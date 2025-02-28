/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
/* deno-fmt-ignore-file */

import "sst"
declare module "sst" {
  export interface Resource {
    "Api": {
      "type": "sst.aws.Router"
      "url": string
    }
    "ApiFn": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
    "Auth": {
      "type": "sst.aws.Auth"
      "url": string
    }
    "AuthFingerprintKey": {
      "type": "random.index/randomString.RandomString"
      "value": string
    }
    "Bus": {
      "arn": string
      "name": string
      "type": "sst.aws.Bus"
    }
    "Database": {
      "host": string
      "name": string
      "password": string
      "type": "sst.sst.Linkable"
      "user": string
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
    "Mail": {
      "configSet": string
      "sender": string
      "type": "sst.aws.Email"
    }
    "PolarSecret": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "Realtime": {
      "authorizer": string
      "endpoint": string
      "type": "sst.aws.Realtime"
    }
    "Urls": {
      "api": string
      "auth": string
      "site": string
      "type": "sst.sst.Linkable"
    }
    "Web": {
      "type": "sst.aws.StaticSite"
      "url": string
    }
  }
}

import "sst"
export {}