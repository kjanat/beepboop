import base64
import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from publish import (
    GitHub,
    SOURCE,
    SOURCE_ID,
    TARGETS,
    manifest_version,
    publish,
    validate_package,
    json_loads,
)

COMMIT = "a" * 40
TAG_OBJECT = "b" * 40
PREPARE = "c" * 40
PUBLISHED = "d" * 40
TARGET = TARGETS["kjanat/scoop-bucket"]
ROOT = f"/repos/{SOURCE}"
DEST = f"/repos/{TARGET.repository}"


class Fixture:
    def __init__(self):
        self.package = json.dumps({
            "version": "2.0.0",
            "architecture": {
                "64bit": {
                    "url": "https://github.com/kjanat/actionlint/releases/download/v2.0.0/actionlint_2.0.0_windows_amd64.zip",
                    "bin": ["actionlint.exe"],
                    "hash": "f" * 64,
                }
            },
        }).encode()
        self.current = b'{"version":"1.17.0"}\n'
        self.manifest = {
            "schema_version": 1,
            "repository": SOURCE,
            "tag": "v2.0.0",
            "version": "2.0.0",
            "candidate": COMMIT,
            "workflow": ".github/workflows/release-prepare.yml",
            "run_id": 10,
            "run_attempt": 1,
            "source": PREPARE,
            "assets": [
                {
                    "name": TARGET.asset,
                    "size": len(self.package),
                    "sha256": hashlib.sha256(self.package).hexdigest(),
                },
                {"name": "actionlint_2.0.0_windows_amd64.zip", "sha256": "f" * 64},
            ],
        }
        self.data = {
            ROOT: {"id": SOURCE_ID, "full_name": SOURCE},
            DEST: {
                "id": TARGET.repository_id,
                "full_name": TARGET.repository,
                "default_branch": "master",
            },
            f"{ROOT}/releases/20": {
                "id": 20,
                "draft": False,
                "prerelease": False,
                "published_at": "2026-10-20T00:00:00Z",
                "tag_name": "v2.0.0",
                "assets": [
                    {"id": 30, "name": "release-candidate.json"},
                    {"id": 31, "name": TARGET.asset},
                ],
            },
            f"{ROOT}/git/ref/tags/v2.0.0": {
                "object": {"type": "tag", "sha": TAG_OBJECT}
            },
            f"{ROOT}/git/tags/{TAG_OBJECT}": {
                "tag": "v2.0.0",
                "verification": {"verified": True},
                "object": {"type": "commit", "sha": COMMIT},
            },
            f"{ROOT}/actions/runs/10/attempts/1": {
                "id": 10,
                "run_attempt": 1,
                "event": "workflow_dispatch",
                "path": ".github/workflows/release-prepare.yml",
                "head_branch": "master",
                "head_sha": PREPARE,
                "status": "completed",
                "conclusion": "success",
                "repository": {"id": SOURCE_ID},
            },
        }
        self.puts = []
        self.proof = True
        self.proof_calls = []
        self.conflict = False
        self.corrupt_confirmation = False

    def json(self, path, **kwargs):
        if path.startswith(DEST):
            assert kwargs.get("destination") is True
        if kwargs.get("method") == "PUT":
            if self.conflict:
                raise ValueError("GitHub request failed: HTTP 409")
            body = kwargs["body"]
            assert body["sha"] == "e" * 40
            assert body["branch"] == "master"
            assert self.proof_calls
            self.puts.append(body)
            self.current = base64.b64decode(body["content"])
            return {"commit": {"sha": PUBLISHED}}
        if path.startswith(f"{DEST}/contents/"):
            content = (
                b"corrupt" if self.corrupt_confirmation and self.puts else self.current
            )
            return {
                "type": "file",
                "encoding": "base64",
                "sha": "e" * 40,
                "content": base64.b64encode(content).decode(),
            }
        return copy.deepcopy(self.data[path])

    def bytes(self, path, **kwargs):
        assert kwargs == {"binary": True}
        if path.endswith("/30"):
            return json.dumps(self.manifest).encode()
        if path.endswith("/31"):
            return self.package
        raise AssertionError(path)

    def verify_candidate(self, content, source_sha, tag):
        if not self.proof:
            raise ValueError("Candidate attestation verification failed")
        self.proof_calls.append((content, source_sha, tag))

    def publish(self, dry_run=False):
        return publish(self, TARGET, 20, COMMIT, "release-20.scoop", dry_run)


