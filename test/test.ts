/* eslint-disable */

const expect = require('chai').expect;
import login from '../dist/index';
import Api from '../dist/lib/api';

describe('Basic Login', function () {
	var api1: Api, api2: Api;
	before(function (done) {
		let oneDone = false;
		login({ email: 'jtestisnotlongenough@gmail.com', password: 'zemiakovysalat' }, {}, (err, iapi) => {
			api1 = iapi;
			if (oneDone) done();
			else oneDone = true;
		});
		login({ email: 'jtestisnotlongenough1@gmail.com', password: 'zemiakovysalat' }, {}, (err, iapi) => {
			api2 = iapi;
			if (oneDone) done();
			else oneDone = true;
		});
	});
	it('successfully logs in', function () {
		expect(api1).to.exist;
		expect(api2).to.exist;
	});
	it('sends and receives simple messages', function () {});
});
