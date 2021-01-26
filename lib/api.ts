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
import stream from 'stream';
import bluebird from 'bluebird';
import { ThreadID } from './types/threads';

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

	markAsDelivered(threadID: ThreadID, messageID: MessageID, callback: (err?: string) => void) {
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

		this.handleSticker(msg, form, callback, () =>
			this.handleAttachment(msg, form, callback, () =>
				this.handleUrl(msg, form, callback, () =>
					this.handleEmoji(msg, form, callback, () =>
						this.handleMention(msg, form, callback, () => this.send(form, threadID, messageAndOTID, callback))
					)
				)
			)
		);
	}

	private handleUrl(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.url) {
			form['shareable_attachment[share_type]'] = '100';
			this.getUrl(msg.url, function (err, params) {
				if (err) {
					return callback(err);
				}

				form['shareable_attachment[share_params]'] = params;
				cb();
			});
		} else {
			cb();
		}
	}

	private handleSticker(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.sticker) {
			form['sticker_id'] = msg.sticker;
		}
		cb();
	}

	private handleEmoji(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.emojiSize != null && msg.emoji == null) {
			return callback({ error: 'emoji property is empty' });
		}
		if (msg.emoji) {
			if (msg.emojiSize == null) {
				msg.emojiSize = 'medium';
			}
			if (msg.emojiSize != 'small' && msg.emojiSize != 'medium' && msg.emojiSize != 'large') {
				return callback({ error: 'emojiSize property is invalid' });
			}
			if (form['body'] != null && form['body'] != '') {
				return callback({ error: 'body is not empty' });
			}
			form['body'] = msg.emoji;
			form['tags[0]'] = 'hot_emoji_size:' + msg.emojiSize;
		}
		cb();
	}

	private handleAttachment(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.attachment) {
			form['image_ids'] = [];
			form['gif_ids'] = [];
			form['file_ids'] = [];
			form['video_ids'] = [];
			form['audio_ids'] = [];

			if (utils.getType(msg.attachment) !== 'Array') {
				msg.attachment = [msg.attachment as stream.Readable];
			}

			this.uploadAttachment(msg.attachment as stream.Readable[], function (err, files) {
				if (err) {
					return callback(err);
				}

				if (files)
					files.forEach(file => {
						const key = Object.keys(file);
						const type = key[0]; // image_id, file_id, etc
						form['' + type + 's'].push(file[type]); // push the id
					});
				cb();
			});
		} else {
			cb();
		}
	}

	private handleMention(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.mentions && msg.body) {
			for (let i = 0; i < msg.mentions.length; i++) {
				const mention = msg.mentions[i];

				const tag = mention.tag;
				if (typeof tag !== 'string') {
					return callback({ error: 'Mention tags must be strings.' });
				}

				const offset = msg.body.indexOf(tag, mention.fromIndex || 0);

				if (offset < 0) {
					log.warn('handleMention', 'Mention for "' + tag + '" not found in message string.');
				}

				if (mention.id == null) {
					log.warn('handleMention', 'Mention id should be non-null.');
				}

				const id = mention.id || 0;
				form['profile_xmd[' + i + '][offset]'] = offset;
				form['profile_xmd[' + i + '][length]'] = tag.length;
				form['profile_xmd[' + i + '][id]'] = id;
				form['profile_xmd[' + i + '][type]'] = 'p';
			}
		}
		cb();
	}

	uploadAttachment(attachments: stream.Readable[], callback: (err?: { error: string }, files?: any[]) => void): void {
		const uploads = [];

		// create an array of promises
		for (let i = 0; i < attachments.length; i++) {
			if (!utils.isReadableStream(attachments[i])) {
				throw {
					error: 'Attachment should be a readable stream and not ' + utils.getType(attachments[i]) + '.'
				};
			}

			const form = {
				upload_1024: attachments[i],
				voice_clip: 'true'
			};

			uploads.push(
				this._defaultFuncs
					.postFormData('https://upload.facebook.com/ajax/mercury/upload.php', this.ctx.jar, form, {})
					.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
					.then(function (resData) {
						if (resData.error) {
							throw resData;
						}

						// We have to return the data unformatted unless we want to change it
						// back in sendMessage.
						return resData.payload.metadata[0];
					})
			);
		}

		// resolve all promises
		bluebird
			.all(uploads)
			.then(function (resData) {
				callback(undefined, resData);
			})
			.catch(err => {
				log.error('uploadAttachment', err);
				return callback(err);
			});
	}

	private getUrl(url: string, callback: (err?: { error: string }, params?: any) => void): void {
		const form = {
			image_height: 960,
			image_width: 960,
			uri: url
		};

		this._defaultFuncs
			.post('https://www.facebook.com/message_share_attachment/fromURI/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(resData => {
				if (resData.error) {
					return callback(resData);
				}

				if (!resData.payload) {
					return callback({ error: 'Invalid url' });
				}

				callback(undefined, resData.payload.share_data.share_params);
			})
			.catch(function (err) {
				log.error('getUrl', err);
				return callback(err);
			});
	}

	private send(form: RequestForm, threadID: ThreadID | ThreadID[], messageAndOTID: string, callback) {
		// We're doing a query to this to check if the given id is the id of
		// a user or of a group chat. The form will be different depending
		// on that.
		if (utils.getType(threadID) === 'Array') {
			sendContent(form, threadID, false, messageAndOTID, callback);
		} else {
			this.getUserInfo(threadID, function (err, res) {
				if (err) {
					return callback(err);
				}
				if (res) {
					sendContent(form, threadID, Object.keys(res).length > 0, messageAndOTID, callback);
				} else {
					throw new Error('Fatal');
				}
			});
		}
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
}
