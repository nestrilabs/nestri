import { domain } from "./dns";
import { storage } from "./storage";

sst.Linkable.wrap(aws.iam.AccessKey, (resource) => ({
    properties: {
        key: resource.id,
        secret: resource.secret,
    },
}))

const cache = new sst.cloudflare.Kv("ImageCache");

const bucket = new sst.cloudflare.Bucket("ImageBucket");

const lambdaInvokerUser = new aws.iam.User("ImageIAMUser", {
    name: `${$app.name}-${$app.stage}-ImageIAMUser`,
    forceDestroy: true
});

const imageProcessorFunction = new sst.aws.Function("ImageProcessor",
    {
        memory: "1024 MB",
        link: [storage],
        timeout: "30 seconds",
        nodejs: { install: ["sharp"] },
        handler: "packages/functions/src/images/processor.handler",
    },
);

new aws.iam.UserPolicy("InvokeLambdaPolicy", {
    user: lambdaInvokerUser.name,
    policy: $output({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: ["lambda:InvokeFunction"],
                Resource: imageProcessorFunction.arn,
            },
        ],
    }).apply(JSON.stringify),
});

const accessKey = new aws.iam.AccessKey("ImageInvokerAccessKey", {
    user: lambdaInvokerUser.name,
});

export const imageCdn = new sst.cloudflare.Worker("ImageCDN", {
    url: true,
    domain: "cdn." + domain,
    link: [bucket, cache, imageProcessorFunction, accessKey],
    handler: "packages/functions/src/images/index.ts",
});

export const outputs = {
    cdn: imageCdn.url
}
