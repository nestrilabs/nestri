import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { Polar as PolarSdk } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";

const polar = new PolarSdk({
    accessToken: Resource.PolarSecret.value,
    server: Resource.App.stage !== "production" ? "sandbox" : "production"
});

export namespace Polar {
    export const client = polar;

    export const fromUserEmail = fn(z.string().min(1), async (email) => {
        try {
            const customers = await client.customers.list({ email })

            if (customers.result.items.length === 0) {
                return await client.customers.create({ email})
            } else {
                return customers.result.items[0]
            }

        } catch (err) {
            //FIXME: This is the issue [Polar.sh/#5147](https://github.com/polarsource/polar/issues/5147)
            // console.log("error", err)
            return undefined
        }
    })

    // const getProductIDs = (plan: z.infer<typeof planType>) => {
    //     switch (plan) {
    //         case "free":
    //             return [Resource.NestriFreeMonthly.value]
    //         case "pro":
    //             return [Resource.NestriProYearly.value, Resource.NestriProMonthly.value]
    //         case "family":
    //             return [Resource.NestriFamilyYearly.value, Resource.NestriFamilyMonthly.value]
    //         default:
    //             return [Resource.NestriFreeMonthly.value]
    //     }
    // }

    export const createPortal = fn(
        z.string(),
        async (customerId) => {
            const session = await client.customerSessions.create({
                customerId
            })

            return session.customerPortalUrl
        }
    )

    //TODO: Implement this
    export const handleWebhook = async (payload: ReturnType<typeof validateEvent>) => {
        switch (payload.type) {
            case "subscription.created":
                const teamID = payload.data.metadata.teamID
        }
    }
}