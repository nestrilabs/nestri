import * as v from "valibot"
import { createSubjects } from "@openauthjs/openauth"

export const subjects = createSubjects({
  user: v.object({
    accessToken: v.string(),
    userID: v.string(),
  }),
})