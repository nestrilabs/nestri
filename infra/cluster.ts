const ecsCluster = new aws.ecs.Cluster("Hosted", {
    name: "NestriGPUCluster"
});

// Find the latest Ubuntu AMI
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
    // managedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"]
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
enable-spot-instance-draining=true
`,
    instanceMarketOptions: {
        marketType: "spot",
        spotOptions: {
            maxPrice: "0.2",
        },
    },
    iamInstanceProfile: ecsInstanceProfile,
});

const logGroup = new aws.cloudwatch.LogGroup("NestriGPULogGroup", {
    name: "/ecs/bottlerocket",
    retentionInDays: 7, // Adjust retention as needed
});

// Create a Task Definition for the ECS service
const taskDefinition = new aws.ecs.TaskDefinition("myTask", {
    family: "ecsTest",
    requiresCompatibilities: ["EC2"],
    containerDefinitions: JSON.stringify([{
        "memory": 80,
        "essential": true,
        "name": "gpu",
        "image": "nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04",
        "resourceRequirements": [
            {
                "type": "GPU",
                "value": "1"
            }
        ],
        "command": [
            "sh",
            "-c",
            "nvidia-smi"
        ],
        "cpu": 100,
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