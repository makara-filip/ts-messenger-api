/** the identification number of a Facebook user (it can be human, app or page) */
export type UserID = string | number;

export enum UserGender {
	Female,
	Male,
	Other,
	Unknown = -1
	// TODO: put appropriate number values
}

export interface UserInfo {
	/** unique FB user identifier */
	id: UserID;
	/** whole name of a person - first name & family name*/
	fullName: string;
	/** first name of a person */
	firstName: string;
	/** alternate name of a person (optional - new FB users don't have this name set by default) */
	alternateName?: string;

	gender: UserGender;
	/** whether is a person included in user's friends list */
	isFriend: boolean;
	/** whether is a person blocked by the user */
	isBlocked: boolean;

	/** URL to profile picture of the user in low resolution (32x32 px) */
	thumbSrc: string;
	/** URL to user's FB profile.
	 * @example 'https://www.facebook.com/james.testing24' */
	profileUrl: string;
	/** user's profile name @example 'james.testing24' */
	vanity: string;
	/** Type of FB account.
	 * @see {isFriend} property to indicate whether a person is friend of the singed in user. */
	type: 'friend' | 'user' | 'page' | 'event' | 'app' | 'group' | string;
}
