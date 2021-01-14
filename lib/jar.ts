import { Cookie, CookieJar, Store } from 'tough-cookie';

export default class Jar {
	private _jar: CookieJar;

	constructor(store?: Store) {
		this._jar = new CookieJar(store, { looseMode: true });
	}

	setCookie(cookieOrStr: string | Cookie, uri: string, options?: CookieJar.SetCookieOptions): Cookie {
		return this._jar.setCookieSync(cookieOrStr, uri, options || {});
	}
	getCookieString(uri: string): string {
		return this._jar.getCookieStringSync(uri);
	}
	getCookies(uri: string): Cookie[] {
		return this._jar.getCookiesSync(uri);
	}
}
