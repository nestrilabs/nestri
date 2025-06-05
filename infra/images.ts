import {api} from "./api"
import { domain } from "./dns";

const cache = new sst.cloudflare.Kv("ImageCache");

const bucket = new sst.cloudflare.Bucket("ImageBucket");

export const imageCdn = new sst.cloudflare.Worker("ImageCDN", {
    url: true,
    domain: "cdn." + domain,
    link: [bucket, cache, api],
    handler: "packages/functions/src/images/index.ts",
});

export const outputs = {
    cdn: imageCdn.url
}

// const transformedImageBucket = new sst.aws.Bucket("TranformedStorage");

// const imageProcessorFunction = new sst.aws.Function("ImageProcessor",
//     {
//         handler: "src/image-processor.handler",
//         nodejs: { install: ["sharp"] },
//         memory: "1024 MB",
//         timeout: "30 seconds",
//         url: true,
//         link: [storage, transformedImageBucket],
//         environment: {
//             transformedImageCacheTTL:
//                 process.env.transformedImageCacheTTL ?? "max-age=31622400",
//             maxImageSize: process.env.MAX_IMAGE_SIZE ?? "4700000",
//         },
//     },
// );

// const cloudfrontOAI = new aws.cloudfront.OriginAccessIdentity("CloudfrontOAI");

// const lambdaOAC = new aws.cloudfront.OriginAccessControl("OriginAccessControl",
//     {
//         name: `${$app.name}-${$app.stage}-OriginAccessControl`,
//         originAccessControlOriginType: "lambda",
//         signingBehavior: "always",
//         signingProtocol: "sigv4",
//     },
// );

// const cloudfrontResponseHeadersPolicy =
//     new aws.cloudfront.ResponseHeadersPolicy("ResponseHeadersPolicy",
//         {
//             name: `${$app.name}-${$app.stage}-ResponseHeadersPolicy`,
//             customHeadersConfig: {
//                 items: [
//                     {
//                         header: "x-aws-image-optimization",
//                         value: "v1.0",
//                         override: true,
//                     },
//                     { header: "vary", value: "accept", override: true },
//                 ],
//             },
//             corsConfig: {
//                 accessControlAllowCredentials: false,
//                 accessControlAllowHeaders: {
//                     items: ["*"],
//                 },
//                 accessControlAllowMethods: {
//                     items: ["GET"],
//                 },
//                 accessControlAllowOrigins: {
//                     items: ["*"],
//                 },
//                 accessControlMaxAgeSec: 600,
//                 originOverride: false,
//             },
//         },
//     );

// const cachePolicy = new aws.cloudfront.CachePolicy("CachePolicy",
//     {
//         name: `${$app.name}-${$app.stage}-CachePolicy`,
//         defaultTtl: 86400,
//         maxTtl: 31536000,
//         minTtl: 0,
//         parametersInCacheKeyAndForwardedToOrigin: {
//             cookiesConfig: {
//                 cookieBehavior: "none",
//             },
//             headersConfig: {
//                 headerBehavior: "none",
//             },
//             queryStringsConfig: {
//                 queryStringBehavior: "whitelist",
//                 queryStrings: {
//                     items: ["w", "h", "dpr", "format"]
//                 },
//             },
//         },
//     },
// );

// const groupOriginId = `${$app.name}-${$app.stage}-"GroupOrigin`;
// const primaryOriginId = `${$app.name}-${$app.stage}-PrimaryOrigin`;
// const secondaryOriginId = `${$app.name}-${$app.stage}-SecondaryOrigin`;

// const s3Distribution = new sst.aws.Cdn("ImageDistribution",
//     {
//         originGroups: [
//             {
//                 originId: groupOriginId,
//                 failoverCriteria: {
//                     statusCodes: [403, 500, 503, 504],
//                 },
//                 members: [
//                     {
//                         originId: primaryOriginId,
//                     },
//                     {
//                         originId: secondaryOriginId,
//                     },
//                 ],
//             },
//         ],
//         origins: [
//             {
//                 originId: primaryOriginId,
//                 domainName: imageProcessorFunction.url.apply(
//                     (url) => new URL(url).hostname,
//                 ),
//                 originAccessControlId: lambdaOAC.id,
//                 customOriginConfig: {
//                     originProtocolPolicy: "https-only",
//                     httpPort: 443,
//                     httpsPort: 443,
//                     originSslProtocols: ["TLSv1.2"],
//                 },
//             },
//             {
//                 originId: secondaryOriginId,
//                 domainName:
//                     transformedImageBucket.nodes.bucket.bucketRegionalDomainName,
//                 s3OriginConfig: {
//                     originAccessIdentity: cloudfrontOAI.cloudfrontAccessIdentityPath,
//                 },
//             },
//         ],
//         defaultCacheBehavior: {
//             cachePolicyId: cachePolicy.id,
//             allowedMethods: ["GET", "HEAD"],
//             cachedMethods: ["GET", "HEAD"],
//             targetOriginId: groupOriginId,
//             viewerProtocolPolicy: "redirect-to-https",
//             functionAssociations: [
//                 {
//                     eventType: "viewer-request",
//                     functionArn: cloudfrontRewriteFunction.arn,
//                 },
//             ],
//             responseHeadersPolicyId: cloudfrontResponseHeadersPolicy.id,
//         },
//     },
// );

// new aws.lambda.Permission("AllowCloudFrontServicePrincipal", {
//     action: "lambda:InvokeFunctionUrl",
//     function: imageProcessorFunction.arn,
//     principal: "cloudfront.amazonaws.com",
//     statementId: "AllowCloudFrontServicePrincipal",
//     sourceArn: s3Distribution.nodes.distribution.arn,
// });