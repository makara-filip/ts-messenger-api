import { AnyAttachment, MessageID } from "../types";
import { ThreadID } from "./threads";
import { UserID } from "./users";

export interface IncomingMessageBase {
	type: IncomingMessageType;
	threadId: ThreadID;
}
export enum IncomingMessageType {
	MessageRegular,
	MessageReply,
	MessageUnsend,
	MessageReaction,
	ThreadEvent,
	TypingIndicator,
	DeliveryReceipt,
	ReadReceipt,
	UserPresence
}

export type AnyIncomingMessage = unknown; // TODO: put here the union type of all following types

export interface IncomingMessage extends IncomingMessageBase {
	type: IncomingMessageType.MessageRegular;
	attachments: AnyAttachment[];
	/** The string corresponding to the message that was just received */
	body: string;
	/** Whether is a group thread */
	isGroup: boolean;
	/** An object containing people mentioned/tagged in the message */
	mentions: { id: string }[];
	messageId: MessageID;
	senderId: UserID;
	timestamp: number;
}

export interface IncomingMessageReply extends IncomingMessage {
	sourceMessage: IncomingMessage;
}

export interface IncomingMessageUnsend extends IncomingMessageBase {
	type: IncomingMessageType.MessageUnsend;
	messageSenderId: UserID;
	messageId: MessageID;
	deletionTimestamp: number;
}

export interface IncomingMessageReaction extends IncomingMessageBase {
	type: IncomingMessageType.MessageReaction;
	messageId: MessageID;
	reaction: string;
	messageSenderId: UserID;
	reactionSenderId: UserID;
	// timestamp: number; // not available
}

export interface IncomingEvent extends IncomingMessageBase {
	type: IncomingMessageType.ThreadEvent;
	senderId: UserID;
	body: string;
	timestamp: number;
	eventType?: IncomingEventType;
	data: unknown; // TODO: specify the type
}

export enum IncomingEventType {
	ChangeThreadImage,
	ChangeThreadName,
	ChangeThreadEmoji,
	ChangeThreadColorTheme,
	ChangeNickname,
	RemovedParticipant,
	AddedParticipants
}

export interface Typ extends IncomingMessageBase {
	type: IncomingMessageType.TypingIndicator;
	senderId: UserID;
	isTyping: boolean;
}

export interface DeliveryReceipt extends IncomingMessageBase {
	type: IncomingMessageType.DeliveryReceipt;
	timestamp: number;
	recipient: UserID;
	deliveredMessageIds: MessageID[];
}

export interface ReadReceipt extends IncomingMessageBase {
	type: IncomingMessageType.ReadReceipt;
	timestamp: number;
	reader: UserID;
}

export interface Presence {
	type: IncomingMessageType.UserPresence;
	status: UserOnlineStatus;
	timestamp: number;
	userID: UserID;
}
export enum UserOnlineStatus {
	/** away for 2 minutes */
	IDLE = 0,
	ONLINE = 2
}
