import Bluebird from 'bluebird';
import { LogLevels } from 'npmlog';
import { Cookie } from 'tough-cookie';
import Jar from './jar';
import mqtt from 'mqtt';

export interface Credentials {
	email: string;
	password: string;
	appState: AppState;
}

export interface ApiOptions {
	/** The desired logging level as determined by npmlog */
	logLevel?: LogLevels;
	/** Whether the api will receive messages from its own account. Default `false` */
	selfListen?: boolean;
	/** Will make `api.listen` also handle events. Default `false` */
	listenEvents?: boolean;
	/**
	 * Makes api.listen only receive messages through the page specified by that ID.
	 * Also makes `sendMessage` and `sendSticker` send from the page.
	 * Default empty
	 * */
	pageID?: string;
	/** Will make `api.listen` also return presence. Default `false` */
	updatePresence?: boolean;
	/** Will automatically approve of any recent logins and continue with the login process. Default `false` */
	forceLogin?: boolean;
	/** The desired simulated User Agent.
	 * Default `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/600.3.18 (KHTML, like Gecko) Version/8.0.3 Safari/600.3.18`
	 */
	userAgent?: string;
	/** Will automatically mark new messages as delivered. Default `true`*/
	autoMarkDelivery?: boolean;
	/** Will automatically mark new messages as read/seen. Default `false */
	autoMarkRead?: boolean;
	logRecordSize?: number;
}

/** Api context data */
export interface ApiCtx {
	userID: string;
	jar: any;
	clientID: string;
	globalOptions: ApiOptions;
	loggedIn: boolean;
	access_token: string;
	clientMutationId: number;
	mqttClient?: mqtt.MqttClient;
	lastSeqId: number;
	syncToken: any;
	fb_dtsg?: any;
	ttstamp?: any;
}

/** Default functions */
export interface Dfs {
	get: (url: string, jar: Jar, qs?: any) => Bluebird<any>;
	post: (url: string, jar: Jar, form: any) => Bluebird<any>;
	postFormData: (url: string, jar: Jar, form: any, qs: any) => Bluebird<any>;
}

export interface RequestForm {
	client: string;
	[index: string]: string;
}

export interface MessHeaders {
	'Content-Type'?: string;
	Referer?: string;
	Host?: string;
	Origin?: string;
	'User-Agent'?: string;
	Connection?: string;
}

export interface Message {
	type: 'message';
	attachments: any[];
	/** The string corresponding to the message that was just received */
	body: string;
	/** Whether is a group thread */
	isGroup: boolean;
	/** An object containing people mentioned/tagged in the message */
	mentions: { id: string }[];
	messageID: string;
	senderID: string;
	threadID: string;
	isUnread: boolean;
}

export type AppState = Cookie[];
