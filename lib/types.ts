import Bluebird from 'bluebird';
import { LogLevels } from 'npmlog';
import { Cookie } from 'tough-cookie';
import Jar from './jar';
import mqtt from 'mqtt';
import stream from 'stream';
import { UserID } from './types/users';

export interface Credentials {
	email: string;
	password: string;
	appState?: AppState;
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
	jar: Jar;
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
	[index: string]: any;
}

export interface MessHeaders {
	'Content-Type'?: string;
	Referer?: string;
	Host?: string;
	Origin?: string;
	'User-Agent'?: string;
	Connection?: string;
}

/** Message can only be a regular message (`body` field set) and optionally one of a `sticker`, `attachment` or `url` */
export interface OutgoingMessage {
	/** a plain-text content of the outgoing message */
	body?: string;
	/** Readable stream(s) to be sent as attachments. Can be any file, image, voiceclip... */
	attachment?: stream.Readable | stream.Readable[];
	/** message ID to which this new message would respond */
	replyToMessage?: MessageID;
	url?: string;
	/** ID of the desired sticker */
	sticker?: number;
	emoji?: string;
	emojiSize?: 'small' | 'medium' | 'large';
	/** Additional information when sending a message with user mentions.
	 * This property contains sorted "name & id" pairs. */
	mentions?: OutgoingMessageUserMention[];
}

export interface OutgoingMessageUserMention {
	/** text which will be referenced to mentioned user (usually starting with the @ (at) sign) */
	name: string;
	/** ID of the user being mentioned */
	id: UserID;
}

interface MessageBase {
	type:
		| 'message'
		| 'event'
		| 'typ'
		| 'read'
		| 'read_receipt'
		| 'message_reaction'
		| 'presence'
		| 'message_unsend'
		| 'message_reply';
	threadID: string;
}

export type MessageID = string;

export interface Message extends MessageBase {
	type: 'message';
	attachments: AnyAttachment[];
	/** The string corresponding to the message that was just received */
	body: string;
	/** Whether is a group thread */
	isGroup: boolean;
	/** An object containing people mentioned/tagged in the message */
	mentions: { id: string }[];
	messageID: MessageID;
	senderID: UserID;
	isUnread?: boolean;
	timestamp?: number;
}

export interface Event extends MessageBase {
	type: 'event';
	author: string;
	logMessageBody: string;
	logMessageData: string;
	logMessageType?: LogMessageType;
}

export type LogMessageType =
	| 'log:subscribe'
	| 'log:unsubscribe'
	| 'log:thread-name'
	| 'log:thread-color'
	| 'log:thread-icon'
	| 'log:user-nickname';

export interface Typ extends MessageBase {
	type: 'typ';
	from: string;
	fromMobile?: boolean;
	isTyping: boolean;
}

export interface Read extends MessageBase {
	type: 'read';
	time: string;
}

export interface ReadReceipt extends MessageBase {
	type: 'read_receipt';
	time: string;
	reader: string;
}

export interface MessageReaction extends MessageBase {
	type: 'message_reaction';
	messageID: string;
	offlineThreadingID?: string;
	reaction: string;
	senderID: string;
	timestamp?: number;
	userID: string;
}

export interface Presence {
	type: 'presence';
	statuses: UserStatus;
	timestamp: number;
	userID: string;
}

export interface MessageUnsend extends MessageBase {
	type: 'message_unsend';
	senderID: string;
	messageID: string;
	deletionTimestamp: number;
	timestamp: number;
}

export interface MessageReply extends MessageBase {
	type: 'message_reply';
	attachments: AnyAttachment[];
	body: string;
	isGroup: boolean;
	mentions: { id: string };
	messageID: string;
	senderID: string;
	isUnread?: boolean;
	messageReply?: Message;
	timestamp?: number;
}

export interface ChangeThreadImage {
	type: 'change_thread_image';
	threadID: string;
	snippet: any;
	timestamp: number;
	author: number;
	image: {
		attachmentID: string;
		width: number;
		height: number;
		url: string;
	};
}

