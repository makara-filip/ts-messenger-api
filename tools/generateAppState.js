// This small script generates and saves an AppState of newly logged-in Facebook user.
// Example use in terminal: `node .\tools\generateAppState.js azihadalchai@gmail.com ladovysalat .\tools\export.json`

const login = require('../dist/index.js');
const fs = require('fs');

console.log(`Logging in a user ${process.argv[2]} using password ${process.argv[3]}...`);
(async () => {
	const api = await login.default({ email: process.argv[2], password: process.argv[3] }, {});
	console.log(`Saving the AppState to file ${process.argv[4]}...`);
	fs.writeFileSync(process.argv[4], JSON.stringify(api.getAppState()));
	console.log('Done :-)');
})();
