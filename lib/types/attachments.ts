/** Union type for all attachment types (including stickers) */
export type AnyAttachment =
	| AttachmentBase
	| AttachmentImage
	| AttachmentVideo
	| AttachmentAudio
	| AttachmentFile
	| AttachmentAnimatedImage
	| AttachmentSticker;

export enum AttachmentType {
	Image = 1,
	Video = 2,
	Audio = 3,
	File = 4,
	Gif = 5,

	Sticker = -1,
	Unknown = 999
}

/** Represents a preview of a visual attachment */
export interface VisualAttachmentPreview {
	/** Url of a preview. All auth cookies recommended with the GET request */
	uri: string;
	/** width of a preview (in pixels) */
	width: number;
	/** height of a preview (in pixels) */
	height: number;
}

/** Base interface for all "normal" attachments.
 * Sticker attachments do not extend this interface. */
export interface AttachmentBase {
	/** Facebook ID of an attachment */
	attachmentId: number;
	/** exact size of an attachment (in bytes) */
	fileSize: number;
	/** original filename of an attachment, including extension */
	fileName: string;
	/** string type representation, e.g. `audio/mpeg` or `image/jpeg` */
	mimeType: string;
	/** type of an attachment, see `AttachmentType` */
	type: AttachmentType;
}

/** Image attachment */
export interface AttachmentImage extends AttachmentBase {
	type: AttachmentType.Image;

	previewSmall: VisualAttachmentPreview;
	previewLarge: VisualAttachmentPreview;
	thumbnailUrl: string;
	/** width & height of the original file */
	originalDimensions: { x: number; y: number };
	/** extension of the original file, e.g. `jpg` */
	originalExtension: string;
}
/** Video attachment */
export interface AttachmentVideo extends AttachmentBase {
	type: AttachmentType.Video;

	chatImage: VisualAttachmentPreview;
	largeImage: VisualAttachmentPreview;
	inboxImage: VisualAttachmentPreview;

	/** from our observation this was only `FILE_ATTACHMENT` */
	videoType: string;
	/** Url of a file. All auth cookies recommended with the GET request */
	playableUrl: string;
	/** width & height of the original file */
	originalDimensions: { x: number; y: number };
	/** duration of a playback (in milliseconds) */
	duration: number;
}
/** Audio attachment */
export interface AttachmentAudio extends AttachmentBase {
	type: AttachmentType.Audio;

	/** Url of a file. All auth cookies recommended with the GET request */
	playableUrl: string;
	/** duration of a playback (in milliseconds) */
	duration: number;
	/** indicator whether an attachment was voice message (`true`) or just an audio file (`false`) */
	isVoiceMail: boolean;
	// can be either `VOICE_MESSAGE` or `FILE_ATTACHMENT`
	audioType: string;
}
/** File attachment */
export interface AttachmentFile extends AttachmentBase {
	type: AttachmentType.File;

	/** Url of a file */
	url: string;
	/** some Facebook malware check */
	isMalicious: boolean;
}
/** Animated image attachment (e.g. gif) */
export interface AttachmentAnimatedImage extends AttachmentBase {
	type: AttachmentType.Gif;

	/** All-available provider application information.
	 * @example
	 * ```typescript
	 * {
	 * 	id: "406655189415060", // probably ID of a GIF
	 * 	name: "GIPHY",
	 * 	square_logo: { uri: "https://some_long_url..." }
	 * }
	 * ```
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	attributionApp: any;
	animatedImage: VisualAttachmentPreview;
	previewImage: VisualAttachmentPreview;
	/** width & height of the original file */
	originalDimensions: { x: number; y: number };
}

/** Sticker attachment. Don't contain file name or size. */
export interface AttachmentSticker {
	type: AttachmentType.Sticker;
	/** All-available information about a sticker attachment.
	 * @example
	 * ```typescript
	 * {
	 * 	id: "623427181025349", // id of a sticker
	 * 	pack: {
	 * 		id: "623386314362769" // id of a sticker package
	 * 	},
	 * 	label: "", // don't know what this does
	 * 	frame_count: 16,
	 * 	frame_rate: 83,
	 * 	frames_per_row: 4,
	 * 	frames_per_column: 4,
	 * 	sprite_image_2x: {
	 * 		uri: "https://scontent.xx.fbcdn.net/some_long_url"
	 * 	},
	 * 	sprite_image: {
	 * 		uri: "https://scontent.xx.fbcdn.net/some_long_url"
	 * 	},
	 * 	padded_sprite_image: {
	 * 		uri: "https://scontent.xx.fbcdn.net/some_long_url"
	 * 	},
	 * 	padded_sprite_image_2x: {
	 * 		uri: "https://scontent.xx.fbcdn.net/some_long_url"
	 * 	},
	 * 	url: "https://scontent.xx.fbcdn.net/some_long_url"
	 * 	height: 240,
	 * 	width: 240
	 * }
	 * ```
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	info: any;
}
