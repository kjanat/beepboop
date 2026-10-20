"""Verify prepared release bytes before updating a downstream package manifest.

The dispatch carries identifiers, never a destination, URL, file path or command.
Repository policy is checked in here; the receiver's token can only write its
own repository. Public source downloads deliberately carry no credentials.
"""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

API = "https://api.github.com"
SOURCE = "kjanat/actionlint"
SOURCE_ID = 1326162482
LIMIT = 2 * 1024 * 1024
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
SHA = re.compile(r"[a-f0-9]{40}")


@dataclass(frozen=True)
class Target:
    repository: str
    repository_id: int
    path: str
    asset: str
    kind: str


TARGETS = {
    "kjanat/scoop-bucket": Target(
        "kjanat/scoop-bucket", 1357905513, "bucket/actionlint.json", "actionlint-scoop.json", "scoop"
    ),
    "kjanat/homebrew-tap": Target(
        "kjanat/homebrew-tap", 1358284523, "Casks/actionlint.rb", "actionlint-homebrew.rb", "brew"
    ),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def record(value):
    require(isinstance(value, dict), "Expected an object")
    return value


def integer(value):
    require(type(value) is int and value > 0, "Expected a positive integer")
    return value


def json_loads(content):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result

    def constant(_value):
        raise ValueError("Non-finite JSON number")

    return json.loads(content, object_pairs_hook=pairs, parse_constant=constant)


def version(value):
    require(isinstance(value, str) and VERSION.fullmatch(value), "Expected a stable version")
    return tuple(int(part) for part in value.split("."))


def unique(items, predicate, label):
    require(isinstance(items, list), f"Invalid {label} list")
    matches = [record(item) for item in items if predicate(record(item))]
    require(len(matches) == 1, f"Expected exactly one {label}")
    return matches[0]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token, destination):
        self.token = token
        self.destination = destination

    def bytes(self, path, *, body=None, method="GET", binary=False, destination=False):
        require(path.startswith("/repos/"), "Invalid GitHub API path")
        if destination:
            require(
                path.startswith(f"/repos/{self.destination}/"),
                "Token must stay within the destination repository",
            )
        headers = {
            "Accept": "application/octet-stream" if binary else "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "beepboop",
        }
        if destination:
            headers["Authorization"] = f"Bearer {self.token}"
        data = None if body is None else json.dumps(body).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
        opener = urllib.request.build_opener(NoRedirect)
        try:
            response = opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            # Asset storage redirects receive no authentication header. JSON
            # redirects (including repository renames) require a policy update.
            location = error.headers.get("Location", "")
            if binary and method == "GET" and error.code in (301, 302, 303, 307, 308):
                parsed = urllib.parse.urlsplit(location)
                require(
                    parsed.scheme == "https"
                    and parsed.hostname in (
                        "release-assets.githubusercontent.com",
                        "productionresultssa0.blob.core.windows.net",
                    ),
                    "Unexpected asset redirect",
                )
                response = opener.open(urllib.request.Request(location), timeout=30)
            else:
                raise ValueError(f"GitHub request failed: HTTP {error.code} {path}") from None
        with response:
            content = response.read(LIMIT + 1)
        require(len(content) <= LIMIT, "GitHub response exceeds size limit")
        return content

    def json(self, path, **kwargs):
        return record(json_loads(self.bytes(path, **kwargs)))

    def verify_candidate(self, content, source_sha, tag):
        # The release verifier compares this manifest with the trusted prepare
        # artifact before attesting it. This proof remains available after
        # Actions artifacts expire and needs no cross-repository Actions token.
        with tempfile.TemporaryDirectory(prefix="beepboop-proof-") as temporary:
            manifest = Path(temporary) / "release-candidate.json"
            manifest.write_bytes(content)
            result = subprocess.run(
                [
                    "gh", "attestation", "verify", str(manifest),
                    "--repo", SOURCE,
                    "--signer-workflow", f"{SOURCE}/.github/workflows/release.yml",
                    "--source-digest", source_sha,
                    "--source-ref", f"refs/tags/{tag}",
                    "--deny-self-hosted-runners",
                ],
                env={**os.environ, "GH_TOKEN": self.token},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=90,
                check=False,
            )
        require(result.returncode == 0, "Candidate attestation verification failed")


def manifest_version(content, kind):
    if kind == "scoop":
        value = record(json_loads(content)).get("version")
    else:
        matches = re.findall(rb'^\s*version "([^"]+)"\s*$', content, re.MULTILINE)
        require(len(matches) == 1, "Expected one Homebrew version")
        value = matches[0].decode("ascii")
    version(value)
    return value


