import base64
import hashlib
import subprocess
import unittest
from unittest.mock import patch

import actup

SHA = "a" * 40
TAG_SHA = "b" * 40
DEST = "kjanat/scoop-bucket"
ROOT = "/repos/kjanat/actup"
ENDPOINT = f"/repos/{DEST}/contents/bucket/actup.json"
TARGETS = [
    "x86_64-pc-windows-msvc.zip",
    "aarch64-pc-windows-msvc.zip",
    "x86_64-apple-darwin.tar.gz",
    "aarch64-apple-darwin.tar.gz",
    "x86_64-unknown-linux-musl.tar.gz",
    "aarch64-unknown-linux-musl.tar.gz",
]
CHECKSUMS = {f"actup-v0.1.0-{target}": "c" * 64 for target in TARGETS}


class Fake:
    token = "test-only"

    def __init__(self):
        self.writes = []
        self.previous = None
        self.checksums = "".join(
            f"{digest}  {name}\n" for name, digest in CHECKSUMS.items()
        ).encode()
        self.release = {
            "id": 44,
            "tag_name": "v0.1.0",
            "draft": False,
            "prerelease": False,
            "published_at": "2026-10-21T00:00:00Z",
            "assets": [
                {
                    "id": 55,
                    "name": "SHA256SUMS.txt",
                    "size": len(self.checksums),
                    "digest": "sha256:" + hashlib.sha256(self.checksums).hexdigest(),
                },
                *[
                    {"id": i + 100, "name": name, "digest": "sha256:" + digest}
                    for i, (name, digest) in enumerate(CHECKSUMS.items())
                ],
            ],
        }
        self.signed = True
        self.job_conclusion = "success"
        self.changed_tag = False
        self.tag_reads = 0

    def bytes(self, path, **kwargs):
        if path == ROOT + "/releases/assets/55":
            return self.checksums
        raise AssertionError(path)

    def json(self, path, **kwargs):
        if path == ROOT:
            return {"id": actup.SOURCE_ID, "full_name": actup.SOURCE}
        if path == ROOT + "/releases/44":
            return self.release
        if path == ROOT + "/git/ref/tags/v0.1.0":
            self.tag_reads += 1
            return {
                "object": {
                    "type": "tag",
                    "sha": "e" * 40
                    if self.changed_tag and self.tag_reads > 1
                    else TAG_SHA,
                }
            }
        if path == ROOT + "/git/tags/" + TAG_SHA:
            return {
                "tag": "v0.1.0",
                "verification": {"verified": self.signed},
                "object": {"type": "commit", "sha": SHA},
            }
        if "/actions/workflows/" in path:
            return {
                "workflow_runs": [
                    {
                        "id": 123,
                        "head_sha": SHA,
                        "head_branch": "v0.1.0",
                        "event": "push",
                        "path": ".github/workflows/release.yml",
                        "repository": {"id": actup.SOURCE_ID},
                    }
                ]
            }
        if "/actions/runs/123/jobs" in path:
            return {
                "jobs": [
                    {
                        "name": name,
                        "status": "completed",
                        "conclusion": self.job_conclusion,
                    }
                    for name in actup.JOBS
                ]
            }
        if path == "/repos/" + DEST:
            return {"id": 1357905513, "full_name": DEST, "default_branch": "master"}
        if path == ENDPOINT + "?ref=master":
            if self.previous is None:
                raise ValueError(f"GitHub request failed: HTTP 404 {path}")
            return {
                "type": "file",
                "encoding": "base64",
                "sha": "d" * 40,
                "content": base64.b64encode(self.previous).decode(),
            }
        if path == ENDPOINT and kwargs.get("method") == "PUT":
            self.writes.append(kwargs["body"])
            return {"commit": {"sha": "f" * 40}}
        if path == ENDPOINT + "?ref=" + "f" * 40:
            return {"encoding": "base64", "content": self.writes[-1]["content"]}
        raise AssertionError(path)


class ActupTests(unittest.TestCase):
    def deliver(self, github, dry=False):
        return actup.publish(
            github, DEST, 44, SHA, f"{actup.SOURCE_ID}:44:actup-scoop", dry
        )

    @patch("actup.verify_attestation")
    def test_first_publication_and_idempotency(self, proof):
        github = Fake()
        self.assertIn("published", self.deliver(github))
        proof.assert_called_once_with(github, github.checksums, SHA, "v0.1.0")
        self.assertNotIn("sha", github.writes[0])
        github.previous = base64.b64decode(github.writes[0]["content"])
        self.assertEqual(self.deliver(github), "already published")
        self.assertEqual(len(github.writes), 1)

    @patch("actup.verify_attestation")
    def test_dry_run_has_no_write(self, _proof):
        github = Fake()
        self.assertIn("dry run", self.deliver(github, True))
        self.assertEqual(github.writes, [])

    @patch("actup.verify_attestation")
    def test_tag_mutation_is_rejected(self, _proof):
        github = Fake()
        github.changed_tag = True
        with self.assertRaisesRegex(ValueError, "Tag changed"):
            self.deliver(github)
        self.assertEqual(github.writes, [])

    @patch("actup.verify_attestation")
    def test_bad_publication_evidence(self, _proof):
        for failure in ["unsigned", "prerelease", "job", "archive"]:
            github = Fake()
            if failure == "unsigned":
                github.signed = False
            if failure == "prerelease":
                github.release["prerelease"] = True
            if failure == "job":
                github.job_conclusion = "skipped"
            if failure == "archive":
                github.release["assets"][1]["digest"] = "sha256:" + "d" * 64
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                self.deliver(github)
            self.assertEqual(github.writes, [])

    @patch("actup.verify_attestation", side_effect=ValueError("bad attestation"))
    def test_bad_attestation_rejected(self, _proof):
        github = Fake()
        with self.assertRaisesRegex(ValueError, "attestation"):
            self.deliver(github)
        self.assertEqual(github.writes, [])

    @patch("actup.verify_attestation")
    def test_downgrade_and_changed_bytes_rejected(self, _proof):
        for current in [b'{"version":"0.2.0"}', b'{"version":"0.1.0"}']:
            github = Fake()
            github.previous = current
            with self.assertRaises(ValueError):
                self.deliver(github)
            self.assertEqual(github.writes, [])

    def test_formula_syntax_and_missing_archive(self):
        content = actup.render("0.1.0", CHECKSUMS, "brew")
        result = subprocess.run(
            ["ruby", "--disable=gems", "-c"], input=content, capture_output=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b"on_linux", content)
        with self.assertRaisesRegex(ValueError, "Missing archive"):
            actup.render("0.1.0", {}, "scoop")

    @patch("actup.subprocess.run")
    def test_provenance_constraints(self, run):
        run.return_value.returncode = 0
        actup.verify_attestation(Fake(), b"test", SHA, "v0.1.0")
        args = run.call_args.args[0]
        self.assertIn("kjanat/actup/.github/workflows/release.yml", args)
        self.assertIn(SHA, args)
        self.assertIn("refs/tags/v0.1.0", args)
        self.assertIn("--deny-self-hosted-runners", args)


if __name__ == "__main__":
    unittest.main()
