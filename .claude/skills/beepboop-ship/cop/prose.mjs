import { readFileSync } from 'node:fs';
import { proseFindings } from './comment-cop.mjs';
console.log(
	JSON.stringify(
		proseFindings('pr', readFileSync(process.argv[2], 'utf8')).map(f => ({
			reasons: f.reasons,
			matches: (f.matches ?? []).map(m => m.text),
		})),
		null,
		1,
	),
);
