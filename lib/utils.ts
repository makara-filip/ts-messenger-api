import { ApiCtx, ApiOptions, Dfs, PrimitiveObject, RequestForm } from './types';
import Jar from './jar';
import stream from 'stream';
import log from 'npmlog';
import { Cookie } from 'tough-cookie';
import FormData from 'form-data';

import got, { Response } from 'got';
const gotInstance = got.extend({
	// followRedirect: false,
	timeout: 60000,
	http2: true
});

function getHeaders(options: ApiOptions): Record<string, string> {
	return {
		'Content-Type': 'application/x-www-form-urlencoded',
		Referer: 'https://www.facebook.com/',
		Origin: 'https://www.facebook.com',
		'User-Agent':
			options.userAgent ||
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/600.3.18 (KHTML, like Gecko) Version/8.0.3 Safari/600.3.18'
	};
}

// TODO: May not be right
export function isReadableStream(obj: unknown): boolean {
	return (
		obj instanceof stream.Stream &&
		(getType((obj as stream.Readable)._read) === 'Function' ||
			getType((obj as stream.Readable)._read) === 'AsyncFunction')
	);
}

/**
 * @param qs This is usually null
 */
export async function get(
	url: string,
	jar: Jar | null,
	qs: Record<string, unknown> | null,
	options: ApiOptions
): Promise<Response<string>> {
	// I'm still confused about this
	if (getType(qs) === 'Object') {
		for (const prop in qs) {
			if (Object.prototype.hasOwnProperty.call(qs, prop) && getType(qs[prop]) === 'Object') {
				qs[prop] = JSON.stringify(qs[prop]);
			}
		}
	}

	//TODO: Use the `qs` param in this request
	const response = await gotInstance.get(url, {
		headers: getHeaders(options),
		cookieJar: jar?._jar
	});
	return response;
}

export async function post(
	url: string,
	jar: Jar,
	form: Record<string, unknown>,
	options: ApiOptions
): Promise<Response<string>> {
	const response = await gotInstance.post(url, {
		headers: getHeaders(options),
		form: form,
		cookieJar: jar._jar
	});
	return response;
}

export async function postFormData(
	url: string,
	jar: Jar,
	form: RequestForm,
	qs: PrimitiveObject,
	options: ApiOptions
): Promise<Response<string>> {
	const headers = getHeaders(options);
	headers['Content-Type'] = 'multipart/form-data';
	return await gotInstance.post(url, {
		headers: headers,
		form,
		searchParams: qs,
		cookieJar: jar._jar
	});
}

export async function postFormData2(
	url: string,
	jar: Jar,
	formData: FormData,
	qs: PrimitiveObject,
	options: ApiOptions
): Promise<Response<string>> {
	return await gotInstance.post(url, {
		headers: Object.assign(getHeaders(options), formData.getHeaders()),
		body: formData,
		searchParams: qs,
		cookieJar: jar._jar
	});
}

/** Appends zeroes to the beggining of `val` until it reaches length of `len` */
export function padZeros(val: string, len = 2): string {
	val = String(val);
	while (val.length < len) val = '0' + val;
	return val;
}

//TODO: Determin the type of `clientID`
export function generateThreadingID(clientID: string): string {
	return `<${Date.now()}:${Math.floor(Math.random() * 4294967295)}-${clientID}@mail.projektitan.com>`;
}

export function binaryToDecimal(data: string): string {
	let ret = '';
	while (data !== '0') {
		let end = 0;
		let fullName = '';
		let i = 0;
		for (; i < data.length; i++) {
			end = 2 * end + parseInt(data[i], 10);
			if (end >= 10) {
				fullName += '1';
				end -= 10;
			} else {
				fullName += '0';
			}
		}
		ret = end.toString() + ret;
		data = fullName.slice(fullName.indexOf('1'));
	}
	return ret;
}

export function generateOfflineThreadingID(): string {
	const now = Date.now();
	const rand = Math.floor(Math.random() * 4294967295);
	const str = ('0000000000000000000000' + rand.toString(2)).slice(-22);
	const msgs = now.toString(2) + str;
	return binaryToDecimal(msgs);
}

