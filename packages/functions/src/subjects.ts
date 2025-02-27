import * as v from "valibot"
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    email: v.string(),
    userID: v.string(),
  }),
  machine: v.object({
    machineID: v.string()
  })
})