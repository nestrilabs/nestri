import { domain } from "./dns";
import { execSync } from "child_process";

// const vpc =  sst.aws.createTaskDefinition("Task",{})

new aws.ecs.Service('service', {
    name: 'awsfundamentals',
    cluster: cluster.arn,
    desiredCount: 1,
    launchType: 'FARGATE',
    taskDefinition: taskDefinition.arn,
    networkConfiguration: {
      assignPublicIp: true,
      subnets: subnets.map((s) => s.id),
      securityGroups: [securityGroup.id],
    },
    loadBalancers: [
      {
        // targetGroupArn: targetGroup.arn,
        containerName: 'backend',
        containerPort: 80,
      },
    ],
  });