import { AnyAttachment, MessageID } from '../types';
import { ThreadID } from './threads';
import { UserID } from './users';

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

/** Union type of all possible types coming from `api.listener` `EventEmitter` on event `message`. */
export type AnyIncomingMessage =
	| IncomingMessage
	| IncomingMessageReply
	| IncomingMessageUnsend
	| IncomingMessageReaction
	| IncomingEvent
	| DeliveryReceipt
	| ReadReceipt;

export interface IncomingMessage extends IncomingMessageBase {
	type: IncomingMessageType.MessageRegular;
	attachments: AnyAttachment[];
	/** The string corresponding to the message that was just received */
	body: string;
	/** Whether is a group thread */
	isGroup: boolean;
	/** An object containing people mentioned/tagged in the message */
	mentions: { name: string; id: UserID }[];
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
	data: IncomingEventData;
}

export enum IncomingEventType {
	ChangeThreadImage,
	ChangeThreadName,
	ChangeThreadEmoji,
	ChangeAdminStatus,
	ChangeThreadColorTheme,
	ChangeNickname,
	RemovedParticipant,
	AddedParticipants
}

/** Compound type of incoming event data.
 * Includes many event types & only one property is defined at the same time. */
export interface IncomingEventData {
	newThreadName?: string;
	newThreadEmoji?: {
		thread_icon_url: string;
		thread_icon: string;
	};
	newThreadColorTheme?: {
		should_show_icon: boolean;
		theme_color: string;
		accessibility_label: string;
		theme_name_with_subtitle: string;
		gradient?: string[];
	};
	addedParticipants?: { firstName: string; fullName: string; userId: UserID }[];
	leftParticipantFbId?: UserID;
	changeAdminInfo?: {
		targetId: UserID;
		isAdminFromNow: boolean;
	};
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
