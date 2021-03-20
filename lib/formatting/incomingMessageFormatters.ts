import Api from '../api';
import {
	AnyIncomingMessage,
	DeliveryReceipt,
	IncomingEvent,
	IncomingEventType,
	IncomingMessage,
	IncomingMessageReaction,
	IncomingMessageReply,
	IncomingMessageType,
	IncomingMessageUnsend,
	ReadReceipt
} from '../types/incomingMessages';
import { _formatAttachment } from '../utils';

export function parseDelta(delta: any, api: Api): AnyIncomingMessage[] {
	if (delta.class === 'NewMessage') {
		let formattedMessage: IncomingMessage;
		try {
			formattedMessage = formatDeltaMessage(delta);
		} catch (error) {
			throw new Error(
				`There was an unknown WS error. Contact the dev team about this (error code 935468). Original error: ${error}. Delta: ${delta}`
			);
		}
		if (!formattedMessage) throw new Error('Error code 935468-b');

		if (api.ctx.globalOptions.autoMarkDelivery) {
			// this._markDelivery(fmtMsg.threadID, fmtMsg.messageID);
		}
		if (!api.ctx.globalOptions.selfListen && formattedMessage.senderId == api.ctx.userID) return [];
		return [formattedMessage];
	}
	if (delta.class == 'ClientPayload') {
		let clientPayload;
		try {
			// if the `delta.payload` property is used, it contains an array
			// of 8-bit integers which are later converted to string
			clientPayload = JSON.parse(Buffer.from(delta.payload).toString());
		} catch (error) {
			throw new Error(
				`There was an error parsing WS. Contact the dev team about this (error code 935469). Original error: ${error}. Delta: ${delta}`
			);
		}
		if (!(clientPayload && clientPayload.deltas)) throw new Error('Error code 935469-b');

		const toBeReturned: AnyIncomingMessage[] = [];

		for (const payloadDelta of clientPayload.deltas) {
			if (payloadDelta.deltaMessageReaction && api.ctx.globalOptions.listenEvents) {
				const messageReaction: IncomingMessageReaction = {
					type: IncomingMessageType.MessageReaction,
					threadId: parseInt(
						payloadDelta.deltaMessageReaction.threadKey.threadFbId ||
							payloadDelta.deltaMessageReaction.threadKey.otherUserFbId
					),
					messageId: payloadDelta.deltaMessageReaction.messageId,
					reaction: payloadDelta.deltaMessageReaction.reaction,
					messageSenderId: parseInt(payloadDelta.deltaMessageReaction.senderId),
					reactionSenderId: parseInt(payloadDelta.deltaMessageReaction.userId)
				};
				toBeReturned.push(messageReaction);
			} else if (payloadDelta.deltaRecallMessageData && api.ctx.globalOptions.listenEvents) {
				// "unsend message" by FB is called "recall message"
				const messageUnsend: IncomingMessageUnsend = {
					type: IncomingMessageType.MessageUnsend,
					threadId: parseInt(
						payloadDelta.deltaRecallMessageData.threadKey.threadFbId ||
							payloadDelta.deltaRecallMessageData.threadKey.otherUserFbId
					),
					messageId: payloadDelta.deltaRecallMessageData.messageID,
					messageSenderId: parseInt(payloadDelta.deltaRecallMessageData.senderID),
					deletionTimestamp: parseInt(payloadDelta.deltaRecallMessageData.deletionTimestamp)
				};
				toBeReturned.push(messageUnsend);
			} else if (payloadDelta.deltaMessageReply) {
				let replyMessage: IncomingMessageReply;
				try {
					replyMessage = formatDeltaReplyMessage(
						payloadDelta.deltaMessageReply.repliedToMessage,
						payloadDelta.deltaMessageReply.message
					);
				} catch (error) {
					throw new Error(
						`There was an unknown WS error. Contact the dev team about this (error code 935470). Original error: ${error}. Delta: ${delta}`
					);
				}
				if (!replyMessage) throw new Error('Error code 935470-b');

				if (api.ctx.globalOptions.autoMarkDelivery) {
					// this._markDelivery(fmtMsg.threadID, fmtMsg.messageID);
				}
				toBeReturned.push(replyMessage);
			}
		}
		return toBeReturned;
	}

	if (delta.class !== 'NewMessage' && !api.ctx.globalOptions.listenEvents) return [];

	switch (delta.class) {
		case 'DeliveryReceipt': {
			let formattedDelivery: DeliveryReceipt;
			try {
				formattedDelivery = formatDeltaDeliveryReceipt(delta);
			} catch (error) {
				throw new Error(
					`There was an unknown WS error. Contact the dev team about this (error code 935471). Original error: ${error}. Delta: ${delta}`
				);
			}
			if (!formattedDelivery) throw new Error('Error code 935471-b');
			return [formattedDelivery];
		}
		case 'ReadReceipt': {
			let formattedMessage: ReadReceipt;
			try {
				formattedMessage = formatDeltaReadReceipt(delta);
			} catch (error) {
				throw new Error(
					`There was an unknown WS error. Contact the dev team about this (error code 935472). Original error: ${error}. Delta: ${delta}`
				);
			}
			if (!formattedMessage) throw new Error('Error code 935472-b');
			return [formattedMessage];
		}
		case 'AdminTextMessage':
		case 'ThreadName':
		case 'ParticipantsAddedToGroupThread':
		case 'ParticipantLeftGroupThread': {
			let formattedAdminText: IncomingEvent;
			try {
				formattedAdminText = formatDeltaEvent(delta);
			} catch (error) {
				throw new Error(
					`There was an unknown WS error. Contact the dev team about this (error code 935473). Original error: ${error}. Delta: ${delta}`
				);
			}
			if (!formattedAdminText) throw new Error('Error code 935473-b');
			return [formattedAdminText];
		}
		default:
			break;
	}
	return [];
}

