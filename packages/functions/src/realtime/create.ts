import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
const client = new ECSClient()

export const handler = async (event: any) => {
    console.log("event", event)
    const clusterArn = process.env.ECS_CLUSTER
    const taskDefinitionArn = process.env.TASK_DEFINITION
    const authFingerprintKey = process.env.AUTH_FINGERPRINT

    try {

        const runResponse = await client.send(new RunTaskCommand({
            taskDefinition: taskDefinitionArn,
            cluster: clusterArn,
            count: 1,
            launchType: "EC2",
            overrides: {
                containerOverrides: [
                    {
                        name: "nestri",
                        environment: [
                            {
                                name: "AUTH_FINGERPRINT_KEY",
                                value: authFingerprintKey
                            },
                            {
                                name: "NESTRI_ROOM",
                                value: "testing-right-now"
                            }
                        ]
                    }
                ]
            }
        }))

        // Check if tasks were started
        if (!runResponse.tasks || runResponse.tasks.length === 0) {
            throw new Error("No tasks were started");
        }

        // Extract task details
        const task = runResponse.tasks[0];
        const taskArn = task?.taskArn!;
        const taskId = taskArn.split('/').pop()!; // Extract task ID from ARN
        const taskStatus = task?.lastStatus!;

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: "sent",
                taskId: taskId,
                taskStatus: taskStatus,
                taskArn: taskArn
            }, null, 2),
        };
    } catch (err) {
        console.error("Error starting task:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to start task" }, null, 2),
        };

    }
};