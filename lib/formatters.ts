/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { IncomingEventType } from './types/incomingMessages';
import { HistoryMessage, HistoryMessageType } from './types/threadHistory';
import { ThreadInfo } from './types/threads';
import { UserID } from './types/users';

export function formatMessagesGraphQLResponse(data: any): HistoryMessage[] {
	const messageThread = data.o0.data.message_thread;
	if (!messageThread)
		throw new Error(
			`There was an unknown response. Contact the dev team about this (error code 935531). Data: ${JSON.stringify(
				data
			)}`
		);

	return messageThread.messages.nodes.map((d: any) => {
		// base object - additional data will be added
		const semiformattedMessage: HistoryMessage = {
			type: HistoryMessageType.Unknown,
			messageId: d.message_id,
			timestamp: parseInt(d.timestamp_precise),
			senderId: parseInt(d.message_sender?.id),
			isUnread: d.unread,
			OTID: parseInt(d.offline_threading_id),
			isSponsored: d.is_sponsored,
			snippet: d.snippet
		};

		switch (d.__typename) {
			case 'UserMessage': {
				// Give priority to stickers. They're seen as normal messages but we consider them as attachments
				let maybeStickerAttachment;
				if (d.sticker && d.sticker.pack) {
					maybeStickerAttachment = [
						{
							type: 'sticker',
							ID: d.sticker.id,
							url: d.sticker.url,

							packID: d.sticker.pack ? d.sticker.pack.id : null,
							spriteUrl: d.sticker.sprite_image,
							spriteUrl2x: d.sticker.sprite_image_2x,
							width: d.sticker.width,
							height: d.sticker.height,

							caption: d.snippet, // Not sure what the heck caption was.
							description: d.sticker.label, // Not sure about this one either.

							frameCount: d.sticker.frame_count,
							frameRate: d.sticker.frame_rate,
							framesPerRow: d.sticker.frames_per_row,
							framesPerCol: d.sticker.frames_per_col,

							stickerID: d.sticker.id, // @Legacy
							spriteURI: d.sticker.sprite_image, // @Legacy
							spriteURI2x: d.sticker.sprite_image_2x // @Legacy
						}
					];
				}

				semiformattedMessage.type = HistoryMessageType.UserMessage;
				semiformattedMessage.userMessage = {
					attachments:
						maybeStickerAttachment ??
						(d.blob_attachments && d.blob_attachments.length > 0
							? d.blob_attachments.map(formatAttachmentsGraphQLResponse)
							: undefined) ??
						(d.extensible_attachment ? [formatExtensibleAttachment(d.extensible_attachment)] : undefined) ??
						[],
					textBody: d.message?.text || undefined,
					mentions: formatMentionsGraphQL(d.message?.text, d.message?.ranges),
					// WHY ON EARTH FACEBOOK DOESN'T SEND REPLY INFORMATION????????
					// TODO: add "replies not available" article in docs
					reactions: d.message_reactions?.map(formatReactionsGraphQL)
				};
				break;
			}
			case 'ThreadNameMessage':
				semiformattedMessage.type = HistoryMessageType.CustomisationEvent;
				semiformattedMessage.customisationEvent = {
					eventType: IncomingEventType.ChangeThreadName,
					newThreadName: d.thread_name
				};
				break;
			case 'ThreadImageMessage':
				semiformattedMessage.type = HistoryMessageType.CustomisationEvent;
				semiformattedMessage.customisationEvent = {
					eventType: IncomingEventType.ChangeThreadImage,
					newImageInfo: d.image_with_metadata
						? {
								previewUri: d.image_with_metadata.preview?.uri,
								attachmentId: parseInt(d.image_with_metadata.legacy_attachment_id),
								originalDimensions: d.image_with_metadata.original_dimensions
						  }
						: null // if the old photo was removed
				};
				break;
			case 'ParticipantLeftMessage':
				semiformattedMessage.type = HistoryMessageType.AdminEvent;
				semiformattedMessage.adminEvent = {
					eventType: IncomingEventType.RemovedParticipant,
					participantsRemoved: d.participants_removed?.map((pr: any) => parseInt(pr.id))
				};
				break;
			case 'ParticipantsAddedMessage':
				semiformattedMessage.type = HistoryMessageType.AdminEvent;
				semiformattedMessage.adminEvent = {
					eventType: IncomingEventType.AddedParticipants,
					participantsAdded: d.participants_added?.map((pr: any) => parseInt(pr.id))
				};
				break;
			// THIS STRUCTURE HASN'T BEEN UPDATED AS THE CODE ABOVE YET
			// case 'VideoCallMessage':
			// 	return {
			// 		type: 'event',
			// 		messageID: d.message_id,
			// 		threadID: threadId,
			// 		isGroup: messageThread.thread_type === 'GROUP',
			// 		senderID: d.message_sender.id,
			// 		timestamp: d.timestamp_precise,
			// 		eventType: 'video_call',
			// 		snippet: d.snippet,

			// 		// @Legacy
			// 		logMessageType: 'other'
			// 	};
			// case 'VoiceCallMessage':
			// 	return {
			// 		type: 'event',
			// 		messageID: d.message_id,
			// 		threadID: threadId,
			// 		isGroup: messageThread.thread_type === 'GROUP',
			// 		senderID: d.message_sender.id,
			// 		timestamp: d.timestamp_precise,
			// 		eventType: 'voice_call',
			// 		snippet: d.snippet,

			// 		// @Legacy
			// 		logMessageType: 'other'
			// 	};
			case 'GenericAdminTextMessage':
				// GenericAdminTextMessage includes multiple events
				switch (d.extensible_message_admin_text_type) {
					case 'CHANGE_THREAD_THEME':
						semiformattedMessage.type = HistoryMessageType.CustomisationEvent;
						semiformattedMessage.customisationEvent = {
							eventType: IncomingEventType.ChangeThreadColorTheme,
							newThreadColor: d.extensible_message_admin_text?.theme_color
						};
						break;
					case 'CHANGE_THREAD_ICON':
						semiformattedMessage.type = HistoryMessageType.CustomisationEvent;
						semiformattedMessage.customisationEvent = {
							eventType: IncomingEventType.ChangeThreadEmoji,
							newThreadEmoji: d.extensible_message_admin_text?.thread_icon
						};
						break;
					case 'CHANGE_THREAD_ADMINS':
						semiformattedMessage.type = HistoryMessageType.AdminEvent;
						semiformattedMessage.adminEvent = {
							eventType: IncomingEventType.ChangeAdminStatus
							// WHY ON EARTH FACEBOOK DOESN'T SEND NEW ADMIN INFORMATION????????
							// TODO: add "further details about new admins not available" article in docs
						};
						break;
					default:
						break; // TODO: create an unknown data collector
				}
				break;
			default:
				// TODO: create an unknown data collector
				break;
		}
		return semiformattedMessage;
	});
}