//TODO: Figure out what the hell this does
let h: RegExp;
const i: { [index: string]: string } = {};
const j: { [index: string]: string } = {
	_: '%',
	A: '%2',
	B: '000',
	C: '%7d',
	D: '%7b%22',
	E: '%2c%22',
	F: '%22%3a',
	G: '%2c%22ut%22%3a1',
	H: '%2c%22bls%22%3a',
	I: '%2c%22n%22%3a%22%',
	J: '%22%3a%7b%22i%22%3a0%7d',
	K: '%2c%22pt%22%3a0%2c%22vis%22%3a',
	L: '%2c%22ch%22%3a%7b%22h%22%3a%22',
	M: '%7b%22v%22%3a2%2c%22time%22%3a1',
	N: '.channel%22%2c%22sub%22%3a%5b',
	O: '%2c%22sb%22%3a1%2c%22t%22%3a%5b',
	P: '%2c%22ud%22%3a100%2c%22lc%22%3a0',
	Q: '%5d%2c%22f%22%3anull%2c%22uct%22%3a',
	R: '.channel%22%2c%22sub%22%3a%5b1%5d',
	S: '%22%2c%22m%22%3a0%7d%2c%7b%22i%22%3a',
	T: '%2c%22blc%22%3a1%2c%22snd%22%3a1%2c%22ct%22%3a',
	U: '%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a',
	V: '%2c%22blc%22%3a0%2c%22snd%22%3a0%2c%22ct%22%3a',
	W: '%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a',
	X: '%2c%22ri%22%3a0%7d%2c%22state%22%3a%7b%22p%22%3a0%2c%22ut%22%3a1',
	Y: '%2c%22pt%22%3a0%2c%22vis%22%3a1%2c%22bls%22%3a0%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a',
	Z:
		'%2c%22sb%22%3a1%2c%22t%22%3a%5b%5d%2c%22f%22%3anull%2c%22uct%22%3a0%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a'
};
// Set `i` as `j` with swapped keys and values
(function () {
	const l = [];
	for (const m in j) {
		i[j[m]] = m;
		l.push(j[m]);
	}
	l.reverse();
	h = new RegExp(l.join('|'), 'g');
})();

export function presenceEncode(str: string): string {
	return encodeURIComponent(str)
		.replace(/([_A-Z])|%../g, (m, n) => (n ? '%' + n.charCodeAt(0).toString(16) : m))
		.toLowerCase()
		.replace(h, m => i[m]);
}

export function presenceDecode(str: string): string {
	return decodeURIComponent(
		str.replace(/[_A-Z]/g, function (m) {
			return j[m];
		})
	);
}

//TODO: Determin the type of `userID`
export function generatePresence(userID: string): string {
	const time = Date.now();
	return (
		'E' +
		presenceEncode(
			JSON.stringify({
				v: 3,
				//TODO: This was modified. (This probably doesn't need parseInt)
				time: time / 1000,
				user: userID,
				state: {
					ut: 0,
					t2: [],
					lm2: null,
					uct2: time,
					tr: null,
					tw: Math.floor(Math.random() * 4294967295) + 1,
					at: time
				},
				ch: { ['p_' + userID]: 0 }
			})
		)
	);
}

export function generateAccessibilityCookie(): string {
	const time = Date.now();
	return encodeURIComponent(
		JSON.stringify({
			sr: 0,
			'sr-ts': time,
			jk: 0,
			'jk-ts': time,
			kb: 0,
			'kb-ts': time,
			hcm: 0,
			'hcm-ts': time
		})
	);
}

export function getGUID(): string {
	let sectionLength = Date.now();
	const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		const r = Math.floor((sectionLength + Math.random() * 16) % 16);
		sectionLength = Math.floor(sectionLength / 16);
		const _guid = (c == 'x' ? r : (r & 7) | 8).toString(16);
		return _guid;
	});
	return id;
}

