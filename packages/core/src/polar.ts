import { Resource } from "sst";
import { Polar as PolarSdk } from "@polar-sh/sdk";

const polar = new PolarSdk({ accessToken: Resource.PolarSecret.value });

export module Polar {
    export const client = polar;
}