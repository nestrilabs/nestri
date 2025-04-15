import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { assertActor, useTeam, useUserID } from "../actor";
import { Polar as PolarSdk } from "@polar-sh/sdk";
import { PlanType } from "../subscription/subscription.sql";

const polar = new PolarSdk({ accessToken: Resource.PolarSecret.value, server: Resource.App.stage !== "production" ? "sandbox" : "production" });
const planType = z.enum(PlanType)
export namespace Polar {
    export const client = polar;

    export const fromUserEmail = fn(z.string().min(1), async (email) => {
        try {
            const customers = await client.customers.list({ email })

            if (customers.result.items.length === 0) {
                return await client.customers.create({ email })
            } else {
                return customers.result.items[0]
            }

        } catch (err) {
            //FIXME: This is the issue [Polar.sh/#5147](https://github.com/polarsource/polar/issues/5147)
            // console.log("error", err)
            return undefined
        }
    })

    const getProductIDs = (plan: z.infer<typeof planType>) => {
        switch (plan) {
            case "free":
                return [Resource.NestriFreeMonthly.value]
            case "pro":
                return [Resource.NestriProYearly.value, Resource.NestriProMonthly.value]
            case "family":
                return [Resource.NestriFamilyYearly.value, Resource.NestriFamilyMonthly.value]
            default:
                return [Resource.NestriFreeMonthly.value]
        }
    }

    export const createPortal = fn(
        z.string(),
        async (customerId) => {
            const session = await client.customerSessions.create({
                customerId
            })

            return session.customerPortalUrl
        }
    )

    export const createCheckout = fn(
        z
            .object({
                planType: z.enum(PlanType),
                customerEmail: z.string(),
                successUrl: z.string(),
                customerID: z.string(),
                allowDiscountCodes: z.boolean(),
                teamID: z.string()
            })
            .partial({
                customerEmail: true,
                allowDiscountCodes: true,
                customerID: true,
                teamID: true
            }),
        async (input) => {
            const productIDs = getProductIDs(input.planType)

            const checkoutUrl =
                await client.checkouts.create({
                    products: productIDs,
                    customerEmail: input.customerEmail ?? useUserID(),
                    successUrl: `${input.successUrl}?checkout={CHECKOUT_ID}`,
                    allowDiscountCodes: input.allowDiscountCodes ?? false,
                    customerId: input.customerID,
                    customerMetadata: {
                        teamID: input.teamID ?? useTeam()
                    }
                })

            return checkoutUrl.url
        })
}