function formatReactionsGraphQL(reaction: any) {
	return {
		reaction: reaction.reaction,
		userId: parseInt(reaction.user.id)
	};
}
function formatMentionsGraphQL(messageText: string, mentionRawData: Array<any>) {
	const mentions: Record<UserID, string> = {};
	mentionRawData?.forEach(e => (mentions[e.entity.id] = messageText.substr(e.offset, e.length)));
	return mentions;
}

function formatAttachmentsGraphQLResponse(attachment: any) {
	switch (attachment.__typename) {
		case 'MessageImage':
			return {
				type: 'photo',
				ID: attachment.legacy_attachment_id,
				filename: attachment.filename,
				thumbnailUrl: attachment.thumbnail.uri,

				previewUrl: attachment.preview.uri,
				previewWidth: attachment.preview.width,
				previewHeight: attachment.preview.height,

				largePreviewUrl: attachment.large_preview.uri,
				largePreviewHeight: attachment.large_preview.height,
				largePreviewWidth: attachment.large_preview.width,

				// You have to query for the real image. See below.
				url: attachment.large_preview.uri, // @Legacy
				width: attachment.large_preview.width, // @Legacy
				height: attachment.large_preview.height, // @Legacy
				name: attachment.filename, // @Legacy

				// @Undocumented
				attributionApp: attachment.attribution_app
					? {
							attributionAppID: attachment.attribution_app.id,
							name: attachment.attribution_app.name,
							logo: attachment.attribution_app.square_logo
					  }
					: null

				// @TODO No idea what this is, should we expose it?
				//      Ben - July 15th 2017
				// renderAsSticker: attachment.render_as_sticker,

				// This is _not_ the real URI, this is still just a large preview.
				// To get the URL we'll need to support a POST query to
				//
				//    https://www.facebook.com/webgraphql/query/
				//
				// With the following query params:
				//
				//    query_id:728987990612546
				//    variables:{"id":"100009069356507","photoID":"10213724771692996"}
				//    dpr:1
				//
				// No special form though.
			};
		case 'MessageAnimatedImage':
			return {
				type: 'animated_image',
				ID: attachment.legacy_attachment_id,
				filename: attachment.filename,

				previewUrl: attachment.preview_image.uri,
				previewWidth: attachment.preview_image.width,
				previewHeight: attachment.preview_image.height,

				url: attachment.animated_image.uri,
				width: attachment.animated_image.width,
				height: attachment.animated_image.height,

				thumbnailUrl: attachment.preview_image.uri, // @Legacy
				name: attachment.filename, // @Legacy
				facebookUrl: attachment.animated_image.uri, // @Legacy
				rawGifImage: attachment.animated_image.uri, // @Legacy
				animatedGifUrl: attachment.animated_image.uri, // @Legacy
				animatedGifPreviewUrl: attachment.preview_image.uri, // @Legacy
				animatedWebpUrl: attachment.animated_image.uri, // @Legacy
				animatedWebpPreviewUrl: attachment.preview_image.uri, // @Legacy

				// @Undocumented
				attributionApp: attachment.attribution_app
					? {
							attributionAppID: attachment.attribution_app.id,
							name: attachment.attribution_app.name,
							logo: attachment.attribution_app.square_logo
					  }
					: null
			};
		case 'MessageVideo':
			return {
				type: 'video',
				filename: attachment.filename,
				ID: attachment.legacy_attachment_id,

				thumbnailUrl: attachment.large_image.uri, // @Legacy

				previewUrl: attachment.large_image.uri,
				previewWidth: attachment.large_image.width,
				previewHeight: attachment.large_image.height,

				url: attachment.playable_url,
				width: attachment.original_dimensions.x,
				height: attachment.original_dimensions.y,

				duration: attachment.playable_duration_in_ms,
				videoType: attachment.video_type.toLowerCase()
			};
			break;
		case 'MessageFile':
			return {
				type: 'file',
				filename: attachment.filename,
				ID: attachment.message_file_fbid,

				url: attachment.url,
				isMalicious: attachment.is_malicious,
				contentType: attachment.content_type,

				name: attachment.filename, // @Legacy
				mimeType: '', // @Legacy
				fileSize: -1 // @Legacy
			};
		case 'MessageAudio':
			return {
				type: 'audio',
				filename: attachment.filename,
				ID: attachment.url_shimhash, // Not fowardable

				audioType: attachment.audio_type,
				duration: attachment.playable_duration_in_ms,
				url: attachment.playable_url,

				isVoiceMail: attachment.is_voicemail
			};
		default:
			return {
				error: "Don't know about attachment type " + attachment.__typename
			};
	}
}

