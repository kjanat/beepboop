# @kjanat/beepboop

Authenticated CLI for [Beepboop](https://beepboop.kjanat.dev): inspect repositories,
prepare releases, approve operations and follow publication results.

Requires **Bun 1.4.4 or later**.

```sh
bun add --global @kjanat/beepboop
beepboop auth login
beepboop repositories list
beepboop repositories adopt owner/repository
beepboop release patch
beepboop releases --help
```

Login opens your browser for approval. The CLI stores a session in your user
state directory; `beepboop auth logout` revokes it. The service must authorize
your account. Installing the CLI does not grant access to the service.

`repositories adopt` enrolls a repository installed on the Beepboop GitHub App,
guides you through release setup, and previews the proposed files before asking
to open a setup PR. Workflow filenames and jobs are generated for you. Merge the
PR yourself to activate the configuration. `repositories setup` is an alias.

`beepboop release patch` resolves the current checkout's GitHub remote and asks
the server what will ship. A sole release stream is selected automatically;
ambiguous streams and an omitted version are prompted for. Review the package
versions and source commit, then confirm preparation. Plan IDs and source SHAs
are carried automatically. The server's default branch is the release source;
uncommitted local changes are not included. Use `--repository` and `--stream` to
override resolution, `--json` for a prompt-free preview, or `--yes` to skip the
confirmation. When stdin is not a terminal the CLI starts after the preview
without asking. Publication still follows repository policy.

For scripts, preview explicit choices and apply the reviewed plan separately:

```sh
beepboop repositories adopt owner/repository --choices choices.json --output plan.json --json
beepboop repositories adopt owner/repository --plan plan.json --apply
```

```sh
beepboop --version
beepboop completions bash
beepboop releases plan kjanat/beepboop --stream cli --releaseVersion 0.1.0
```

The same package is published on JSR. To call it from a Bun application:

```sh
bunx jsr add @kjanat/beepboop
```

```ts
import { run } from '@kjanat/beepboop';
await run();
```

`run()` uses the current process arguments. The npm package supplies the
`beepboop` executable; JSR's npm compatibility layer exposes the module.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
