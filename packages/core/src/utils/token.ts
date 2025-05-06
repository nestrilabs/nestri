import crypto from 'crypto';
import { Resource } from 'sst';
import { fn } from './fn';
import { z } from 'zod';

const ENCRYPTION_KEY = Resource.SteamEncryptionKey.value; // Must be 32 bytes (256 bits)
const ENCRYPTION_IV_LENGTH = 16;


export namespace Token {
    export const encrypt = fn(
        z.string().min(4),
        (token) => {
            try {
                const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
                const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);

                let encrypted = cipher.update(token, 'utf8', 'hex');
                encrypted += cipher.final('hex');

                const authTag = cipher.getAuthTag();

                // Store IV and auth tag with the encrypted data
                return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;

            } catch (error) {
                console.error('Encryption failed:', error);
                throw new Error('Failed to encrypt data');
            }
        }
    )

    export const decrypt = fn(
        z.string().min(4),
        (encryptedToken) => {
            try {
                const [ivHex, authTagHex, encryptedData] = encryptedToken.split(':');

                if (!ivHex || !authTagHex || !encryptedData) {
                    throw new Error('Invalid encrypted format');
                }

                const iv = Buffer.from(ivHex, 'hex');
                const authTag = Buffer.from(authTagHex, 'hex');

                const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
                decipher.setAuthTag(authTag);

                let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
                decrypted += decipher.final('utf8');

                return decrypted;

            } catch (error) {
                console.error('Decryption failed:', error);
                throw new Error('Failed to decrypt data');
            }
        }
    )
}