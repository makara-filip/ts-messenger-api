/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable no-case-declarations */
import stream from 'stream';
import log from 'npmlog';
import {
	ApiCtx,
	AppState,
	Dfs,
	MessageID,
	MqttQueue,
	OutgoingMessage,
	OutgoingMessageSendType,
	WebsocketContent
} from './types';
import { parseDelta } from './formatting/incomingMessageFormatters';
import { Presence, Typ, IncomingMessageType } from './types/incomingMessages';
import { FriendsList, UserID, UserInfoGeneral, UserInfoGeneralDictByUserId } from './types/users';
import * as utils from './utils';
import * as formatters from './formatters';
import mqtt from 'mqtt';
import websocket from 'websocket-stream';
import FormData from 'form-data';
import { ThreadHistory, ThreadID, ThreadInfo } from './types/threads';
import { getAttachmentID, UploadGeneralAttachmentResponse } from './types/upload-attachment-response';
import { EventEmitter } from 'events';

export default class Api {
	ctx: ApiCtx;
	private _defaultFuncs;

	private _topics = [
		'/t_ms',
		'/thread_typing',
		'/orca_typing_notifications',
		'/orca_presence',
		'/legacy_web',
		'/br_sr',
		'/sr_res',
		'/webrtc',
		'/onevc',
		'/notify_disconnect',
		'/inbox',
		'/mercury',
		'/messaging_events',
		'/orca_message_notifications',
		'/pp',
		'/webrtc_response'
	];
	private allowedProperties: { [index: string]: boolean } = {
		attachment: true,
		url: true,
		sticker: true,
		emoji: true,
		emojiSize: true,
		body: true,
		mentions: true
	};
	private chatOn = true;
	private foreground = false;

	/** @internal */
	constructor(defaultFuncs: Dfs, ctx: ApiCtx) {
		this.ctx = ctx;
		this._defaultFuncs = defaultFuncs;
	}

	/** Returns the `AppState` which can be saved and reused
	 * in future logins without needing the password.
	 * @category Activation */
	getAppState(): AppState {
		return utils.getAppState(this.ctx.jar);
	}

