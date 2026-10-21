"""Deliver Actup from signed tags and attested checksums using fixed templates."""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from publish import (
    SHA,
    GitHub,
    integer,
    manifest_version,
    record,
    require,
    unique,
    version,
)

SOURCE = "kjanat/actup"
SOURCE_ID = 1133686965
TARGETS = {
    "kjanat/scoop-bucket": (1357905513, "bucket/actup.json", "scoop"),
    "kjanat/homebrew-tap": (1358284523, "Formula/actup.rb", "brew"),
}
CRATES = (
    "tree-sitter-github-actions",
    "actup-core",
    "actup-providers",
    "actup-provider-github",
    "actup-provider-gitlab",
    "actup-provider-gitea",
    "actup",
    "actup-lsp",
    "actup-mcp",
)
JOBS = ("Create Release", "Publish to npm", "Publish container image") + tuple(
    f"Publish {crate} to crates.io" for crate in CRATES
)


def verify_attestation(github, content, source_sha, tag):
    with tempfile.TemporaryDirectory(prefix="actup-proof-") as temporary:
        path = Path(temporary) / "SHA256SUMS.txt"
        path.write_bytes(content)
        result = subprocess.run(
            [
                "gh",
                "attestation",
                "verify",
                str(path),
                "--repo",
                SOURCE,
                "--signer-workflow",
                f"{SOURCE}/.github/workflows/release.yml",
                "--source-digest",
                source_sha,
                "--source-ref",
                f"refs/tags/{tag}",
                "--deny-self-hosted-runners",
            ],
            env={**os.environ, "GH_TOKEN": github.token},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=90,
            check=False,
        )
    require(result.returncode == 0, "Checksum attestation verification failed")


def pages(github, endpoint, field):
    values = []
    separator = "&" if "?" in endpoint else "?"
    for page in range(1, 11):
        entries = github.json(f"{endpoint}{separator}per_page=100&page={page}").get(
            field
        )
        require(isinstance(entries, list), "Invalid paginated response")
        values.extend(record(entry) for entry in entries)
        if len(entries) < 100:
            return values
    raise ValueError("Pagination limit exceeded")


def publication_ready(github, tag, source_sha):
    runs = pages(
        github,
        f"/repos/{SOURCE}/actions/workflows/release.yml/runs?event=push&head_sha={source_sha}",
        "workflow_runs",
    )
    runs = [
        run
        for run in runs
        if run.get("head_sha") == source_sha
        and run.get("head_branch") == tag
        and run.get("event") == "push"
        and run.get("path") == ".github/workflows/release.yml"
        and record(run.get("repository")).get("id") == SOURCE_ID
    ]
    require(bool(runs), "No matching publication run")
    run = max(runs, key=lambda item: integer(item.get("id")))
    jobs = pages(
        github,
        f"/repos/{SOURCE}/actions/runs/{integer(run['id'])}/jobs?filter=latest",
        "jobs",
    )
    for name in JOBS:
        job = unique(jobs, lambda item: item.get("name") == name, "publication job")
        require(
            job.get("status") == "completed" and job.get("conclusion") == "success",
            f"Publication incomplete: {name}",
        )


def release_identity(release):
    return {
        key: release.get(key)
        for key in ("id", "tag_name", "draft", "prerelease", "published_at", "assets")
    }


