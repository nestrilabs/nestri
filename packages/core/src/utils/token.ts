import { z } from 'zod';
import { fn } from './fn';
import crypto from 'crypto';
import { Resource } from 'sst';

// This is a 32-character random ASCII string
const rawKey = Resource.SteamEncryptionKey.value;

// Turn it into exactly 32 bytes via UTF-8
const key = Buffer.from(rawKey, 'utf8');
if (key.length !== 32) {
    throw new Error(
        `SteamEncryptionKey must be exactly 32 bytes; got ${key.length}`
    );
}

const ENCRYPTION_IV_LENGTH = 12; // 96 bits for GCM

export namespace Token {
    export const encrypt = fn(
        z.string().min(4),
        (token) => {
            const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

            const ciphertext = Buffer.concat([
                cipher.update(token, 'utf8'),
                cipher.final(),
            ]);
            const tag = cipher.getAuthTag();

            return ['v1', iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(':');
        });

    export const decrypt = fn(
        z.string().min(4),
        (data) => {
            const [version, ivHex, tagHex, ciphertextHex] = data.split(':');
            if (version !== 'v1' || !ivHex || !tagHex || !ciphertextHex) {
                throw new Error('Invalid token format');
            }

            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const ciphertext = Buffer.from(ciphertextHex, 'hex');

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);

            const plaintext = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]);

            return plaintext.toString('utf8');
        });
        
}