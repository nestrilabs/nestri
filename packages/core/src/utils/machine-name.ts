import { hostname } from 'os';
import { createHash } from 'crypto';

export function getSpoofedHostname(hostName?: string) {
    if (typeof hostName !== 'string') {
        let hash = createHash('sha1');
        hash.update(hostname());
        let sha1 = hash.digest();

        const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        let output = 'DESKTOP-';
        for (let i = 0; i < 7; i++) {
            output += CHARS[sha1[i] % CHARS.length];
        }
        return output;
    } else {
        let hash = createHash('sha1');
        hash.update(hostName);
        let sha1 = hash.digest();

        const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        let output = 'DESKTOP-';
        for (let i = 0; i < 7; i++) {
            output += CHARS[sha1[i] % CHARS.length];
        }
        return output;
    }
}