function formatDeltaMessage(delta: any): IncomingMessage {
	const messageMetadata = delta.messageMetadata;

	// mention data
	const mdata: any[] = !delta.data ? [] : !delta.data.prng ? [] : JSON.parse(delta.data.prng);
	const m_id = mdata.map(u => u.i);
	const m_offset = mdata.map(u => u.o);
	const m_length = mdata.map(u => u.l);
	//TODO: This was modified
	const mentions: { id: string }[] = [];
	for (let i = 0; i < m_id.length; i++) {
		mentions[m_id[i]] = delta.body.substring(m_offset[i], m_offset[i] + m_length[i]);
	}

	const formatted: IncomingMessage = {
		type: IncomingMessageType.MessageRegular,
		senderId: parseInt(messageMetadata.actorFbId),
		body: delta.body || '',
		// when one-to-one chat, `otherUserFbId` is used by FB
		// when group chat, `threadFbId` is used by FB
		threadId: parseInt(messageMetadata.threadKey.threadFbId || messageMetadata.threadKey.otherUserFbId),
		messageId: messageMetadata.messageId,
		attachments: ((delta.attachments as unknown[]) || []).map(att => _formatAttachment(att)),
		mentions,
		timestamp: parseInt(messageMetadata.timestamp),
		isGroup: !!messageMetadata.threadKey.threadFbId
	};
	return formatted;
}

function formatDeltaReplyMessage(deltaSourceMessage: any, deltaReplyMessage: any): IncomingMessageReply {
	// since the reply incoming message has very similar structure as regular incoming message,
	// we can format it using `formatDeltaMessage` function & add some additional properties
	const formattedReplyMessage: any = {
		...formatDeltaMessage(deltaReplyMessage), // format using another function
		// and add some additional properties:
		sourceMessage: formatDeltaMessage(deltaSourceMessage)
	};
	formattedReplyMessage.type = IncomingMessageType.MessageReply;
	return formattedReplyMessage as IncomingMessageReply;
}

export function getAdminTextMessageType(type: string): IncomingEventType | undefined {
	switch (type) {
		case 'change_thread_theme':
			return IncomingEventType.ChangeThreadColorTheme;
		case 'change_thread_nickname':
			return IncomingEventType.ChangeNickname;
		case 'change_thread_icon':
			return IncomingEventType.ChangeThreadImage;
		default:
			return undefined;
	}
}

function formatDeltaEvent(delta: any): IncomingEvent {
	let eventType: IncomingEventType | undefined;
	let additionalData = {};

	switch (delta.class) {
		case 'AdminTextMessage':
			additionalData = delta.untypedData;
			eventType = getAdminTextMessageType(delta.type);
			break;
		case 'ThreadName':
			eventType = IncomingEventType.ChangeThreadName;
			additionalData = { name: delta.name };
			break;
		case 'ParticipantsAddedToGroupThread':
			eventType = IncomingEventType.AddedParticipants;
			additionalData = { addedParticipants: delta.addedParticipants };
			break;
		case 'ParticipantLeftGroupThread':
			eventType = IncomingEventType.RemovedParticipant;
			additionalData = { leftParticipantFbId: delta.leftParticipantFbId };
			break;
		default:
			break;
	}

	return {
		type: IncomingMessageType.ThreadEvent,
		threadId: parseInt(delta.messageMetadata.threadKey.threadFbId || delta.messageMetadata.threadKey.otherUserFbId),
		senderId: parseInt(delta.messageMetadata.actorFbId),
		body: delta.messageMetadata.adminText,
		timestamp: parseInt(delta.messageMetadata.timestamp),
		eventType,
		data: additionalData
	};
}

function formatDeltaDeliveryReceipt(delta: any): DeliveryReceipt {
	return {
		type: IncomingMessageType.DeliveryReceipt,
		timestamp: parseInt(delta.deliveredWatermarkTimestampMs),
		threadId: parseInt(delta.threadKey.otherUserFbId || delta.threadKey.threadFbId),
		recipient: parseInt(delta.actorFbId || delta.threadKey.otherUserFbId),
		deliveredMessageIds: delta.messageIds
	};
}

function formatDeltaReadReceipt(delta: any): ReadReceipt {
	return {
		type: IncomingMessageType.ReadReceipt,
		reader: parseInt(delta.actorFbId || delta.threadKey.otherUserFbId),
		timestamp: parseInt(delta.actionTimestampMs),
		threadId: parseInt(delta.threadKey.otherUserFbId || delta.threadKey.threadFbId)
	};
}
