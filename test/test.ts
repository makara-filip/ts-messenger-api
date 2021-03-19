import { expect } from 'chai';
import login from '../dist/index';
import Api from '../dist/lib/api';
import fs from 'fs';
import path from 'path';
import {
	AppState,
	IncomingMessage,
	IncomingMessageBase,
	MessageID,
	IncomingMessageReply,
	Typ,
	IncomingMessageType
} from '../dist/lib/types';
import { EventEmitter } from 'events';
import { sentence } from 'txtgen';

describe('Fundamental API functioning', function () {
	this.timeout(30000); // 30s

	let appState1: AppState, appState2: AppState;
	let startTime: Date;
	before(() => {
		startTime = new Date();
		console.log(`The tests have just started. Timestamp: ${startTime.getTime()}`);
		appState1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testAppStates', 'justin.json')).toString());
		appState2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testAppStates', 'azihad.json')).toString());
	});

	it('should have the AppStates loaded', () => {
		expect(appState1, '1st AppState not loaded').to.exist;
		expect(appState1, '1st AppState not loaded').to.be.not.empty;
		expect(appState2, '2nd AppState not loaded').to.exist;
		expect(appState2, '2nd AppState not loaded').to.be.not.empty;
	});

	let api1: Api, api2: Api;
	it('performs login 1', async () => {
		api1 = (await login({ appState: appState1, email: '', password: '' }, {})) as Api;
	});
	it('performs login 2', async () => {
		api2 = (await login({ appState: appState2, email: '', password: '' }, {})) as Api;
	});
	it('should have both the test accounts logged in', () => {
		expect(api1).to.exist;
		expect(api1.getAppState()).to.be.not.empty;
		expect(api2).to.exist;
		expect(api2.getAppState()).to.be.not.empty;
	});

	it('gets a friendslist of both test accounts', async () => {
		const list1 = api1.getFriendsList();
		const list2 = api2.getFriendsList();
		expect(await list1).to.exist;
		expect(await list2).to.exist;
	});

	let emitter: EventEmitter; // this will emit events from the second api
	it('invokes the listening method of test account 1', async () => {
		await api1.listen();
	});
	it('invokes the listening method of test account 2', async () => {
		emitter = await api2.listen();
	});

	it('should have both the test accounts activated', () => {
		expect(api1.isActive, 'the first api was not activated').to.be.true;
		expect(api2.isActive, 'the second api was not activated').to.be.true;
	});

	it('sends a typing indicator and spots it in another account', done => {
		// the first account will send the indicator, the second one should spot it
		let indicatorWasSent = false;
		let indicatorReceivedTyping = false;
		let isDone = false;

		const listener = (event: IncomingMessageBase) => {
			if (!indicatorWasSent || event.type !== IncomingMessageType.TypingIndicator || isDone) return;
			const typing = event as Typ;
			if (typing.senderId != api1.ctx.userID) return;

			if (!indicatorReceivedTyping) {
				// the first indication - should be "true"
				expect(typing.isTyping, 'first typing indicator was not true').to.be.true;
				indicatorReceivedTyping = true;
			} else {
				// the second indication (after the timeout) - should be "false"
				expect(typing.isTyping, 'second typing indicator was not false').to.be.false;
				done();
				isDone = true;
				emitter.removeListener('typ', listener);
			}
		};
		emitter.addListener('typ', listener);

		indicatorWasSent = true;
		api1.sendTypingIndicator(api2.ctx.userID, true, 3000);
	});

	let messageId: MessageID;
	it('sends a text message and receives it in another account', done => {
		// the first account will send a message, the second one should receive it
		const messageBody = sentence().slice(0, -1);
		let messageWasSent = false;
		let messageWasReceived = false;

		// setup the event listener
		const listener = (event: IncomingMessageBase) => {
			if (!(messageWasSent && event.type === IncomingMessageType.MessageRegular && !messageWasReceived)) return;

			expect((event as IncomingMessage).body, 'incoming text message did not contain "body" property').to.exist;
			expect((event as IncomingMessage).body, 'incoming text message did not contain expected content').to.include(
				messageBody
			);
			done();
			messageId = (event as IncomingMessage).messageId; // save the message ID for later use
			messageWasReceived = true;
			emitter.removeListener('message', listener);
		};
		emitter.addListener('message', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage({ body: messageBody }, api2.ctx.userID);
	});
	it('sends a reply to last message and receives it in another account', done => {
		// the first account will send a reply, the second one should receive it
		const messageBody = sentence().slice(0, -1);
		let messageWasSent = false;
		let messageWasReceived = false;

		// setup the event listener
		const listener = (event: IncomingMessageBase) => {
			if (!(messageWasSent && event.type === IncomingMessageType.MessageReply && !messageWasReceived)) return;

			expect((event as IncomingMessageReply).body, 'incoming text message did not contain "body" property').to.exist;
			expect((event as IncomingMessageReply).body, 'incoming text message did not contain expected content').to.include(
				messageBody
			);
			done();
			messageWasReceived = true;
			emitter.removeListener('message', listener);
		};
		emitter.addListener('message', listener);

		// send the actual reply
		messageWasSent = true;
		api1.sendMessage({ body: messageBody, replyToMessage: messageId }, api2.ctx.userID);
	});

	it('sends an image attachment and receives it in another account', done => {
		// the first account will send a message, the second one should receive it
		let messageWasSent = false;
		let messageWasReceived = false;

		// setup the event listener
		const listener = (event: IncomingMessageBase) => {
			if (!(messageWasSent && event.type === IncomingMessageType.MessageRegular && !messageWasReceived)) return;

			expect((event as IncomingMessage).attachments, 'incoming message did not contain "attachments" property').to
				.exist;
			expect((event as IncomingMessage).attachments).to.be.not.empty;
			done();
			messageWasReceived = true;
			emitter.removeListener('message', listener);
		};
		emitter.addListener('message', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage(
			{ attachment: fs.createReadStream(path.join(__dirname, 'testAttachments/image.jpg')) },
			api2.ctx.userID
		);
	});

	xit('sends an audio attachment and receives it in another account', done => {
		// the first account will send a message, the second one should receive it
		let messageWasSent = false;
		let messageWasReceived = false;

		// setup the event listener
		const listener = (event: IncomingMessageBase) => {
			if (!(messageWasSent && event.type === IncomingMessageType.MessageRegular && !messageWasReceived)) return;

			expect((event as IncomingMessage).attachments, 'incoming message did not contain "attachments" property').to
				.exist;
			expect((event as IncomingMessage).attachments).to.be.not.empty;
			done();
			messageWasReceived = true;
			emitter.removeListener('message', listener);
		};
		emitter.addListener('message', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage(
			{ attachment: fs.createReadStream(path.join(__dirname, 'testAttachments/audio.mp3')) },
			api2.ctx.userID
		);
	});

	xit('sends a video attachment and receives it in another account', done => {
		// the first account will send a message, the second one should receive it
		let messageWasSent = false;
		let messageWasReceived = false;

		// setup the event listener
		const listener = (event: IncomingMessageBase) => {
			if (!(messageWasSent && event.type === IncomingMessageType.MessageRegular && !messageWasReceived)) return;

			expect((event as IncomingMessage).attachments, 'incoming message did not contain "attachments" property').to
				.exist;
			expect((event as IncomingMessage).attachments).to.be.not.empty;
			done();
			messageWasReceived = true;
			emitter.removeListener('message', listener);
		};
		emitter.addListener('message', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage(
			{ attachment: fs.createReadStream(path.join(__dirname, 'testAttachments/video.mp4')) },
			api2.ctx.userID
		);
	});

	it('should get user info of the second account', async () => {
		const info = (await api1.getUserInfo([api2.ctx.userID])).get(api2.ctx.userID);
		expect(info).to.exist;
		expect(info?.isFriend).to.be.true;
	});

	it('should get thread history', async () => {
		const history = await api1.getThreadHistory(api2.ctx.userID, 20, undefined);
		expect(history).to.exist;
		if (history) {
			expect(history).to.not.be.empty;
			expect(history[0]).to.not.be.empty;
		}
	});

	after(() => {
		api1?.stopListening();
		api2?.stopListening();
		emitter?.removeAllListeners();

		const endTime = new Date();
		console.log(
			`The tests have completed. Timestamp: ${endTime.getTime()}. Duration: ${
				endTime.getTime() - startTime.getTime()
			} milliseconds`
		);
		process.exit(0); // force exit (it used to test for a whole day)
	});
});
