import log from 'npmlog';
import { ApiCtx, Dfs, RequestForm } from './types';
import * as utils from './utils';

export default class Api {
	ctx: ApiCtx;
	private _defaultFuncs;

	constructor(defaultFuncs: Dfs, ctx: ApiCtx) {
		this.ctx = ctx;
		this._defaultFuncs = defaultFuncs;
	}

	deleteMessage(messageOrMessages: string[], callback = (err?: Error) => undefined): void {
		const form: RequestForm = {
			client: 'mercury'
		};

		for (let i = 0; i < messageOrMessages.length; i++) {
			form[`message_ids[${i}]`] = messageOrMessages[i];
		}

		this._defaultFuncs
			.post('https://www.facebook.com/ajax/mercury/delete_messages.php', this.ctx.jar, form)
			.then(utils.parseAndCheckLogin(this.ctx, this._defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}

				return callback();
			})
			.catch(function (err) {
				log.error('deleteMessage', err);
				return callback(err);
			});
	}
}
