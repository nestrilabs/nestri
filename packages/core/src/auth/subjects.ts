import { createSubjects } from '@nestri/auth/subject';
import { z } from 'zod';

export const subjects = createSubjects({
	user: z.object({
		userID: z.string(),
		linkedAccountID: z.string(),
		fingerprint: z.string().optional()
	})
});
