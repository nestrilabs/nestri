import { sshKey } from "./ssh";
import { authFingerprintKey } from "./auth";

export const ecsCluster = new aws.ecs.Cluster("NestriGPUCluster", {
    name: "NestriGPUCluster",
});

// Find the latest Ecs GPU AMI
const ami = aws.ec2.getAmi({
    filters: [
        {
            name: "name",
            values: ["amzn2-ami-ecs-gpu-hvm-*"], //Would have wanted to use BottleRocket instead, but we'd have to make so many sacrifices
        },
    ],
    mostRecent: true,
    owners: ["591542846629"], //amazon
});

const ecsInstanceRole = new aws.iam.Role("NestriGPUInstanceRole", {
    name: "GPUAssumeRoleProd",
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Principal: {
                Service: "ec2.amazonaws.com",
            },
            Effect: "Allow",
            Sid: "",
        }],
    }),
});

new aws.iam.RolePolicyAttachment("NestriGPUInstancePolicyAttachment", {
    role: ecsInstanceRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
});

const ecsInstanceProfile = new aws.iam.InstanceProfile("NestriGPUInstanceProfile", {
    role: ecsInstanceRole.name,
});

const server = new aws.ec2.Instance("NestriGPU", {
    instanceType: aws.ec2.InstanceType.G4dn_XLarge,
    ami: ami.then((ami) => ami.id),
    keyName: sshKey.keyName,
    //sudo nvidia-ctk runtime configure --runtime=docker [--set-as-default]
    userData: $interpolate`#!/bin/bash
sudo rm /etc/sysconfig/docker
echo DAEMON_MAXFILES=1048576 | sudo tee -a /etc/sysconfig/docker
echo DAEMON_PIDFILE_TIMEOUT=10 | sud o tee -a /etc/sysconfig/docker
echo OPTIONS="--default-ulimit nofile=32768:65536" | sudo tee -a /etc/sysconfig/docker
sudo tee "/etc/docker/daemon.json" > /dev/null <<EOF
{
    "default-runtime": "nvidia",
    "runtimes": {
        "nvidia": {
            "path": "/usr/bin/nvidia-container-runtime",
            "runtimeArgs": []
        }
    }
}
EOF
sudo systemctl restart docker
echo ECS_CLUSTER='${ecsCluster.name}' | sudo tee -a /etc/ecs/ecs.config
echo ECS_ENABLE_GPU_SUPPORT=true | sudo tee -a /etc/ecs/ecs.config
echo ECS_CONTAINER_STOP_TIMEOUT=3h | sudo tee -a /etc/ecs/ecs.config
echo ECS_ENABLE_SPOT_INSTANCE_DRAINING=true | sudo tee -a /etc/ecs/ecs.config
`,
    instanceMarketOptions: {
        marketType: "spot",
        spotOptions: {
            maxPrice: "0.2",
            spotInstanceType: "persistent",
            instanceInterruptionBehavior: "stop"
        },
    },
    iamInstanceProfile: ecsInstanceProfile,
});

const logGroup = new aws.cloudwatch.LogGroup("NestriGPULogGroup", {
    name: "/ecs/nestri-gpu-prod",
    retentionInDays: 7,
});

// Create a Task Definition for the ECS service to test it
export const gpuTaskDefinition = new aws.ecs.TaskDefinition("NestriGPUTask", {
    family: "NestriGPUTaskProd",
    requiresCompatibilities: ["EC2"],
    volumes: [
        {
            name: "host",
            hostPath: "/mnt/"
            // efsVolumeConfiguration: {
            //     fileSystemId: storage.id,
            //     authorizationConfig: { accessPointId: storage.accessPoint },
            //     transitEncryption: "ENABLED",
            // }
        }
    ],
    containerDefinitions: authFingerprintKey.result.apply(v => JSON.stringify([{
        "essential": true,
        "name": "nestri",
        "memory": 1024,
        "cpu": 200,
        "gpu": 1,
        "image": "ghcr.io/nestrilabs/nestri/runner:nightly",
        "environment": [
            {
                "name": "RESOLUTION",
                "value": "1920x1080"
            },
            {
                "name": "AUTH_FINGERPRINT",
                "value": v
            },
            {
                "name": "FRAMERATE",
                "value": "60"
            },
            {
                "name": "NESTRI_ROOM",
                "value": "aws-testing"
            },
            {
                "name": "RELAY_URL",
                "value": "https://relay.dathorse.com"
            },
            {
                "name": "NESTRI_PARAMS",
                "value": "--verbose=true --video-codec=h264 --video-bitrate=4000 --video-bitrate-max=6000 --gpu-card-path=/dev/dri/card0"
            },
        ],
        "mountPoints": [{ "containerPath": "/home/nestri", "sourceVolume": "host" }],
        "disableNetworking": false,
        "linuxParameter": {
            "sharedMemorySize": 5120
        },
        "logConfiguration": {
            "logDriver": "awslogs",
            "options": {
                "awslogs-group": "/ecs/nestri-gpu-prod",
                "awslogs-region": "us-east-1",
                "awslogs-stream-prefix": "nestri-gpu-task"
            }
        }
    }]))
});

sst.Linkable.wrap(aws.ecs.TaskDefinition, (resource) => ({
    properties: {
        value: resource.arn,
    },
}));

sst.Linkable.wrap(aws.ecs.Cluster, (resource) => ({
    properties: {
        value: resource.arn,
    },
}));

// This is used for requesting a container to be deployed on AWS
// const queue = new sst.aws.Queue("PartyQueue", { fifo: true });

// queue.subscribe({ handler: "packages/functions/src/party/subscriber.handler", permissions:{}, link:[taskF]})
// const authRes = $interpolate`${authFingerprintKey.result}`
