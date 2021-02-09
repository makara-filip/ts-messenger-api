const login = require('../dist/index.js');
const fs = require('fs');

login.default({ email: process.argv[2], password: process.argv[3] }, {}, (err, api) => {
	if (err) throw err;
	fs.writeFileSync(process.argv[4], JSON.stringify(api.getAppState()));
});
