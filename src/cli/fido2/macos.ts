import type { Pointer } from 'bun:ffi';
import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer } from 'bun:ffi';
import { Effect, Result } from 'effect';
import type { HidDevice, HidTransport } from '@/cli/fido2/types';
import { SecurityKeyError, securityKeyFailure } from '@/cli/fido2/types';

const IOKIT_PATH = '/System/Library/Frameworks/IOKit.framework/IOKit';
const CORE_FOUNDATION_PATH = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';
const LIBSYSTEM_PATH = '/usr/lib/libSystem.B.dylib';

const FIDO_USAGE_PAGE = 0xf1d0;
const FIDO_USAGE = 0x01;
const REPORT_SIZE = 64;
const PUMP_SECONDS = 0.01;
const ENUMERATE_PUMPS = 2;

const RTLD_LAZY = 1;
const K_CF_STRING_ENCODING_UTF8 = 0x08000100;
const K_CF_NUMBER_SINT32_TYPE = 3;
const K_IOHID_REPORT_TYPE_OUTPUT = 1;
const K_IOHID_OPTIONS_TYPE_NONE = 0;
const K_IO_RETURN_SUCCESS = 0;

type Ref = Pointer | bigint;
type Native<A> = Result.Result<A, SecurityKeyError>;

function failed(message: string): Native<never> {
	return Result.fail(new SecurityKeyError({ message }));
}

function ref(value: Pointer | bigint | null, what: string): Native<Ref> {
	return value === null || value === 0 || value === 0n ? failed(`${what} returned null`) : Result.succeed(value);
}

function cString(value: string): Uint8Array {
	return new TextEncoder().encode(`${value}\0`);
}

function ioFailure(code: number, what: string): string {
	return `${what} failed (IOReturn 0x${(code >>> 0).toString(16)})`;
}

function ioReturn(code: number, what: string): Native<void> {
	return code === K_IO_RETURN_SUCCESS ? Result.void : failed(ioFailure(code, what));
}

function native<A>(run: () => A): Native<A> {
	return Result.try({ try: run, catch: securityKeyFailure });
}

function loadSystem() {
	return dlopen(LIBSYSTEM_PATH, {
		dlopen: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr },
		dlsym: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
	}).symbols;
}

function loadCoreFoundation() {
	return dlopen(CORE_FOUNDATION_PATH, {
		CFRelease: { args: [FFIType.ptr], returns: FFIType.void },
		CFRetain: { args: [FFIType.ptr], returns: FFIType.ptr },
		CFStringCreateWithCString: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
			returns: FFIType.ptr,
		},
		CFNumberCreate: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
		CFDictionaryCreate: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64_fast, FFIType.ptr, FFIType.ptr],
			returns: FFIType.ptr,
		},
		CFSetGetCount: { args: [FFIType.ptr], returns: FFIType.i64_fast },
		CFSetGetValues: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
		CFRunLoopGetCurrent: { args: [], returns: FFIType.ptr },
		CFRunLoopRunInMode: {
			args: [FFIType.ptr, FFIType.f64, FFIType.bool],
			returns: FFIType.i32,
		},
	}).symbols;
}

function loadIOKit() {
	return dlopen(IOKIT_PATH, {
		IOHIDManagerCreate: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
		IOHIDManagerSetDeviceMatching: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
		IOHIDManagerCopyDevices: { args: [FFIType.ptr], returns: FFIType.ptr },
		IOHIDManagerScheduleWithRunLoop: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
		IOHIDManagerUnscheduleFromRunLoop: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
		IOHIDDeviceOpen: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		IOHIDDeviceClose: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		IOHIDDeviceSetReport: {
			args: [FFIType.ptr, FFIType.u32, FFIType.i64_fast, FFIType.ptr, FFIType.i64_fast],
			returns: FFIType.i32,
		},
		IOHIDDeviceRegisterInputReportCallback: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.i64_fast, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
		IOHIDDeviceScheduleWithRunLoop: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
		IOHIDDeviceUnscheduleFromRunLoop: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
	}).symbols;
}

