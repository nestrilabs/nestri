import { resolve } from "path";
import { writeFileSync } from "fs";

const ecsCluster = new aws.ecs.Cluster("Hosted", {
    name: "NestriGPUCluster"
});

const privateKey = new tls.PrivateKey("NestriGPUPrivateKey", {
    algorithm: "RSA",
    rsaBits: 4096,
});

// // Find the latest Ecs GPU AMI
// // FIXME: Problematic for Nestri GPU
// const ami = aws.ec2.getAmi({
//     filters: [
//         {
//             name: "name",
//             values: ["amzn2-ami-ecs-gpu-hvm-*"], //Would have wanted to use BottleRocket instead, but we'd have to make so many sacrifices
//         },
//     ],
//     mostRecent: true,
//     owners: ["591542846629"], //amazon
// });

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
    keyName: "NestriGPUKey",
    publicKey: privateKey.publicKeyOpenssh
})

const keyPath = privateKey.privateKeyOpenssh.apply((key) => {
    const path = "key_rsa";
    writeFileSync(path, key, { mode: 0o600 });
    return resolve(path);
});


const server = new aws.ec2.Instance("NestriGPU", {
    instanceType: aws.ec2.InstanceType.G4dn_XLarge,
    // ami: ami.then((ami) => ami.id),
    ami: "ami-06835d15c4de57810",
    keyName: sshKey.keyName,
    userData: $interpolate`#!/bin/bash
sudo usermod -aG docker ubuntu
newgrp docker
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
curl -O https://s3.us-east-1.amazonaws.com/amazon-ecs-agent-us-east-1/amazon-ecs-init-latest.amd64.deb
sudo dpkg -i amazon-ecs-init-latest.amd64.deb
echo ECS_CLUSTER='${ecsCluster.name}' | sudo tee -a /etc/ecs/ecs.config
echo ECS_ENABLE_GPU_SUPPORT=true | sudo tee -a /etc/ecs/ecs.config
echo ECS_CONTAINER_STOP_TIMEOUT=3h | sudo tee -a /etc/ecs/ecs.config
sudo systemctl enable ecs
sudo systemctl start ecs
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

// echo ECS_ENABLE_AWSLOGS_EXECUTIONROLE_OVERRIDE=true | sudo tee -a /etc/ecs/ecs.config
// echo ECS_LOG_DRIVER=awslogs | sudo tee -a /etc/ecs/ecs.config

// sudo mkdir -p /etc/sysconfig/
// echo DAEMON_MAXFILES=1048576 | sudo tee -a /etc/sysconfig/docker
// echo OPTIONS="--default-ulimit nofile=32768:65536 --default-runtime nvidia" | sudo tee -a /etc/sysconfig/docker
// echo DAEMON_PIDFILE_TIMEOUT=10 | sudo tee -a /etc/sysconfig/docker
// sudo systemctl restart docker

// echo ECS_ENABLE_GPU_SUPPORT=true | sudo tee -a /etc/ecs/ecs.config
// echo ECS_ENABLE_CONTAINER_METADATA=true | sudo tee -a /etc/ecs/ecs.config
// echo ECS_ENABLE_SPOT_INSTANCE_DRAINING=true | sudo tee -a /etc/ecs/ecs.config

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
        "gpu": 1,
        "image": "ghcr.io/nestrilabs/nestri/runner:nightly",
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
                value: "'--verbose=true --video-codec=h264 --video-bitrate=4000 --video-bitrate-max=6000 --gpu-card-path=/dev/dri/card1"
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

// "resourceRequirements": [
//             {
//                 type: "GPU",
//                 value: "1"
//             }
//         ],

// RESOLUTION: "1920x1080",
// FRAMERATE: "60",
// NVIDIA_DRIVER_CAPABILITIES: "all",
// RELAY_URL: "https://relay.dathorse.com",
// NESTRI_PARAMS: "--verbose=true --video-codec=h264 --video-bitrate=4000 --video-bitrate-max=6000 --gpu-card-path=/dev/dri/card1"