export function formatID(id: string): string {
	if (id != undefined && id != null) {
		return id.replace(/(fb)?id[:.]/, '');
	} else {
		return id;
	}
}

export function getFrom(str: string, startToken: string, endToken: string): string {
	const start: number = str.indexOf(startToken) + startToken.length;
	if (start < startToken.length) return '';

	const lastHalf = str.substring(start);
	const end = lastHalf.indexOf(endToken);
	if (end === -1) {
		throw Error('Could not find endTime `' + endToken + '` in the given string.');
	}
	return lastHalf.substring(0, end);
}

export function makeParsable(html: string): string {
	const withoutForLoop = html.replace(/for\s*\(\s*;\s*;\s*\)\s*;\s*/, '');

	// (What the fuck FB, why windows style newlines?)
	// So sometimes FB will send us base multiple objects in the same response.
	// They're all valid JSON, one after the other, at the top level. We detect
	// that and make it parse-able by JSON.parse.
	//       Ben - July 15th 2017
	//
	// It turns out that Facebook may insert random number of spaces before
	// next object begins (issue #616)
	//       rav_kr - 2018-03-19
	const maybeMultipleObjects = withoutForLoop.split(/\}\r\n *\{/);
	if (maybeMultipleObjects.length === 1) return maybeMultipleObjects[0];

	return '[' + maybeMultipleObjects.join('},{') + ']';
}

export function arrToForm(form: any) {
	return arrayToObject(
		form,
		(v: any) => v.name,
		(v: any) => v.val
	);
}

export function arrayToObject(arr: any[], getKey: (val: any) => any, getValue: (val: any) => any): any {
	return arr.reduce(function (acc, val) {
		acc[getKey(val)] = getValue(val);
		return acc;
	}, {});
}

export function getSignatureID(): string {
	return Math.floor(Math.random() * 2147483648).toString(16);
}

export function generateTimestampRelative(): string {
	const d = new Date();
	return d.getHours() + ':' + padZeros(String(d.getMinutes()));
}

export function makeDefaults(html: string, userID: string, ctx: ApiCtx): Dfs {
	let reqCounter = 1;
	const fb_dtsg = getFrom(html, 'name="fb_dtsg" value="', '"');

	// @Hack Ok we've done hacky things, this is definitely on top 5.
	// We totally assume the object is flat and try parsing until a }.
	// If it works though it's cool because we get a bunch of extra data things.
	//
	// Update: we don't need this. Leaving it in in case we ever do.
	//       Ben - July 15th 2017

	// var siteData = getFrom(html, "[\"SiteData\",[],", "},");
	// try {
	//   siteData = JSON.parse(siteData + "}");
	// } catch(e) {
	//   log.warn("makeDefaults", "Couldn't parse SiteData. Won't have access to some variables.");
	//   siteData = {};
	// }

	let ttstamp = '2';
	for (let i = 0; i < fb_dtsg.length; i++) {
		ttstamp += fb_dtsg.charCodeAt(i);
	}
	const revision = getFrom(html, 'revision":', ',');

	function mergeWithDefaults(obj?: any) {
		// @TODO This is missing a key called __dyn.
		// After some investigation it seems like __dyn is some sort of set that FB
		// calls BitMap. It seems like certain responses have a "define" key in the
		// res.jsmods arrays. I think the code iterates over those and calls `set`
		// on the bitmap for each of those keys. Then it calls
		// bitmap.toCompressedString() which returns what __dyn is.
		//
		// So far the API has been working without this.
		//
		//              Ben - July 15th 2017
		const newObj: any = {
			__user: userID,
			__req: (reqCounter++).toString(36),
			__rev: revision,
			__a: 1,
			// __af: siteData.features,
			fb_dtsg: ctx.fb_dtsg ? ctx.fb_dtsg : fb_dtsg,
			jazoest: ctx.ttstamp ? ctx.ttstamp : ttstamp
			// __spin_r: siteData.__spin_r,
			// __spin_b: siteData.__spin_b,
			// __spin_t: siteData.__spin_t,
		};
		if (!obj) return newObj;

		for (const prop in obj) {
			// eslint-disable-next-line no-prototype-builtins
			if (obj.hasOwnProperty(prop)) {
				if (!newObj[prop]) {
					newObj[prop] = obj[prop];
				}
			}
		}

		return newObj;
	}

	async function postWithDefaults(url: string, jar: Jar, form: Record<string, unknown>) {
		return await post(url, jar, mergeWithDefaults(form), ctx.globalOptions);
	}

	async function getWithDefaults(url: string, jar: Jar, qs?: PrimitiveObject) {
		return await get(url, jar, mergeWithDefaults(qs), ctx.globalOptions);
	}

	async function postFormDataWithDefault(url: string, jar: Jar, form: Record<string, unknown>, qs: PrimitiveObject) {
		return await postFormData(url, jar, mergeWithDefaults(form), mergeWithDefaults(qs), ctx.globalOptions);
	}

	async function postFormData2WithDefaults(url: string, jar: Jar, formData: FormData, qs: PrimitiveObject) {
		return await postFormData2(url, jar, formData, mergeWithDefaults(qs), ctx.globalOptions);
	}

	return {
		get: getWithDefaults,
		post: postWithDefaults,
		postFormData: postFormDataWithDefault,
		postFormData2: postFormData2WithDefaults
	};
}

