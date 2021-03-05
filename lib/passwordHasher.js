/* eslint-disable @typescript-eslint/no-var-requires */

// Copied from Facebook frontend code, slightly modified

// I've tried to rewrite this code to TypeScript, but I had had some
// troubles while importing the "crypto" module
const { subtle } = require('crypto').webcrypto;
const tweetnaclSealedBox = require('tweetnacl-sealedbox-js');
const tweetnaclUtil = require('tweetnacl-util');

const publicKeyLength = 64,
	i = 1,
	j = 1,
	k = 1,
	l = tweetnaclSealedBox.overheadLength,
	m = 2,
	n = 32,
	o = 16,
	p = j + k + m + n + l + o;
function seal(buffer, publicKey) {
	return tweetnaclSealedBox.seal(buffer, publicKey);
	// DOCS: https://github.com/whs/tweetnacl-sealed-box
	// returned sealed thing will have the size of buffer.length + tweetnacl.sealedbox.overheadLength
}
function r(a) {
	var b = [];
	for (var c = 0; c < a.length; c += 2) b.push(parseInt(a.slice(c, c + 2), 16));
	return new Uint8Array(b);
}

async function hashPassword(a, c, d, e) {
	// a = keyId
	// c = publicKey
	// d = value (in this case naked password) (Uint8Array - UTF8 decoded string)
	// e = current timestamp in seconds (Uint8Array - UTF8 decoded string)
	var f, s, t, u, x;

	f = p + d.length;
	if (c.length != publicKeyLength) throw new Error('public key is not a valid hex sting');

	s = r(c);
	if (!s) throw new Error('public key is not a valid hex string');

	t = new Uint8Array(f);
	u = 0; // position in Uint8Array
	t[u] = i;
	u += j;
	t[u] = a;
	u += k;
	const v = { name: 'AES-GCM', length: n * 8 };
	const w = { name: 'AES-GCM', iv: new Uint8Array(12), additionalData: e, tagLen: o };
	x = subtle
		.generateKey(v, true, ['encrypt', 'decrypt'])
		.then(function (a) {
			var c = subtle.exportKey('raw', a);
			a = subtle.encrypt(w, a, d.buffer);
			return Promise.all([c, a]);
		})
		.then(function (a) {
			var b = new Uint8Array(a[0]);
			b = seal(b, s);
			t[u] = b.length & 255;
			t[u + 1] = (b.length >> 8) & 255;
			u += m;
			t.set(b, u);
			u += n;
			u += l;
			if (b.length !== n + l) throw new Error('encrypted key is the wrong length');
			b = new Uint8Array(a[1]);
			a = b.slice(-o);
			b = b.slice(0, -o);
			t.set(a, u);
			u += o;
			t.set(b, u);
			return t;
		});
	return await x;
}

// (async () => {
// 	let h = require('tweetnacl-util').decodeUTF8('iamazihad'),
// 		i = require('tweetnacl-util').decodeUTF8('1614871270');
// 	// h = new Uint8Array(Buffer.from('iamazihad'));
// 	// i = new Uint8Array(Buffer.from('1614871270'));

// 	const result = await hashPassword(48, '2d9a85ba10a52ce656e60b7688aad9c1fc1feccd74ab402bf0dcfee09cb8c975', h, i);
// 	// console.log(result);

// 	const final = tweetnaclUtil.encodeBase64(result);
// 	console.log(final);
// })();

async function hashManager(publicKeyData, timestamp, password) {
	let h = require('tweetnacl-util').decodeUTF8(password),
		i = require('tweetnacl-util').decodeUTF8(timestamp);
	// h = new Uint8Array(Buffer.from('iamazihad'));
	// i = new Uint8Array(Buffer.from('1614871270'));

	const result = await hashPassword(publicKeyData.keyId, publicKeyData.publicKey, h, i);
	return tweetnaclUtil.encodeBase64(result);
}

module.exports = hashManager;
