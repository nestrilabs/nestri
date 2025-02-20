// const vpc = new sst.aws.Vpc("NestriRelayVpc", { az: 2 })    
// import { subnet1, subnet2, securityGroup } from "./vpc"

// const taskExecutionRole = new aws.iam.Role('NestriRelayExecutionRole', {
//     assumeRolePolicy: JSON.stringify({
//         Version: '2012-10-17',
//         Statement: [
//             {
//                 Effect: 'Allow',
//                 Principal: {
//                     Service: 'ecs-tasks.amazonaws.com',
//                 },
//                 Action: 'sts:AssumeRole',
//             },
//         ],
//     }),
// });

// const taskRole = new aws.iam.Role('NestriRelayTaskRole', {
//     assumeRolePolicy: JSON.stringify({
//         Version: '2012-10-17',
//         Statement: [
//             {
//                 Effect: 'Allow',
//                 Principal: {
//                     Service: 'ecs-tasks.amazonaws.com',
//                 },
//                 Action: 'sts:AssumeRole',
//             },
//         ],
//     }),
// });

// new aws.cloudwatch.LogGroup('NestriRelayLogGroup', {
//     name: '/ecs/nestri-relay',
//     retentionInDays: 7,
// });

// new aws.iam.RolePolicyAttachment('NestriRelayExecutionRoleAttachment', {
//     policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
//     role: taskRole,
// });

// const logPolicy = new aws.iam.Policy('NestriRelayLogPolicy', {
//     policy: JSON.stringify({
//         Version: '2012-10-17',
//         Statement: [
//             {
//                 Effect: 'Allow',
//                 Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
//                 Resource: 'arn:aws:logs:*:*:*',
//             },
//         ],
//     }),
// });

// new aws.iam.RolePolicyAttachment('NestriRelayTaskRoleAttachment', {
//     policyArn: logPolicy.arn,
//     role: taskExecutionRole,
// });

// const taskDefinition = new aws.ecs.TaskDefinition("NestriRelayTask", {
//     family: "NestriRelay",
//     cpu: "1024",
//     memory: "2048",
//     networkMode: "awsvpc",
//     taskRoleArn: taskRole.arn,
//     requiresCompatibilities: ["FARGATE"],
//     executionRoleArn: taskExecutionRole.arn,
//     containerDefinitions: JSON.stringify([{
//         name: "nestri-relay",
//         essential: true,
//         memory: 2048,
//         image: "ghcr.io/nestrilabs/nestri/relay:nightly",
//         portMappings: [
//             // HTTP port
//             {
//                 protocol: "tcp",
//                 hostPort: 80,
//                 containerPort: 80,
//             },
//             // UDP port range (1,000 ports)
//             {
//                 containerPortRange: "10000-11000",
//                 protocol: "udp",
//             },
//         ],
//         "environment": [
//             {
//                 name: "ENDPOINT_PORT",
//                 value: "80"
//             },
//         ],
//         logConfiguration: {
//             logDriver: 'awslogs',
//             options: {
//                 'awslogs-group': '/ecs/nestri-relay',
//                 'awslogs-region': 'us-east-1',
//                 'awslogs-stream-prefix': 'ecs',
//             },
//         },
//     }]),
// });

// const relayCluster = new aws.ecs.Cluster('NestriRelay');

// new aws.ecs.Service('NestriRelayService', {
//     name: 'NestriRelayService',
//     cluster: relayCluster.arn,
//     desiredCount: 1,
//     launchType: 'FARGATE',
//     taskDefinition: taskDefinition.arn,
//     deploymentCircuitBreaker: {
//         enable: true,
//         rollback: true,
//     },
//     enableExecuteCommand: true,
//     networkConfiguration: {
//         assignPublicIp: true,
//         subnets: [subnet1.id, subnet2.id],
//         securityGroups: [securityGroup.id],
//     },
// });

//FIXME: I cannot create Global Accelerators (Something to do with Quotas -  Yet my account is fine)
// const usWest2 = new aws.Provider("GlobalAccelerator", { region: aws.Region.USWest2 })

// const accelerator = new aws.globalaccelerator.Accelerator('Accelerator', {
//     name: 'NestriRelayAccelerator',
//     enabled: true,
//     ipAddressType: 'IPV4',
// }, { provider: usWest2 });

// const httpListener = new aws.globalaccelerator.Listener('TcpListener', {
//     acceleratorArn: accelerator.id,
//     clientAffinity: 'SOURCE_IP',
//     protocol: 'TCP',
//     portRanges: [{
//         fromPort: 80,
//         toPort: 80,
//     }],
// }, { provider: usWest2 });

// const udpListener = new aws.globalaccelerator.Listener('UdpListener', {
//     acceleratorArn: accelerator.id,
//     clientAffinity: 'SOURCE_IP',
//     protocol: 'UDP',
//     portRanges: [{
//         fromPort: 10000,
//         toPort: 11000,
//     }],
// }, { provider: usWest2 });

// new aws.globalaccelerator.EndpointGroup('TcpRelay', {
//     listenerArn: httpListener.id,
//     // healthCheckPath: '/',
//     endpointGroupRegion: aws.Region.USEast1,
//     endpointConfigurations: [{
//         clientIpPreservationEnabled: true,
//         endpointId: subnet1.id, //vpc.publicSubnets[0].apply(i => i),
//         weight: 100,
//     }],
// }, { provider: usWest2 });

// new aws.globalaccelerator.EndpointGroup('UdpRelay', {
//     listenerArn: udpListener.id,
//     // healthCheckPort: 80,
//     // healthCheckPath: "/",
//     endpointGroupRegion: aws.Region.USEast1,
//     endpointConfigurations: [{
//         clientIpPreservationEnabled: true,
//         endpointId: subnet1.id,//vpc.publicSubnets[0].apply(i => i),
//         weight: 100,
//     }],
// }, { provider: usWest2 });

// export const outputs = {
//     relay: accelerator.dnsName
// }