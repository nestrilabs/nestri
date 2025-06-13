export const storage = new sst.aws.Bucket("Storage", {
    access: "cloudfront"
});

export const zeroStorage = new sst.aws.Bucket("ZeroStorage");