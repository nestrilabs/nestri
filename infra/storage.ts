// const storage = new sst.aws.Efs("HostedStorage")

const vpc = new sst.aws.Vpc("StorageVpc", { az: 2 })


const filesystem = new aws.efs.FileSystem("HostedStorage",{
    performanceMode: "generalPurpose",
    throughputMode: "elastic",
    encrypted: true,
})


