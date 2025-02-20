// export const vpc = new aws.ec2.Vpc('NestriVpc', {
//     cidrBlock: '172.16.0.0/16',
// });

// export const subnet1 = new aws.ec2.Subnet('NestriSubnet1', {
//     vpcId: vpc.id,
//     cidrBlock: '172.16.1.0/24',
//     // cidrBlock: '110.0.12.0/22',
//     availabilityZone: 'us-east-1a',
// });

// export const subnet2 = new aws.ec2.Subnet('NestriSubnet2', {
//     vpcId: vpc.id,
//     cidrBlock: '172.16.2.0/24',
//     // cidrBlock: '10.0.20.0/22',
//     availabilityZone: 'us-east-1b',
// });

// const internetGateway = new aws.ec2.InternetGateway('NestriInternetGateway', {
//     vpcId: vpc.id,
// });

// const routeTable = new aws.ec2.RouteTable('NestriRouteTable', {
//     vpcId: vpc.id,
//     routes: [
//         {
//             cidrBlock: '0.0.0.0/0',
//             gatewayId: internetGateway.id,
//         },
//     ],
// });

// new aws.ec2.RouteTableAssociation('NestriSubnet1RouteTable', {
//     subnetId: subnet1.id,
//     routeTableId: routeTable.id,
// });

// new aws.ec2.RouteTableAssociation('NestriSubnet2RouteTable', {
//     subnetId: subnet2.id,
//     routeTableId: routeTable.id,
// });

// // const vpc = new sst.aws.Vpc("NestriRelayVpc")

// export const securityGroup = new aws.ec2.SecurityGroup("NestriSecurityGroup", {
//     vpcId: vpc.id,
//     description: "Managed thru SST",
//     ingress: [
//         {
//             protocol: "tcp",
//             fromPort: 80,
//             toPort: 80,
//             cidrBlocks: ["0.0.0.0/0"],
//         },
//         {
//             protocol: "udp",
//             fromPort: 10000,
//             toPort: 20000,
//             cidrBlocks: ["0.0.0.0/0"],
//         },
//     ],
//     egress: [
//         {
//             protocol: "-1",
//             cidrBlocks: ["0.0.0.0/0"],
//             fromPort: 0,
//             toPort: 0
//         }
//     ]
// });

// const loadBalancer = new aws.lb.LoadBalancer('NestriVpcLoadBalancer', {
//     name: 'NestriVpcLoadBalancer',
//     internal: false,
//     securityGroups: [securityGroup.id],
//     subnets: vpc.publicSubnets
// });

// const targetGroup = new aws.lb.TargetGroup('NestriVpcTargetGroup', {
//     name: 'NestriVpcTargetGroup',
//     port: 80,
//     protocol: 'HTTP',
//     targetType: 'ip',
//     vpcId: vpc.id,
//     healthCheck: {
//         path: '/',
//         protocol: 'HTTP',
//     },
// });

// new aws.lb.Listener('NestriVpcLoadBalancerListener', {
//     loadBalancerArn: loadBalancer.arn,
//     port: 80,
//     protocol: 'HTTP',
//     defaultActions: [
//         {
//             type: 'forward',
//             targetGroupArn: targetGroup.arn,
//         },
//     ],
// });

// // export const subnets = [subnet1, subnet2]