def verified_checksums(github, release_id, source_sha):
    source = github.json(f"/repos/{SOURCE}")
    require(
        source.get("id") == SOURCE_ID and source.get("full_name") == SOURCE,
        "Source identity changed",
    )
    release = github.json(f"/repos/{SOURCE}/releases/{release_id}")
    require(
        release.get("id") == release_id
        and release.get("draft") is False
        and release.get("prerelease") is False
        and isinstance(release.get("published_at"), str),
        "Release must be published and stable",
    )
    tag = release.get("tag_name")
    require(isinstance(tag, str) and tag.startswith("v"), "Invalid release tag")
    require(version(tag[1:]) >= (0, 1, 0), "Release below minimum version")
    reference = record(github.json(f"/repos/{SOURCE}/git/ref/tags/{tag}").get("object"))
    require(
        reference.get("type") == "tag"
        and isinstance(reference.get("sha"), str)
        and SHA.fullmatch(reference["sha"]),
        "Expected annotated tag",
    )
    signed = github.json(f"/repos/{SOURCE}/git/tags/{reference['sha']}")
    require(
        signed.get("tag") == tag
        and record(signed.get("verification")).get("verified") is True
        and record(signed.get("object")).get("type") == "commit"
        and record(signed.get("object")).get("sha") == source_sha,
        "Invalid signed tag",
    )
    publication_ready(github, tag, source_sha)
    asset = unique(
        release.get("assets"),
        lambda item: item.get("name") == "SHA256SUMS.txt",
        "checksums",
    )
    content = github.bytes(
        f"/repos/{SOURCE}/releases/assets/{integer(asset.get('id'))}", binary=True
    )
    require(
        asset.get("size") == len(content)
        and asset.get("digest") == f"sha256:{hashlib.sha256(content).hexdigest()}",
        "Checksum asset changed",
    )
    verify_attestation(github, content, source_sha, tag)
    checksums = {}
    for line in content.decode("ascii").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (actup-[A-Za-z0-9_.-]+)", line)
        require(match is not None, "Invalid checksum line")
        digest, name = match.groups()
        require(name not in checksums, "Duplicate archive checksum")
        archive = unique(
            release.get("assets"), lambda item: item.get("name") == name, "archive"
        )
        require(
            archive.get("digest") == f"sha256:{digest}",
            "Archive differs from attested checksum",
        )
        checksums[name] = digest
    return tag[1:], checksums, release_identity(release), reference["sha"]


def render(release_version, checksums, kind):
    version(release_version)

    def archive(target, extension):
        name = f"actup-v{release_version}-{target}.{extension}"
        digest = checksums.get(name)
        require(
            isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest),
            "Missing archive checksum",
        )
        return (
            f"https://github.com/{SOURCE}/releases/download/v{release_version}/{name}",
            digest,
        )

    if kind == "scoop":
        architectures = {}
        for arch, target in (
            ("64bit", "x86_64-pc-windows-msvc"),
            ("arm64", "aarch64-pc-windows-msvc"),
        ):
            url, digest = archive(target, "zip")
            architectures[arch] = {"url": url, "hash": digest, "bin": "actup.exe"}
        return (
            json.dumps(
                {
                    "version": release_version,
                    "description": "Check and update GitHub Actions references",
                    "homepage": f"https://github.com/{SOURCE}",
                    "license": "MIT|Apache-2.0",
                    "architecture": architectures,
                },
                indent=4,
            )
            + "\n"
        ).encode()
    require(kind == "brew", "Unknown destination format")
    lines = [
        "class Actup < Formula",
        '  desc "Check and update GitHub Actions references"',
        f'  homepage "https://github.com/{SOURCE}"',
        f'  version "{release_version}"',
        '  license any_of: ["MIT", "Apache-2.0"]',
    ]
    for os_name, suffix in (("macos", "apple-darwin"), ("linux", "unknown-linux-musl")):
        lines.append(f"  on_{os_name} do")
        for arch, cpu in (("arm", "aarch64"), ("intel", "x86_64")):
            url, digest = archive(f"{cpu}-{suffix}", "tar.gz")
            lines.extend([
                f"    on_{arch} do",
                f'      url "{url}"',
                f'      sha256 "{digest}"',
                "    end",
            ])
        lines.append("  end")
    lines.extend([
        "  def install",
        '    bin.install "actup"',
        "  end",
        "  test do",
        '    assert_match version.to_s, shell_output("#{bin}/actup --version")',
        "  end",
        "end",
    ])
    return ("\n".join(lines) + "\n").encode()


