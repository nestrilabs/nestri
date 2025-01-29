/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
/* deno-fmt-ignore-file */

import "sst"
declare module "sst" {
  export interface Resource {
    "AuthFingerprintKey": {
      "type": "random.index/randomString.RandomString"
      "value": string
    }
    "DiscordClientID": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "DiscordClientSecret": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "GithubClientID": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "GithubClientSecret": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "InstantAdminToken": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "InstantAppId": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "LoopsApiKey": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "Party": {
      "authorizer": string
      "endpoint": string
      "type": "sst.aws.Realtime"
    }
    "Urls": {
      "api": string
      "auth": string
      "type": "sst.sst.Linkable"
    }
  }
}
// cloudflare 
import * as cloudflare from "@cloudflare/workers-types";
declare module "sst" {
  export interface Resource {
    "Api": cloudflare.Service
    "Auth": cloudflare.Service
    "CloudflareAuthKV": cloudflare.KVNamespace
  }
}

import "sst"
export {}