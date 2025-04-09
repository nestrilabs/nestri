/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
/* deno-fmt-ignore-file */

import "sst"
declare module "sst" {
  export interface Resource {
    "Api": {
      "service": string
      "type": "sst.aws.Service"
      "url": string
    }
    "Auth": {
      "service": string
      "type": "sst.aws.Service"
      "url": string
    }
    "Bus": {
      "arn": string
      "name": string
      "type": "sst.aws.Bus"
    }
    "Database": {
      "clusterArn": string
      "database": string
      "host": string
      "password": string
      "port": number
      "reader": string
      "secretArn": string
      "type": "sst.aws.Aurora"
      "username": string
    }
    "DatabaseMigrator": {
      "name": string
      "type": "sst.aws.Function"
    }
    "DiscordClientID": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "DiscordClientSecret": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "Email": {
      "configSet": string
      "sender": string
      "type": "sst.aws.Email"
    }
    "GithubClientID": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "GithubClientSecret": {
      "type": "sst.sst.Secret"
      "value": string
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
    "Steam": {
      "service": string
      "type": "sst.aws.Service"
      "url": string
    }
    "Storage": {
      "name": string
      "type": "sst.aws.Bucket"
    }
    "VPC": {
      "bastion": string
      "type": "sst.aws.Vpc"
    }
    "Web": {
      "type": "sst.aws.StaticSite"
      "url": string
    }
    "Zero": {
      "service": string
      "type": "sst.aws.Service"
      "url": string
    }
    "ZeroPermissions": {
      "name": string
      "type": "sst.aws.Function"
    }
  }
}

import "sst"
export {}