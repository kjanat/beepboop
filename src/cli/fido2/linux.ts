import { closeSync, constants, openSync, readdirSync, readFileSync, readSync, writeSync } from 'node:fs';
import type { HidDevice, HidTransport } from '@/cli/fido2/types';

// FIDO CTAPHID devices declare usage page 0xF1D0 as the bytes 06 D0 F1, from the FIDO HID specification.
const fidoUsagePage = [0x06, 0xd0, 0xf1];

function isFido(descriptor: Uint8Array): boolean {
	return descriptor.some((_, index) => fidoUsagePage.every((byte, offset) => descriptor[index + offset] === byte));
}

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function open(path: string): HidDevice {
	const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
	return {
		path,
		async write(report) {
			writeSync(fd, Uint8Array.from([0, ...report]));
		},
		async read(timeoutMs) {
			const buffer = new Uint8Array(64);
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				try {
					const length = readSync(fd, buffer, 0, buffer.length, null);
					if (length > 0) return buffer.slice(0, length);
				} catch (error) {
					if (errorCode(error) !== 'EAGAIN') throw error;
				}
				if (Date.now() > deadline) throw new Error('Security key timed out');
				await Bun.sleep(5);
			}
		},
		close() {
			closeSync(fd);
		},
	};
}

export const linuxTransport: HidTransport = {
	async devices() {
		const root = '/sys/class/hidraw';
		let names: string[];
		try {
			names = readdirSync(root);
		} catch {
			return [];
		}
		const devices: HidDevice[] = [];
		const refused: string[] = [];
		for (const name of names.sort()) {
			let descriptor: Uint8Array;
			try {
				descriptor = new Uint8Array(readFileSync(`${root}/${name}/device/report_descriptor`));
			} catch {
				continue;
			}
			if (!isFido(descriptor)) continue;
			try {
				devices.push(open(`/dev/${name}`));
			} catch (error) {
				if (errorCode(error) !== 'EACCES') throw error;
				refused.push(`/dev/${name}`);
			}
		}
		if (!devices.length && refused.length) {
			throw new Error(
				`No permission to open ${
					refused.join(', ')
				}; install a udev rule that grants FIDO devices to the logged-in user, such as systemd's 60-fido-id.rules`,
			);
		}
		return devices;
	},
};