enum UserStatus {
	/** away for 2 minutes */
	IDLE = 0,
	ONLINE = 2
}

// ============= Attachments =============

export interface Attachment {
	type: string;
	ID: string;
	url: string;
}
export interface Preview {
	previewUrl: string;
	previewWidth: number;
	previewHeight: number;
}

export interface StickerAttachment extends Attachment {
	type: 'sticker';
	packID: string;
	spriteUrl: string;
	spriteUrl2x: string;
	width: number;
	height: number;

	caption: string;
	description: string;

	frameCount: number;
	frameRate: number;
	framesPerRow: number;
	framesPerCol: number;

	stickerID: string; // @Legacy
	spriteURI: string; // @Legacy
	spriteURI2x: string; // @Legacy
}
export interface FileAttachment extends Attachment {
	type: 'file';
	filename: string;

	isMalicious: boolean;
	contentType: string;

	name: string; // @Legacy
	mimeType: string; // @Legacy
	fileSize: number; // @Legacy
}
export interface PhotoAttachment extends Attachment, Preview {
	type: 'photo';
	filename: string;
	thumbnailUrl: string;

	largePreviewUrl: string;
	largePreviewWidth: number;
	largePreviewHeight: number;

	width: number; // @Legacy
	height: number; // @Legacy
	name: string; // @Legacy
}
export interface AnimatedImageAttachment extends Attachment, Preview {
	type: 'animated_image';
	filename: string;

	url: string;
	width: number;
	height: number;

	name: string; // @Legacy
	facebookUrl: string; // @Legacy
	thumbnailUrl: string; // @Legacy
	mimeType?: string; // @Legacy
	rawGifImage: unknown; // @Legacy
	rawWebpImage?: unknown; // @Legacy
	animatedGifUrl: string; // @Legacy
	animatedGifPreviewUrl: string; // @Legacy
	animatedWebpUrl: string; // @Legacy
	animatedWebpPreviewUrl: string; // @Legacy
}
export interface ShareAttachment extends Attachment {
	type: 'share';

	title: string;
	description: string;
	source: unknown;

	image: unknown;
	width: number;
	height: number;
	playable: boolean;
	duration: number;

	subattachments: unknown;
	properties: unknown;

	playableUrl?: string;

	animatedImageSize?: number; // @Legacy
	facebookUrl: string; // @Legacy
	target: unknown; // @Legacy
	styleList: unknown; // @Legacy
}
export interface VideoAttachment extends Attachment, Preview {
	type: 'video';
	filename: string;

	width: number;
	height: number;

	duration: number;
	videoType: 'unknown';

	thumbnailUrl: string; // @Legacy
}
export interface AudioAttachment extends Attachment {
	type: 'audio';
	filename: string;

	audioType: string;
	/** Playable duration in ms */
	duration: number;

	isVoiceMail: boolean;
}

export interface AttachmentError {
	type: 'error';
	attachment1: any;
	attachment2: any;
}

export type AnyAttachment =
	| AudioAttachment
	| VideoAttachment
	| ShareAttachment
	| AnimatedImageAttachment
	| PhotoAttachment
	| FileAttachment
	| StickerAttachment
	| AttachmentError;

export interface MqttQueue {
	sync_api_version: number;
	max_deltas_able_to_process: number;
	delta_batch_size: number;
	encoding: string;
	entity_fbid: string;
	device_params?: null;
	initial_titan_sequence_id?: number;
	sync_token?: string;
	last_seq_id?: number;
}

export type AppState = Cookie[];

export type ListenCallback = (
	err?: string | { error: string; detail: string; res: { delta: any }; type: string },
	message?:
		| Message
		| Event
		| Typ
		| Read
		| ReadReceipt
		| MessageReaction
		| Presence
		| MessageUnsend
		| MessageReply
		| ChangeThreadImage
) => void;
