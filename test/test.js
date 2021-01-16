/* eslint-disable */

const expect = require('chai').expect;
const login = require('../dist/index').default;

describe('Basic Login', function () {
	var api;
	before(function (done) {
		login({ email: 'jtestisnotlongenough@gmail.com', password: 'zemiakovysalat' }, {}, (err, iapi) => {
			api = iapi;
			done()
		});
	})
	it('successfully logs in', function () {
		expect(api).to.exist;
	});
});
