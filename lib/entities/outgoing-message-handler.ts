import bluebird from 'bluebird';
import stream from 'stream';
import log from 'npmlog';
import { ApiCtx, Dfs, OutgoingMessage, RequestForm } from '../types';
import * as utils from '../utils';

export class OutgoingMessageHandler {
	private handleUrl(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.url) {
			form['shareable_attachment[share_type]'] = '100';
			this.getUrl(msg.url, function (err, params) {
				if (err) {
					return callback(err);
				}

				form['shareable_attachment[share_params]'] = params;
				cb();
			});
		} else {
			cb();
		}
	}

	private handleSticker(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.sticker) {
			form['sticker_id'] = msg.sticker;
		}
		cb();
	}

	private handleEmoji(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.emojiSize != null && msg.emoji == null) {
			return callback({ error: 'emoji property is empty' });
		}
		if (msg.emoji) {
			if (msg.emojiSize == null) {
				msg.emojiSize = 'medium';
			}
			if (msg.emojiSize != 'small' && msg.emojiSize != 'medium' && msg.emojiSize != 'large') {
				return callback({ error: 'emojiSize property is invalid' });
			}
			if (form['body'] != null && form['body'] != '') {
				return callback({ error: 'body is not empty' });
			}
			form['body'] = msg.emoji;
			form['tags[0]'] = 'hot_emoji_size:' + msg.emojiSize;
		}
		cb();
	}

	private handleAttachment(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.attachment) {
			form['image_ids'] = [];
			form['gif_ids'] = [];
			form['file_ids'] = [];
			form['video_ids'] = [];
			form['audio_ids'] = [];

			if (utils.getType(msg.attachment) !== 'Array') {
				msg.attachment = [msg.attachment as stream.Readable];
			}

			this.uploadAttachment(msg.attachment as stream.Readable[], function (err, files) {
				if (err) {
					return callback(err);
				}

				if (files)
					files.forEach(file => {
						const key = Object.keys(file);
						const type = key[0]; // image_id, file_id, etc
						form['' + type + 's'].push(file[type]); // push the id
					});
				cb();
			});
		} else {
			cb();
		}
	}

	private handleMention(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		if (msg.mentions && msg.body) {
			for (let i = 0; i < msg.mentions.length; i++) {
				const mention = msg.mentions[i];

				const tag = mention.tag;
				if (typeof tag !== 'string') {
					return callback({ error: 'Mention tags must be strings.' });
				}

				const offset = msg.body.indexOf(tag, mention.fromIndex || 0);

				if (offset < 0) {
					log.warn('handleMention', 'Mention for "' + tag + '" not found in message string.');
				}

				if (mention.id == null) {
					log.warn('handleMention', 'Mention id should be non-null.');
				}

				const id = mention.id || 0;
				form['profile_xmd[' + i + '][offset]'] = offset;
				form['profile_xmd[' + i + '][length]'] = tag.length;
				form['profile_xmd[' + i + '][id]'] = id;
				form['profile_xmd[' + i + '][type]'] = 'p';
			}
		}
		cb();
	}

	constructor(private ctx: ApiCtx, private _defaultFuncs: Dfs) {}

	handleAll(
		msg: OutgoingMessage,
		form: RequestForm,
		callback: (err?: { error: string }) => void,
		cb: () => void
	): void {
		this.handleSticker(msg, form, callback, () =>
			this.handleAttachment(msg, form, callback, () =>
				this.handleUrl(msg, form, callback, () =>
					this.handleEmoji(msg, form, callback, () => this.handleMention(msg, form, callback, cb))
				)
			)
		);
	}

	private getUrl(url: string, callback: (err?: { error: string }, params?: any) => void): void {
		const form = {
			image_height: 960,
			image_width: 960,
			uri: url
		};

		this._defaultFuncs
			.post('https://www.facebook.com/message_share_attachment/fromURI/', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then((resData: any) => {
				if (resData.error) {
					return callback(resData);
				}

				if (!resData.payload) {
					return callback({ error: 'Invalid url' });
				}

				callback(undefined, resData.payload.share_data.share_params);
			})
			.catch((err: any) => {
				log.error('getUrl', err);
				return callback(err);
			});
	}

	uploadAttachment(attachments: stream.Readable[], callback: (err?: { error: string }, files?: any[]) => void): void {
		const uploads = [];

		// create an array of promises
		for (let i = 0; i < attachments.length; i++) {
			if (!utils.isReadableStream(attachments[i])) {
				throw {
					error: 'Attachment should be a readable stream and not ' + utils.getType(attachments[i]) + '.'
				};
			}

			const form = {
				upload_1024: attachments[i],
				voice_clip: 'true'
			};

			uploads.push(
				this._defaultFuncs
					.postFormData('https://upload.facebook.com/ajax/mercury/upload.php', this.ctx.jar, form, {})
					.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
					.then((resData: any) => {
						if (resData.error) {
							throw resData;
						}

						// We have to return the data unformatted unless we want to change it
						// back in sendMessage.
						return resData.payload.metadata[0];
					})
			);
		}

		// resolve all promises
		bluebird
			.all(uploads)
			.then(function (resData) {
				callback(undefined, resData);
			})
			.catch(err => {
				log.error('uploadAttachment', err);
				return callback(err);
			});
	}
}
