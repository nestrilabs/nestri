import { z } from "zod"
import { Resource } from "sst";
import { doubleFn, fn } from "../utils";
import { AwsClient } from "aws4fetch";
import { DescribeTasksCommandOutput, StopTaskCommandOutput, type RunTaskCommandOutput } from "@aws-sdk/client-ecs";


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
                "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.RunTask",
                "Content-Type": "application/x-amz-json-1.1",
            },
            body: JSON.stringify(body)
        })

        return await res.json() as RunTaskCommandOutput
    })

    export const EcsDescribeTasks = fn(z.object({ tasks: z.string().array(), cluster: z.string() }), async (body) => {
        const c = await client();

        const url = new URL(`https://ecs.${c.region}.amazonaws.com/`)

        const res = await c.fetch(url, {
            method: "POST",
            headers: {
                "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.DescribeTasks",
                "Content-Type": "application/x-amz-json-1.1",
            },
            body: JSON.stringify(body)
        })

        return await res.json() as DescribeTasksCommandOutput
    })


    export const EcsStopTask = fn(z.object({
        cluster: z.string().optional(),
        reason: z.string().optional(),
        task: z.string()
    }), async (body) => {
        const c = await client();

        const url = new URL(`https://ecs.${c.region}.amazonaws.com/`)

        const res = await c.fetch(url, {
            method: "POST",
            headers: {
                "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.StopTask",
                "Content-Type": "application/x-amz-json-1.1",
            },
            body: JSON.stringify(body)
        })

        return await res.json() as StopTaskCommandOutput
    })

}