def validate_package(content, target, release_version, declarations):
    if target.kind == "brew":
        with tempfile.TemporaryDirectory(prefix="beepboop-ruby-") as temporary:
            path = Path(temporary) / "actionlint.rb"
            path.write_bytes(content)
            environment = {key: value for key, value in os.environ.items() if key != "RUBYOPT"}
            result = subprocess.run(
                ["ruby", "--disable=gems", "-c", str(path)],
                env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=30, check=False,
            )
        require(result.returncode == 0, "Homebrew manifest has invalid Ruby syntax")
        return
    require(target.kind == "scoop", "Unknown package format")
    package = record(json_loads(content))
    architectures = record(package.get("architecture"))
    platforms = {"32bit": "386", "64bit": "amd64", "arm64": "arm64"}
    require("64bit" in architectures and set(architectures) <= set(platforms), "Invalid Scoop architectures")
    for architecture, raw in architectures.items():
        item = record(raw)
        asset = f"actionlint_{release_version}_windows_{platforms[architecture]}.zip"
        expected_url = f"https://github.com/{SOURCE}/releases/download/v{release_version}/{asset}"
        require(item.get("url") == expected_url, "Scoop URL differs from release archive")
        require(item.get("bin") == ["actionlint.exe"], "Invalid Scoop executable")
        digest = item.get("hash")
        require(isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest), "Invalid Scoop archive digest")
        declaration = unique(declarations, lambda entry: entry.get("name") == asset, "Scoop archive")
        require(declaration.get("sha256") == digest, "Scoop hash differs from prepared archive")


def release_identity(release, target):
    assets = release.get("assets")
    return {
        "id": release.get("id"), "tag": release.get("tag_name"),
        "published_at": release.get("published_at"), "draft": release.get("draft"),
        "prerelease": release.get("prerelease"),
        "assets": [unique(assets, lambda a: a.get("name") == name, "publication asset")
                   for name in ("release-candidate.json", target.asset)],
    }


def verified_asset(github, release_id, source_sha, target):
    source = github.json(f"/repos/{SOURCE}")
    require(source.get("id") == SOURCE_ID and source.get("full_name") == SOURCE, "Source identity changed")
    release = github.json(f"/repos/{SOURCE}/releases/{release_id}")
    require(
        release.get("id") == release_id
        and release.get("draft") is False
        and release.get("prerelease") is False
        and isinstance(release.get("published_at"), str),
        "Release is not published and stable",
    )
    tag = release.get("tag_name")
    require(isinstance(tag, str) and tag.startswith("v"), "Invalid version tag")
    release_version = tag[1:]
    require(version(release_version) >= (2, 0, 0), "Only v2+ releases use Beepboop")
    reference = github.json(f"/repos/{SOURCE}/git/ref/tags/{tag}")
    tag_object = record(reference.get("object"))
    require(tag_object.get("type") == "tag", "Release tag must be annotated")
    tag_sha = tag_object.get("sha")
    require(isinstance(tag_sha, str) and SHA.fullmatch(tag_sha), "Invalid tag object SHA")
    signed = github.json(f"/repos/{SOURCE}/git/tags/{tag_sha}")
    require(
        signed.get("tag") == tag
        and record(signed.get("verification")).get("verified") is True
        and record(signed.get("object")).get("type") == "commit"
        and record(signed.get("object")).get("sha") == source_sha,
        "Signed release tag does not match the dispatched commit",
    )
    assets = release.get("assets")
    candidate_asset = unique(assets, lambda a: a.get("name") == "release-candidate.json", "candidate manifest")
    candidate = github.bytes(f"/repos/{SOURCE}/releases/assets/{integer(candidate_asset.get('id'))}", binary=True)
    manifest = record(json_loads(candidate))
    require(
        type(manifest.get("schema_version")) is int
        and manifest.get("schema_version") == 1
        and manifest.get("repository") == SOURCE
        and manifest.get("tag") == tag
        and manifest.get("version") == release_version
        and manifest.get("candidate") == source_sha
        and manifest.get("workflow") == ".github/workflows/release-prepare.yml",
        "Candidate identity does not match release",
    )
    run_id = integer(manifest.get("run_id"))
    attempt = integer(manifest.get("run_attempt"))
    run = github.json(f"/repos/{SOURCE}/actions/runs/{run_id}/attempts/{attempt}")
    require(
        run.get("id") == run_id
        and run.get("run_attempt") == attempt
        and run.get("event") == "workflow_dispatch"
        and run.get("path") == ".github/workflows/release-prepare.yml"
        and run.get("head_branch") == "master"
        and run.get("head_sha") == manifest.get("source")
        and isinstance(run.get("head_sha"), str)
        and SHA.fullmatch(run["head_sha"])
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and record(run.get("repository")).get("id") == SOURCE_ID,
        "Candidate was not prepared by the trusted workflow",
    )
    github.verify_candidate(candidate, source_sha, tag)
    declaration = unique(manifest.get("assets"), lambda a: a.get("name") == target.asset, "declared package")
    asset = unique(assets, lambda a: a.get("name") == target.asset, "published package")
    content = github.bytes(f"/repos/{SOURCE}/releases/assets/{integer(asset.get('id'))}", binary=True)
    require(
        type(declaration.get("size")) is int
        and len(content) == declaration["size"]
        and hashlib.sha256(content).hexdigest() == declaration.get("sha256"),
        "Package bytes differ from the prepared digest",
    )
    require(manifest_version(content, target.kind) == release_version, "Package version differs from release")
    validate_package(content, target, release_version, manifest.get("assets"))
    return release_version, content, release_identity(release, target), tag_sha


