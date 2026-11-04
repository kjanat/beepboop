# @kjanat/beepboop

Authenticated CLI for [Beepboop](https://beepboop.kjanat.dev): inspect repositories,
prepare releases, approve operations and follow publication results.

Requires **Bun 1.4.4 or later**.

```sh
bun add --global @kjanat/beepboop
beepboop auth login
beepboop repositories list
beepboop releases --help
```

Login opens your browser for approval. The CLI stores a session in your user
state directory; `beepboop auth logout` revokes it. The service must authorize
your account. Installing the CLI does not grant access to the service.

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