	/** Establish the websocket connection and enables message sending and receiving.
	 * Possible event names are `error`, `message`, `typ`, `presence` and `close`.
	 * @returns Event emitter emitting all incoming events.
	 * @category Activation */
	async listen(): Promise<EventEmitter> {
		//Reset some stuff
		this.ctx.lastSeqId = 0;
		this.ctx.syncToken = undefined;

		//Same request as getThreadList
		const form = {
			av: this.ctx.globalOptions.pageID,
			queries: JSON.stringify({
				o0: {
					doc_id: '1349387578499440',
					query_params: {
						limit: 1,
						before: null,
						tags: ['INBOX'],
						includeDeliveryReceipts: false,
						includeSeqID: true
					}
				}
			})
		};

		return await this._defaultFuncs
			.post('https://www.facebook.com/api/graphqlbatch/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(async resData => {
				if (resData && resData.length > 0 && resData[resData.length - 1].error_results > 0) {
					throw resData[0].o0.errors;
				}

				if (resData[resData.length - 1].successful_results === 0) {
					throw { error: 'getSeqId: there was no successful_results', res: resData };
				}

				if (resData[0].o0.data.viewer.message_threads.sync_sequence_id) {
					this.ctx.lastSeqId = resData[0].o0.data.viewer.message_threads.sync_sequence_id;
					return await this._listenMqtt();
				}
				throw new Error('Fatal XT6');
			});
	}

	private async _listenMqtt(): Promise<EventEmitter> {
		const mqttEE = new EventEmitter();

		const sessionID = Math.floor(Math.random() * 9007199254740991) + 1;
		const username = {
			u: this.ctx.userID,
			s: sessionID,
			chat_on: this.chatOn,
			fg: this.foreground,
			d: utils.getGUID(),
			ct: 'websocket',
			//App id from facebook
			aid: '219994525426954',
			mqtt_sid: '',
			cp: 3,
			ecp: 10,
			st: this._topics,
			pm: [],
			dc: '',
			no_auto_fg: true,
			gas: null
		};
		const cookies: string = this.ctx.jar.getCookies('https://www.facebook.com').join('; ');

		//Region could be changed for better ping. (Region atn: Southeast Asia, region ash: West US, prob) (Don't really know if we need it).
		//// const host = 'wss://edge-chat.facebook.com/chat?region=atn&sid=' + sessionID;
		const host = 'wss://edge-chat.facebook.com/chat?sid=' + sessionID;

		const options = {
			clientId: 'mqttwsclient',
			protocolId: 'MQIsdp',
			protocolVersion: 3,
			username: JSON.stringify(username),
			clean: true,
			wsOptions: {
				headers: {
					Cookie: cookies,
					Origin: 'https://www.facebook.com',
					'User-Agent': this.ctx.globalOptions.userAgent,
					Referer: 'https://www.facebook.com',
					Host: 'edge-chat.facebook.com'
				},
				origin: 'https://www.facebook.com',
				protocolVersion: 13
			}
		};

		this.ctx.mqttClient = new mqtt.Client(() => websocket(host, options.wsOptions), options);

		const mqttClient = this.ctx.mqttClient;

		mqttClient.on('error', err => {
			//TODO: This was modified
			log.error('err', err.message);
			mqttClient.end();
			mqttEE.emit('error', err);
		});

		mqttClient.on('message', (topic, message) => {
			const jsonMessage = JSON.parse(message.toString());
			if (topic === '/t_ms') {
				if (jsonMessage.firstDeltaSeqId && jsonMessage.syncToken) {
					this.ctx.lastSeqId = jsonMessage.firstDeltaSeqId;
					this.ctx.syncToken = jsonMessage.syncToken;
				}

				if (jsonMessage.lastIssuedSeqId) this.ctx.lastSeqId = parseInt(jsonMessage.lastIssuedSeqId);

				for (const i in jsonMessage.deltas) {
					const delta = jsonMessage.deltas[i];
					let parsed = []; // array, because 1 delta can possibly contain multiple events
					try {
						// all data are formatted into ts-messenger-api ecosystem in this function
						parsed = parseDelta(delta, this);
					} catch (error) {
						return mqttEE.emit('error', error);
					}
					for (const parsedMessage of parsed) mqttEE.emit('message', parsedMessage);
				}
			} else if (topic === '/thread_typing' || topic === '/orca_typing_notifications') {
				if (jsonMessage.type !== 'typ')
					return mqttEE.emit(
						'error',
						new Error('There was an unknown WS error. Contact the dev team about this (error code 935466).')
					);
				const typ: Typ = {
					type: IncomingMessageType.TypingIndicator,
					isTyping: !!jsonMessage.state,
					senderId: parseInt(jsonMessage.sender_fbid),
					threadId: parseInt(jsonMessage.sender_fbid || jsonMessage.thread)
				};
				mqttEE.emit('typ', typ);
			} else if (topic === '/orca_presence' && this.ctx.globalOptions.updatePresence) {
				if (!(jsonMessage.list && jsonMessage.list.length))
					return mqttEE.emit(
						'error',
						new Error('There was an unknown WS error. Contact the dev team about this (error code 935467)')
					);
				for (const data of jsonMessage.list) {
					const presence: Presence = {
						type: IncomingMessageType.UserPresence,
						userID: data.u,
						timestamp: data.l * 1000, // timestamp to milliseconds
						status: data.p
					};
					mqttEE.emit('presence', presence);
				}
			}
		});
		mqttClient.on('close', () => {
			this.ctx.mqttClient = undefined;
			mqttEE.emit('close');
		});

		return await new Promise((resolve, reject) => {
			mqttClient.once('connect', () => {
				// TODO: think about this when reconnecting
				let topic;
				const queue: MqttQueue = {
					sync_api_version: 10,
					max_deltas_able_to_process: 1000,
					delta_batch_size: 500,
					encoding: 'JSON',
					entity_fbid: this.ctx.userID
				};

				if (this.ctx.globalOptions.pageID) {
					queue.entity_fbid = this.ctx.globalOptions.pageID;
				}

				if (this.ctx.syncToken) {
					topic = '/messenger_sync_get_diffs';
					queue.last_seq_id = this.ctx.lastSeqId;
					queue.sync_token = this.ctx.syncToken;
				} else {
					topic = '/messenger_sync_create_queue';
					queue.initial_titan_sequence_id = this.ctx.lastSeqId;
					queue.device_params = null;
				}

				mqttClient.publish(topic, JSON.stringify(queue), { qos: 1, retain: false });
				resolve(mqttEE);
			});
		});
	}

	/** Closes the websocket connection and, consequently, disables message sending and receiving.
	 * @category Activation */
	stopListening(): void {
		if (!this.ctx.mqttClient) return;
		this.ctx.mqttClient.end();
		this.ctx.mqttClient = undefined;
	}

	/** This value indicates whether the API listens for events and is able to send messages.
	 * This property is true if `API.listen` method was invoked.
	 * @category Activation */
	isActive(): boolean {
		return !!this.ctx.mqttClient;
	}
	private checkForActiveState() {
		if (!this.isActive) throw new Error('This function requires the function Api.listen() to be called first');
	}

	private websocketTaskNumber = 1;
	private websocketRequestNumber = 1;
	/** Returns new object that can be JSON-stringified and sent using the websockets.
	 * @param fbContentType (number) specific for each websocket requests
	 * (4 for typing & state indication, 3 for message sending, etc.) - default 3 */
	private createWebsocketContent(fbContentType = 3): WebsocketContent {
		return {
			request_id: ++this.websocketRequestNumber,
			type: fbContentType,
			payload: {
				version_id: '3816854585040595',
				tasks: [], // all tasks will be added here
				epoch_id: 6763184801413415579,
				data_trace_id: null
			},
			app_id: '772021112871879'
		};
	}
	private async sendWebsocketContent(websocketContent: WebsocketContent): Promise<void> {
		this.checkForActiveState();

		// json-stringify the payload property (if it hasn't been previously)
		// because (slightly retarded) Facebook requires it
		if (typeof websocketContent.payload === 'object')
			websocketContent.payload = JSON.stringify(websocketContent.payload);

		return new Promise((resolve, reject) => {
			this.ctx.mqttClient?.publish('/ls_req', JSON.stringify(websocketContent), {}, (err, packet) =>
				err ? reject(err) : resolve()
			);
		});
	}

	/** Marks a thread with given `threadId` as read.
	 * @category Messages */
	async markAsRead(threadId: ThreadID): Promise<void> {
		// similar code structure as in "sendMessage" method...
		this.checkForActiveState();

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '21',
			payload: JSON.stringify({
				thread_id: threadId,
				last_read_watermark_ts: Date.now()
			}),
			queue_name: threadId.toString(),
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Sends a message to a given thread.
	 * @param msg Actual message object - can contain attachments, mentions, reply...
	 * @param threadID ID of a thread to send the message to
	 * @category Messages */
	async sendMessage(msg: OutgoingMessage, threadID: ThreadID): Promise<void> {
		this.checkForActiveState();

		// the core websocket content object
		// its properties will vary depending on message type
		const rawTaskPayload = {
			thread_id: threadID,
			otid: utils.generateOfflineThreadingID(),
			source: 0
			// other properties will be added
		} as Record<string, unknown>;

		if (msg.sticker) {
			rawTaskPayload.send_type = OutgoingMessageSendType.Sticker;
			rawTaskPayload.sticker_id = msg.sticker;
		}
		if (msg.body) {
			rawTaskPayload.send_type = OutgoingMessageSendType.PlainText;
			rawTaskPayload.text = msg.body;

			if (msg.mentions)
				rawTaskPayload.mention_data = {
					mention_ids: msg.mentions.map(m => m.id).join(),
					mention_offsets: utils
						.mentionsGetOffsetRecursive(
							msg.body,
							msg.mentions.map(m => m.name)
						)
						.join(),
					mention_lengths: msg.mentions.map(m => m.name.length).join(),
					mention_types: msg.mentions.map(() => 'p').join()
				};
		}
		if (msg.attachment) {
			if (!(msg.attachment instanceof Array)) msg.attachment = [msg.attachment];
			// upload files and get attachment IDs
			const files = await this.uploadAttachment(msg.attachment);

			rawTaskPayload.send_type = OutgoingMessageSendType.Attachment;
			rawTaskPayload.text = msg.body ? msg.body : null;
			rawTaskPayload.attachment_fbids = files.map(file => getAttachmentID(file)); // here is the actual attachment ID
		}
		if (msg.replyToMessage) {
			rawTaskPayload.reply_metadata = {
				reply_source_id: msg.replyToMessage,
				reply_source_type: 1 // I've seen here only "1" and nothing else
			};
		}

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '46',
			payload: JSON.stringify(rawTaskPayload), // the main info is this
			queue_name: threadID.toString(),
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Unsends the message with given `messageId`, resulting in other participants not seeing the original content of the message.
	 * @category Messages */
	async unsendMessage(messageID: MessageID): Promise<void> {
		this.checkForActiveState();
		if (!messageID) throw new Error('Invalid input to unsendMessage method');

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '33',
			payload: JSON.stringify({ message_id: messageID }),
			queue_name: 'unsend_message',
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Forwards a message with id `messageID` to thread `threadId`.
	 * You can use this method to send an attachment without uploading it again.
	 * @category Messages */
	async forwardMessage(messageID: MessageID, threadID: ThreadID): Promise<void> {
		this.checkForActiveState();
		if (!(messageID && threadID)) throw new Error('Invalid input to forwardMessage method');

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '46',
			payload: JSON.stringify({
				thread_id: threadID,
				otid: utils.generateOfflineThreadingID(),
				source: 65536,
				send_type: OutgoingMessageSendType.ForwardMessage,
				forwarded_msg_id: messageID
			}),
			queue_name: threadID.toString(),
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	private async uploadAttachment(attachments: stream.Readable[]): Promise<UploadGeneralAttachmentResponse[]> {
		return await Promise.all(
			attachments.map(async att => {
				if (!utils.isReadableStream(att))
					throw new TypeError(`Attachment should be a readable stream and not ${utils.getType(att)}.`);

				const formData = new FormData();
				formData.append('upload_1024', att);
				// formData.append('voice_clip', 'true'); // is this necessary??

				return await this._defaultFuncs
					.postFormData2('https://upload.facebook.com/ajax/mercury/upload.php', this.ctx.jar, formData, {})
					.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
					.then((resData: any) => {
						if (resData.error) throw resData;

						// We have to return the data unformatted unless we want to change it back in sendMessage.
						return resData.payload.metadata[0] as UploadGeneralAttachmentResponse;
					});
			})
		);
	}

	/** Sends a typing indicator to a thread with id `threadId`.
	 * @param threadID the specified thread to send the indicator to
	 * @param isTyping the actual state of typing indicator (typing or not typing)
	 * @param timeout time in milliseconds after which to turn off the typing state if the state is set to true - default 20000 (20 seconds)
	 * @category Messages */
	async sendTypingIndicator(threadID: ThreadID, isTyping: boolean, timeout = 20000): Promise<void> {
		this.checkForActiveState();
		if (!threadID) throw new Error('Invalid input to sendTypingIndicator method.');

		// we need to know whether the thread is a group
		// TODO: transform to getThreadInfo when it's available
		const history = await this.getThreadHistory(threadID, 1, undefined);
		if (!history) throw new Error('An error 2 occuder while checking whether the thread was a group or not.');
		if (!history.length) throw new Error('An error 3 occuder while checking whether the thread was a group or not.');

		const wsContent = this.createWebsocketContent(4);
		// typing indication is slightly different from message sending
		wsContent.payload = JSON.stringify({
			label: '3',
			payload: JSON.stringify({
				thread_key: threadID,
				is_group_thread: history[0].isGroup, // group boolean here
				is_typing: isTyping
			}),
			version: '2667723500019469'
		});

		// automatically turn off after the timeout (otherwise it would be forever, I've tested that )
		if (isTyping) setTimeout(() => this.sendTypingIndicator(threadID, false, -1), timeout);
		await this.sendWebsocketContent(wsContent);
	}

	/** Sends a reaction to a message with id `messageId` in a thread with `threadId`.
	 * @param reaction An emoji to use in the reaction. The string must be exactly one emoji.
	 * @category Messages */
	async sendMessageReaction(threadId: ThreadID, messageId: MessageID, reaction: string): Promise<void> {
		this.checkForActiveState();
		if (!(threadId && messageId && reaction))
			throw new Error('Invalid input to sendMessageReaction method. Got undefined arguments.');

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '29',
			payload: JSON.stringify({
				thread_key: threadId,
				timestamp_ms: Date.now(),
				message_id: messageId,
				actor_id: this.ctx.userID,
				reaction: reaction,
				reaction_style: null
			}),
			queue_name: JSON.stringify(['reaction', messageId]),
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}
	/** @category Messages */
	async clearMessageReaction(threadId: ThreadID, messageId: MessageID): Promise<void> {
		await this.sendMessageReaction(threadId, messageId, '');
	}

	/** Returns all available information about one or more users by their FB id.
	 * @category Users */
	async getUserInfo(id: UserID[]): Promise<UserInfoGeneralDictByUserId> {
		const form: { [index: string]: UserID } = {};
		id.forEach((v, i) => {
			form['ids[' + i + ']'] = v;
		});
		return await this._defaultFuncs
			.post('https://www.facebook.com/chat/user_info/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(resData => {
				if (resData.error) {
					throw resData;
				}
				return this.formatData(resData.payload.profiles);
			});
	}
	private formatData(data: any): Map<UserID, UserInfoGeneral> {
		const retObj: UserInfoGeneralDictByUserId = new Map<UserID, UserInfoGeneral>();

		for (const prop in data) {
			if (Object.hasOwnProperty.call(data, prop)) {
				const innerObj = data[prop];
				retObj.set(prop, {
					name: innerObj.name,
					firstName: innerObj.firstName,
					vanity: innerObj.vanity,
					thumbSrc: innerObj.thumbSrc,
					profileUrl: innerObj.uri,
					gender: innerObj.gender,
					type: innerObj.type,
					isFriend: innerObj.is_friend,
					isBirthday: !!innerObj.is_birthday
				});
			}
		}

		return retObj;
	}

	/** Sets a custom emoji to a thread with `threadId`.
	 * If you want to keep the original Facebook "like", set the `emoji` argument as an empty string.
	 * @category Customisation */
	async changeThreadEmoji(threadId: ThreadID, emoji: string): Promise<void> {
		this.checkForActiveState();

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '53',
			payload: JSON.stringify({ thread_key: threadId, custom_emoji: emoji }),
			queue_name: 'thread_custom_emoji',
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Sets a custom colour theme to a thread with `threadId`.
	 * ⚠ Warning: `threadId` parameter will change to enum soon
	 * @category Customisation */
	async changeThreadColorTheme(threadId: ThreadID, themeId: number): Promise<void> {
		// TODO: add an enum for all theme IDs
		this.checkForActiveState();

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '43',
			payload: JSON.stringify({ thread_key: threadId, theme_fbid: themeId, source: null }),
			queue_name: 'thread_theme',
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Adds one or more users to a group with id `threadId`.
	 * @category Group management */
	async addUserToGroup(userIds: UserID | UserID[], threadId: ThreadID): Promise<void> {
		this.checkForActiveState();
		if (!(userIds instanceof Array)) userIds = [userIds];

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '23',
			payload: JSON.stringify({ thread_key: threadId, contact_ids: userIds }),
			queue_name: threadId.toString(),
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Removes one user from a group with id `threadId`.
	 * @category Group management */
	async removeUserFromGroup(userId: UserID, threadId: ThreadID): Promise<void> {
		this.checkForActiveState();

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '140',
			payload: JSON.stringify({ thread_id: threadId, contact_id: userId }),
			queue_name: 'remove_participant_v2',
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** @category Group management  */
	async leaveGroup(threadId: ThreadID): Promise<void> {
		await this.removeUserFromGroup(this.ctx.userID, threadId);
	}

	/** Marks a user as admin/non-admin in a group chat.
	 * If the user calling this function has insufficient permissions to raise admins in the group, nothing happens.
	 * @category Group management */
	async changeAdminStatus(threadId: ThreadID, userId: UserID, isAdmin: boolean): Promise<void> {
		this.checkForActiveState();

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '25',
			payload: JSON.stringify({ thread_key: threadId, contact_id: userId, is_admin: isAdmin }),
			queue_name: 'admin_status',
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Changes the group chat title. This works only on groups.
	 * @category Group management */
	async changeGroupName(threadId: ThreadID, newName: string): Promise<void> {
		this.checkForActiveState();
		if (!newName) throw new Error('Undefined argument: newName was not specified.');

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '32',
			payload: JSON.stringify({ thread_key: threadId, thread_name: newName }),
			queue_name: threadId.toString(),
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Set a profile picture to a group with id `threadId`.
	 * @example
	 * ```typescript
	 * import fs from 'fs';
	 * api.changeGroupPhoto(9876543219876, fs.createReadableStream('path_to_picture'))
	 * ```
	 * @category Group management */
	async changeGroupPhoto(threadId: ThreadID, photo: stream.Readable): Promise<void> {
		this.checkForActiveState();

		// upload photo to get an attachment ID
		const uploadResponse = await this.uploadAttachment([photo]);
		const attachmentId = getAttachmentID(uploadResponse[0]);

		const wsContent = this.createWebsocketContent();
		wsContent.payload.tasks.push({
			label: '37',
			payload: JSON.stringify({ thread_key: threadId, image_id: attachmentId }),
			queue_name: 'thread_image',
			task_id: this.websocketTaskNumber++,
			failure_count: null
		});
		await this.sendWebsocketContent(wsContent);
	}

	/** Returns all available information about all user's friends as an array of user objects.
	 * @category Users */
	async getFriendsList(): Promise<FriendsList> {
		return await this._defaultFuncs
			.postFormData('https://www.facebook.com/chat/user_info_all', this.ctx.jar, {}, { viewer: this.ctx.userID })
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (!resData) throw { error: 'getFriendsList returned empty object.' };
				if (resData.error) throw resData;
				return resData as FriendsList;
			});
	}

	/** Returns all available information about a thread with `threadId`.
	 * @category Threads
	 */
	async getThreadInfo(threadId: ThreadID): Promise<ThreadInfo> {
		const form = {
			queries: JSON.stringify({
				o0: {
					// This doc_id is valid as of February 1st, 2018.
					doc_id: '1498317363570230',
					query_params: {
						id: threadId,
						message_limit: 0,
						load_messages: 0,
						load_read_receipts: false,
						before: null
					}
				}
			})
		};

		return await this._defaultFuncs
			.post('https://www.facebook.com/api/graphqlbatch/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error) throw resData;
				// This returns us an array of things. The last one is the success/failure one.
				// @TODO What do we do in this case?
				if (resData[resData.length - 1].error_results !== 0) throw new Error('There was an error_result');

				return formatters.formatThreadGraphQLResponse(resData[0]);
			});
	}

	/** Returns `amount` of thread messages before the `timestamp` (default undefined - last messages)
	 * @category Threads */
	async getThreadHistory(threadID: ThreadID, amount: number, timestamp?: number): Promise<ThreadHistory> {
		// `queries` has to be a string. I couldn't tell from the dev console. This
		// took me a really long time to figure out. I deserve a cookie for this.
		const form = {
			av: this.ctx.globalOptions.pageID,
			queries: JSON.stringify({
				o0: {
					// This doc_id was valid on February 2nd 2017.
					doc_id: '1498317363570230',
					query_params: {
						id: threadID,
						message_limit: amount,
						load_messages: 1,
						load_read_receipts: false,
						before: timestamp
					}
				}
			})
		};

		return await this._defaultFuncs
			.post('https://www.facebook.com/api/graphqlbatch/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error) {
					throw resData;
				}
				// This returns us an array of things. The last one is the success /
				// failure one.
				// @TODO What do we do in this case?
				if (resData[resData.length - 1].error_results !== 0) {
					throw new Error('well darn there was an error_result');
				}

				return formatters.formatMessagesGraphQLResponse(resData[0]);
			});
	}
}
