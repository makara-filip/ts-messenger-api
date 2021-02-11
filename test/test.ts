import { expect } from 'chai';
import login from '../dist/index';
import Api from '../dist/lib/api';
import fs from 'fs';
import path from 'path';
import { AppState, Message, Typ } from '../dist/lib/types';
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
		appState2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testAppStates', 'testAccount3.json')).toString());
	});
	it('should have the AppStates loaded', () => {
		expect(appState1, '1st AppState not loaded').to.exist;
		expect(appState1, '1st AppState not loaded').to.be.not.empty;
		expect(appState2, '2nd AppState not loaded').to.exist;
		expect(appState2, '2nd AppState not loaded').to.be.not.empty;
	});

	let api1: Api, api2: Api;
	it('performs login 1', done => {
		login({ appState: appState1, email: '', password: '' }, {}, (err, iapi) => {
			if (err) throw err;
			api1 = iapi as Api;
			done();
		});
	});
	it('performs login 2', done => {
		login({ appState: appState2, email: '', password: '' }, {}, (err, iapi) => {
			if (err) throw err;
			api2 = iapi as Api;
			done();
		});
	});
	it('should have both the test accounts logged in', () => {
		expect(api1).to.exist;
		expect(api1.getAppState()).to.be.not.empty;
		expect(api2).to.exist;
		expect(api2.getAppState()).to.be.not.empty;
	});

	it('gets a friendslist of both test accounts', done => {
		let oneDone = false;
		api1.getFriendsList((err, list) => {
			if (err) throw err;
			expect(list).to.exist;
			if (oneDone) done();
			else oneDone = true;
		});
		api2.getFriendsList((err, list) => {
			if (err) throw err;
			expect(list).to.exist;
			if (oneDone) done();
			else oneDone = true;
		});
	});

	let emitter: EventEmitter; // this will emit events from the second api
	it('invokes the listening method of test account 1', done => {
		let isActive = false;
		api1.listen((err, event) => {
			if (err) throw err;
			if (!isActive) {
				isActive = true;
				done();
			}
		});
	});
	it('invokes the listening method of test account 2', done => {
		emitter = new EventEmitter();
		let isActive = false;
		api2.listen((err, event) => {
			if (err) throw err;
			if (!isActive) {
				isActive = true;
				done();
			}
			emitter.emit('event', event);
		});
	});

	it('should have both the test accounts activated', () => {
		expect(api1.isActive, 'the first api was not activated').to.be.true;
		expect(api2.isActive, 'the second api was not activated').to.be.true;
	});

	it('sends a text message and recieves it in another account', done => {
		// the first account will send a message, the second one should recieve it
		const messageBody = sentence().slice(0, -1);
		let messageWasSent = false;
		let messageWasRecieved = false;

		// setup the event listener
		const listener = (event: any) => {
			if (messageWasSent && event.type === 'message' && !messageWasRecieved) {
				expect((event as Message).body, 'incoming text message did not contain "body" property').to.exist;
				expect((event as Message).body, 'incoming text message did not contain expected content').to.include(
					messageBody
				);
				done();
				messageWasRecieved = true;
				emitter.removeListener('event', listener);
			}
		};
		emitter.addListener('event', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage({ body: messageBody }, api2.ctx.userID, err => expect(err).to.not.exist);
	});

	xit('sends an image attachment and recieves it in another account', done => {
		// the first account will send a message, the second one should recieve it
		let messageWasSent = false;
		let messageWasRecieved = false;

		// setup the event listener
		const listener = (event: any) => {
			if (messageWasSent && event.type === 'message' && !messageWasRecieved) {
				expect((event as Message).attachments, 'incoming message did not contain "attachments" property').to.exist;
				expect((event as Message).attachments).to.be.not.empty;
				// expect((event as Message).attachments, 'incoming message did not contain expected attachment').to.include(
				// 	messageBody
				// );
				done();
				messageWasRecieved = true;
				emitter.removeListener('event', listener);
			}
		};
		emitter.addListener('event', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage(
			{ attachment: fs.createReadStream(path.join(__dirname, 'testAttachments/image.jpg')) },
			api2.ctx.userID,
			err => expect(err).to.not.exist
		);
	});

	xit('sends an audio attachment and recieves it in another account', done => {
		// the first account will send a message, the second one should recieve it
		let messageWasSent = false;
		let messageWasRecieved = false;

		// setup the event listener
		const listener = (event: any) => {
			if (messageWasSent && event.type === 'message' && !messageWasRecieved) {
				expect((event as Message).attachments, 'incoming message did not contain "attachments" property').to.exist;
				expect((event as Message).attachments).to.be.not.empty;
				// expect((event as Message).attachments, 'incoming message did not contain expected attachment').to.include(
				// 	messageBody
				// );
				done();
				messageWasRecieved = true;
				emitter.removeListener('event', listener);
			}
		};
		emitter.addListener('event', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage(
			{ attachment: fs.createReadStream(path.join(__dirname, 'testAttachments/audio.mp3')) },
			api2.ctx.userID,
			err => expect(err).to.not.exist
		);
	});

	xit('sends a video attachment and recieves it in another account', done => {
		// the first account will send a message, the second one should recieve it
		let messageWasSent = false;
		let messageWasRecieved = false;

		// setup the event listener
		const listener = (event: any) => {
			if (messageWasSent && event.type === 'message' && !messageWasRecieved) {
				expect((event as Message).attachments, 'incoming message did not contain "attachments" property').to.exist;
				expect((event as Message).attachments).to.be.not.empty;
				// expect((event as Message).attachments, 'incoming message did not contain expected attachment').to.include(
				// 	messageBody
				// );
				done();
				messageWasRecieved = true;
				emitter.removeListener('event', listener);
			}
		};
		emitter.addListener('event', listener);

		// send the actual message
		messageWasSent = true;
		api1.sendMessage(
			{ attachment: fs.createReadStream(path.join(__dirname, 'testAttachments/video.mp4')) },
			api2.ctx.userID,
			err => expect(err).to.not.exist
		);
	});

	it('sends a typing indicator and spot it in another account', done => {
		// the first account will send the indicator, the second one should spot it
		let indicatorWasSent = false;
		let indicatorRecievedTyping = false;
		let isDone = false;

		const listener = (event: any) => {
			if (!indicatorWasSent || event.type !== 'typ' || isDone) return;
			const typing = event as Typ;
			if (typing.from != api1.ctx.userID) return;

			if (!indicatorRecievedTyping) {
				// the first indication - should be "true"
				expect(typing.isTyping).to.be.true;
				indicatorRecievedTyping = true;
			} else {
				// the second indication (after the timeout) - should be "false"
				expect(typing.isTyping).to.be.false;
				done();
				isDone = true;
				emitter.removeListener('event', listener);
			}
		};
		emitter.addListener('event', listener);

		indicatorWasSent = true;
		api1.sendTypingIndicator(api2.ctx.userID, true, 4000, err => expect(err).to.not.exist);
	});

	it('should get thread history', done => {
		api1.getThreadHistory('100037075550522', 20, undefined, (err, history) => {
			expect(err).to.be.null;
			expect(history).to.exist;
			if (history) {
				expect(history).to.not.be.empty;
				expect(history[0]).to.not.be.empty;
			}
			done();
		});
	});

	after(() => {
		api1?.stopListening();
		api2?.stopListening();
		emitter?.removeAllListeners();

		const endTime: Date = new Date();
		console.log(
			`The tests have completed. Timestamp: ${endTime.getTime()}. Duration: ${
				endTime.getTime() - startTime.getTime()
			} milliseconds`
		);
		process.exit(0); // force exit (it used to test for a whole day)
	});
});