export function parseAndCheckLogin(ctx: ApiCtx, defaultFuncs: Dfs, retryCount = 0) {
	return async (data: Response<string>): Promise<any> => {
		log.verbose('parseAndCheckLogin', data.body);
		if (data.statusCode >= 500 && data.statusCode < 600) {
			if (retryCount >= 5) {
				throw {
					error: 'Request retry failed. Check the `res` and `statusCode` property on this error.',
					statusCode: data.statusCode,
					res: data.body
				};
			}
			retryCount++;
			const retryTime = Math.floor(Math.random() * 5000);
			log.warn(
				'parseAndCheckLogin',
				'Got status code ' +
					data.statusCode +
					' - ' +
					retryCount +
					'. attempt to retry in ' +
					retryTime +
					' milliseconds...'
			);
			// const url = data.request.options.protocol + '//' + data.request.uri.hostname + data.request.uri.pathname;
			const url = data.request.options.url.toString();
			if (data.request.options.headers['Content-Type']) {
				if ((data.request.options.headers['Content-Type'] as string).split(';')[0] === 'multipart/form-data') {
					return new Promise(resolve => setTimeout(resolve, retryTime))
						.then(async () => await defaultFuncs.postFormData(url, ctx.jar, data.request.options.form || {}, {}))
						.then(parseAndCheckLogin(ctx, defaultFuncs, retryCount));
				} else {
					return new Promise(resolve => setTimeout(resolve, retryTime))
						.then(async () => await defaultFuncs.post(url, ctx.jar, data.request.options.form || {}))
						.then(parseAndCheckLogin(ctx, defaultFuncs, retryCount));
				}
			}
		}
		if (data.statusCode !== 200)
			throw new Error(
				'parseAndCheckLogin got status code: ' + data.statusCode + '. Bailing out of trying to parse response.'
			);

		let res = null;
		try {
			res = JSON.parse(makeParsable(data.body));
		} catch (e) {
			throw {
				error: 'JSON.parse error. Check the `detail` property on this error.',
				detail: e,
				res: data.body
			};
		}

		// In some cases the response contains only a redirect URL which should be followed
		if (res.redirect && data.request.options.method.toUpperCase() === 'GET') {
			return await defaultFuncs.get(res.redirect, ctx.jar).then(parseAndCheckLogin(ctx, defaultFuncs));
		}

		// TODO: handle multiple cookies?
		if (
			res.jsmods &&
			res.jsmods.require &&
			Array.isArray(res.jsmods.require[0]) &&
			res.jsmods.require[0][0] === 'Cookie'
		) {
			res.jsmods.require[0][3][0] = res.jsmods.require[0][3][0].replace('_js_', '');
			const cookie = formatCookie(res.jsmods.require[0][3], 'facebook');
			const cookie2 = formatCookie(res.jsmods.require[0][3], 'messenger');
			ctx.jar.setCookie(cookie, 'https://www.facebook.com');
			ctx.jar.setCookie(cookie2, 'https://www.messenger.com');
		}

		// On every request we check if we got a DTSG and we mutate the context so that we use the latest
		// one for the next requests.
		if (res.jsmods && Array.isArray(res.jsmods.require)) {
			const arr = res.jsmods.require;
			for (const i in arr) {
				if (arr[i][0] === 'DTSG' && arr[i][1] === 'setToken') {
					ctx.fb_dtsg = arr[i][3][0] as string;

					// Update ttstamp since that depends on fb_dtsg
					ctx.ttstamp = '2';
					for (let j = 0; j < ctx.fb_dtsg.length; j++) {
						ctx.ttstamp += ctx.fb_dtsg.charCodeAt(j);
					}
				}
			}
		}

		if (res.error === 1357001) {
			throw { error: 'Not logged in.' };
		}
		return res;
	};
}

