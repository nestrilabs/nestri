export namespace Invite {
    /**
     * Generates a random invite code for teams
     * @param length The length of the invite code (default: 8)
     * @returns A string containing alphanumeric characters (excluding confusing characters)
     */
    export function generateCode(length: number = 8): string {
        // Use only unambiguous characters (no 0/O, 1/l/I confusion)
        const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';

        // Create a Uint32Array of the required length for randomness
        const randomValues = new Uint32Array(length);

        // Fill with cryptographically strong random values if available
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(randomValues);
        } else {
            // Fallback for environments without crypto
            for (let i = 0; i < length; i++) {
                randomValues[i] = Math.floor(Math.random() * 2 ** 32);
            }
        }

        // Use the random values to select characters
        for (let i = 0; i < length; i++) {
            result += characters.charAt(randomValues[i] % characters.length);
        }

        return result;
    }
}