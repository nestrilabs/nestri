import { sshKey } from "./cluster";

const securityGroup = new aws.ec2.SecurityGroup("web-secgrp", {
    ingress: [
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            protocol: "udp",
            fromPort: 10000,
            toPort: 20000,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
});

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

const server = new aws.ec2.Instance("NestriGPU", {
    instanceType: aws.ec2.InstanceType.T2_Medium,
    ami: ami.then((ami) => ami.id),
    keyName: sshKey.keyName,
    instanceMarketOptions: {
        marketType: "spot",
        spotOptions: {
            maxPrice: "0.05",
            spotInstanceType: "persistent",
            instanceInterruptionBehavior: "stop"
        },
    },
});