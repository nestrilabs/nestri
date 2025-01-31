// const storage = new sst.aws.Efs("HostedStorage")

const vpc = new sst.aws.Vpc("StorageVpc", { az: 2 })


const fileSystem = new aws.efs.FileSystem("HostedStorage", {
    performanceMode: "generalPurpose",
    throughputMode: "elastic",
    encrypted: true,
})

const securityGroup = new aws.ec2.SecurityGroup(
    `NestriHostedSecGroup`,
    {
        description: "Managed by SST",
        vpcId: vpc.id,
        egress: [
            {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
            },
        ],
        ingress: [
            {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                // Restricts inbound traffic to only within the VPC
                cidrBlocks: [vpc.nodes.vpc.cidrBlock],
            },
        ],
    }
);

vpc.privateSubnets.apply((subnets) =>
    subnets.map(
        (subnet) =>
            new aws.efs.MountTarget(`NestriMountTarget${subnet}`, {
                fileSystemId: fileSystem.id,
                subnetId: subnet,
                securityGroups: [securityGroup.id],
            })
    ))
