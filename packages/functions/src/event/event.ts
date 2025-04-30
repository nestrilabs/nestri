import { bus } from "sst/aws/bus";
import { User } from "@nestri/core/user/index";
import { Email } from "@nestri/core/email/index"

export const handler = bus.subscriber(
  [User.Events.Created],
  async (event) => {
    console.log(event.type, event.properties, event.metadata);
    switch (event.type) {
      case "user.created": {
        console.log("Send email here")
        // const actor = useActor()
        // if (actor.type !== "user") throw new Error("User actor is needed here")
        // await Email.send(
        //   "welcome",
        //   actor.properties.email,
        //   `Welcome to Nestri`,
        //   `Welcome to Nestri`,
        // )
        //     await Stripe.syncUser(event.properties.userID);
        //     break;
      }
    }
  },
);