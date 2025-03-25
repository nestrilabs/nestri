import { vpc } from "./vpc";

export const cluster = new sst.aws.Cluster("Cluster", {
  vpc,
  forceUpgrade: "v2"
});