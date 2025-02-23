import { bus } from "sst/aws/bus";
import { User } from "@nestri/core/user/index";
// import { Stripe } from "@nestri/core/stripe";
// import { Template } from "@nestri/core/email/template";
// import { EmailOctopus } from "@nestri/core/email-octopus";

export const handler = bus.subscriber(
  [User.Events.Updated, User.Events.Created],
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
    //     await Stripe.syncUser(event.properties.userID);
    //     // await EmailOctopus.addToMarketingList(event.properties.userID);
    //     break;
      }
    }
  },
);