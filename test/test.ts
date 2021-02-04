// /* eslint-disable */

// const expect = require('chai').expect;
import { expect } from 'chai';
import login from '../dist/index';
import Api from '../dist/lib/api';
import fs from 'fs';
import path from 'path';
import { AppState, Message } from '../dist/lib/types';

describe('Fundamental API functioning', function () {
	let appState1: AppState, appState2: AppState;
	before(() => {
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
	it('should have the test accounts logged in', () => {
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
	it('sends a message and recieves it in another account', done => {
		// TODO: add some time to the timeout of this test (if possible)
		// because this test lasts sometimes longer than default 15s
		const messageBody = 'This message was send automatically during the test';
		let messageWasSent = false;
		let secondApiInitialised = false;

		api1.listen((err, event1) => {
			// this `listen` function invocation is for websocket init only (for message sending)
			expect(err).to.not.exist;
			if (err) throw err;

			if (!secondApiInitialised) {
				secondApiInitialised = true;
				// we want to init this second api only once

				api2.listen((err2, event2) => {
					expect(err2).to.not.exist;
					if (err2) throw err2;
					if (!event2) throw new Error();

					if (!messageWasSent) {
						messageWasSent = true;
						// now both accounts are listening, so we can send a text message
						// from one account to another and check if it has been recieved
						api1.sendMessage(
							{ body: `[${messageBody}. Timestamp: ${new Date().getTime()}` },
							api2.ctx.userID,
							err3 => expect(err3).to.not.exist
						);
					}

					if (messageWasSent && event2.type === 'message') {
						// the first account sent the message, the second one should recieve it
						expect((event2 as Message).body, 'incoming message did not contain "body" property').to.exist;
						expect((event2 as Message).body, 'incoming text message did not contain expected content').to.include(
							messageBody
						);
						done();
					}
				});
			}
		});
	});
});
