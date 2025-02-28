import * as v from "valibot"
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    email: v.string(),
    userID: v.string(),
  }),
  task: v.object({
    hostname: v.string(),
    taskID: v.string(),
  })
})