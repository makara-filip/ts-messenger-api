import { ApiCtx, ApiOptions, AppState, Credentials, Dfs } from './lib/types';
import * as utils from './lib/utils';
import log, { LogLevels } from 'npmlog';
import Jar from './lib/jar';
import cheerio from 'cheerio';
import { Response } from 'request';
import Api from './lib/api';
import Bluebird from 'bluebird';

const defaultLogRecordSize = 100;

let ctx: ApiCtx;
let defaultFuncs: Dfs;
let api: Api;

export default function login(
	loginData: Credentials,
	options: ApiOptions,
	callback: (err?: Error, api?: Api) => void
): void {
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
	loginHelper(loginData.email, loginData.password, globalOptions, callback, loginData.appState);
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

function loginHelper(
	email: string,
	password: string,
	globalOptions: ApiOptions,
	callback: (err?: Error, api?: Api) => void,
	appState?: AppState
) {
	let mainPromise = null;
	const jar = new Jar();

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
			.get('https://www.facebook.com/', null, null, globalOptions)
			.then(utils.saveCookies(jar))
			.then(makeLogin(jar, email, password, globalOptions, callback))
			.then(function () {
				return utils.get('https://www.facebook.com/', jar, null, globalOptions).then(utils.saveCookies(jar));
			});
	}

	mainPromise = mainPromise
		.then((res: Response) => {
			// Hacky check for the redirection that happens on some ISPs, which doesn't return statusCode 3xx
			const reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
			const redirect = reg.exec(res.body);
			if (redirect && redirect[1]) {
				return utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
			}
			return res;
		})
		.then(res => {
			// Define global state
			const html = res.body;
			const stuff = buildAPI(globalOptions, html, jar);
			ctx = stuff.ctx;
			defaultFuncs = stuff.defaultFuncs;
			api = stuff.api;
			return res;
		})
		.then(() => {
			const form = {
				reason: 6
			};
			log.info('login', 'Request to reconnect');
			return defaultFuncs
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
			return true;
		});

	// given a pageID we log in as a page
	if (globalOptions.pageID) {
		mainPromise = mainPromise
			.then(() => {
				return utils.get(
					'https://www.facebook.com/' + ctx.globalOptions.pageID + '/messages/?section=messages&subsection=inbox',
					ctx.jar,
					null,
					globalOptions
				);
			})
			.then(resData => {
				let url = utils
					.getFrom(resData.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");')
					.split('\\')
					.join('');
				url = url.substring(0, url.length - 1);

				return utils.get('https://www.facebook.com' + url, ctx.jar, null, globalOptions);
			});
	}

	// At the end we call the callback or catch an exception
	(mainPromise as Bluebird<any>)
		.then(() => {
			log.info('login', 'Done logging in.');
			return callback(undefined, api);
		})
		.catch((e: any) => {
			log.error('login', e.error || e);
			callback(e);
		});
}

function buildAPI(globalOptions: ApiOptions, html: string, jar: Jar) {
	const maybeCookie = jar
		.getCookies('https://www.facebook.com')
		.filter(val => val.cookieString().split('=')[0] == 'c_user');

	if (maybeCookie.length === 0) {
		throw {
			error:
				'Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook for logging in from an unknown location. Try logging in with a browser to verify.'
		};
	}

	const userID = maybeCookie[0].cookieString().split('=')[1].toString();
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

	// TODO: Implement this to Api
	// let api = {
	// 	setOptions: setOptions.bind(null, globalOptions),
	// 	getAppState: function getAppState() {
	// 		return utils.getAppState(jar);
	// 	}
	// 	// TODO: finish this
	// };

	// // const apiFuncNames = [
	// //   'deleteMessage',
	// //   'getCurrentUserID',
	// //   'getFriendsList',
	// //   'getThreadHistory',
	// //   'getThreadInfo',
	// //   'getThreadList',
	// //   'getUserID',
	// //   'getUserInfo',
	// //   'handleMessageRequest',
	// //   'listenMqtt',
	// //   'logout',
	// //   'sendMessage'
	// // ];

	const defaultFuncs: Dfs = utils.makeDefaults(html, userID, ctx);
	const api = new Api(defaultFuncs, ctx);

	// // Load all api functions in a loop
	// apiFuncNames.map(function (v) {
	// 	api[v] = require('./src/' + v)(defaultFuncs, api, ctx);
	// });

	return { ctx, defaultFuncs, api };
}

/** Magic function */
function makeLogin(
	jar: Jar,
	email: string,
	password: string,
	loginOptions: ApiOptions,
	callback: (err?: Error, api?: Api) => void
) {
	return function (res: Response) {
		const html: string = res.body;
		const $ = cheerio.load(html);
		let arr: { val: string; name?: string }[] = [];

		// This will be empty, but just to be sure we leave it
		$('#login_form input').map(function (i, v) {
			arr.push({ val: $(v).val(), name: $(v).attr('name') });
		});

		arr = arr.filter(v => v.val && v.val.length);

		const form = utils.arrToForm(arr);
		form.lsd = utils.getFrom(html, '["LSD",[],{"token":"', '"}');
		form.lgndim = Buffer.from('{"w":1440,"h":900,"aw":1440,"ah":834,"c":24}').toString('base64');
		form.email = email;
		form.pass = password;
		form.default_persistent = '0';
		form.lgnrnd = utils.getFrom(html, 'name="lgnrnd" value="', '"');
		form.locale = 'en_US';
		form.timezone = '240';
		form.lgnjs = ~~(Date.now() / 1000);

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
		return utils
			.post('https://www.facebook.com/login.php?login_attempt=1&lwv=110', jar, form, loginOptions)
			.then((res: Response) => {
				utils.saveCookies(jar)(res);
				const headers = res.headers;
				if (!headers.location) {
					throw { error: 'Wrong username/password.' };
				}

				// This means the account has login approvals turned on.
				if (headers.location.indexOf('https://www.facebook.com/checkpoint/') > -1) {
					log.info('login', 'You have login approvals turned on.');
					const nextURL = 'https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php';

					return utils
						.get(headers.location, jar, null, loginOptions)
						.then(utils.saveCookies(jar))
						.then(res => {
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
									continue: (code: string) => {
										form.approvals_code = code;
										form['submit[Continue]'] = 'Continue';
										return utils
											.post(nextURL, jar, form, loginOptions)
											.then(utils.saveCookies(jar))
											.then(function () {
												// Use the same form (safe I hope)
												form.name_action_selected = 'save_device';

												return utils.post(nextURL, jar, form, loginOptions).then(utils.saveCookies(jar));
											})
											.then(function (res) {
												const headers = res.headers;
												if (!headers.location && res.body.indexOf('Review Recent Login') > -1) {
													throw { error: 'Something went wrong with login approvals.' };
												}

												const appState = utils.getAppState(jar);

												// Simply call loginHelper because all it needs is the jar
												// and will then complete the login process
												return loginHelper(email, password, loginOptions, callback, appState);
											})
											.catch(function (err) {
												callback(err);
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

								return utils
									.post(nextURL, jar, form, loginOptions)
									.then(utils.saveCookies(jar))
									.then(function () {
										// Use the same form (safe I hope)
										form.name_action_selected = 'save_device';

										return utils.post(nextURL, jar, form, loginOptions).then(utils.saveCookies(jar));
									})
									.then(function (res) {
										const headers = res.headers;

										if (!headers.location && res.body.indexOf('Review Recent Login') > -1) {
											throw { error: 'Something went wrong with review recent login.' };
										}

										const appState = utils.getAppState(jar);

										// Simply call loginHelper because all it needs is the jar
										// and will then complete the login process
										return loginHelper(email, password, loginOptions, callback, appState);
									})
									.catch(function (e) {
										callback(e);
									});
							}
						});
				}
				return utils.get('https://www.facebook.com/', jar, null, loginOptions).then(utils.saveCookies(jar)) as any;
			});
	};
}