class PublicationTests(unittest.TestCase):
    def test_publishes_exact_prepared_bytes_then_confirms_commit(self):
        fixture = Fixture()
        self.assertIn(PUBLISHED, fixture.publish())
        self.assertEqual(fixture.current, fixture.package)
        self.assertEqual(len(fixture.puts), 1)
        self.assertEqual(fixture.proof_calls[0][1:], (COMMIT, "v2.0.0"))

    def test_repeat_delivery_is_noop(self):
        fixture = Fixture()
        fixture.publish()
        self.assertEqual(fixture.publish(), "already published")
        self.assertEqual(len(fixture.puts), 1)

    def test_dry_run_checks_proof_but_never_writes(self):
        fixture = Fixture()
        self.assertIn("dry run", fixture.publish(True))
        self.assertTrue(fixture.proof_calls)
        self.assertFalse(fixture.puts)

    def test_rejects_modified_package_before_publication(self):
        fixture = Fixture()
        fixture.package += b" "
        with self.assertRaisesRegex(ValueError, "digest"):
            fixture.publish()
        self.assertFalse(fixture.puts)

    def test_rejects_unsigned_retargeted_or_lightweight_tags(self):
        mutations = [
            (
                f"{ROOT}/git/ref/tags/v2.0.0",
                "object",
                {"type": "commit", "sha": COMMIT},
            ),
            (f"{ROOT}/git/tags/{TAG_OBJECT}", "verification", {"verified": False}),
            (
                f"{ROOT}/git/tags/{TAG_OBJECT}",
                "object",
                {"type": "commit", "sha": PREPARE},
            ),
        ]
        for path, key, value in mutations:
            with self.subTest(key=key, value=value):
                fixture = Fixture()
                fixture.data[path][key] = value
                with self.assertRaises(ValueError):
                    fixture.publish()
                self.assertFalse(fixture.puts)

    def test_rejects_wrong_repository_and_prepare_context(self):
        mutations = [
            (ROOT, "id", 123),
            (DEST, "id", 123),
            (DEST, "default_branch", "other"),
            (f"{ROOT}/actions/runs/10/attempts/1", "event", "pull_request"),
            (f"{ROOT}/actions/runs/10/attempts/1", "head_sha", COMMIT),
            (f"{ROOT}/actions/runs/10/attempts/1", "head_branch", "fork"),
            (f"{ROOT}/actions/runs/10/attempts/1", "conclusion", "failure"),
        ]
        for path, key, value in mutations:
            with self.subTest(key=key, value=value):
                fixture = Fixture()
                fixture.data[path][key] = value
                with self.assertRaises(ValueError):
                    fixture.publish()
                self.assertFalse(fixture.puts)

    def test_rejects_failed_attestation(self):
        fixture = Fixture()
        fixture.proof = False
        with self.assertRaisesRegex(ValueError, "attestation"):
            fixture.publish()
        self.assertFalse(fixture.puts)

    def test_rejects_downgrade_and_same_version_mutation(self):
        for content in (b'{"version":"2.1.0"}', b'{"version":"2.0.0"}'):
            fixture = Fixture()
            fixture.current = content
            with self.assertRaises(ValueError):
                fixture.publish()
            self.assertFalse(fixture.puts)

    def test_rejects_duplicate_release_assets(self):
        fixture = Fixture()
        fixture.data[f"{ROOT}/releases/20"]["assets"].append({
            "id": 32,
            "name": TARGET.asset,
        })
        with self.assertRaisesRegex(ValueError, "exactly one"):
            fixture.publish()
        self.assertFalse(fixture.puts)

    def test_conflict_does_not_retry_over_newer_content(self):
        fixture = Fixture()
        fixture.conflict = True
        with self.assertRaisesRegex(ValueError, "409"):
            fixture.publish()
        self.assertFalse(fixture.puts)

    def test_unconfirmed_publication_is_failure(self):
        fixture = Fixture()
        fixture.corrupt_confirmation = True
        with self.assertRaisesRegex(ValueError, "confirmed"):
            fixture.publish()

    def test_brew_parser_rejects_ambiguous_versions(self):
        self.assertEqual(
            manifest_version(b'cask "actionlint" do\n version "2.0.0"\nend\n', "brew"),
            "2.0.0",
        )
        with self.assertRaises(ValueError):
            manifest_version(b'version "2.0.0"\nversion "2.1.0"\n', "brew")

    def test_attestation_cli_enforces_signer_digest_ref_and_runner(self):
        with patch("publish.subprocess.run") as run:
            run.return_value.returncode = 0
            GitHub("test", TARGET.repository).verify_candidate(
                b"manifest", COMMIT, "v2.0.0"
            )
            args = run.call_args.args[0]
            self.assertEqual(args[args.index("--source-digest") + 1], COMMIT)
            self.assertEqual(args[args.index("--source-ref") + 1], "refs/tags/v2.0.0")
            self.assertEqual(
                args[args.index("--signer-workflow") + 1],
                "kjanat/actionlint/.github/workflows/release.yml",
            )
            self.assertIn("--deny-self-hosted-runners", args)
            self.assertEqual(run.call_args.kwargs["env"]["GH_TOKEN"], "test")
            self.assertEqual(run.call_args.kwargs["timeout"], 90)