def publish(github, target, release_id, source_sha, operation_id, dry_run):
    require(isinstance(source_sha, str) and SHA.fullmatch(source_sha), "Invalid source SHA")
    require(re.fullmatch(r"[A-Za-z0-9._:-]{1,200}", operation_id), "Invalid operation ID")
    destination = github.json(f"/repos/{target.repository}", destination=True)
    require(
        destination.get("id") == target.repository_id
        and destination.get("full_name") == target.repository
        and destination.get("default_branch") == "master",
        "Destination identity or branch changed",
    )
    release_version, content, identity, tag_sha = verified_asset(github, release_id, source_sha, target)
    endpoint = f"/repos/{target.repository}/contents/{target.path}"
    previous = github.json(f"{endpoint}?ref=master", destination=True)
    require(
        previous.get("type") == "file"
        and previous.get("encoding") == "base64"
        and isinstance(previous.get("content"), str)
        and isinstance(previous.get("sha"), str)
        and SHA.fullmatch(previous["sha"]),
        "Invalid current package manifest",
    )
    current = base64.b64decode(previous["content"])
    current_version = manifest_version(current, target.kind)
    require(version(current_version) <= version(release_version), "Refusing a package downgrade")
    if current_version == release_version:
        require(current == content, "Previously published version has different bytes")
        return "already published"
    if dry_run:
        return f"verified v{release_version}; dry run"
    current_release = github.json(f"/repos/{SOURCE}/releases/{release_id}")
    require(release_identity(current_release, target) == identity, "Release changed during verification")
    current_tag = github.json(f"/repos/{SOURCE}/git/ref/tags/{identity['tag']}")
    current_object = record(current_tag.get("object"))
    require(current_object.get("type") == "tag" and current_object.get("sha") == tag_sha,
            "Release tag changed during verification")
    # The blob SHA is a compare-and-swap. A concurrent change is rejected by
    # GitHub instead of being overwritten; workflow concurrency serializes
    # Beepboop's own runs.
    result = github.json(
        endpoint,
        method="PUT",
        destination=True,
        body={
            "message": f"chore: update actionlint to v{release_version}\n\nBeepboop: {operation_id}",
            "branch": "master",
            "sha": previous["sha"],
            "content": base64.b64encode(content).decode("ascii"),
        },
    )
    commit = record(result.get("commit")).get("sha")
    require(isinstance(commit, str) and SHA.fullmatch(commit), "Publication commit was not confirmed")
    actual = github.json(f"{endpoint}?ref={commit}", destination=True)
    require(
        actual.get("encoding") == "base64"
        and isinstance(actual.get("content"), str)
        and base64.b64decode(actual["content"]) == content,
        "Published bytes could not be confirmed",
    )
    return f"published v{release_version} at {commit}"


def main():
    target = TARGETS.get(os.environ.get("GITHUB_REPOSITORY"))
    require(target is not None, "This repository has no publication policy")
    require(os.environ.get("SOURCE_REPOSITORY_ID") == str(SOURCE_ID), "Unexpected source repository ID")
    require(os.environ.get("GITHUB_REF") == "refs/heads/master", "Receiver must run on master")
    require(os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Receiver requires workflow_dispatch")
    release_id = os.environ.get("RELEASE_ID", "")
    require(re.fullmatch(r"[1-9][0-9]*", release_id), "Invalid release ID")
    dry_run = os.environ.get("DRY_RUN", "")
    require(dry_run in ("true", "false"), "Invalid dry-run value")
    token = os.environ.get("GITHUB_TOKEN")
    require(isinstance(token, str) and token, "Missing receiver token")
    print(publish(
        GitHub(token, target.repository), target, int(release_id),
        os.environ.get("SOURCE_SHA", ""), os.environ.get("OPERATION_ID", ""), dry_run == "true",
    ))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(f"Beepboop: {error}", file=sys.stderr)
        sys.exit(1)
