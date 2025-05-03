import { Hono } from "hono";
import { Result } from "./common";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";

export namespace TeamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Team"],
                summary: "List teams",
                description: "List the teams associated with the current user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Team.Info.array().openapi({
                                        description: "List of teams this user is part of",
                                        example: [Examples.Team]
                                    })
                                ),
                            },
                        },
                        description: "List of teams"
                    },
                }
            }),
            async (c) => {
                return c.json({
                    data: await Team.list()
                }, 200);
            },
        )

        //FIXME: Teams should and will be created for each Steam account
        // .post("/",
        //     describeRoute({
        //         tags: ["Team"],
        //         summary: "Create a team",
        //         description: "Create a team for the current user",
        //         responses: {
        //             200: {
        //                 content: {
        //                     "application/json": {
        //                         schema: Result(
        //                             z.object({
        //                                 checkoutUrl: z.string().openapi({
        //                                     description: "The checkout url to confirm subscription for this team",
        //                                     example: "https://polar.sh/checkout/2903038439320298377"
        //                                 })
        //                             })
        //                         )
        //                     }
        //                 },
        //                 description: "Team created succesfully"
        //             },
        //             400: ErrorResponses[400],
        //             409: ErrorResponses[409],
        //             429: ErrorResponses[429],
        //             500: ErrorResponses[500],
        //         }
        //     }),
        //     validator(
        //         "json",
        //         Team.create.schema
        //             .extend({ steamID: Steam.Info.shape.id })
        //             .partial({ slug: true })
        //             .openapi({
        //                 description: "Details of the team you want to create",
        //                 example: {
        //                     name: Examples.Team.name,
        //                     steamID: Examples.Member.steamID,
        //                     slug: Examples.Team.slug,
        //                     // machineID: Examples.Team.machineID,
        //                 },
        //             })
        //     ),
        //     async (c) => {
        //         const body = c.req.valid("json")

        //         let slug;
        //         if (!body.slug) {
        //             const account = await Steam.fromSteamID(body.steamID)
        //             if(account){

        //             }
        //         }


        //         const teamID = await Team.create({ name: body.name, slug: body.slug ??  });

        //         const userID = Actor.userID()
        //         await Actor.provide(
        //             "system",
        //             {
        //                 teamID
        //             },
        //             async () => {
        //                 await Member.create({
        //                     userID,
        //                     role: "adult", // We assume it is an adult for now
        //                     steamID: body.steamID,
        //                 });

        //                 // await Subscription.create({
        //                 //     planType: body.planType,
        //                 //     userID: actor.properties.userID,
        //                 //     // FIXME: Make this make sense
        //                 //     tokens: body.planType === "free" ? 100 : body.planType === "pro" ? 1000 : body.planType === "family" ? 10000 : 0,
        //                 // });
        //             }
        //         );

        //         // const checkoutUrl = await Polar.createCheckout({ planType: body.planType, successUrl: body.successUrl, teamID })

        //         // return c.json({
        //         //     data: {
        //         //         checkoutUrl,
        //         //     }
        //         // })
        //     }
        // )
}