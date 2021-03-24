/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { UserGender, UserID, UserInfo } from '../types/users';

export function formatUserInfoDict(userProfiles: any): Record<UserID, UserInfo> {
	const finalObject: Record<UserID, UserInfo> = {};
	for (const key of Object.keys(userProfiles)) {
		const parsedKey = parseInt(key);
		if (!parsedKey)
			throw new Error(
				`There was an unknown response. Contact the dev team about this (error code 935520). User profiles: ${JSON.stringify(
					userProfiles
				)}`
			);
		// filter out some (possibly) hidden accounts - they nevertheless contain no useful information
		if (userProfiles[key].id == 0) continue;

		finalObject[parsedKey] = {
			id: parseInt(userProfiles[key].id),

			fullName: userProfiles[key].name,
			firstName: userProfiles[key].firstName,
			alternateName: userProfiles[key].alternateName || undefined,
			gender: getGender(userProfiles[key].gender),

			isFriend: userProfiles[key].is_friend,
			isBlocked: userProfiles[key].is_blocked,

			thumbSrc: userProfiles[key].thumbSrc,
			profileUrl: userProfiles[key].uri,
			type: userProfiles[key].type,
			vanity: userProfiles[key].vanity || undefined
		};
	}
	return finalObject;
}

function getGender(gender: any): UserGender {
	switch (gender) {
		case 1:
			return UserGender.Female;
		case 2:
			return UserGender.Male;
		case 6:
			return UserGender.Other;
		default:
			return UserGender.Unknown;
	}
}
