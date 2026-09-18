import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Enrolment } from '@nestri/core/steam/enrolment';

/**
 * The user a host is allowed to speak about, or a refusal.
 *
 * One box carries several people's Steam sign-ins, so which user a batch
 * belongs to has to be said rather than inferred from the credentials — and
 * then checked, because a body field naming a user is otherwise a way to write
 * into any library. The enrolment record is what it is checked against:
 * holding a refresh token is what lets a host enumerate those games at all, so
 * a host without one is reporting something it could not have observed.
 *
 * Shared by the two sync routes deliberately. The check is the whole boundary
 * between "a host reporting what it can see" and "a host writing wherever it
 * likes", and two copies of it are two things to keep in agreement.
 */
export async function enrolledUser(userId: string): Promise<string> {
	const enrolment = await Enrolment.findByMachineAndUser({
		machineId: Actor.machineID,
		userId
	});
	if (!enrolment) {
		throw new VisibleError(
			'forbidden',
			ErrorCodes.Permission.FORBIDDEN,
			'This host holds no Steam sign-in for that user'
		);
	}
	return userId;
}
