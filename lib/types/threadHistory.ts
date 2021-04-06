import { MessageID } from '../types';
import { IncomingEventType } from './incomingMessages';
import { UserID } from './users';

export enum HistoryMessageType {
	/** regular message sent by a chat participant */
	UserMessage,
	/** an event corresponding to admin activity
	 * (add or remove participants or admins) */
	AdminEvent,
	/** an event corresponding to thread customisation
	 * (changed thread emoji, icon, color theme or name) */
	CustomisationEvent,
	Unknown
}

export interface HistoryMessage {
	/** the type of a HistoryMessage (user message, admin activity, customisation...) */
	type: HistoryMessageType;
	/** unique identifier of a message */
	messageId: MessageID;
	/** message creation timestamp in milliseconds */
	timestamp: number;
	/** ID of a user, who created or caused a message */
	senderId: UserID;
	/** indicator whether the user has seen a message */
	isUnread: boolean;

	/** additional information about a user message (if any) */
	userMessage?: {
		attachments: any; // TODO
		textBody?: string;
		mentions?: Record<UserID, string>;
		/** there is no reply information... sadly... */
		replyInfo?: never;
		reactions?: { reaction: string; userId: UserID }[];
	};
	/** additional information about a customisation event (if any) */
	customisationEvent?: {
		eventType: IncomingEventType;
		newThreadName?: string;
		newThreadEmoji?: string;
		newThreadColor?: string;
		newImageInfo?: { previewUri: string; attachmentId: number; originalDimensions: { x: number; y: number } } | null;
	};
	/** additional information about an admin event (if any) */
	adminEvent?: {
		eventType: IncomingEventType;
		participantsRemoved?: UserID[];
		participantsAdded?: UserID[];
		/** There is no further information... sadly...
		 * However, you can call `Api.getThreadInfo()` to get new admin IDs.*/
		changeAdminStatusInfo?: never;
	};

	/** short text representing event message
	 * @example 'John changed the thread to 😁' */
	snippet?: string;

	/** indicator whether a message is currently sponsored */
	isSponsored: boolean;
	/** Technical property (with mystical meaning - if you have figured out
	 * what it is, don't be afraid to open an discussion on Github)...
	 * OTID stands for Offline Threading ID */
	OTID: number;
}