function formatExtensibleAttachment(attachment: any) {
	if (attachment.story_attachment) {
		return {
			type: 'share',
			ID: attachment.legacy_attachment_id,
			url: attachment.story_attachment.url,

			title: attachment.story_attachment.title_with_entities.text,
			description: attachment.story_attachment.description && attachment.story_attachment.description.text,
			source: attachment.story_attachment.source == null ? null : attachment.story_attachment.source.text,

			image:
				attachment.story_attachment.media == null
					? null
					: attachment.story_attachment.media.animated_image == null && attachment.story_attachment.media.image == null
					? null
					: (attachment.story_attachment.media.animated_image || attachment.story_attachment.media.image).uri,
			width:
				attachment.story_attachment.media == null
					? null
					: attachment.story_attachment.media.animated_image == null && attachment.story_attachment.media.image == null
					? null
					: (attachment.story_attachment.media.animated_image || attachment.story_attachment.media.image).width,
			height:
				attachment.story_attachment.media == null
					? null
					: attachment.story_attachment.media.animated_image == null && attachment.story_attachment.media.image == null
					? null
					: (attachment.story_attachment.media.animated_image || attachment.story_attachment.media.image).height,
			playable: attachment.story_attachment.media == null ? null : attachment.story_attachment.media.is_playable,
			duration:
				attachment.story_attachment.media == null ? null : attachment.story_attachment.media.playable_duration_in_ms,
			playableUrl: attachment.story_attachment.media == null ? null : attachment.story_attachment.media.playable_url,

			subattachments: attachment.story_attachment.subattachments,

			// Format example:
			//
			//   [{
			//     key: "width",
			//     value: { text: "1280" }
			//   }]
			//
			// That we turn into:
			//
			//   {
			//     width: "1280"
			//   }
			//
			properties: attachment.story_attachment.properties.reduce((obj: any, cur: any) => {
				obj[cur.key] = cur.value.text;
				return obj;
			}, {}),

			// Deprecated fields
			animatedImageSize: '', // @Legacy
			facebookUrl: '', // @Legacy
			styleList: '', // @Legacy
			target: '', // @Legacy
			thumbnailUrl:
				attachment.story_attachment.media == null
					? null
					: attachment.story_attachment.media.animated_image == null && attachment.story_attachment.media.image == null
					? null
					: (attachment.story_attachment.media.animated_image || attachment.story_attachment.media.image).uri, // @Legacy
			thumbnailWidth:
				attachment.story_attachment.media == null
					? null
					: attachment.story_attachment.media.animated_image == null && attachment.story_attachment.media.image == null
					? null
					: (attachment.story_attachment.media.animated_image || attachment.story_attachment.media.image).width, // @Legacy
			thumbnailHeight:
				attachment.story_attachment.media == null
					? null
					: attachment.story_attachment.media.animated_image == null && attachment.story_attachment.media.image == null
					? null
					: (attachment.story_attachment.media.animated_image || attachment.story_attachment.media.image).height // @Legacy
		};
	} else {
		return { error: "Don't know what to do with extensible_attachment." };
	}
}