function loadDataSymbols(): Native<{ keyCallbacks: Ref; valueCallbacks: Ref }> {
	return Result.gen(function*() {
		const system = yield* native(loadSystem);
		const handle = yield* ref(
			system.dlopen(ptr(cString(CORE_FOUNDATION_PATH)), RTLD_LAZY),
			'dlopen(CoreFoundation)',
		);
		const address = (name: string): Native<Ref> => ref(system.dlsym(handle, ptr(cString(name))), `dlsym(${name})`);
		return {
			keyCallbacks: yield* address('kCFTypeDictionaryKeyCallBacks'),
			valueCallbacks: yield* address('kCFTypeDictionaryValueCallBacks'),
		};
	});
}

function libraries() {
	return { cf: loadCoreFoundation(), iokit: loadIOKit() };
}

interface Api extends ReturnType<typeof libraries> {
	keyCallbacks: Ref;
	valueCallbacks: Ref;
	mode: Ref;
	string(value: string): Native<Ref>;
	number(value: number): Native<Ref>;
}

function load(): Native<Api> {
	return Result.gen(function*() {
		const { cf, iokit } = yield* native(libraries);
		const { keyCallbacks, valueCallbacks } = yield* loadDataSymbols();
		const string = (value: string): Native<Ref> =>
			ref(
				cf.CFStringCreateWithCString(null, ptr(cString(value)), K_CF_STRING_ENCODING_UTF8),
				'CFStringCreateWithCString',
			);
		const number = (value: number): Native<Ref> =>
			ref(cf.CFNumberCreate(null, K_CF_NUMBER_SINT32_TYPE, ptr(new Int32Array([value]))), 'CFNumberCreate');
		return {
			cf,
			iokit,
			keyCallbacks,
			valueCallbacks,
			string,
			number,
			mode: yield* string('kCFRunLoopDefaultMode'),
		};
	});
}

let cached: Api | undefined;

function api(): Native<Api> {
	if (cached) return Result.succeed(cached);
	return load().pipe(Result.map(lib => {
		cached = lib;
		return lib;
	}));
}

function matchingDictionary(lib: Api): Native<Ref> {
	return Result.gen(function*() {
		const keys = [yield* lib.string('PrimaryUsagePage'), yield* lib.string('PrimaryUsage')];
		const values = [yield* lib.number(FIDO_USAGE_PAGE), yield* lib.number(FIDO_USAGE)];
		const dictionary = lib.cf.CFDictionaryCreate(
			null,
			ptr(new BigUint64Array(keys.map(BigInt))),
			ptr(new BigUint64Array(values.map(BigInt))),
			keys.length,
			lib.keyCallbacks,
			lib.valueCallbacks,
		);
		for (const item of [...keys, ...values]) lib.cf.CFRelease(item);
		return yield* ref(dictionary, 'CFDictionaryCreate');
	});
}

function pump(lib: Api, seconds: number): void {
	lib.cf.CFRunLoopRunInMode(lib.mode, seconds, true);
}

