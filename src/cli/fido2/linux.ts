import { closeSync, constants, openSync, readdirSync, readFileSync, readSync, writeSync } from 'node:fs';
import { Data, Effect } from 'effect';
import type { HidDevice, HidTransport } from '@/cli/fido2/types';
import { closeAll, SecurityKeyError, securityKeyFailure } from '@/cli/fido2/types';

// FIDO CTAPHID devices declare usage page 0xF1D0 as the bytes 06 D0 F1, from the FIDO HID specification.
const fidoUsagePage = [0x06, 0xd0, 0xf1];

function isFido(descriptor: Uint8Array): boolean {
	return descriptor.some((_, index) => fidoUsagePage.every((byte, offset) => descriptor[index + offset] === byte));
}

class SystemError
	extends Data.TaggedError('SystemError')<{ readonly code: string | undefined; readonly cause: unknown }>
{}

function system<A>(run: () => A): Effect.Effect<A, SystemError> {
	return Effect.try({
		try: run,
		catch: cause =>
			new SystemError({
				cause,
				code: cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined,
			}),
	});
}

function failed(error: SystemError): SecurityKeyError {
	return securityKeyFailure(error.cause);
}

function open(path: string): HidDevice {
	const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
	return {
		path,
		write: report =>
			Effect.try({ try: () => void writeSync(fd, Uint8Array.from([0, ...report])), catch: securityKeyFailure }),
		read: timeoutMs =>
			Effect.gen(function*() {
				const buffer = new Uint8Array(64);
				const deadline = Date.now() + timeoutMs;
				for (;;) {
					const length = yield* system(() => readSync(fd, buffer, 0, buffer.length, null)).pipe(
						Effect.catchIf(error => error.code === 'EAGAIN', () => Effect.succeed(0)),
						Effect.mapError(failed),
					);
					if (length > 0) return buffer.slice(0, length);
					if (Date.now() > deadline) return yield* new SecurityKeyError({ message: 'Security key timed out' });
					yield* Effect.sleep('5 millis');
				}
			}),
		close() {
			closeSync(fd);
		},
	};
}

export const linuxTransport: HidTransport = {
	devices: Effect.gen(function*() {
		const root = '/sys/class/hidraw';
		const names = yield* system(() => readdirSync(root)).pipe(Effect.orElseSucceed((): string[] => []));
		const devices: HidDevice[] = [];
		const refused: string[] = [];
		for (const name of names.sort()) {
			const descriptor = yield* system(() => new Uint8Array(readFileSync(`${root}/${name}/device/report_descriptor`)))
				.pipe(Effect.orElseSucceed(() => undefined));
			if (!descriptor || !isFido(descriptor)) continue;
			const opened = yield* system(() => open(`/dev/${name}`)).pipe(
				Effect.catchIf(error => error.code === 'EACCES', () => Effect.undefined),
				Effect.tapError(() => closeAll(devices)),
				Effect.mapError(failed),
			);
			if (opened) devices.push(opened);
			else refused.push(`/dev/${name}`);
		}
		if (!devices.length && refused.length) {
			return yield* new SecurityKeyError({
				message: `No permission to open ${
					refused.join(', ')
				}; install a udev rule that grants FIDO devices to the logged-in user, such as systemd's 60-fido-id.rules`,
			});
		}
		return devices;
	}),
};
