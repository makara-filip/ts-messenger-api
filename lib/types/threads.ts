import { UserID } from './users';

export type ThreadID = string | number;

export interface ThreadInfo {
	threadID: ThreadID;
	participantIDs: Array<UserID>;

	/** Name of the thread - usually the name of the user. In group chats, this will be empty if the name of the group chat is unset. */
	name: string;
	nicknames: Array<ThreadNickname> | null;
	unreadCount: number;
	messageCount: number;
	/** Url to the group chat photo. `Null` if unset or one-to-one chat. */
	imageSrc: string;

	timestamp: number;
	muteUntil: number;
	isGroup: boolean;
	isSubscribed: boolean;
	folder: 'INBOX' | 'inbox' | 'ARCHIVE' | 'archive';
	isArchived: boolean;
	/** If the user cannot reply to this thread, this is the reason why. Otherwise, `null`. */
	cannotReplyReason: null | 'RECIPIENTS_NOT_LOADABLE' | 'BLOCKED' | 'recipients_not_loadable' | 'blocked' | string;
	canReply: boolean;
	lastReadTimestamp: number;

	emoji: ThreadEmoji;
	/** String form of the custom color in hexadecimal form. */
	color: ThreadColor;
	/** Array of user IDs of the admins of this thread. Empty array if unset. */
	adminIDs: Array<UserID>;

	mentionsMuteMode: 'mentions_not_muted' | 'mentions_muted';
	reactionsMuteMode: 'reactions_not_muted' | 'reactions_muted';

	// there are other properties, but they rarely appear and are not really important
}

export type ThreadColor = string | null;
export type ThreadEmoji = {
	emoji: string;
} | null;
export type ThreadNickname = {
	userid: UserID;
	nickname: string;
};

/** The thread history consisting of last messages.
 * Get an instance from `API.getThreadHistory()` method. */
export type ThreadHistory = any[];
