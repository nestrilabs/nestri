// import { domain, zone } from "./dns";
// import { keyPath, sshKey } from "./ssh";

// const securityGroup = new aws.ec2.SecurityGroup("NestriRelaySecGrp", {
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
//     // egress: [
//     //     {
//     //         protocol: "-1",
//     //         cidrBlocks: ["0.0.0.0/0"],
//     //         fromPort:all
//     //         toPort:all
//     //     }
//     // ]
// });

// const ami = aws.ec2.getAmi({
//     filters: [
//         {
//             name: "name",
//             values: ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"],
//         },
//     ],
//     mostRecent: true,
//     owners: ["099720109477"], // Canonical
// });

// // User data to set up a simple web server
// const userData = `#!/bin/bash
// curl -fsSL https://get.docker.com | sh
// sudo groupadd docker
// sudo usermod -aG docker ubuntu
// newgrp docker
// docker run -d --restart=always -p 80:8088 -p 10000-20000:10000-20000/udp ghcr.io/nestrilabs/nestri/relay:nightly &
// `;

// // const userData = `#!/bin/bash
// // echo "Hello, World!" > index.html
// // nohup python3 -m http.server 80 &`;

// const server = new aws.ec2.Instance("NestriRelay", {
//     instanceType: aws.ec2.InstanceType.T2_Micro,
//     userData,
//     vpcSecurityGroupIds: [securityGroup.id],
//     ami: ami.then((ami) => ami.id),
//     keyName: sshKey.keyName,
//     associatePublicIpAddress: true,
//     // instanceMarketOptions: {
//     //     marketType: "spot",
//     //     spotOptions: {
//     //         maxPrice: "0.05",
//     //         spotInstanceType: "persistent",
//     //         instanceInterruptionBehavior: "stop"
//     //     },
//     // },
// });

// const relay = new cloudflare.Record("example", {
//     zoneId: zone.id,
//     name: "relay." + domain,
//     content: $interpolate`${server.publicIp}`,
//     type: "A",
//     ttl: 1,
//     proxied: true
// });

// export const outputs = {
//     relay: $interpolate`https://${relay.hostname}`
// }

// const dockerProvider = new docker.Provider("DockerProvider", {
//     host: $interpolate`ssh://ubuntu@${server.publicIp}`,
//     sshOpts: ["-i", keyPath, "-o", "StrictHostKeyChecking=no"],
// });

// const nginx = new docker.Container(
//     "Nginx",
//     {
//         image: "nginx:latest",
//         ports: [
//             {
//                 internal: 80,
//                 external: 80,
//             },
//             {
//                 internal:
//             }
//         ],
//         restart: "always",
//     },
//     {
//         provider: dockerProvider,
//         dependsOn: [server],
//     },
// );