class PackageValidationTests(unittest.TestCase):
    def test_duplicate_and_nonfinite_json_rejected(self):
        for content in ('{"version":"2.0.0","version":"9.0.0"}', '{"value": NaN}'):
            with self.assertRaises(ValueError):
                json_loads(content)

    def test_scoop_url_hash_and_executable_match_prepared_archives(self):
        fixture = Fixture()
        for key, value in (
            ("url", "https://attacker.invalid/package.zip"),
            ("hash", "0" * 64),
            ("bin", ["other.exe"]),
        ):
            with self.subTest(key=key):
                package = json.loads(fixture.package)
                package["architecture"]["64bit"][key] = value
                with self.assertRaises(ValueError):
                    validate_package(
                        json.dumps(package).encode(),
                        TARGET,
                        "2.0.0",
                        fixture.manifest["assets"],
                    )

    def test_ruby_parser_checks_without_executing_manifest(self):
        target = TARGETS["kjanat/homebrew-tap"]
        validate_package(b'raise "must not execute"\n', target, "2.0.0", [])
        with self.assertRaisesRegex(ValueError, "syntax"):
            validate_package(b'cask "actionlint" do\n', target, "2.0.0", [])

    def test_source_mutation_during_verification_prevents_write(self):
        for kind in ("tag", "asset"):
            with self.subTest(kind=kind):
                fixture = Fixture()

                def mutate(_content, _sha, _tag):
                    fixture.proof_calls.append(True)
                    if kind == "tag":
                        fixture.data[f"{ROOT}/git/ref/tags/v2.0.0"]["object"]["sha"] = (
                            "9" * 40
                        )
                    else:
                        fixture.data[f"{ROOT}/releases/20"]["assets"][1]["id"] = 99

                fixture.verify_candidate = mutate
                with self.assertRaisesRegex(ValueError, "changed during verification"):
                    fixture.publish()
                self.assertFalse(fixture.puts)


if __name__ == "__main__":
    unittest.main()
