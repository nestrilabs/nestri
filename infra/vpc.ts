// import { isPermanentStage } from "./stage";

// export const vpc = isPermanentStage
//   ? new sst.aws.Vpc("Vpc", {
//       az: 2,
//     })
//     //FIXME: Change this ID
//   : undefined //sst.aws.Vpc.get("Vpc", "vpc-070a1a7598f4c12d1");
//   // 

export const vpc = new sst.aws.Vpc("NestriVpc", {
  az: 2,
})