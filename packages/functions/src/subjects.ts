import * as v from "valibot"
import { Subscription } from "./type"
import { createSubjects } from "@openauthjs/openauth"

export const subjects = createSubjects({
  user: v.object({
    accessToken: v.string(),
    userID: v.string(),
    subscription: v.enum(Subscription)
  }),
  device: v.object({
    teamSlug: v.string(),
    hostname: v.string(),
  })
})