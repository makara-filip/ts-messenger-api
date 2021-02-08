// const expect = require('chai').expect;
import { expect } from 'chai';
import login from '../dist/index';
import Api from '../dist/lib/api';
import fs from 'fs';
import path from 'path';
import { AppState, Message } from '../dist/lib/types';
import { EventEmitter } from 'events';

describe('Fundamental API functioning', function () {
	this.timeout(30000); // 30s

	let appState1: AppState, appState2: AppState;
	let startTime: Date;
	before(() => {
		startTime = new Date();
		console.log(`The tests have just started. Timestamp: ${startTime.getTime()}`);
		appState1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testAppStates', 'testAccount1.json')).toString());
		appState2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testAppStates', 'testAccount3.json')).toString());
	});
	it('should have the AppStates loaded', () => {
		expect(appState1, '1st AppState not loaded').to.exist;
		expect(appState1, '1st AppState not loaded').to.be.not.empty;
		expect(appState2, '2nd AppState not loaded').to.exist;
		expect(appState2, '2nd AppState not loaded').to.be.not.empty;
	});

	let api1: Api, api2: Api;
	it('performs both logins', done => {
		let oneDone = false;
		login({ appState: appState1, email: '', password: '' }, {}, (err, iapi) => {
			if (err) throw err;
			api1 = iapi as Api;
			if (oneDone) done();
			else oneDone = true;
		});
		login({ appState: appState2, email: '', password: '' }, {}, (err, iapi) => {
			if (err) throw err;
			api2 = iapi as Api;
			if (oneDone) done();
			else oneDone = true;
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
	it('invokes the listening method of both test accounts', done => {
		emitter = new EventEmitter();

		const isActive = [false, false];
		api1.listen((err, event) => {
			if (err) throw err;
			if (isActive[1] && !isActive[0]) done();
			isActive[0] = true;
		});
		api2.listen((err, event) => {
			if (err) throw err;
			if (isActive[0] && !isActive[1]) done();
			isActive[1] = true;

			emitter.emit('event', event);
		});
	});
  
	it('should have both the test accounts activated', () => {
		expect(api1.isActive, 'the first api was not activated').to.be.true;
		expect(api2.isActive, 'the second api was not activated').to.be.true;
	});

	it('sends a text message and recieves it in another account', done => {
		// the first account will send a message, the second one should recieve it
		const messageBody = 'This message was send automatically during the test';
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
		api1.sendMessage(
			{ body: `[${messageBody}. Timestamp: ${new Date().getTime()}` },
			api2.ctx.userID,
			err => expect(err).to.not.exist
		);
	});
  
	it('sends an image attachment and recieves it in another account', done => {
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
  
	it('sends an audio attachment and recieves it in another account', done => {
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
  
	it('sends a video attachment and recieves it in another account', done => {
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

	it('should get thread history', done => {
		api1.getThreadHistory('100041399284084', 20, undefined, (err, history) => {
			expect(err).to.be.null;
			expect(history).to.exist;
			if (history) {
				expect(history.length).to.be.equal(20);
				expect(history[0]).to.not.be.empty;
			}
			done();
		});
	});

	after(() => {
		api1?.stopListening();
		api2?.stopListening();

		const endTime: Date = new Date();
		console.log(
			`The tests have completed. Timestamp: ${endTime.getTime()}. Duration: ${
				endTime.getTime() - startTime.getTime()
			} milliseconds`
		);
	});
});