def publish(github, destination, release_id, source_sha, operation_id, dry_run):
    require(destination in TARGETS, "Unknown destination")
    repository_id, path, kind = TARGETS[destination]
    require(
        isinstance(source_sha, str) and SHA.fullmatch(source_sha), "Invalid source SHA"
    )
    expected_route = "actup-scoop" if kind == "scoop" else "actup-homebrew"
    require(
        operation_id == f"{SOURCE_ID}:{release_id}:{expected_route}",
        "Invalid operation identity",
    )
    repository = github.json(f"/repos/{destination}", destination=True)
    require(
        repository.get("id") == repository_id
        and repository.get("full_name") == destination
        and repository.get("default_branch") == "master",
        "Destination identity changed",
    )
    release_version, checksums, identity, tag_sha = verified_checksums(
        github, release_id, source_sha
    )
    content = render(release_version, checksums, kind)
    endpoint = f"/repos/{destination}/contents/{path}"
    try:
        previous = github.json(f"{endpoint}?ref=master", destination=True)
    except ValueError as error:
        if str(error) != f"GitHub request failed: HTTP 404 {endpoint}?ref=master":
            raise
        previous = None
    if previous is not None:
        require(
            previous.get("type") == "file"
            and previous.get("encoding") == "base64"
            and isinstance(previous.get("sha"), str)
            and SHA.fullmatch(previous["sha"]),
            "Invalid current manifest",
        )
        current = base64.b64decode(previous["content"])
        current_version = manifest_version(current, kind)
        require(
            version(current_version) <= version(release_version), "Refusing downgrade"
        )
        if current_version == release_version:
            require(current == content, "Same version has different bytes")
            return "already published"
    if dry_run:
        return f"verified v{release_version}; dry run"
    require(
        release_identity(github.json(f"/repos/{SOURCE}/releases/{release_id}"))
        == identity,
        "Release changed",
    )
    reference = record(
        github.json(f"/repos/{SOURCE}/git/ref/tags/v{release_version}").get("object")
    )
    require(
        reference.get("type") == "tag" and reference.get("sha") == tag_sha,
        "Tag changed",
    )
    body = {
        "message": f"chore: update actup to v{release_version}",
        "branch": "master",
        "content": base64.b64encode(content).decode("ascii"),
    }
    if previous is not None:
        body["sha"] = previous["sha"]
    result = github.json(endpoint, method="PUT", destination=True, body=body)
    commit = record(result.get("commit")).get("sha")
    require(isinstance(commit, str) and SHA.fullmatch(commit), "No publication commit")
    actual = github.json(f"{endpoint}?ref={commit}", destination=True)
    require(
        actual.get("encoding") == "base64"
        and base64.b64decode(actual["content"]) == content,
        "Published bytes differ",
    )
    return f"published v{release_version} at {commit}"


def main():
    require(
        os.environ.get("SOURCE_REPOSITORY_ID") == str(SOURCE_ID), "Unexpected source"
    )
    require(
        os.environ.get("GITHUB_REF") == "refs/heads/master"
        and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch",
        "Unexpected receiver context",
    )
    destination = os.environ.get("GITHUB_REPOSITORY", "")
    require(destination in TARGETS, "Unknown destination")
    release_id = os.environ.get("RELEASE_ID", "")
    require(re.fullmatch(r"[1-9][0-9]*", release_id), "Invalid release ID")
    dry_run = os.environ.get("DRY_RUN")
    require(dry_run in ("true", "false"), "Invalid dry run")
    token = os.environ.get("GITHUB_TOKEN")
    require(isinstance(token, str) and token, "Missing receiver token")
    print(
        publish(
            GitHub(token, destination),
            destination,
            int(release_id),
            os.environ.get("SOURCE_SHA"),
            os.environ.get("OPERATION_ID"),
            dry_run == "true",
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(f"Actup delivery: {error}", file=sys.stderr)
        sys.exit(1)
