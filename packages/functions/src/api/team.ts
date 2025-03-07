import { Hono } from "hono";
import { notPublic } from "./auth";
import {Team} from "@nestri/core/team/index"
import { Result } from "../common.ts";
import {Examples} from "@nestri/core/examples"
import { z } from "zod";
import { User } from "@nestri/core/user";

export namespace TeamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Account"],
                summary: "Retrieve the current user's teams",
                description: "Returns the user's teams they have joined",
                responses:{
                  200:{
                    content:{
                      "application/json":{
                        schema: Result(
                          Team.Info.array().openapi({
                            example:[Examples.Team],
                            description:"List of teams this user has joined"
                          })
                        ),
                      }
                    }
                  }
                }
            })
        )
}