import { Resource } from "sst"

export const getAwsCredentials = () => { return { secretAccessKey: Resource.AWS_KEY.value, accessKeyId: Resource.AWS_ACCESS.value } }