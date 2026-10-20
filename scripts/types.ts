import { readFile, writeFile } from "node:fs/promises";

const generator = Bun.spawn(["bun", "x", "wrangler", "types"], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await generator.exited) !== 0) throw new Error("Worker type generation failed");
const path = "worker-configuration.d.ts";
const generated = await readFile(path, "utf8");
// Wrangler's runtime declarations contain trailing spaces. Normalize generated
// bytes consistently so regeneration and Git whitespace checks agree.
await writeFile(path, generated.replace(/[ \t]+$/gm, ""));
