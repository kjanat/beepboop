import { randomBytes } from 'node:crypto';
import { bytes, type CborMap, type CborValue, decode, encode, map } from '@/cli/fido2/cbor';
import { type PinProtocol, pinProtocol, sha256 } from '@/cli/fido2/pin';
import type { Assertion, AssertionRequest, Authenticator, HidDevice, HidTransport } from '@/cli/fido2/types';

// CTAPHID command bytes and CTAP2 status codes, from CTAP 2.1 sections 8.1.9 and 8.2.
const command = { init: 0x06, cbor: 0x10, keepalive: 0x3b, error: 0x3f } as const;
const status = new Map<number, string>([
	[0x27, 'The security key refused the request'],
	[0x2e, 'This security key is not enrolled in Beepboop'],
	[0x2f, 'Timed out waiting for a touch'],
	[0x31, 'Wrong PIN'],
	[0x32, 'The PIN is blocked; reset the security key'],
	[0x34, 'Too many wrong PINs; unplug and reinsert the security key'],
	[0x35, 'This security key has no PIN; set one with the vendor tool'],
	[0x36, 'This security key requires a PIN'],
]);

export class CtapError extends Error {
	constructor(readonly code: number) {
		super(status.get(code) ?? `Security key error 0x${code.toString(16).padStart(2, '0')}`);
	}
}

const packet = 64;

class Channel {
	private constructor(private device: HidDevice, private id: number) {}

	static async open(device: HidDevice): Promise<Channel> {
		const broadcast = new Channel(device, 0xffffffff);
		const nonce = new Uint8Array(randomBytes(8));
		await broadcast.send(command.init, nonce);
		for (;;) {
			const reply = await broadcast.receive(2000);
			if (reply.command === command.init && reply.data.slice(0, 8).every((byte, index) => byte === nonce[index])) {
				return new Channel(device, new DataView(reply.data.buffer, reply.data.byteOffset).getUint32(8));
			}
		}
	}

	private header(): number[] {
		return [(this.id >>> 24) & 0xff, (this.id >> 16) & 0xff, (this.id >> 8) & 0xff, this.id & 0xff];
	}

	async send(type: number, data: Uint8Array): Promise<void> {
		const first = Uint8Array.from([...this.header(), type | 0x80, data.length >> 8, data.length & 0xff]);
		let offset = packet - first.length;
		const frame = new Uint8Array(packet);
		frame.set(first);
		frame.set(data.slice(0, offset), first.length);
		await this.device.write(frame);
		for (let sequence = 0; offset < data.length; sequence++) {
			const next = new Uint8Array(packet);
			next.set([...this.header(), sequence]);
			next.set(data.slice(offset, offset + packet - 5), 5);
			offset += packet - 5;
			await this.device.write(next);
		}
	}

	async receive(timeoutMs: number): Promise<{ command: number; data: Uint8Array }> {
		for (;;) {
			const first = await this.device.read(timeoutMs);
			const view = new DataView(first.buffer, first.byteOffset);
			if (view.getUint32(0) !== this.id || ((first[4] ?? 0) & 0x80) === 0) continue;
			const type = (first[4] ?? 0) & 0x7f, length = view.getUint16(5);
			const data = new Uint8Array(length);
			data.set(first.slice(7, 7 + Math.min(length, packet - 7)));
			let filled = Math.min(length, packet - 7);
			while (filled < length) {
				const next = await this.device.read(timeoutMs);
				if (new DataView(next.buffer, next.byteOffset).getUint32(0) !== this.id) continue;
				const chunk = next.slice(5, 5 + Math.min(length - filled, packet - 5));
				data.set(chunk, filled);
				filled += chunk.length;
			}
			return { command: type, data };
		}
	}

	async cbor(operation: number, parameters: CborMap | undefined, waiting?: () => void): Promise<CborMap> {
		await this.send(
			command.cbor,
			Uint8Array.from([operation, ...(parameters ? encode(parameters) : [])]),
		);
		let prompted = false;
		for (;;) {
			const reply = await this.receive(30_000);
			if (reply.command === command.keepalive) {
				// Keepalive status 2 means the authenticator waits for user presence.
				if (reply.data[0] === 2 && !prompted && waiting) {
					prompted = true;
					waiting();
				}
				continue;
			}
			if (reply.command === command.error) throw new Error(`Security key transport error ${reply.data[0] ?? 0}`);
			const code = reply.data[0] ?? 0;
			if (code !== 0) throw new CtapError(code);
			return reply.data.length > 1 ? map(decode(reply.data.slice(1))) : new Map();
		}
	}
}

