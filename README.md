# ts-messenger-api

Unofficial API for Facebook Messenger. This package provides programmatic access to Facebook Messenger activity like sending and receiving messages on behalf of actual user.

> ⚠ **Note:** _This package works only on **NodeJS v15** and higher!_

> Since Facebook makes frequent modification to their API, please bear in mind, that this library is prone to developing bugs, that may not be immediately fixed.

## Installation

You can install the [package](https://www.npmjs.com/package/ts-messenger-api) with NPM:
```
npm i ts-messenger-api
```

## Quick Demo

```ts
import facebookLogin from 'ts-messenger-api';
// for plain JavaScript use this:
// const facebookLogin = require('ts-messenger-api').default;

const api = await facebookLogin({
  email: 'your.email@example.com',
  password: 'your_messenger_password'
});

const friends = await api.getFriendsList();

await api.listen();
await api.sendMessage({ body: 'Hi' }, friends[0].id);
```

## Message Sending

There are some examples of sending messages below. First of all, start with `await api.listen();` to establish a websocket connection.

### Plain text message

```typescript
api.sendMessage({ body: 'This' }, friends[3].id);
```

### Attachment message

Facebook automatically recognises file type (picture, video, audio or general file).

```typescript
import fs from 'fs';
api.sendMessage({ attachment: fs.createReadStream('path-to-file') }, friends[3].id);
// or send multiple attachments in one message
api.sendMessage(
  {
    attachment: [
      fs.createReadStream('path-to-file1'),
      fs.createReadStream('path-to-file2'),
      fs.createReadStream('path-to-file3')
    ]
  },
  friends[3].id
);
```

### Replying to a message

```typescript
api.sendMessage(
  {
    body: 'This is my reply to your question',
    replyToMessage: originalMessageId
  },
  friends[3].id
);
```

Similarly, you can send a message with mentions. The types for that are in the docs.

## Receiving messages and events

First of all, start with `await api.listen()` to establish a websocket connection.
You can access the `EventEmitter` by using the returned value of this function
or get it directly from `api.listener` property.

Posible event types are:

- `"message"` for all incoming messages and events (for listening to events,
  specify the `options` argument as `{listenEvents: true}` while login)
- `"presence"` for information about friends' active state
- `"typ"` for incoming typing indicators
- `"error"` for possible errors caused by websocket communication

```typescript
api.listener.addEventListener('message', (msg: AnyIncomingMessage) => console.log(msg));
api.listener.addEventListener('error', err => console.error(err));
```

> Type of an incoming message is defined in `msg.type`.

## Login with `AppState`

You can login to Facebook account for the second time without the need to provide login
credentials (email and password). This feature is provided with `AppState` (array of
cookies provided by Facebook). We advise you to save the AppState right after first
successful login using:

```typescript
// after first login
fs.writeFileSync('./appState.json', JSON.stringify(api.getAppState()));
```

Now you can use the saved cookies to log in later.

```typescript
// using the saved AppState
let api: Api | null = null;
try {
  api = (await login(
    {
      appState: JSON.parse(fs.readFileSync('./appState.json').toString())
    },
    { listenEvents: true }
  )) as Api;
} catch (error) {
  // something like `console.error(error);`
}
```

## Docs

You can find the documentation [here](https://makiprogrammer.github.io/ts-messenger-api/index.html).

## Features

The following table lists all features that are implemented or are destined to be implemented in the future. If you would like to have some feature implemented do not hesitate to submit PR.

| Feature                | Implemented |
| ---------------------- | :---------: |
| Login                  |      ✔      |
| Logout                 |      ✔      |
| Get app state          |      ✔      |
| **Messages**           |
| Send message           |      ✔      |
| Unsend message         |      ✔      |
| Delete message         |     ❌      |
| Forward attachment     |      ✔      |
| Set message reaction   |      ✔      |
| Send typing indicator  |      ✔      |
| **Users**              |
| Get friends list       |      ✔      |
| Get user ID            |     ❌      |
| Get user info          |      ✔      |
| **Threads**            |
| Get thread list        |     ❌      |
| Get thread info        |      ✔      |
| Get thread history     |      ✔      |
| Get thread pictures    |     ❌      |
| Delete thread          |     ❌      |
| Mute thread            |     ❌      |
| Search for thread      |     ❌      |
| **Customisation**      |
| Change thread colour   |      ✔      |
| Change thread emoji    |      ✔      |
| **Group management**   |
| Add user to group      |      ✔      |
| Remove user from group |      ✔      |
| Leave group            |      ✔      |
| Change admin status    |      ✔      |
| Change group image     |      ✔      |
| Change group title     |      ✔      |
| Change nickname        |     ❌      |
| Create poll            |     ❌      |
|                        |
| Mark as read           |      ✔      |
| Mark as read all       |     ❌      |
|                        |
| Change archived status |     ❌      |
| Change blocked status  |     ❌      |
