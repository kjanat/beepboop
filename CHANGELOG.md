# Changelog

All notable changes to Beepboop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Generated release workflows build Cargo binaries with `cargo auditable build`, so the SBOM lists the crates each binary was built with. The SBOM names the repository and release version, gives every file SHA1 and SHA256 digests, and lists no packages or CPEs guessed from asset file names. https://github.com/kjanat/beepboop/pull/72
- `beepboop adopt` no longer offers workflow jobs that setup cannot patch, such as reusable, matrix, dependent, conditional or container jobs, the job that already publishes, or workflows whose automatic triggers other jobs share. It names why each is left out and asks again, so the choice ends in a generated workflow instead of a blocker at the end.
