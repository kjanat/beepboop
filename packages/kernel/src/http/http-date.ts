const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = months.join('|');
const time = String.raw`(\d{2}):(\d{2}):(\d{2})`;
const imfFixdate = new RegExp(String.raw`^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (${month}) (\d{4}) ${time} GMT$`);
const rfc850Date = new RegExp(
	String.raw`^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(${month})-(\d{2}) ${time} GMT$`,
);
const asctimeDate = new RegExp(String.raw`^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (${month}) ([ \d]\d) ${time} (\d{4})$`);
const latest = 8.64e15;
const fiftyYears = Date.UTC(2050, 0) - Date.UTC(2000, 0);

function instant(year: number, monthName: string, day: string, hour: string, minute: string, second: string) {
	const index = months.indexOf(monthName);
	const date = Number(day.trim());
	const at = Date.UTC(year, index, date, Number(hour), Number(minute), Number(second));
	const check = new Date(Date.UTC(year, index, date));
	if (
		check.getUTCFullYear() !== year || check.getUTCMonth() !== index || check.getUTCDate() !== date
		|| Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60
	) return undefined;
	return at;
}

export function parseHttpDate(value: string, now: number): number | undefined {
	const imf = imfFixdate.exec(value);
	if (imf) {
		const [, day = '', name = '', year = '', hour = '', minute = '', second = ''] = imf;
		return instant(Number(year), name, day, hour, minute, second);
	}
	const rfc850 = rfc850Date.exec(value);
	if (rfc850) {
		const [, day = '', name = '', year = '', hour = '', minute = '', second = ''] = rfc850;
		const century = Math.floor(new Date(now).getUTCFullYear() / 100) * 100;
		const at = instant(century + Number(year), name, day, hour, minute, second);
		if (at === undefined || at <= now + fiftyYears) return at;
		return instant(century - 100 + Number(year), name, day, hour, minute, second);
	}
	const asctime = asctimeDate.exec(value);
	if (asctime) {
		const [, name = '', day = '', hour = '', minute = '', second = '', year = ''] = asctime;
		return instant(Number(year), name, day, hour, minute, second);
	}
	return undefined;
}

export function parseRetryAfter(value: string, now: number): number | undefined {
	const field = value.trim();
	const at = /^\d+$/.test(field) ? now + Number(field) * 1000 : parseHttpDate(field, now);
	return at !== undefined && at <= latest ? at : undefined;
}
