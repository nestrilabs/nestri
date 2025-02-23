import * as v from "valibot"
import { Subscription } from "./type"
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    email: v.string(),
    userID: v.string(),
  }),
  // device: v.object({
  //   teamSlug: v.string(),
  //   hostname: v.string(),
  // })
})