import { readFileSync } from 'node:fs';
import { commitFindings } from './comment-cop.mjs';
const message = readFileSync(process.argv[2], 'utf8');
console.log(JSON.stringify(commitFindings('commit', message), null, 1));
