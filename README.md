# ts-messenger-api

Unofficial API for Facebook Messenger. This package provides programmatic access to sending messages on behalf of actual user as opposed to just as a bot.

> ⚠ **Note:** _This package works only on **NodeJS v15** and higher!_

```ts
import facebookLogin from 'ts-messenger-api';

const api = await facebookLogin({ email: 'your.email@example.com', password: 'your_messenger_password' }, {});
const friends = await api.getFriendsList();
await api.sendMessage({ body: 'Hi there!' }, friends[0].userID);
```

## Features

The following table lists all features that are implemented or are destined to be implemented in the future. If you would like to have some feature implemented do not hesitate to submit PR.

| Feature                | Implemented |
| ---------------------- | :---------: |
| Login                  |      ✔      |
| Logout                 |     ❌      |
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
