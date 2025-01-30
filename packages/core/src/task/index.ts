import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { Aws } from "../aws/client";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database"
import { useCurrentUser } from "../actor";
import { id as createID } from "@instantdb/admin";
import { groupBy, map, pipe, values } from "remeda"

export const lastStatus = z.enum([
    "RUNNING",
    "PENDING",
    "UNKNOWN",
    "STOPPED",
]);

export const taskType = z.enum([
    "AWS",
    "ON_PREMISES",
    "UNKNOWN"
]);

export const healthStatus = z.enum([
    "HEALTHY",
    "UNHEALTHY",
    "UNKNOWN",
]);

export type taskType = z.infer<typeof taskType>;
export type lastStatus = z.infer<typeof lastStatus>;
export type healthStatus = z.infer<typeof healthStatus>;

export module Tasks {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Task.id,
            }),
            type: taskType.openapi({
                description: "Where this task is hosted on",
                example: Examples.Task.type,
            }),
            startedAt: z.string().or(z.number()).openapi({
                description: "The time this task was started",
                example: Examples.Task.startedAt,
            }),
            lastUpdated: z.string().or(z.number()).openapi({
                description: "The time the information about this task was last updated",
                example: Examples.Task.lastUpdated,
            }),
            stoppedAt: z.string().or(z.number()).optional().openapi({
                description: "The time this task was stopped or quit",
                example: Examples.Task.lastUpdated,
            }),
            lastStatus: lastStatus.openapi({
                description: "The last registered status of this task",
                example: Examples.Task.lastStatus,
            }),
            healthStatus: healthStatus.openapi({
                description: "The health status of this task",
                example: Examples.Task.healthStatus,
            })
        })
        .openapi({
            ref: "Subscription",
            description: "Subscription to a Nestri product.",
            example: Examples.Task,
        });

    export type Info = z.infer<typeof Info>;

    export const list = async () => {
        const db = databaseClient()
        const user = useCurrentUser()

        try {
            const query = {
                tasks: {
                    $: {
                        where: {
                            stoppedAt: { $isNull: true },
                            owner: user.id
                        }
                    },
                }
            }

            const data = await db.query(query)

            const response = data.tasks
            if (!response || response.length === 0) {
                throw new Error("No task for this user were found");
            }

            const result = pipe(
                response,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    type: group[0].type as taskType,
                    lastStatus: group[0].lastStatus as lastStatus,
                    healthStatus: group[0].healthStatus as healthStatus,
                    startedAt: group[0].startedAt,
                    stoppedAt: group[0].stoppedAt,
                    lastUpdated: group[0].lastUpdated,
                }))
            )

            return result
        } catch (e) {
            return null
        }
    }

    export const create = async () => {
        const user = useCurrentUser()

        try {

            const runResponse = await Aws.EcsRunTask({
                count: 1,
                cluster: Resource.Hosted.value,
                taskDefinition: Resource.NestriGPUTask.value,
                launchType: "EC2",
                overrides: {
                    containerOverrides: [
                        {
                            name: "nestri",
                            environment: [
                                {
                                    name: "NESTRI_ROOM",
                                    value: "testing-right-now"
                                }
                            ]
                        }
                    ]
                }
            }) as any

            console.log("RunTask Failures", runResponse["Failures"] as any)
            // Validate response structure
            if (!('tasks' in runResponse)) {
                throw new Error("Invalid API response - missing tasks field");
            }
            
            // Check if tasks were started
            if (!runResponse.tasks || runResponse.tasks.length === 0 || (runResponse.failures && runResponse.failures.length > 0)) {
                console.error("task failures", runResponse.failures)
                console.log("tasks", runResponse)
                throw new Error(`No tasks were started`);
            }

            // Extract task details
            const task = runResponse.tasks[0];
            const taskArn = task?.taskArn!;
            const taskId = taskArn.split('/').pop()!; // Extract task ID from ARN
            const taskStatus = task?.lastStatus;
            const taskHealthStatus = task?.healthStatus;
            const startedAt = task?.startedAt!;

            // const id = createID()
            const db = databaseClient()
            const now = new Date().toISOString()
            await db.transact(db.tx.tasks[taskId]!.update({
                type: "AWS",
                healthStatus: taskHealthStatus ? taskHealthStatus.toString() : "UNKNOWN",
                startedAt: startedAt ? startedAt.toISOString() : now,
                lastStatus: taskStatus,
                lastUpdated: now,
            }).link({ owner: user.id }))

            return "ok"
        } catch (e) {
            console.error("error", e)
            return null
        }
    }

    export const fromID = fn(z.string(), async (taskID) => {
        const db = databaseClient()
        try {
            const query = {
                tasks: {
                    $: {
                        where: {
                            id: taskID,
                            stoppedAt: { $isNull: true }
                        }
                    },
                }
            }

            const data = await db.query(query)

            const response = data.tasks
            if (!response || response.length === 0) {
                throw new Error("No task with the given id was found");
            }

            const result = pipe(
                response,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    type: group[0].type as taskType,
                    lastStatus: group[0].lastStatus as lastStatus,
                    healthStatus: group[0].healthStatus as healthStatus,
                    startedAt: group[0].startedAt,
                    stoppedAt: group[0].stoppedAt,
                    lastUpdated: group[0].lastUpdated,
                }))
            )

            return result

        } catch (error) {
            return null
        }
    })

    export const update = fn(z.string(), async (taskID) => {
        try {
            // const client = new ECSClient({ credentials: getAwsCredentials() })
            // const db = databaseClient()

            // const describeResponse = await client.send(new DescribeTasksCommand({ tasks: [taskID] }))
            // const now = new Date().toISOString()

            // if (!describeResponse.tasks || describeResponse.tasks.length === 0) {
            //     throw new Error("No tasks were found");
            // }

            // const task = describeResponse.tasks[0]!

            // await db.transact(db.tx.tasks[taskID]!.update({
            //     healthStatus: task.healthStatus ? task.healthStatus : "UNKNOWN",
            //     lastStatus: task.lastStatus ? task.lastStatus : "UNKNOWN",
            //     lastUpdated: now,
            // }))

            return "ok"

        } catch (error) {
            return null
        }
    })

    export const remove = fn(z.string(), async (taskID) => {
        const db = databaseClient()
        const now = new Date().toISOString()
        // const client = new ECSClient({ credentials: getAwsCredentials() })
        try {
            //     const query = {
            //         tasks: {
            //             $: {
            //                 where: {
            //                     id: taskID,
            //                     stoppedAt: { $isNull: true }
            //                 }
            //             },
            //         }
            //     }

            //     const data = await db.query(query)

            //     const response = data.tasks
            //     if (!response || response.length === 0) {
            //         throw new Error("No task with the given id was found");
            //     }

            //     const stopResponse = await client.send(new StopTaskCommand({
            //         task: taskID,
            //         cluster: Resource.Hosted.value,
            //         reason: "Client requested a shutdown"
            //     }))

            //     await db.transact(db.tx.tasks[taskID]!.update({
            //         stoppedAt: now,
            //         lastUpdated: now,
            //         lastStatus: "STOPPED",
            //         healthStatus: "UNKNOWN"
            //     }))

            return "ok"

        } catch (error) {
            return null
        }
    })
}