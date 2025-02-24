#!/usr/bin/env bun

import { Resource } from "sst";
import { spawnSync } from "bun";

spawnSync(
  [
    "psql",
    `postgresql://${Resource.Database.user}:${Resource.Database.password}@${Resource.Database.host}/${Resource.Database.name}?sslmode=require`,
  ],
  {
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
  },
);