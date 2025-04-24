// utils/encryption.ts
import crypto from 'crypto';
import { Resource } from 'sst';

const ENCRYPTION_KEY = Resource.SteamEncryptionKey.value; // Must be 32 bytes (256 bits)
const ENCRYPTION_IV_LENGTH = 16;

// Encrypt token before storing in database
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Store IV and auth tag with the encrypted data
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

// Decrypt token when retrieving from database
export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encryptedData] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}