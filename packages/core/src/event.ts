import { event } from "sst/event";
import { ZodValidator } from "sst/event/validator";
import { Actor } from "./actor";

export const createEvent = event.builder({
  validator: ZodValidator,
  metadata() {
    return {
      actor: Actor.use(),
    };
  },
});