export function formatThreadInfo(data: any): ThreadInfo {
	// formatting GraphQL response
	const messageThread = data.o0.data.message_thread;
	if (!messageThread)
		throw new Error(
			`There was an unknown response. Contact the dev team about this (error code 935528). Data: ${JSON.stringify(
				data
			)}`
		);
	const isGroup = messageThread.thread_type?.toUpperCase() == 'GROUP'; // otherwise 'ONE_TO_ONE'
	return {
		threadId: parseInt(messageThread.thread_key.thread_fbid || messageThread.thread_key.other_user_id),
		threadName: messageThread.name,
		participantIds: messageThread.all_participants?.nodes?.map((d: any) => parseInt(d.messaging_actor?.id)),

		groupAdministration: isGroup
			? {
					approvalMode: !!parseInt(messageThread.approval_mode),
					adminIds: messageThread.thread_admins?.map((obj: any) => parseInt(obj.id))
					// thread_queue_metadata
			  }
			: null,

		unreadCount: messageThread.unread_count,
		messageCount: messageThread.messages_count,

		lastUpdateTimestamp: parseInt(messageThread.updated_time_precise),
		lastMessage: {
			snippetText: messageThread.last_message?.nodes[0]?.snippet,
			senderId: parseInt(messageThread.last_message?.nodes[0]?.message_sender?.messaging_actor.id),
			timestamp: parseInt(messageThread.last_message?.nodes[0]?.timestamp_precise)
		},
		lastReadTimestamp: parseInt(messageThread.last_read_receipt?.nodes[0].timestamp_precise),

		isGroup,
		isArchived: messageThread.has_viewer_archived,
		isSubscribed: messageThread.is_viewer_subscribed,
		folder: messageThread.folder,

		customisation: {
			enabledCustomisation: messageThread.customization_enabled,
			emoji: messageThread.customization_info.emoji,
			outgoingBubbleColor: messageThread.customization_info.outgoing_bubble_color,
			imageUri: messageThread.image?.uri
			// Disabled by Facebook, may not work in the future
			// nicknames: messageThread.customization_info?.participant_customizations?.reduce((res: any, val: any) => {
			// 	if (val.nickname) res[val.participant_id] = val.nickname;
			// 	return res;
			// }, {}),
		},

		cannotReplyReason: messageThread.cannot_reply_reason,
		eventReminders: messageThread.event_reminders?.nodes?.map(formatEventReminders),

		muteUntil: parseInt(messageThread.mute_until) * 1000 || null,
		reactionsMuteMode: messageThread.reactions_mute_mode,
		mentionsMuteMode: messageThread.mentions_mute_mode
	};
}

function formatEventReminders(reminder: any) {
	return {
		reminderID: reminder.id,
		eventCreatorID: reminder.lightweight_event_creator.id,
		time: reminder.time,
		eventType: reminder.lightweight_event_type.toLowerCase(),
		locationName: reminder.location_name,
		// @TODO verify this
		locationCoordinates: reminder.location_coordinates,
		locationPage: reminder.location_page,
		eventStatus: reminder.lightweight_event_status.toLowerCase(),
		note: reminder.note,
		repeatMode: reminder.repeat_mode.toLowerCase(),
		eventTitle: reminder.event_title,
		triggerMessage: reminder.trigger_message,
		secondsToNotifyBefore: reminder.seconds_to_notify_before,
		allowsRsvp: reminder.allows_rsvp,
		relatedEvent: reminder.related_event,
		members: reminder.event_reminder_members.edges.map((member: any) => ({
			memberID: member.node.id,
			state: member.guest_list_state.toLowerCase()
		}))
	};
}
