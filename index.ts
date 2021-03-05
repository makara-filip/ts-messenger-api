import { ApiCtx, ApiOptions, AppState, Credentials, Dfs } from './lib/types';
import * as utils from './lib/utils';
import log, { LogLevels } from 'npmlog';
import Jar from './lib/jar';
import cheerio from 'cheerio';
import Api from './lib/api';
import { Response } from 'got';

const defaultLogRecordSize = 100;

export default async function login(loginData: Credentials, options: ApiOptions): Promise<Api | undefined> {
	const globalOptions: ApiOptions = {
		selfListen: false,
		listenEvents: false,
		updatePresence: false,
		forceLogin: false,
		autoMarkDelivery: true,
		autoMarkRead: false,
		logRecordSize: defaultLogRecordSize,
		userAgent:
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/600.3.18 (KHTML, like Gecko) Version/8.0.3 Safari/600.3.18'
	};
	setOptions(globalOptions, options);

	//TODO: Add support for appState
	return await loginHelper(loginData.email, loginData.password, globalOptions, loginData.appState);
}

/** Sets `globalOptions` and npmlog based on the `options` attribute */
function setOptions(globalOptions: ApiOptions, options: ApiOptions): void {
	Object.keys(options).map(function (key) {
		switch (key) {
			case 'logLevel':
				log.level = options.logLevel as LogLevels;
				globalOptions.logLevel = options.logLevel;
				break;
			case 'logRecordSize':
				log.maxRecordSize = options.logRecordSize as number;
				globalOptions.logRecordSize = options.logRecordSize;
				break;
			case 'selfListen':
				globalOptions.selfListen = options.selfListen;
				break;
			case 'listenEvents':
				globalOptions.listenEvents = options.listenEvents;
				break;
			case 'pageID':
				globalOptions.pageID = options.pageID?.toString();
				break;
			case 'updatePresence':
				globalOptions.updatePresence = options.updatePresence;
				break;
			case 'forceLogin':
				globalOptions.forceLogin = options.forceLogin;
				break;
			case 'userAgent':
				globalOptions.userAgent = options.userAgent;
				break;
			case 'autoMarkDelivery':
				globalOptions.autoMarkDelivery = options.autoMarkDelivery;
				break;
			case 'autoMarkRead':
				globalOptions.autoMarkRead = options.autoMarkRead;
				break;
			default:
				log.warn('setOptions', 'Unrecognized option given to setOptions: ' + key);
				break;
		}
	});
}

