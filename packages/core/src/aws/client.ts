import { z } from "zod"
import { Resource } from "sst";
import { doubleFn, fn } from "../utils";
import { AwsClient } from "aws4fetch";

export module Aws {
    export const client = async () => {
        return new AwsClient({
            accessKeyId: Resource.AwsAccessKey.value,
            secretAccessKey: Resource.AwsSecretKey.value,
            region: "us-east-1",
        });
    }

    export const EcsRunTask = fn(z.object({
        cluster: z.string(),
        count: z.number(),
        taskDefinition: z.string(),
        launchType: z.enum(["EC2", "FARGATE"]),
        overrides: z.object({
            containerOverrides: z.object({
                name: z.string(),
                environment: z.object({
                    name: z.string(),
                    value: z.string().or(z.number())
                }).array()
            }).array()
        })
    }), async (body) => {

        const c = await client();

        const url = new URL(`https://ecs.${c.region}.amazonaws.com/`)
        
        const res = await c.fetch(url, {
            method: "POST",
            headers: {
                "X-Amz-Target": `AmazonEC2ContainerServiceV20141113.RunTask`,
                "Content-Type": "application/x-amz-json-1.1",
            },
            body: JSON.stringify(body)
        }).then(r => r.json())

        return res
    })
}
