/** the identification number of a Facebook user (it can be human, app or page) */
export type UserID = string | number;
export type FacebookUserGender = string | number; // still confused - it is not yet unified

// The facebook-chat-api package is inconsistent and give different results
// when `API.getUserInfo()` and `API.getFriendsList()` methods are called.

interface UserInfoRootObject {
	firstName: string;
	gender: FacebookUserGender;
	isBirthday: boolean;
	isFriend: boolean;
	/** The Url to Facebook profile of the user.
	 * @example `https://www.facebook.com/james.testing24 */
	profileUrl: string;
	/** The profile name of the user
	 * @example `james.testing24 */
	vanity: string;
	type: 'friend' | 'user' | 'page' | 'event' | 'app' | 'group' | string;
}

/** Information about a single Facebook user provided by the `API.getUserInfo()` method. */
export interface UserInfoGeneral extends UserInfoRootObject {
	name: string;
	/** The Url to profile picture of the user in low-resolution (32x32 px) */
	thumbSrc: string;
}
/** Inforamtion about multiple Facebook users returned by the `API.getUserInfo()` method. */
export type UserInfoGeneralDictByUserId = Map<UserID, UserInfoGeneral>;

/** Information about a single user marked as a friend. It is provided by the `API.getFriendsList()` method. */
export interface UserInfoWhenFriend extends UserInfoRootObject {
	userID: UserID;
	alternateName: string;
	fullName: string;
	profilePicture: string;
}
/** An array of the user information who are marked as friends.
 * It is provided by the `API.getFriendsList()` method. */
export type FriendsList = Array<UserInfoWhenFriend>;