function credentialList(ids: Uint8Array[]): CborValue[] {
	return ids.map(id => new Map<string, CborValue>([['type', 'public-key'], ['id', id]]));
}

async function pinToken(channel: Channel, info: CborMap, request: AssertionRequest): Promise<{
	protocol: PinProtocol;
	token: Uint8Array;
}> {
	const supported = info.get(0x06);
	const version = Array.isArray(supported) && supported.includes(2) ? 2 : 1;
	const agreement = await channel.cbor(0x06, new Map([[1, version], [2, 0x02]]));
	const protocol = pinProtocol(version, map(agreement.get(1)));
	const pinHash = sha256(new TextEncoder().encode(await request.pin())).slice(0, 16);
	const options = map(info.get(0x04));
	const parameters: CborMap = options.get('pinUvAuthToken') === true
		? new Map<number, CborValue>([
			[1, version],
			[2, 0x09],
			[3, protocol.platformKey],
			[6, protocol.encrypt(pinHash)],
			// Permission 0x02 is getAssertion, from CTAP 2.1 section 6.5.5.7.
			[9, 0x02],
			[10, request.rpId],
		])
		: new Map<number, CborValue>([[1, version], [2, 0x05], [3, protocol.platformKey], [6, protocol.encrypt(pinHash)]]);
	const reply = await channel.cbor(0x06, parameters);
	return { protocol, token: protocol.decrypt(bytes(reply.get(2))) };
}

async function holdsCredential(channel: Channel, request: AssertionRequest): Promise<boolean> {
	try {
		await channel.cbor(
			0x02,
			new Map<number, CborValue>([
				[1, request.rpId],
				[2, request.clientDataHash],
				[3, credentialList(request.allowCredentials)],
				[5, new Map([['up', false]])],
			]),
		);
		return true;
	} catch (error) {
		if (error instanceof CtapError && error.code === 0x2e) return false;
		return true;
	}
}

async function assert(channel: Channel, request: AssertionRequest): Promise<Assertion> {
	const info = await channel.cbor(0x04, undefined);
	const options = map(info.get(0x04));
	const parameters = new Map<number, CborValue>([
		[1, request.rpId],
		[2, request.clientDataHash],
		[3, credentialList(request.allowCredentials)],
	]);
	if (options.get('clientPin') === true) {
		const { protocol, token } = await pinToken(channel, info, request);
		parameters.set(5, new Map([['up', true]]));
		parameters.set(6, protocol.authenticate(token, request.clientDataHash));
		parameters.set(7, protocol.version);
	} else if (options.get('uv') === true) {
		parameters.set(5, new Map([['up', true], ['uv', true]]));
	} else {
		throw new CtapError(0x35);
	}
	const reply = await channel.cbor(0x02, parameters, request.touch);
	const credential = reply.get(1);
	const user = reply.get(4);
	const id = credential instanceof Map ? bytes(credential.get('id')) : request.allowCredentials[0];
	if (!id) throw new Error('The security key returned no credential');
	const userId = user instanceof Map ? user.get('id') : undefined;
	return {
		credentialId: id,
		authenticatorData: bytes(reply.get(2)),
		signature: bytes(reply.get(3)),
		...(userId instanceof Uint8Array ? { userHandle: userId } : {}),
	};
}

export function hidAuthenticator(transport: HidTransport): Authenticator {
	return {
		async getAssertion(request) {
			const devices = await transport.devices();
			if (!devices.length) throw new Error('No security key found; plug in an enrolled key');
			try {
				for (const device of devices) {
					const channel = await Channel.open(device);
					if (devices.length > 1 && !(await holdsCredential(channel, request))) continue;
					return await assert(channel, request);
				}
				throw new CtapError(0x2e);
			} finally {
				for (const device of devices) device.close();
			}
		},
	};
}
