/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { ThreadInfo, ThreadParticipant } from '../types/threads';
import { UserID, UserInfo } from '../types/users';

export function formatSingleFriend(originalFriend: any): UserInfo | null {
	const original = originalFriend?.node?.sts_info?.direct_nav_result;
	if (!original) return null;
	// single friend can be also FB event or site:
	if (original.type.toUpperCase() !== 'FRIEND') return null;

	return {
		userId: parseInt(original.ent_id),
		fullName: original.title,
		profilePictureUrlSmall: original.img_url,
		profileUrl: original.link_url
	};
}

export function formatSingleThread(originalThread: any, currentUserId: UserID): ThreadInfo {
	const original = originalThread.node;
	if (!original)
		throw new Error(
			`There was an unknown response. Contact the dev team about this (error code F-22). Data: ${JSON.stringify(
				originalThread
			)}`
		);

	const isGroup = original.thread_type.toLowerCase() === 'group';
	const isOneToOne = original.thread_type.toLowerCase() === 'one_to_one';
	if (!isOneToOne && !isGroup)
		throw new Error(
			`There was an unknown thread type. Contact the dev team about this (error code F-23). Data: ${JSON.stringify(
				originalThread
			)}`
		);

	const common = {
		isGroup,
		lastUpdated: parseInt(original.updated_time),
		participants: formatParticipants(original.all_participants?.edges),
		nicknames: formatParticipantCustomisations(original.customization_info?.participant_customizations)
	};

	if (isGroup)
		return {
			...common,
			threadId: parseInt(original.thread_key?.thread_fbid),
			threadName: original.name,
			imageUrl: original.image?.uri || original.image?.url
		};

	const otherParticipant = common.participants.find(p => p.userId != currentUserId);
	return {
		...common,
		threadId: otherParticipant?.userId as UserID,
		threadName: otherParticipant?.fullName as string,
		imageUrl: otherParticipant?.profilePictureUrlSmall as string
	};
}

function formatParticipantCustomisations(array: any[]) {
	if (!array) return {};
	const nicknames: Record<UserID, string> = {};
	for (const obj of array) nicknames[parseInt(obj.participant_id)] = obj.nickname;
	return nicknames;
}

function formatParticipants(array: any[]): ThreadParticipant[] {
	if (!array) return [];
	return array
		.map(one => one.node.messaging_actor)
		.map(one => ({
			userId: parseInt(one.id),
			fullName: one.name,
			shortName: one.short_name,
			profilePictureUrlSmall: one.profile_picture?.uri || one.profile_picture?.url
		}));
}
