const login = require('../dist/index.js');
const fs = require('fs');

login.default({ email: process.argv[2], password: process.argv[3] }, {}, (err, api) => {
	fs.writeFileSync(process.argv[4], api.getAppState());
});
