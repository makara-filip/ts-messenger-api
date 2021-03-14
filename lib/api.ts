/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable no-case-declarations */
import stream from 'stream';
import log from 'npmlog';
import {
	ApiCtx,
	AppState,
	Dfs,
	ListenCallback,
	Message,
	MessageID,
	MessageReply,
	MqttQueue,
	OutgoingMessage,
	OutgoingMessageSendType,
	Presence,
	RequestForm,
	Typ,
	WebsocketContent
} from './types';
import { FriendsList, UserID, UserInfoGeneral, UserInfoGeneralDictByUserId } from './types/users';
import * as utils from './utils';
import * as formatters from './formatters';
import mqtt from 'mqtt';
import websocket from 'websocket-stream';
import FormData from 'form-data';
import { ThreadColor, ThreadID } from './types/threads';
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

	constructor(defaultFuncs: Dfs, ctx: ApiCtx) {
		this.ctx = ctx;
		this._defaultFuncs = defaultFuncs;
	}

	logout(callback: (err?: any) => void): void {
		callback = callback || function () {};

		const form = {
			pmid: '0'
		};

		this._defaultFuncs
			.post(
				'https://www.facebook.com/bluebar/modern_settings_menu/?help_type=364455653583099&show_contextual_help=1',
				this.ctx.jar,
				form
			)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				const elem = resData.jsmods.instances[0][2][0].filter((v: any) => v.value === 'logout')[0];

				const html = resData.jsmods.markup.filter((v: any) => v[0] === elem.markup.__m)[0][1].__html;

				const form = {
					fb_dtsg: utils.getFrom(html, '"fb_dtsg" value="', '"'),
					ref: utils.getFrom(html, '"ref" value="', '"'),
					h: utils.getFrom(html, '"h" value="', '"')
				};

				return this._defaultFuncs
					.post('https://www.facebook.com/logout.php', this.ctx.jar, form)
					.then(utils.saveCookies(this.ctx.jar));
			})
			.then((res: any) => {
				if (!res.headers) {
					throw { error: 'An error occurred when logging out.' };
				}

				return this._defaultFuncs.get(res.headers.location, this.ctx.jar).then(utils.saveCookies(this.ctx.jar));
			})
			.then(() => {
				this.ctx.loggedIn = false;
				log.info('logout', 'Logged out successfully.');
				callback();
			})
			.catch((err: any) => {
				log.error('logout', err);
				return callback(err);
			});
	}

	getAppState(): AppState {
		return utils.getAppState(this.ctx.jar);
	}

	deleteMessage(messageOrMessages: MessageID[], callback = (err?: Error) => err): void {
		const form: RequestForm = {
			client: 'mercury'
		};

		for (let i = 0; i < messageOrMessages.length; i++) {
			form[`message_ids[${i}]`] = messageOrMessages[i];
		}

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/delete_messages.php', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('deleteMessage', err);
				return callback(err);
			});
	}

	/** Establish the websocket connection and enables message sending and receiving.
	 * Possible event names are `error`, `message`, `typ`, `presence` and `close`.
	 * @returns Event emitter emitting all incoming events. */
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
			//TODO: This was modified
			const jsonMessage = JSON.parse(message.toString());
			// if (jsonMessage?.deltas) console.log(jsonMessage?.deltas[0]?.requestContext);
			if (topic === '/t_ms') {
				if (jsonMessage.firstDeltaSeqId && jsonMessage.syncToken) {
					this.ctx.lastSeqId = jsonMessage.firstDeltaSeqId;
					this.ctx.syncToken = jsonMessage.syncToken;
				}

				if (jsonMessage.lastIssuedSeqId) {
					this.ctx.lastSeqId = parseInt(jsonMessage.lastIssuedSeqId);
				}

				if (
					jsonMessage.queueEntityId &&
					this.ctx.globalOptions.pageID &&
					this.ctx.globalOptions.pageID != jsonMessage.queueEntityId
				) {
					return;
				}

				//If it contains more than 1 delta
				for (const i in jsonMessage.deltas) {
					const delta = jsonMessage.deltas[i];
					this._parseDelta(
						(err, message) => {
							if (err) return mqttEE.emit('error', err);
							mqttEE.emit('message', message);
						},
						{ delta: delta }
					);
				}
			} else if (topic === '/thread_typing' || topic === '/orca_typing_notifications') {
				const typ: Typ = {
					type: 'typ',
					isTyping: !!jsonMessage.state,
					from: jsonMessage.sender_fbid.toString(),
					threadID: utils.formatID((jsonMessage.thread || jsonMessage.sender_fbid).toString())
				};
				mqttEE.emit('typ', typ);
			} else if (topic === '/orca_presence') {
				if (!this.ctx.globalOptions.updatePresence) {
					for (const i in jsonMessage.list) {
						const data = jsonMessage.list[i];
						const userID = data['u'];

						const presence: Presence = {
							type: 'presence',
							userID: userID.toString(),
							//Convert to ms
							timestamp: data['l'] * 1000,
							statuses: data['p']
						};
						mqttEE.emit('presence', presence);
					}
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

	/** This function disables the websocket connection and, consequently, disables message sending and receiving. */
	stopListening(): void {
		if (!this.ctx.mqttClient) return;
		this.ctx.mqttClient.end();
		this.ctx.mqttClient = undefined;
	}

	/** This value indicates whether the API listens for events and is able to send messages.
	 * This property is true if `API.listen` method was invoked. */
	get isActive(): boolean {
		return !!this.ctx.mqttClient;
	}
	private checkForActiveState() {
		if (!this.isActive) throw new Error('This function requires the function Api.listen() to be called first');
	}

	private websocketTaskNumber = 1;
	private websocketRequestNumber = 1;
	/** Creates and returns an object that can be JSON-stringified and sent using the websocket connection.
	 * @param fbContentType (number) specific for different websocket types as Facebook uses
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

	private _parseDelta(globalCallback: ListenCallback, v: { delta: any }) {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const that = this;
		if (v.delta.class == 'NewMessage') {
			(function resolveAttachmentUrl(i): void {
				// sometimes, with sticker message in group, delta does not contain 'attachments' property.
				if (v.delta.attachments && i == v.delta.attachments.length) {
					let fmtMsg;
					try {
						fmtMsg = utils.formatDeltaMessage(v);
					} catch (err) {
						return globalCallback({
							error:
								'Problem parsing message object. Please open an issue at https://github.com/Schmavery/facebook-chat-api/issues.',
							detail: err,
							res: v,
							type: 'parse_error'
						});
					}
					if (fmtMsg) {
						if (that.ctx.globalOptions.autoMarkDelivery) {
							that._markDelivery(fmtMsg.threadID, fmtMsg.messageID);
						}
					}
					return !that.ctx.globalOptions.selfListen && fmtMsg.senderID === that.ctx.userID
						? undefined
						: (function () {
								globalCallback(undefined, fmtMsg);
						  })();
				} else {
					if (v.delta.attachments && v.delta.attachments[i].mercury.attach_type == 'photo') {
						that.resolvePhotoUrl(v.delta.attachments[i].fbid, (err?: Error, url?: string) => {
							if (!err) v.delta.attachments[i].mercury.metadata.url = url;
							return resolveAttachmentUrl(i + 1);
						});
					} else {
						return resolveAttachmentUrl(i + 1);
					}
				}
			})(0);
		}

		if (v.delta.class == 'ClientPayload') {
			const clientPayload = utils.decodeClientPayload(v.delta.payload);
			if (clientPayload && clientPayload.deltas) {
				for (const i in clientPayload.deltas) {
					const delta = clientPayload.deltas[i];
					if (delta.deltaMessageReaction && !!this.ctx.globalOptions.listenEvents) {
						(function () {
							globalCallback(undefined, {
								type: 'message_reaction',
								threadID: (delta.deltaMessageReaction.threadKey.threadFbId
									? delta.deltaMessageReaction.threadKey.threadFbId
									: delta.deltaMessageReaction.threadKey.otherUserFbId
								).toString(),
								messageID: delta.deltaMessageReaction.messageId,
								reaction: delta.deltaMessageReaction.reaction,
								senderID: delta.deltaMessageReaction.senderId.toString(),
								userID: delta.deltaMessageReaction.userId.toString()
							});
						})();
					} else if (delta.deltaRecallMessageData && !!this.ctx.globalOptions.listenEvents) {
						(function () {
							globalCallback(undefined, {
								type: 'message_unsend',
								threadID: (delta.deltaRecallMessageData.threadKey.threadFbId
									? delta.deltaRecallMessageData.threadKey.threadFbId
									: delta.deltaRecallMessageData.threadKey.otherUserFbId
								).toString(),
								messageID: delta.deltaRecallMessageData.messageID,
								senderID: delta.deltaRecallMessageData.senderID.toString(),
								deletionTimestamp: delta.deltaRecallMessageData.deletionTimestamp,
								timestamp: delta.deltaRecallMessageData.timestamp
							});
						})();
					} else if (delta.deltaMessageReply) {
						//Mention block - #1
						let mdata =
							delta.deltaMessageReply.message === undefined
								? []
								: delta.deltaMessageReply.message.data === undefined
								? []
								: delta.deltaMessageReply.message.data.prng === undefined
								? []
								: JSON.parse(delta.deltaMessageReply.message.data.prng);
						let m_id = mdata.map((u: any) => u.i);
						let m_offset = mdata.map((u: any) => u.o);
						let m_length = mdata.map((u: any) => u.l);

						const mentions: any = {};

						for (let i = 0; i < m_id.length; i++) {
							mentions[m_id[i]] = (delta.deltaMessageReply.message.body || '').substring(
								m_offset[i],
								m_offset[i] + m_length[i]
							);
						}
						//Mention block - 1#
						const callbackToReturn: MessageReply = {
							type: 'message_reply',
							threadID: (delta.deltaMessageReply.message.messageMetadata.threadKey.threadFbId
								? delta.deltaMessageReply.message.messageMetadata.threadKey.threadFbId
								: delta.deltaMessageReply.message.messageMetadata.threadKey.otherUserFbId
							).toString(),
							messageID: delta.deltaMessageReply.message.messageMetadata.messageId,
							senderID: delta.deltaMessageReply.message.messageMetadata.actorFbId.toString(),
							attachments: delta.deltaMessageReply.message.attachments
								.map(function (att: any) {
									const mercury = JSON.parse(att.mercuryJSON);
									Object.assign(att, mercury);
									return att;
								})
								.map((att: any) => {
									let x;
									try {
										x = utils._formatAttachment(att);
									} catch (ex) {
										x = att;
										x.error = ex;
										x.type = 'unknown';
									}
									return x;
								}),
							body: delta.deltaMessageReply.message.body || '',
							isGroup: !!delta.deltaMessageReply.message.messageMetadata.threadKey.threadFbId,
							mentions: mentions,
							timestamp: delta.deltaMessageReply.message.messageMetadata.timestamp
						};

						if (delta.deltaMessageReply.repliedToMessage) {
							//Mention block - #2
							mdata =
								delta.deltaMessageReply.repliedToMessage === undefined
									? []
									: delta.deltaMessageReply.repliedToMessage.data === undefined
									? []
									: delta.deltaMessageReply.repliedToMessage.data.prng === undefined
									? []
									: JSON.parse(delta.deltaMessageReply.repliedToMessage.data.prng);
							m_id = mdata.map((u: any) => u.i);
							m_offset = mdata.map((u: any) => u.o);
							m_length = mdata.map((u: any) => u.l);

							const rmentions: any = {};

							for (let i = 0; i < m_id.length; i++) {
								rmentions[m_id[i]] = (delta.deltaMessageReply.repliedToMessage.body || '').substring(
									m_offset[i],
									m_offset[i] + m_length[i]
								);
							}
							//Mention block - 2#
							callbackToReturn.messageReply = {
								type: 'message',
								threadID: (delta.deltaMessageReply.repliedToMessage.messageMetadata.threadKey.threadFbId
									? delta.deltaMessageReply.repliedToMessage.messageMetadata.threadKey.threadFbId
									: delta.deltaMessageReply.repliedToMessage.messageMetadata.threadKey.otherUserFbId
								).toString(),
								messageID: delta.deltaMessageReply.repliedToMessage.messageMetadata.messageId,
								senderID: delta.deltaMessageReply.repliedToMessage.messageMetadata.actorFbId.toString(),
								attachments: delta.deltaMessageReply.repliedToMessage.attachments
									.map(function (att: any) {
										const mercury = JSON.parse(att.mercuryJSON);
										Object.assign(att, mercury);
										return att;
									})
									.map((att: any) => {
										let x;
										try {
											x = utils._formatAttachment(att);
										} catch (ex) {
											x = att;
											x.error = ex;
											x.type = 'unknown';
										}
										return x;
									}),
								body: delta.deltaMessageReply.repliedToMessage.body || '',
								isGroup: !!delta.deltaMessageReply.repliedToMessage.messageMetadata.threadKey.threadFbId,
								mentions: rmentions,
								timestamp: delta.deltaMessageReply.repliedToMessage.messageMetadata.timestamp
							};
						}

						if (this.ctx.globalOptions.autoMarkDelivery) {
							this._markDelivery(callbackToReturn.threadID, callbackToReturn.messageID);
						}

						return !this.ctx.globalOptions.selfListen && callbackToReturn.senderID === this.ctx.userID
							? undefined
							: (function () {
									globalCallback(undefined, callbackToReturn);
							  })();
					}
				}
				return;
			}
		}

		if (v.delta.class !== 'NewMessage' && !this.ctx.globalOptions.listenEvents) return;

		switch (v.delta.class) {
			case 'ReadReceipt':
				let fmtMsg;
				try {
					fmtMsg = utils.formatDeltaReadReceipt(v.delta);
				} catch (err) {
					return globalCallback({
						error:
							'Problem parsing message object. Please open an issue at https://github.com/Schmavery/facebook-chat-api/issues.',
						detail: err,
						res: v.delta,
						type: 'parse_error'
					});
				}
				return (function () {
					globalCallback(undefined, fmtMsg);
				})();
			case 'AdminTextMessage':
				switch (v.delta.type) {
					case 'change_thread_theme':
					case 'change_thread_nickname':
					case 'change_thread_icon':
						break;
					case 'group_poll':
						let fmtMsg;
						try {
							fmtMsg = utils.formatDeltaEvent(v.delta);
						} catch (err) {
							return globalCallback({
								error:
									'Problem parsing message object. Please open an issue at https://github.com/Schmavery/facebook-chat-api/issues.',
								detail: err,
								res: v.delta,
								type: 'parse_error'
							});
						}
						return (function () {
							globalCallback(undefined, fmtMsg);
						})();
					default:
						return;
				}
				break;
			//For group images
			case 'ForcedFetch':
				if (!v.delta.threadKey) return;
				const mid = v.delta.messageId;
				const tid = v.delta.threadKey.threadFbId;
				if (mid && tid) {
					const form = {
						av: this.ctx.globalOptions.pageID,
						queries: JSON.stringify({
							o0: {
								//This doc_id is valid as of ? (prob January 18, 2020)
								doc_id: '1768656253222505',
								query_params: {
									thread_and_message_id: {
										thread_id: tid.toString(),
										message_id: mid.toString()
									}
								}
							}
						})
					};

					this._defaultFuncs
						.post('https://www.facebook.com/api/graphqlbatch/', this.ctx.jar, form)
						.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
						.then(resData => {
							if (resData[resData.length - 1].error_results > 0) {
								throw resData[0].o0.errors;
							}

							if (resData[resData.length - 1].successful_results === 0) {
								throw { error: 'forcedFetch: there was no successful_results', res: resData };
							}

							const fetchData = resData[0].o0.data.message;
							if (fetchData && fetchData.__typename === 'ThreadImageMessage') {
								(!this.ctx.globalOptions.selfListen && fetchData.message_sender.id.toString() === this.ctx.userID) ||
								!this.ctx.loggedIn
									? undefined
									: (function () {
											globalCallback(undefined, {
												type: 'change_thread_image',
												threadID: utils.formatID(tid.toString()),
												snippet: fetchData.snippet,
												timestamp: fetchData.timestamp_precise,
												author: fetchData.message_sender.id,
												image: {
													attachmentID:
														fetchData.image_with_metadata && fetchData.image_with_metadata.legacy_attachment_id,
													width: fetchData.image_with_metadata && fetchData.image_with_metadata.original_dimensions.x,
													height: fetchData.image_with_metadata && fetchData.image_with_metadata.original_dimensions.y,
													url: fetchData.image_with_metadata && fetchData.image_with_metadata.preview.uri
												}
											});
									  })();
							}
						})
						.catch(err => {
							log.error('forcedFetch', err);
						});
				}
				break;
			case 'ThreadName':
			case 'ParticipantsAddedToGroupThread':
			case 'ParticipantLeftGroupThread':
				let formattedEvent;
				try {
					formattedEvent = utils.formatDeltaEvent(v.delta);
				} catch (err) {
					return globalCallback({
						error:
							'Problem parsing message object. Please open an issue at https://github.com/Schmavery/facebook-chat-api/issues.',
						detail: err,
						res: v.delta,
						type: 'parse_error'
					});
				}
				return (!this.ctx.globalOptions.selfListen && formattedEvent.author.toString() === this.ctx.userID) ||
					!this.ctx.loggedIn
					? undefined
					: (function () {
							globalCallback(undefined, formattedEvent);
					  })();
		}
	}

	private _markDelivery(threadID: ThreadID, messageID: MessageID) {
		// if (threadID && messageID) {
		// 	this.markAsDelivered(threadID, messageID, err => {
		// 		if (err) {
		// 			log.error('FIX THIS', err);
		// 		} else {
		// 			if (this.ctx.globalOptions.autoMarkRead) {
		// 				this.markAsRead(threadID, undefined, err => {
		// 					if (err) {
		// 						log.error('FIX THIS', err);
		// 					}
		// 				});
		// 			}
		// 		}
		// 	});
		// }
	}

	resolvePhotoUrl(photoID: string, callback: (err?: Error, url?: string) => void): void {
		if (!callback) {
			throw { error: 'resolvePhotoUrl: need callback' };
		}

		this._defaultFuncs
			.get('https://www.facebook.com/mercury/attachments/photo', this.ctx.jar, {
				photo_id: photoID
			})
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(resData => {
				if (resData.error) {
					throw resData;
				}

				const photoUrl = resData.jsmods.require[0][3][0];

				return callback(undefined, photoUrl);
			})
			.catch(err => {
				log.error('resolvePhotoUrl', err);
				return callback(err);
			});
	}

	markAsDelivered(threadID: ThreadID, messageID: MessageID, callback: (err?: string) => void): void {
		if (!callback) {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			callback = function () {};
		}

		if (!threadID || !messageID) {
			return callback('Error: messageID or threadID is not defined');
		}

		const form: any = {};

		form['message_ids[0]'] = messageID;
		form['thread_ids[' + threadID + '][0]'] = messageID;

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/delivery_receipts.php', this.ctx.jar, form)
			.then(utils.saveCookies(this.ctx.jar))
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('markAsDelivered', err);
				return callback(err);
			});
	}

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

	markAsReadAll(callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}

		const form = {
			folder: 'inbox'
		};

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/mark_folder_as_read.php', this.ctx.jar, form)
			.then(utils.saveCookies(this.ctx.jar))
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('markAsReadAll', err);
				return callback(err);
			});
	}

	/**
	 * Sends a message to a given thread.
	 * @param msg Contents of the message
	 * @param threadID ID of a thread to send the message to
	 * @param callback Will be called when the message was successfully sent or rejected
	 */
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

	/** Sends a typing indicator to the specified thread.
	 * @param threadID the specified thread to send the indicator
	 * @param isTyping the state of typing indicator
	 * @param timeout the time in milliseconds after which to turn off the typing state
	 * (if the state was set to true) - recommended 20000 (20 seconds) */
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

	async getUserInfo(id: UserID[]): Promise<UserInfoGeneralDictByUserId> {
		const form: { [index: string]: UserID } = {};
		id.map((v, i) => {
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

	// -1=permanent mute, 0=unmute, 60=one minute, 3600=one hour, etc.
	muteThread(threadID: ThreadID, muteSeconds: number, callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}

		const form = {
			thread_fbid: threadID,
			mute_settings: muteSeconds
		};

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/change_mute_thread.php', this.ctx.jar, form)
			.then(utils.saveCookies(this.ctx.jar))
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('muteThread', err);
				return callback(err);
			});
	}

	deleteThread(threadOrThreads: ThreadID | ThreadID[], callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}

		const form: RequestForm = {
			client: 'mercury'
		};

		if (!(threadOrThreads instanceof Array)) {
			threadOrThreads = [threadOrThreads];
		}

		for (let i = 0; i < threadOrThreads.length; i++) {
			form['ids[' + i + ']'] = threadOrThreads[i];
		}

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/delete_thread.php', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch((err: any) => {
				log.error('deleteThread', err);
				return callback(err);
			});
	}

	/** Sets a custom emoji to the specified thread as a part of chat customisation.
	 * If you want to keep the original Facebook "like", set an empty string as the `emoji` argument. */
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

	async leaveGroup(threadId: ThreadID): Promise<void> {
		await this.removeUserFromGroup(this.ctx.userID, threadId);
	}

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

	changeArchivedStatus(threadOrThreads: ThreadID | ThreadID[], archive: boolean, callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}

		const form: any = {};

		if (threadOrThreads instanceof Array) {
			for (let i = 0; i < threadOrThreads.length; i++) {
				form['ids[' + threadOrThreads[i] + ']'] = archive;
			}
		} else {
			form['ids[' + threadOrThreads + ']'] = archive;
		}

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/change_archived_status.php', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error) {
					throw resData;
				}
				return callback();
			})
			.catch((err: any) => {
				log.error('changeArchivedStatus', err);
				return callback(err);
			});
	}

	changeBlockedStatus(userID: UserID, block: boolean, callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}
		if (block) {
			this._defaultFuncs
				.post(
					'https://www.facebook.com/nfx/block_messages/?thread_fbid=' + userID + '&location=www_chat_head',
					this.ctx.jar,
					{}
				)
				.then(utils.saveCookies(this.ctx.jar))
				.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
				.then((resData: any) => {
					if (resData.error) {
						throw resData;
					}
					this._defaultFuncs
						.post(
							'https://www.facebook.com' +
								(/action="(.+?)"+?/.exec(resData.jsmods.markup[0][1].__html) || '')[1].replace(/&amp;/g, '&'),
							this.ctx.jar,
							{}
						)
						.then(utils.saveCookies(this.ctx.jar))
						.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
						.then((_resData: any) => {
							if (_resData.error) {
								throw _resData;
							}
							return callback();
						});
				})
				.catch(function (err) {
					log.error('changeBlockedStatus', err);
					return callback(err);
				});
		} else {
			this._defaultFuncs
				.post(
					'https://www.facebook.com/ajax/nfx/messenger_undo_block.php?story_location=messenger&context=%7B%22reportable_ent_token%22%3A%22' +
						userID +
						'%22%2C%22initial_action_name%22%3A%22BLOCK_MESSAGES%22%7D&',
					this.ctx.jar,
					{}
				)
				.then(utils.saveCookies(this.ctx.jar))
				.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
				.then((resData: any) => {
					if (resData.error) {
						throw resData;
					}
					return callback();
				})
				.catch((err: any) => {
					log.error('changeBlockedStatus', err);
					return callback(err);
				});
		}
	}

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

	async getThreadInfo(threadId: ThreadID): Promise<any> {
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

	async getThreadHistory(threadID: ThreadID, amount: number, timestamp: number | undefined): Promise<Message[]> {
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
