// import { pulumi } from '@pulumi/pulumi';

// const ecsCluster = new aws.ecs.Cluster("Hosted", {
//     name: "NestriHostedCluster"
// });

// const securityGroup = new aws.ec2.SecurityGroup("WebSecurityGrp", {
//     ingress: [
//         {
//             protocol: "tcp",
//             fromPort: 80,
//             toPort: 80,
//             cidrBlocks: ["0.0.0.0/0"],
//         },
//     ],
// });

// Find the latest Ubuntu AMI
// const ami = aws.ec2.getAmi({
//     filters: [
//         {
//             name: "name",
//?Note: Bottlerocket does not support encrypted EFS instances or ones with 'awsvpc'
//             values: ["bottlerocket-aws-ecs-2-nvidia-x86_64-*"],
//         },
//     ],
//     mostRecent: true,
//     owners: ["092701018921"],
// });

const server = new aws.ec2.Instance("NestriGPU", {
    instanceType: aws.ec2.InstanceType.G4dn_XLarge,
    ami: ami.then((ami) => ami.id),
    userData: $interpolate`
[settings.ecs]
cluster = "${cluster.name}"
reserved-memory=300
container-stop-timeout="3h"
`,
    // vpcSecurityGroupIds: [securityGroup.id],
    instanceMarketOptions: {
        marketType: "spot",
        spotOptions: {
            maxPrice: "0.0031",
        },
    },
    associatePublicIpAddress: true,
});

// export const outputs = {
//     // hostedCluster: server.publicIp
//     // ami: ami.then((ami) => ami.id)
// }