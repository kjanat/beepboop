# Changelog

All notable changes to Beepboop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Generated release workflows build Cargo binaries with `cargo auditable build`, so the SBOM lists the crates each binary was built with. The SBOM names the repository and release version, gives every file SHA1 and SHA256 digests, and lists no packages or CPEs guessed from asset file names. https://github.com/kjanat/beepboop/pull/72
- A setup rebuild replaces the per-crate `cargo publish --locked --package 'name'` lines an earlier generator wrote with `beepboop publish`, so a rerun skips published crates, retries rate limits and reports each crate. Commands that differ from those lines stay as written.
