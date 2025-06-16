import { z } from "zod"
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
    user: z.object({
        email: z.string(),
        userID: z.string(),
    })
})