function createDevice(lib: Api, handle: Ref, index: number): Native<HidDevice> {
	return Result.gen(function*() {
		const runLoop = yield* ref(lib.cf.CFRunLoopGetCurrent(), 'CFRunLoopGetCurrent');
		const buffer = new Uint8Array(REPORT_SIZE);
		const queue: Uint8Array[] = [];
		let closed = false;

		const callback = new JSCallback(
			(
				_context: unknown,
				result: number,
				_sender: unknown,
				_type: number,
				_reportId: number,
				report: unknown,
				length: number | bigint,
			) => {
				if (result !== K_IO_RETURN_SUCCESS) return;
				if (typeof report !== 'number' && typeof report !== 'bigint') return;
				const size = Math.min(Number(length), REPORT_SIZE);
				queue.push(new Uint8Array(toArrayBuffer(report, 0, size)).slice());
			},
			{
				args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i64],
				returns: FFIType.void,
			},
		);

		const open = lib.iokit.IOHIDDeviceOpen(handle, K_IOHID_OPTIONS_TYPE_NONE);
		if (open !== K_IO_RETURN_SUCCESS) {
			callback.close();
			lib.cf.CFRelease(handle);
			return yield* failed(ioFailure(open, 'IOHIDDeviceOpen'));
		}
		lib.iokit.IOHIDDeviceRegisterInputReportCallback(
			handle,
			ptr(buffer),
			REPORT_SIZE,
			yield* ref(callback.ptr, 'JSCallback'),
			null,
		);
		lib.iokit.IOHIDDeviceScheduleWithRunLoop(handle, runLoop, lib.mode);

		return {
			path: `macos-hid-${index}`,
			write: report =>
				Effect.gen(function*() {
					if (closed) return yield* new SecurityKeyError({ message: 'Security key closed' });
					if (report.length !== REPORT_SIZE) {
						return yield* new SecurityKeyError({ message: `HID report must be ${REPORT_SIZE} bytes` });
					}
					const code = yield* Effect.fromResult(
						native(() =>
							lib.iokit.IOHIDDeviceSetReport(handle, K_IOHID_REPORT_TYPE_OUTPUT, 0, ptr(report), report.length)
						),
					);
					yield* Effect.fromResult(ioReturn(code, 'IOHIDDeviceSetReport'));
				}),
			read: timeoutMs =>
				Effect.gen(function*() {
					const deadline = performance.now() + timeoutMs;
					for (;;) {
						if (closed) return yield* new SecurityKeyError({ message: 'Security key closed' });
						const next = queue.shift();
						if (next) return next;
						if (performance.now() >= deadline) {
							return yield* new SecurityKeyError({ message: 'Security key timed out' });
						}
						pump(lib, PUMP_SECONDS);
						yield* Effect.yieldNow;
					}
				}),
			close() {
				if (closed) return;
				closed = true;
				lib.iokit.IOHIDDeviceUnscheduleFromRunLoop(handle, runLoop, lib.mode);
				lib.iokit.IOHIDDeviceRegisterInputReportCallback(handle, ptr(buffer), REPORT_SIZE, null, null);
				lib.iokit.IOHIDDeviceClose(handle, K_IOHID_OPTIONS_TYPE_NONE);
				lib.cf.CFRelease(handle);
				callback.close();
				queue.length = 0;
			},
		};
	});
}

function enumerate(): Native<HidDevice[]> {
	return Result.gen(function*() {
		const lib = yield* api();
		const runLoop = yield* ref(lib.cf.CFRunLoopGetCurrent(), 'CFRunLoopGetCurrent');
		const manager = yield* ref(lib.iokit.IOHIDManagerCreate(null, K_IOHID_OPTIONS_TYPE_NONE), 'IOHIDManagerCreate');
		const matching = yield* matchingDictionary(lib);
		lib.iokit.IOHIDManagerSetDeviceMatching(manager, matching);
		lib.cf.CFRelease(matching);
		lib.iokit.IOHIDManagerScheduleWithRunLoop(manager, runLoop, lib.mode);
		for (let i = 0; i < ENUMERATE_PUMPS; i++) pump(lib, PUMP_SECONDS);

		const set = lib.iokit.IOHIDManagerCopyDevices(manager);
		const retained: Ref[] = [];
		if (set !== null && set !== 0 && set !== 0n) {
			const count = Number(lib.cf.CFSetGetCount(set));
			const handles = new BigUint64Array(count);
			lib.cf.CFSetGetValues(set, ptr(handles));
			for (const handle of handles) retained.push(yield* ref(lib.cf.CFRetain(handle), 'CFRetain'));
			lib.cf.CFRelease(set);
		}
		lib.iokit.IOHIDManagerUnscheduleFromRunLoop(manager, runLoop, lib.mode);
		lib.cf.CFRelease(manager);

		const devices: HidDevice[] = [];
		for (const [index, handle] of retained.entries()) {
			const device = createDevice(lib, handle, index);
			if (Result.isFailure(device)) {
				for (const other of retained.slice(index + 1)) lib.cf.CFRelease(other);
				for (const opened of devices) opened.close();
				return yield* Result.fail(device.failure);
			}
			devices.push(device.success);
		}
		return devices;
	});
}

export const macosTransport: HidTransport = {
	devices: process.platform === 'darwin' ? Effect.suspend(() => Effect.fromResult(enumerate())) : Effect.succeed([]),
};
