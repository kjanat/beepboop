/** Authenticated Beepboop CLI. Requires Bun; arguments come from process.argv. @module */
import { app } from './cli.js';

/** Run the CLI with DreamCLI's prompts, completions and structured output. */
export async function run(): Promise<void> {
	await app.run();
}