/** Returns a function with a res attribute, which saves received cookies to provided jar and returns `res` */
export function saveCookies(jar: Jar) {
	return (res: Response<string>): Response<string> => {
		// TODO: do we really need this?
		const cookies = res.headers['set-cookie'] || [];
		cookies.forEach(function (c) {
			if (c.indexOf('.facebook.com') > -1) {
				jar.setCookie(c, 'https://www.facebook.com');
			}
			const c2 = c.replace(/domain=\.facebook\.com/, 'domain=.messenger.com');
			jar.setCookie(c2, 'https://www.messenger.com');
		});
		return res;
	};
}

// const NUM_TO_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// const NUM_TO_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// export function formatDate(date: Date): string {
// 	let d: string | number = date.getUTCDate();
// 	// TODO: maybe remove `d`
// 	d = d >= 10 ? d : '0' + d;
// 	let h: string | number = date.getUTCHours();
// 	h = h >= 10 ? h : '0' + h;
// 	let m: string | number = date.getUTCMinutes();
// 	m = m >= 10 ? m : '0' + m;
// 	let s: string | number = date.getUTCSeconds();
// 	s = s >= 10 ? s : '0' + s;
// 	return `${NUM_TO_DAY[date.getUTCDay()]}, d ${
// 		NUM_TO_MONTH[date.getUTCMonth()]
// 	} ${date.getUTCFullYear()} ${h}:${m}:${s} GMT`;
// }

export function formatCookie(arr: string[], url: string): string {
	return `${arr[0]}=${arr[1]}; Path=${arr[3]}; Domain=${url}.com`;
}

export function getType(obj: any): string {
	return Object.prototype.toString.call(obj).slice(8, -1);
}

// export function formatProxyPresence(presence: any, userID: string) {
// 	if (presence.lat === undefined || presence.p === undefined) return null;
// 	return {
// 		type: 'presence',
// 		timestamp: presence.lat * 1000,
// 		userID: userID,
// 		statuses: presence.p
// 	};
// }

export function getAppState(jar: Jar): Cookie[] {
	return jar
		.getCookies('https://www.facebook.com')
		.concat(jar.getCookies('https://facebook.com'))
		.concat(jar.getCookies('https://www.messenger.com'));
}

/** This recursive function gets all the offsets (indexes) of the searched values one-by-one.
 * This method is recursive, so it can find the same substring at different positions. */
export function mentionsGetOffsetRecursive(text: string, searchForValues: string[]): number[] {
	const index = text.indexOf(searchForValues[0]);
	if (index === -1) throw new Error('There was a problem finding the offset - no such text found');

	if (searchForValues.length == 1) {
		// this is the final mention search
		return [index];
	} else {
		// we have still another mention string - so we provide substring & subarray
		const newStartIndex = index + searchForValues[0].length;
		return [index].concat(
			mentionsGetOffsetRecursive(text.slice(newStartIndex), searchForValues.slice(1)).map(i => i + newStartIndex)
		);
	}
}
