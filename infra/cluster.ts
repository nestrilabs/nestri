const ecsCluster = new aws.ecs.Cluster("Hosted", {
    name: "NestriGPUCluster"
});

export const key = new tls.PrivateKey("SSHKey", {
    algorithm: "ED25519",
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
    name: "GPUAssumeRole",
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

const ecsInstancePolicyAttachment = new aws.iam.RolePolicyAttachment("NestriGPUInstancePolicyAttachment", {
    role: ecsInstanceRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
});

const ecsInstanceProfile = new aws.iam.InstanceProfile("NestriGPUInstanceProfile", {
    role: ecsInstanceRole.name,
});

// Just in case you want to SSH
const sshKey = new aws.ec2.KeyPair("NestriGPUKey", {
    keyName:"NestriGPUKey",
    publicKey: key.publicKeyPem.apply((ssh) => ssh.trim())
})

const server = new aws.ec2.Instance("NestriGPU", {
    instanceType: aws.ec2.InstanceType.G4dn_XLarge,
    ami: ami.then((ami) => ami.id),
    keyName: sshKey.keyName,
    userData: $interpolate`#!/bin/bash
echo ECS_CLUSTER='${ecsCluster.name}' >> /etc/ecs/ecs.config
echo ECS_RESERVED_MEMORY=256 >> /etc/ecs/ecs.config
echo ECS_RESERVED_MEMORY=300 >> /etc/ecs/ecs.config
echo ECS_CONTAINER_STOP_TIMEOUT=3h >> /etc/ecs/ecs.config
echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config
echo ECS_ENABLE_SPOT_INSTANCE_DRAINING=true >> /etc/ecs/ecs.config
sudo rm /etc/sysconfig/docker
echo DAEMON_MAXFILES=1048576 | sudo tee -a /etc/sysconfig/docker
echo OPTIONS="--default-ulimit nofile=32768:65536 --default-runtime nvidia" | sudo tee -a /etc/sysconfig/docker
echo DAEMON_PIDFILE_TIMEOUT=10 | sudo tee -a /etc/sysconfig/docker
sudo systemctl restart docker
`,
    // instanceMarketOptions: {
    //     marketType: "spot",
    //     spotOptions: {
    //         maxPrice: "0.2",
    //         spotInstanceType: "persistent",
    //         instanceInterruptionBehavior: "stop"
    //     },
    // },
    iamInstanceProfile: ecsInstanceProfile,
});

const logGroup = new aws.cloudwatch.LogGroup("NestriGPULogGroup", {
    name: "/ecs/bottlerocket",
    retentionInDays: 7,
});

// Create a Task Definition for the ECS service to test it
const nestriTask = new aws.ecs.TaskDefinition("NestriGPUTask", {
    family: "ecsTest",
    requiresCompatibilities: ["EC2"],
    containerDefinitions: JSON.stringify([{
        "essential": true,
        "name": "nestri",
        "memory": 1024,
        "cpu": 200,
        "image": "ghcr.io/nestrilabs/nestri/runner:nightly",
        "resourceRequirements": [
            {
                type: "GPU",
                value: "1"
            }
        ],
        "environment": [
            {
                name: "NESTRI_ROOM",
                value: "awstesting"
            },
            {
                name: "RESOLUTION",
                value: "1920x1080"
            },
            {
                name: "FRAMERATE",
                value: "60"
            },
            {
                name: "NVIDIA_DRIVER_CAPABILITIES",
                value: "all"
            },
            {
                name: "RELAY_URL",
                value: "https://relay.dathorse.com"
            },
            {
                name: "NESTRI_PARAMS",
                value: "--verbose=true --video-codec=h264 --video-bitrate=4000 --video-bitrate-max=6000 --gpu-card-path=/dev/dri/card1"
            },
        ],
        "disableNetworking": false,
        "linuxParameter": {
            sharedMemorySize: 5120
        },
        "logConfiguration": {
            "logDriver": "awslogs",
            "options": {
                "awslogs-group": "/ecs/bottlerocket",
                "awslogs-region": "us-east-1",
                "awslogs-stream-prefix": "demo-gpu"
            }
        }
    }])
});