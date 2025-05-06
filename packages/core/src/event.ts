import { Actor } from "./actor";
import { event } from "sst/event";
import { ZodValidator } from "sst/event/validator";

export const createEvent = event.builder({
  validator: ZodValidator,
  metadata() {
    return {
      actor: Actor.use(),
    };
  },
});