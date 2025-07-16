import { isPermanentStage } from "./stage";

export const vpc = isPermanentStage
  ? new sst.aws.Vpc("VPC", {
    az: 2,
    // For lambdas to work in this VPC
    nat: "ec2",
    // For SST tunnel to work
    bastion: true,
  })
  : sst.aws.Vpc.get("VPC", "vpc-0beb1cdc21a725748");