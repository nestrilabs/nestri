const ecsCluster = new aws.ecs.Cluster("Hosted", {
    name: "NestriGPUCluster"
});

// Find the latest BottleRocket AMI
const ami = aws.ec2.getAmi({
    filters: [
        {
            name: "name",
            //?Note: Bottlerocket does not support encrypted EFS instances or ones with 'awsvpc'
            values: ["bottlerocket-aws-ecs-2-nvidia-x86_64-*"],
        },
    ],
    mostRecent: true,
    owners: ["092701018921"],
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

const server = new aws.ec2.Instance("NestriGPU", {
    instanceType: aws.ec2.InstanceType.G4dn_XLarge,
    ami: ami.then((ami) => ami.id),
    userData: $interpolate`
[settings.ecs]
cluster = "${ecsCluster.name}"
reserved-memory=300
container-stop-timeout="3h"
image-pull-behavior="always"
enable-spot-instance-draining=true
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

// RESOLUTION: "1920x1080",
// FRAMERATE: "60",
// NVIDIA_DRIVER_CAPABILITIES: "all",
// RELAY_URL: "https://relay.dathorse.com",
// NESTRI_PARAMS: "--verbose=true --video-codec=h264 --video-bitrate=4000 --video-bitrate-max=6000 --gpu-card-path=/dev/dri/card1"