import { bus } from "sst/aws/bus";
import { User } from "@nestri/core/user/index";
import { Email } from "@nestri/core/email/index"
// import { Stripe } from "@nestri/core/stripe";
// import { Template } from "@nestri/core/email/template";
// import { EmailOctopus } from "@nestri/core/email-octopus";

export const handler = bus.subscriber(
  [User.Events.Created],
  async (event) => {
    console.log(event.type, event.properties, event.metadata);
    switch (event.type) {
      //   case "order.created": {
      //     await Shippo.createShipment(event.properties.orderID);
      //     await Template.sendOrderConfirmation(event.properties.orderID);
      //     await EmailOctopus.addToCustomersList(event.properties.orderID);
      //     break;
      //   }
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
        //     // await EmailOctopus.addToMarketingList(event.properties.userID);
        //     break;
      }
    }
  },
);