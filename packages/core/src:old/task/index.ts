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
import { Sessions } from "../session";

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
            taskID: z.string().openapi({
                description: "The id of this task as seen on AWS",
                example: Examples.Task.taskID,
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
                    taskID: group[0].taskID,
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

            //TODO: Use a simpler way to set the session ID
            // const sessionID = createID()

            const sessionID = await Sessions.create({ public: true })
            if (!sessionID) throw new Error("No session id was given");

            const run = await Aws.EcsRunTask({
                count: 1,
                cluster: Resource.NestriGPUCluster.value,
                taskDefinition: Resource.NestriGPUTask.value,
                launchType: "EC2",
                overrides: {
                    containerOverrides: [
                        {
                            name: "nestri",
                            environment: [
                                {
                                    name: "NESTRI_ROOM",
                                    value: sessionID
                                }
                            ]
                        }
                    ]
                }
            })

            if (!run.tasks || run.tasks.length === 0) {
                throw new Error(`No tasks were started`);
            }

            // Extract task details
            const task = run.tasks[0];
            const taskArn = task?.taskArn!;
            const taskId = taskArn.split('/').pop()!; // Extract task ID from ARN
            const taskStatus = task?.lastStatus;
            const taskHealthStatus = task?.healthStatus;
            const startedAt = task?.startedAt!;

            const id = createID()
            const db = databaseClient()
            const now = new Date().toISOString()
            await db.transact(db.tx.tasks[id]!.update({
                taskID: taskId,
                type: "AWS",
                healthStatus: taskHealthStatus ? taskHealthStatus.toString() : "UNKNOWN",
                startedAt: startedAt ? startedAt.toISOString() : now,
                lastStatus: taskStatus,
                lastUpdated: now,
            }).link({ owner: user.id, sessions: sessionID }))

            return id
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
                    taskID: group[0].taskID,
                    type: group[0].type as taskType,
                    lastStatus: group[0].lastStatus as lastStatus,
                    healthStatus: group[0].healthStatus as healthStatus,
                    startedAt: group[0].startedAt,
                    stoppedAt: group[0].stoppedAt,
                    lastUpdated: group[0].lastUpdated,
                }))
            )

            return result[0]

        } catch (error) {
            return null
        }
    })

    export const update = fn(z.string(), async (taskID) => {
        try {
            const db = databaseClient()

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
                throw new Error("No task with the given taskID was found");
            }

            const now = new Date().toISOString()
            const describeResponse = await Aws.EcsDescribeTasks({
                tasks: [response[0]!.taskID],
                cluster: Resource.NestriGPUCluster.value
            })

            if (!describeResponse.tasks || describeResponse.tasks.length === 0) {
                throw new Error("No tasks were found");
            }

            const task = describeResponse.tasks[0]!

            const updatedDb = {
                healthStatus: task.healthStatus ? task.healthStatus : "UNKNOWN",
                lastStatus: task.lastStatus ? task.lastStatus : "UNKNOWN",
                lastUpdated: now,
            }

            await db.transact(db.tx.tasks[response[0]!.id]!.update({
                ...updatedDb
            }))

            const updatedRes = [{ ...response[0]!, ...updatedDb }]

            const result = pipe(
                updatedRes,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    taskID: group[0].taskID,
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
            console.error("update error", error)
            return null
        }
    })

    export const stop = fn(z.object({ taskID: z.string(), id: z.string() }), async (input) => {
        const db = databaseClient()
        const now = new Date().toISOString()
        try {
            //TODO:Check whether they own this task first

            const stopResponse = await Aws.EcsStopTask({
                task: input.taskID,
                cluster: Resource.NestriGPUCluster.value,
                reason: "Client requested a shutdown"
            })

            if (!stopResponse.task) {
                throw new Error(`No task was stopped`);
            }

            await db.transact(db.tx.tasks[input.id]!.update({
                stoppedAt: now,
                lastUpdated: now,
                lastStatus: "STOPPED",
                healthStatus: "UNKNOWN"
            }))

            return "ok"

        } catch (error) {
            console.error("stop error", error)
            return null
        }
    })
}