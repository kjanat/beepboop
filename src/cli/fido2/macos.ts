import { dlopen, FFIType, JSCallback, type Pointer, ptr, toArrayBuffer } from 'bun:ffi';
import type { HidDevice, HidTransport } from '@/cli/fido2/types.ts';

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

function ref(value: Pointer | bigint | null, what: string): Ref {
	if (value === null || value === 0 || value === 0n) throw new Error(`${what} returned null`);
	return value;
}

function cString(value: string): Uint8Array {
	return new TextEncoder().encode(`${value}\0`);
}

function ioReturn(code: number, what: string): void {
	if (code !== K_IO_RETURN_SUCCESS) {
		throw new Error(`${what} failed (IOReturn 0x${(code >>> 0).toString(16)})`);
	}
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

function loadDataSymbols() {
	const system = loadSystem();
	const handle = ref(
		system.dlopen(ptr(cString(CORE_FOUNDATION_PATH)), RTLD_LAZY),
		'dlopen(CoreFoundation)',
	);
	const address = (name: string): Ref => ref(system.dlsym(handle, ptr(cString(name))), `dlsym(${name})`);
	return {
		keyCallbacks: address('kCFTypeDictionaryKeyCallBacks'),
		valueCallbacks: address('kCFTypeDictionaryValueCallBacks'),
	};
}

function load() {
	const cf = loadCoreFoundation();
	const iokit = loadIOKit();
	const { keyCallbacks, valueCallbacks } = loadDataSymbols();

	const string = (value: string): Ref =>
		ref(
			cf.CFStringCreateWithCString(null, ptr(cString(value)), K_CF_STRING_ENCODING_UTF8),
			'CFStringCreateWithCString',
		);
	const number = (value: number): Ref =>
		ref(cf.CFNumberCreate(null, K_CF_NUMBER_SINT32_TYPE, ptr(new Int32Array([value]))), 'CFNumberCreate');

	return {
		cf,
		iokit,
		keyCallbacks,
		valueCallbacks,
		string,
		number,
		mode: string('kCFRunLoopDefaultMode'),
	};
}

type Api = ReturnType<typeof load>;

let cached: Api | undefined;

function api(): Api {
	cached ??= load();
	return cached;
}

function matchingDictionary(lib: Api): Ref {
	const keys = [lib.string('PrimaryUsagePage'), lib.string('PrimaryUsage')];
	const values = [lib.number(FIDO_USAGE_PAGE), lib.number(FIDO_USAGE)];
	const dictionary = lib.cf.CFDictionaryCreate(
		null,
		ptr(new BigUint64Array(keys.map(BigInt))),
		ptr(new BigUint64Array(values.map(BigInt))),
		keys.length,
		lib.keyCallbacks,
		lib.valueCallbacks,
	);
	for (const item of [...keys, ...values]) lib.cf.CFRelease(item);
	return ref(dictionary, 'CFDictionaryCreate');
}

function pump(lib: Api, seconds: number): void {
	lib.cf.CFRunLoopRunInMode(lib.mode, seconds, true);
}

function createDevice(lib: Api, handle: Ref, index: number): HidDevice {
	const runLoop = ref(lib.cf.CFRunLoopGetCurrent(), 'CFRunLoopGetCurrent');
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
		ioReturn(open, 'IOHIDDeviceOpen');
	}
	lib.iokit.IOHIDDeviceRegisterInputReportCallback(
		handle,
		ptr(buffer),
		REPORT_SIZE,
		ref(callback.ptr, 'JSCallback'),
		null,
	);
	lib.iokit.IOHIDDeviceScheduleWithRunLoop(handle, runLoop, lib.mode);

	return {
		path: `macos-hid-${index}`,
		async write(report) {
			if (closed) throw new Error('Security key closed');
			if (report.length !== REPORT_SIZE) throw new Error(`HID report must be ${REPORT_SIZE} bytes`);
			ioReturn(
				lib.iokit.IOHIDDeviceSetReport(handle, K_IOHID_REPORT_TYPE_OUTPUT, 0, ptr(report), report.length),
				'IOHIDDeviceSetReport',
			);
		},
		async read(timeoutMs) {
			const deadline = performance.now() + timeoutMs;
			for (;;) {
				if (closed) throw new Error('Security key closed');
				const next = queue.shift();
				if (next) return next;
				if (performance.now() >= deadline) throw new Error('Security key timed out');
				pump(lib, PUMP_SECONDS);
				await Bun.sleep(0);
			}
		},
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
}

async function enumerate(): Promise<HidDevice[]> {
	const lib = api();
	const runLoop = ref(lib.cf.CFRunLoopGetCurrent(), 'CFRunLoopGetCurrent');
	const manager = ref(lib.iokit.IOHIDManagerCreate(null, K_IOHID_OPTIONS_TYPE_NONE), 'IOHIDManagerCreate');
	const matching = matchingDictionary(lib);
	lib.iokit.IOHIDManagerSetDeviceMatching(manager, matching);
	lib.cf.CFRelease(matching);
	lib.iokit.IOHIDManagerScheduleWithRunLoop(manager, runLoop, lib.mode);
	for (let i = 0; i < ENUMERATE_PUMPS; i++) {
		pump(lib, PUMP_SECONDS);
		await Bun.sleep(0);
	}

	const set = lib.iokit.IOHIDManagerCopyDevices(manager);
	const retained: Ref[] = [];
	if (set !== null && set !== 0 && set !== 0n) {
		const count = Number(lib.cf.CFSetGetCount(set));
		const handles = new BigUint64Array(count);
		lib.cf.CFSetGetValues(set, ptr(handles));
		for (const handle of handles) retained.push(ref(lib.cf.CFRetain(handle), 'CFRetain'));
		lib.cf.CFRelease(set);
	}
	lib.iokit.IOHIDManagerUnscheduleFromRunLoop(manager, runLoop, lib.mode);
	lib.cf.CFRelease(manager);

	const devices: HidDevice[] = [];
	try {
		for (const [index, handle] of retained.entries()) devices.push(createDevice(lib, handle, index));
	} catch (error) {
		for (const handle of retained.slice(devices.length + 1)) lib.cf.CFRelease(handle);
		for (const device of devices) device.close();
		throw error;
	}
	return devices;
}

export const macosTransport: HidTransport = {
	async devices() {
		if (process.platform !== 'darwin') return [];
		return enumerate();
	},
};
