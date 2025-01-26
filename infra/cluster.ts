// import { pulumi } from '@pulumi/pulumi';

// const ecsCluster = new aws.ecs.Cluster("Hosted", {
//     name: "NestriHostedCluster"
// });

// const vpc = new sst.aws.Vpc("MyVpc");

const securityGroup = new aws.ec2.SecurityGroup("WebSecurityGrp", {
    ingress: [
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
});

// Find the latest Ubuntu AMI
const ami = aws.ec2.getAmi({
    filters: [
        {
            name: "name",
            values: ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"],
        },
    ],
    mostRecent: true,
    owners: ["099720109477"], // Canonical
});

const server = new aws.ec2.Instance("Ec2", {
    instanceType: "t2.micro",
    ami: ami.then((ami) => ami.id),
    userData: $interpolate`#!/bin/bash
    echo "Hello, World!" > index.html
    nohup python3 -m http.server 80 &`,
    vpcSecurityGroupIds: [securityGroup.id],
    associatePublicIpAddress: true,
});

export const outputs = {
    hostedCluster: server.publicIp
}

// const launchTemplate = new aws.ec2.LaunchTemplate("Ec2LaunchTemplate", {
//     name: "myLaunchTemplate",
//     instanceType: "t2.micro",//"g4dn.xlarge", // g4dn instance type
//     imageId: ami.then((ami) => ami.id),
//     networkInterfaces: [{
//         associatePublicIpAddress: "true",
//         securityGroups: ["sg-0c508d8f0e5e1a5c5"], // Replace with your security group ID
//     }],
//     userData: $interpolate`#!/bin/bash
// echo ECS_CLUSTER=${ecsCluster.name} >> /etc/ecs/ecs.config`
// });