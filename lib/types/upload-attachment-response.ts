/** An interface representing a response payload of file uploading. This is the general response. */
export interface UploadGeneralAttachmentResponse {
	/** @example 'dog_playing_with_cat.jpg' */
	filename: string;
	/** @example 'image/jpeg' or 'application/json' or 'audio/mpeg' etc. */
	filetype: string;
}

/** An interface representing a response payload of image uploading. @extends UploadGeneralAttachmentResponse */
export interface UploadImageAttachmentResponse extends UploadGeneralAttachmentResponse {
	/** @alias fbid (both properties have the same value) */
	image_id: number;
	/** ID of this uploaded image.
	 * @alias image_id (both properties have the same value) */
	fbid: number;
	/** full internet resource path to this uploaded image */
	src: string;
}
/** An interface representing a response payload of video uploading. @extends UploadGeneralAttachmentResponse */
export interface UploadVideoAttachmentResponse extends UploadGeneralAttachmentResponse {
	video_id: number;
	/** full internet resource path to thumbnail (cover photo) of this uploaded video */
	thumbnail_src: string;
}
/** An interface representing a response payload of audio uploading. @extends UploadGeneralAttachmentResponse */
export interface UploadAudioAttachmentResponse extends UploadGeneralAttachmentResponse {
	audio_id: number;
}
/** An interface representing a response payload of file uploading. @extends UploadGeneralAttachmentResponse */
export interface UploadFileAttachmentResponse extends UploadGeneralAttachmentResponse {
	file_id: number;
}

export function getAttachmentID(uploadResponse: any): number {
	const id =
		uploadResponse.image_id ?? uploadResponse.video_id ?? uploadResponse.audio_id ?? uploadResponse.file_id ?? -1;
	if (id === -1) throw new Error('Could not get an attachment ID from the given object');
	return id;
}
