import { JWTPayload, jwtVerify, KeyLike, SignJWT } from 'jose';

export namespace jwt {
	export function create(payload: JWTPayload, algorithm: string, privateKey: KeyLike) {
		return new SignJWT(payload)
			.setProtectedHeader({ alg: algorithm, typ: 'JWT', kid: 'sst' })
			.sign(privateKey);
	}

	export function verify<T>(token: string, publicKey: KeyLike) {
		return jwtVerify<T>(token, publicKey);
	}
}