async function loginHelper(email: string, password: string, globalOptions: ApiOptions, appState?: AppState) {
	let mainPromise: Promise<any>;
	const jar = new Jar();

	let ctx: ApiCtx;
	let defaultFuncs: Dfs;
	let api: Api | undefined;

	// If we're given an appState we loop through it and save each cookie into the jar.
	if (appState) {
		appState.map(c =>
			jar.setCookie(
				`${c.key}=${c.value}; expires=${c.expires}; domain=${c.domain}; path=${c.path};`,
				'http://' + c.domain
			)
		);
		// Load the main page.
		mainPromise = utils.get('https://www.facebook.com/', jar, null, globalOptions).then(utils.saveCookies(jar));
	} else {
		// Open the main page, then we login with the given credentials and finally
		// load the main page again (it'll give us some IDs that we need)
		mainPromise = utils
			.get('https://m.facebook.com/', null, null, globalOptions)
			.then(utils.saveCookies(jar))
			.then(makeLogin(jar, email, password, globalOptions))
			.then(
				async () => await utils.get('https://www.facebook.com/', jar, null, globalOptions).then(utils.saveCookies(jar))
			);
	}

	mainPromise = mainPromise
		.then(async (res: Response<string>) => {
			// Hacky check for the redirection that happens on some ISPs, which doesn't return statusCode 3xx
			const reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
			const redirect = reg.exec(res.body);
			if (redirect && redirect[1]) {
				return await utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
			}
			return res;
		})
		.then((res: Response<string>) => {
			// Define global state
			const html = res.body;
			const stuff = buildAPI(globalOptions, html, jar);
			ctx = stuff.ctx;
			defaultFuncs = stuff.defaultFuncs; // TODO: remove the defaultFuncs, because they are already in the api
			api = stuff.api;
			return res;
		})
		.then(async () => {
			const form = {
				reason: 6
			};
			log.info('login', 'Request to reconnect');
			return await defaultFuncs
				.get('https://www.facebook.com/ajax/presence/reconnect.php', ctx.jar, form)
				.then(utils.saveCookies(ctx.jar));
		})
		.then(() => {
			const presence = utils.generatePresence(ctx.userID);
			ctx.jar.setCookie('presence=' + presence + '; path=/; domain=.facebook.com; secure', 'https://www.facebook.com');
			ctx.jar.setCookie(
				'presence=' + presence + '; path=/; domain=.messenger.com; secure',
				'https://www.messenger.com'
			);
			ctx.jar.setCookie('locale=en_US; path=/; domain=.facebook.com; secure', 'https://www.facebook.com');
			ctx.jar.setCookie('locale=en_US; path=/; domain=.messenger.com; secure', 'https://www.messenger.com');
			ctx.jar.setCookie(
				'a11y=' + utils.generateAccessiblityCookie() + '; path=/; domain=.facebook.com; secure',
				'https://www.facebook.com'
			);
		});

	// given a pageID we log in as a page
	if (globalOptions.pageID) {
		mainPromise = mainPromise
			.then(async () => {
				return await utils.get(
					'https://www.facebook.com/' + ctx.globalOptions.pageID + '/messages/?section=messages&subsection=inbox',
					ctx.jar,
					null,
					globalOptions
				);
			})
			.then(async (resData: any) => {
				let url = utils
					.getFrom(resData.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");')
					.split('\\')
					.join('');
				url = url.substring(0, url.length - 1);

				return await utils.get('https://www.facebook.com' + url, ctx.jar, null, globalOptions);
			});
	}

	await mainPromise;
	log.info('login', 'Done logging in.');
	return api;
}

function buildAPI(globalOptions: ApiOptions, html: string, jar: Jar) {
	const userIdCookies = jar.getCookies('https://www.facebook.com').filter(cookie => cookie.key === 'c_user');

	if (userIdCookies.length === 0) {
		throw {
			error:
				'Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook for logging in from an unknown location. Try logging in with a browser to verify.'
		};
	}

	const userID = userIdCookies[0].value;
	log.info('login', 'Logged in');
	const clientID = ((Math.random() * 2147483648) | 0).toString(16);

	// All data available to api functions
	const ctx: ApiCtx = {
		userID: userID,
		jar: jar,
		clientID: clientID,
		globalOptions: globalOptions,
		loggedIn: true,
		access_token: 'NONE',
		clientMutationId: 0,
		mqttClient: undefined,
		lastSeqId: 0,
		syncToken: undefined
	};
	const defaultFuncs: Dfs = utils.makeDefaults(html, userID, ctx);
	const api = new Api(defaultFuncs, ctx);
	return { ctx, defaultFuncs, api };
}

/** Magic function */
function makeLogin(jar: Jar, email: string, password: string, loginOptions: ApiOptions) {
	return async (res: Response<string>) => {
		const html: string = res.body;
		const $ = cheerio.load(html);

		const jazoest = $('input[name=jazoest]').attr('value');
		const lsd = $('input[name=lsd]').attr('value');
		const publicKeyDataString = utils.getFrom(html, 'pubKeyData:', '}') + '}';
		const publicKeyData = {
			publicKey: utils.getFrom(publicKeyDataString, 'publicKey:"', '"'),
			keyId: utils.getFrom(publicKeyDataString, 'keyId:', '}')
		};
		// in newer versions of Facebook, encrypted password is being used
		// (even Instagram uses the same technique to send password during login)

		const currentTime = Math.floor(Date.now() / 1000).toString();
		const form = {
			jazoest,
			lsd,
			email,
			login_source: 'comet_headerless_login',
			next: '',
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			encpass: `#PWD_BROWSER:5:${currentTime}:${await require('../lib/passwordHasher.js')(
				publicKeyData,
				currentTime,
				password
			)}`
		};
		const loginUrl = `https://www.facebook.com/login/?privacy_mutation_token=${Buffer.from(
			`{"type":0,"creation_time":${currentTime},"callsite_id":381229079575946}`
		).toString('base64')}`;

		// Getting cookies from the HTML page... (kill me now plz)
		// we used to get a bunch of cookies in the headers of the response of the
		// request, but FB changed and they now send those cookies inside the JS.
		// They run the JS which then injects the cookies in the page.
		// The "solution" is to parse through the html and find those cookies
		// which happen to be conveniently indicated with a _js_ in front of their
		// variable name.
		//
		// ---------- Very Hacky Part Starts -----------------
		const willBeCookies: string[] = html.split('"_js_');
		willBeCookies.slice(1).map(function (val) {
			const cookieData = JSON.parse('["' + utils.getFrom(val, '', ']') + ']');
			jar.setCookie(utils.formatCookie(cookieData, 'facebook'), 'https://www.facebook.com');
		});
		// ---------- Very Hacky Part Ends -----------------

		log.info('login', 'Logging in...');
		return await utils.post(loginUrl, jar, form, loginOptions).then(async (res: Response<string>) => {
			utils.saveCookies(jar)(res);
			const headers = res.headers;
			// Facebook used to put "location" response header when the password was correct,
			// now they do it differently - they change "window.location" in a script
			if (!res.body.includes('window.location.replace')) throw { error: 'Wrong username/password.' };
			const redirect = utils.getFrom(res.body, 'window.location.replace("', '")');
			log.info('login', `Redirected to ${redirect}`);

			// This means the account has login approvals turned on.
			if (headers.location && headers.location.indexOf('https://www.facebook.com/checkpoint/') > -1) {
				log.info('login', 'You have login approvals turned on.');
				const nextURL = 'https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php';

				return await utils
					.get(headers.location, jar, null, loginOptions)
					.then(utils.saveCookies(jar))
					.then(async (res: any) => {
						const html = res.body;
						// Make the form in advance which will contain the fb_dtsg and nh
						const $ = cheerio.load(html);
						let arr: any[] = [];
						$('form input').map(function (i, v) {
							arr.push({ val: $(v).val(), name: $(v).attr('name') });
						});

						arr = arr.filter(function (v) {
							return v.val && v.val.length;
						});

						const form = utils.arrToForm(arr);
						if (html.indexOf('checkpoint/?next') > -1) {
							throw {
								error: 'login-approval',
								continue: async (code: string) => {
									form.approvals_code = code;
									form['submit[Continue]'] = 'Continue';
									return await utils
										.post(nextURL, jar, form, loginOptions)
										.then(utils.saveCookies(jar))
										.then(async () => {
											// Use the same form (safe I hope)
											form.name_action_selected = 'save_device';

											return await utils.post(nextURL, jar, form, loginOptions).then(utils.saveCookies(jar));
										})
										.then(async (res: any) => {
											const headers = res.headers;
											if (!headers.location && res.body.indexOf('Review Recent Login') > -1) {
												throw { error: 'Something went wrong with login approvals.' };
											}

											const appState = utils.getAppState(jar);

											// Simply call loginHelper because all it needs is the jar
											// and will then complete the login process
											return await loginHelper(email, password, loginOptions, appState);
										})
										.catch((err: any) => {
											throw err;
										});
								}
							};
						} else {
							if (!loginOptions.forceLogin) {
								throw {
									error:
										"Couldn't login. Facebook might have blocked this account. Please login with a browser or enable the option 'forceLogin' and try again."
								};
							}
							if (html.indexOf('Suspicious Login Attempt') > -1) {
								form['submit[This was me]'] = 'This was me';
							} else {
								form['submit[This Is Okay]'] = 'This Is Okay';
							}

							return await utils
								.post(nextURL, jar, form, loginOptions)
								.then(utils.saveCookies(jar))
								.then(async () => {
									// Use the same form (safe I hope)
									form.name_action_selected = 'save_device';

									return await utils.post(nextURL, jar, form, loginOptions).then(utils.saveCookies(jar));
								})
								.then(async (res: any) => {
									const headers = res.headers;

									if (!headers.location && res.body.indexOf('Review Recent Login') > -1) {
										throw { error: 'Something went wrong with review recent login.' };
									}

									const appState = utils.getAppState(jar);

									// Simply call loginHelper because all it needs is the jar
									// and will then complete the login process
									return await loginHelper(email, password, loginOptions, appState);
								})
								.catch((e: any) => {
									throw e;
								});
						}
					});
			}
			return utils.get('https://www.facebook.com/', jar, null, loginOptions).then(utils.saveCookies(jar));
		});
	};
}
