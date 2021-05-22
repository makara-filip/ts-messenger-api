import { UserID } from './users';

export type ThreadID = string | number;

export interface ThreadInfo_IS_NOT_BEING_USED_BUT_IS_THERE_FOR_FUTURE {
	/** the thread identifier */
	threadId: ThreadID;
	/** name of a group chat (`null` if one-to-one chat) */
	threadName: string | null;
	/** list of all user IDs in a thread */
	participantIds: UserID[];

	/** represents the administration information for groups (`null` if one-to-one chat) */
	groupAdministration: {
		/** whether admins in a group approve new memberships */
		approvalMode: boolean;
		/** list of all admin user IDs */
		adminIds: UserID[];
	} | null;

	/** number of unread messages since last view */
	unreadCount: number;
	/** total number of messages in a thread */
	messageCount: number;

	/** timestamp (in milliseconds) of last update in a thread */
	lastUpdateTimestamp: number;
	lastMessage: {
		/** simple text of what last message was
		 * @example 'Where were you yesterday?' */
		snippetText: string;
		/** ID of last message sender */
		senderId: UserID;
		/** timestamp (in milliseconds) when was last message sent */
		timestamp: number;
	};
	/** timestamp (in milliseconds) when the user last read a thread */
	lastReadTimestamp: number;

	/** self-explaining... :-) */
	isGroup: boolean;
	/** whether a thread is marked as archived */
	isArchived: boolean;
	/** whether the user is subscribing a thread (actually don't know what this is) */
	isSubscribed: boolean;
	/** folder in which a thread is located (eg. 'INBOX') */
	folder: string;

	/** represents the thread customisation information like emoji, color & icon */
	customisation: {
		enabledCustomisation: boolean;
		emoji: string;
		outgoingBubbleColor: string;
		imageUri: string;
	};

	eventReminders: any[];
	/** if the user can't reply to a thread, this property tells the reason (otherwise, `null`) */
	cannotReplyReason: string;

	// Disabled by Facebook, may not work in the future
	// nicknames: any[];

	// TODO: implement type & logic for whether there is a voice/video call in a thread

	/** timestamp (in milliseconds) until which the user wishes a thread to be muted (if not muted, `null`) */
	muteUntil: number | null;
	/** whether the reactions for a thread are muted */
	reactionsMuteMode: string;
	/** whether the mentions for a thread are muted */
	mentionsMuteMode: string;
}

export type ThreadColor = string | null;
export type ThreadEmoji = {
	emoji: string;
} | null;

export interface ThreadInfo {
	/** the thread identifier */
	threadId: ThreadID;
	/** name of a group chat (or other person's name if one-to-one chat) */
	threadName: string;

	/** self-explaining... :-) */
	isGroup: boolean;
	/** timestamp (in seconds) of last update in a thread (last message sent) */
	lastUpdated: number;
	/** list of thread's participants and their further information */
	participants: ThreadParticipant[];
	/** dictionary of user's nicknames by their IDs*/
	nicknames: Record<UserID, string>;
	/** url to the thread image */
	imageUrl: string;
}

export interface ThreadParticipant {
	userId: UserID;
	fullName: string;
	shortName: string;
	/** url of a person's profile picture in 40x40 px resolution */
	profilePictureUrlSmall: string;
}

/** The thread history consisting of last messages.
 * Get an instance from `API.getThreadHistory()` method. */
export type ThreadHistory = any[];
