import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultServer = 'https://beepboop.kjanat.dev';

export function stateDirectory(): string {
	return join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'beepboop');
}
