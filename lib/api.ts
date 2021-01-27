/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable no-case-declarations */
import log from 'npmlog';
import {
	ApiCtx,
	Dfs,
	ListenCallback,
	MessageID,
	MessageReply,
	MqttQueue,
	OutgoingMessage,
	Presence,
	RequestForm,
	Typ
} from './types';
import { UserID, UserInfoGeneralDictByUserId } from './types/users';
import * as utils from './utils';
import mqtt from 'mqtt';
import websocket from 'websocket-stream';
import { ThreadColor, ThreadID } from './types/threads';
import { OutgoingMessageHandler } from './entities/outgoing-message-handler';

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

	unsendMessage(messageID: MessageID, callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}

		const form = {
			message_id: messageID
		};

		this._defaultFuncs
			.post('https://www.facebook.com/messaging/unsend_message/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('unsendMessage', err);
				return callback(err);
			});
	}

	/**
	 * @param callback Function that's called on every received message
	 * @returns Function that when called, stops listening
	 */
	listen(callback: ListenCallback): () => void {
		let globalCallback = callback;

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

		this._defaultFuncs
			.post('https://www.facebook.com/api/graphqlbatch/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(resData => {
				if (resData && resData.length > 0 && resData[resData.length - 1].error_results > 0) {
					throw resData[0].o0.errors;
				}

				if (resData[resData.length - 1].successful_results === 0) {
					throw { error: 'getSeqId: there was no successful_results', res: resData };
				}

				if (resData[0].o0.data.viewer.message_threads.sync_sequence_id) {
					this.ctx.lastSeqId = resData[0].o0.data.viewer.message_threads.sync_sequence_id;
					this._listenMqtt(globalCallback);
				}
			})
			.catch(err => {
				log.error('getSeqId', err);
				return callback(err);
			});

		return () => {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			globalCallback = function () {};

			if (this.ctx.mqttClient) {
				this.ctx.mqttClient.end();
				this.ctx.mqttClient = undefined;
			}
		};
	}

	private _listenMqtt(globalCallback: ListenCallback) {
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

		mqttClient.on('error', function (err) {
			//TODO: This was modified
			log.error('err', err.message);
			mqttClient.end();
			globalCallback('Connection refused: Server unavailable');
		});

		mqttClient.on('connect', () => {
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
		});
		mqttClient.on('message', (topic, message) => {
			//TODO: This was modified
			const jsonMessage = JSON.parse(message.toString());
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
					this._parseDelta(globalCallback, { delta: delta });
				}
			} else if (topic === '/thread_typing' || topic === '/orca_typing_notifications') {
				const typ: Typ = {
					type: 'typ',
					isTyping: !!jsonMessage.state,
					from: jsonMessage.sender_fbid.toString(),
					threadID: utils.formatID((jsonMessage.thread || jsonMessage.sender_fbid).toString())
				};
				(function () {
					globalCallback(undefined, typ);
				})();
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
						(function () {
							globalCallback(undefined, presence);
						})();
					}
				}
			}
		});

		mqttClient.on('close', function () {
			// client.end();
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
		if (threadID && messageID) {
			this.markAsDelivered(threadID, messageID, err => {
				if (err) {
					log.error('FIX THIS', err);
				} else {
					if (this.ctx.globalOptions.autoMarkRead) {
						this.markAsRead(threadID, undefined, err => {
							if (err) {
								log.error('FIX THIS', err);
							}
						});
					}
				}
			});
		}
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

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	markAsRead(threadID: ThreadID, read = true, callback = (err?: any) => {}): void {
		const form: { [index: string]: string | boolean | number } = {};

		if (typeof this.ctx.globalOptions.pageID !== 'undefined') {
			form['source'] = 'PagesManagerMessagesInterface';
			form['request_user_id'] = this.ctx.globalOptions.pageID;
		}

		form['ids[' + threadID + ']'] = read;
		form['watermarkTimestamp'] = new Date().getTime();
		form['shouldSendReadReceipt'] = true;
		form['commerce_last_message_type'] = 'non_ad';
		form['titanOriginatedThreadId'] = utils.generateThreadingID(this.ctx.clientID);

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/change_read_status.php', this.ctx.jar, form)
			.then(utils.saveCookies(this.ctx.jar))
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData: any) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('markAsRead', err);
				return callback(err);
			});
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
	 * @param replyToMessage ID of a message this message replies to
	 */
	sendMessage(
		msg: OutgoingMessage,
		threadID: ThreadID | ThreadID[],
		callback = (err?: { error: string }) => {},
		replyToMessage?: MessageID
	): void {
		const msgType = utils.getType(msg);
		const threadIDType = utils.getType(threadID);
		const messageIDType = utils.getType(replyToMessage);

		if (msgType !== 'String' && msgType !== 'Object') {
			return callback({
				error: 'Message should be of type string or object and not ' + msgType + '.'
			});
		}

		// Changing this to accomodate an array of users
		if (threadIDType !== 'Array' && threadIDType !== 'Number' && threadIDType !== 'String') {
			return callback({
				error: 'ThreadID should be of type number, string, or array and not ' + threadIDType + '.'
			});
		}

		if (replyToMessage && messageIDType !== 'String') {
			return callback({
				error: 'MessageID should be of type string and not ' + threadIDType + '.'
			});
		}

		const disallowedProperties = Object.keys(msg).filter(prop => !this.allowedProperties[prop]);
		if (disallowedProperties.length > 0) {
			return callback({
				error: 'Dissallowed props: `' + disallowedProperties.join(', ') + '`'
			});
		}

		const messageAndOTID = utils.generateOfflineThreadingID();

		const form: RequestForm = {
			client: 'mercury',
			action_type: 'ma-type:user-generated-message',
			author: 'fbid:' + this.ctx.userID,
			timestamp: Date.now(),
			timestamp_absolute: 'Today',
			timestamp_relative: utils.generateTimestampRelative(),
			timestamp_time_passed: '0',
			is_unread: false,
			is_cleared: false,
			is_forward: false,
			is_filtered_content: false,
			is_filtered_content_bh: false,
			is_filtered_content_account: false,
			is_filtered_content_quasar: false,
			is_filtered_content_invalid_app: false,
			is_spoof_warning: false,
			source: 'source:chat:web',
			'source_tags[0]': 'source:chat',
			body: msg.body ? msg.body.toString() : '',
			html_body: false,
			ui_push_phase: 'V3',
			status: '0',
			offline_threading_id: messageAndOTID,
			message_id: messageAndOTID,
			threading_id: utils.generateThreadingID(this.ctx.clientID),
			'ephemeral_ttl_mode:': '0',
			manual_retry_cnt: '0',
			has_attachment: !!(msg.attachment || msg.url || msg.sticker),
			signatureID: utils.getSignatureID(),
			replied_to_message_id: replyToMessage
		};

		new OutgoingMessageHandler(this.ctx, this._defaultFuncs).handleAll(msg, form, callback, () =>
			this.send(form, threadID, messageAndOTID, callback)
		);
	}

	private send(form: RequestForm, threadID: ThreadID | ThreadID[], messageAndOTID: string, callback) {
		// We're doing a query to this to check if the given id is the id of
		// a user or of a group chat. The form will be different depending
		// on that.
		if (utils.getType(threadID) === 'Array') {
			this.sendContent(form, threadID, false, messageAndOTID, callback);
		} else {
			this.getUserInfo(threadID, (err, res) => {
				if (err) {
					return callback(err);
				}
				if (res) {
					this.sendContent(form, threadID, Object.keys(res).length > 0, messageAndOTID, callback);
				} else {
					throw new Error('Fatal');
				}
			});
		}
	}
	private sendContent(
		form: RequestForm,
		threadID: ThreadID | ThreadID[],
		isSingleUser: boolean,
		messageAndOTID: string,
		callback
	) {
		// There are three cases here:
		// 1. threadID is of type array, where we're starting a new group chat with users
		//    specified in the array.
		// 2. User is sending a message to a specific user.
		// 3. No additional form params and the message goes to an existing group chat.
		if (threadID instanceof Array) {
			for (let i = 0; i < threadID.length; i++) {
				form['specific_to_list[' + i + ']'] = 'fbid:' + threadID[i];
			}
			form['specific_to_list[' + threadID.length + ']'] = 'fbid:' + this.ctx.userID;
			form['client_thread_id'] = 'root:' + messageAndOTID;
			log.info('sendMessage', 'Sending message to multiple users: ' + threadID);
		} else {
			// This means that threadID is the id of a user, and the chat
			// is a single person chat
			if (isSingleUser) {
				form['specific_to_list[0]'] = 'fbid:' + threadID;
				form['specific_to_list[1]'] = 'fbid:' + this.ctx.userID;
				form['other_user_fbid'] = threadID;
			} else {
				form['thread_fbid'] = threadID;
			}
		}

		if (this.ctx.globalOptions.pageID) {
			form['author'] = 'fbid:' + this.ctx.globalOptions.pageID;
			form['specific_to_list[1]'] = 'fbid:' + this.ctx.globalOptions.pageID;
			form['creator_info[creatorID]'] = this.ctx.userID;
			form['creator_info[creatorType]'] = 'direct_admin';
			form['creator_info[labelType]'] = 'sent_message';
			form['creator_info[pageID]'] = this.ctx.globalOptions.pageID;
			form['request_user_id'] = this.ctx.globalOptions.pageID;
			form['creator_info[profileURI]'] = 'https://www.facebook.com/profile.php?id=' + this.ctx.userID;
		}

		this._defaultFuncs
			.post('https://www.facebook.com/messaging/send/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (!resData) {
					return callback({ error: 'Send message failed.' });
				}

				if (resData.error) {
					if (resData.error === 1545012) {
						log.warn(
							'sendMessage',
							"Got error 1545012. This might mean that you're not part of the conversation " + threadID
						);
					}
					return callback(resData);
				}

				const messageInfo = resData.payload.actions.reduce((p: any, v: any) => {
					return (
						{
							threadID: v.thread_fbid,
							messageID: v.message_id,
							timestamp: v.timestamp
						} || p
					);
				}, null);

				return callback(null, messageInfo);
			})
			.catch(function (err) {
				log.error('sendMessage', err);
				return callback(err);
			});
	}

	getUserInfo(id: UserID | UserID[], callback: (err: any, info?: UserInfoGeneralDictByUserId) => void): void {
		if (!callback) {
			throw { error: 'getUserInfo: need callback' };
		}
		if (!(id instanceof Array)) id = [id];

		const form: { [index: string]: UserID } = {};
		id.map((v, i) => {
			form['ids[' + i + ']'] = v;
		});
		this._defaultFuncs
			.post('https://www.facebook.com/chat/user_info/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}
				return callback(null, formatData(resData.payload.profiles));
			})
			.catch(function (err) {
				log.error('getUserInfo', err);
				return callback(err);
			});
	}
	private formatData(data: any) {
		const retObj: { [index: string]: any } = {};

		for (const prop in data) {
			if (data.hasOwnProperty(prop)) {
				const innerObj = data[prop];
				retObj[prop] = {
					name: innerObj.name,
					firstName: innerObj.firstName,
					vanity: innerObj.vanity,
					thumbSrc: innerObj.thumbSrc,
					profileUrl: innerObj.uri,
					gender: innerObj.gender,
					type: innerObj.type,
					isFriend: innerObj.is_friend,
					isBirthday: !!innerObj.is_birthday
				};
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

	addUserToGroup(userID: UserID | UserID[], threadID: ThreadID, callback: (err?: any) => void): void {
		if (!callback) {
			callback = function () {};
		}

		if (!(userID instanceof Array)) {
			userID = [userID];
		}

		const messageAndOTID = utils.generateOfflineThreadingID();
		const form: RequestForm = {
			client: 'mercury',
			action_type: 'ma-type:log-message',
			author: 'fbid:' + this.ctx.userID,
			thread_id: '',
			timestamp: Date.now(),
			timestamp_absolute: 'Today',
			timestamp_relative: utils.generateTimestampRelative(),
			timestamp_time_passed: '0',
			is_unread: false,
			is_cleared: false,
			is_forward: false,
			is_filtered_content: false,
			is_filtered_content_bh: false,
			is_filtered_content_account: false,
			is_spoof_warning: false,
			source: 'source:chat:web',
			'source_tags[0]': 'source:chat',
			log_message_type: 'log:subscribe',
			status: '0',
			offline_threading_id: messageAndOTID,
			message_id: messageAndOTID,
			threading_id: utils.generateThreadingID(this.ctx.clientID),
			manual_retry_cnt: '0',
			thread_fbid: threadID
		};

		for (let i = 0; i < userID.length; i++) {
			if (utils.getType(userID[i]) !== 'Number' && utils.getType(userID[i]) !== 'String') {
				throw {
					error: 'Elements of userID should be of type Number or String and not ' + utils.getType(userID[i]) + '.'
				};
			}

			form['log_message_data[added_participants][' + i + ']'] = 'fbid:' + userID[i];
		}

		this._defaultFuncs
			.post('https://www.facebook.com/messaging/send/', ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (!resData) {
					throw { error: 'Add to group failed.' };
				}
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch((err: any) => {
				log.error('addUserToGroup', err);
				return callback(err);
			});
	}
	
	changeAdminStatus(
		threadID: ThreadID,
		adminIDs: Array<UserID>,
		adminStatus: boolean,
		callback: (err?: any) => void
	): void {
		if (utils.getType(adminIDs) !== 'Array') {
			throw { error: 'changeAdminStatus: adminIDs must be an array or string' };
		}

		if (utils.getType(adminStatus) !== 'Boolean') {
			throw { error: 'changeAdminStatus: adminStatus must be a string' };
		}

		if (!callback) {
			callback = () => {};
		}

		if (utils.getType(callback) !== 'Function' && utils.getType(callback) !== 'AsyncFunction') {
			throw { error: 'changeAdminStatus: callback is not a function' };
		}

		const form: any = {
			thread_fbid: threadID
		};

		let i = 0;
		for (const u of adminIDs) {
			form[`admin_ids[${i++}]`] = u;
		}
		form['add'] = adminStatus;

		this._defaultFuncs
			.post('https://www.facebook.com/messaging/save_admins/?dpr=1', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error) {
					switch (resData.error) {
						case 1976004:
							throw { error: 'Cannot alter admin status: you are not an admin.', rawResponse: resData };
						case 1357031:
							throw { error: 'Cannot alter admin status: this thread is not a group chat.', rawResponse: resData };
						default:
							throw { error: 'Cannot alter admin status: unknown error.', rawResponse: resData };
					}
				}
				callback();
			})
			.catch(err => {
				log.error('changeAdminStatus', err);
				return callback(err);
			});
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

	changeThreadEmoji(emoji: string, threadID: ThreadID, callback: (err?: any) => void): void {
		const form = {
			emoji_choice: emoji,
			thread_or_other_fbid: threadID
		};

		this._defaultFuncs
			.post(
				'https://www.facebook.com/messaging/save_thread_emoji/?source=thread_settings&__pc=EXP1%3Amessengerdotcom_pkg',
				this.ctx.jar,
				form
			)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error === 1357031) {
					throw {
						error:
							"Trying to change emoji of a chat that doesn't exist. Have at least one message in the thread before trying to change the emoji."
					};
				}
				if (resData.error) {
					throw resData;
				}
				return callback();
			})
			.catch((err: any) => {
				log.error('changeThreadEmoji', err);
				return callback(err);
			});
	}
}
