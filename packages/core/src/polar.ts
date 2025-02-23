import { Resource } from "sst";
import { Polar as PolarSdk } from "@polar-sh/sdk";

const polar = new PolarSdk({ accessToken: Resource.PolarSecret.value, server: Resource.App.stage !== "production" ? "sandbox" : "production" });

export module Polar {
    export const client = polar;
}