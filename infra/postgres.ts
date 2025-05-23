import { vpc } from "./vpc";
import { isPermanentStage } from "./stage";
import { steamEncryptionKey } from "./secret";

// TODO: Add a dev db to use, this will help with running zero locally... and testing it
export const postgres = new sst.aws.Aurora("Database", {
  vpc,
  engine: "postgres",
  scaling: isPermanentStage
    ? undefined
    : {
      min: "0 ACU",
      max: "1 ACU",
    },
  transform: {
    clusterParameterGroup: {
      parameters: [
        {
          name: "rds.logical_replication",
          value: "1",
          applyMethod: "pending-reboot",
        },
        {
          name: "max_slot_wal_keep_size",
          value: "10240",
          applyMethod: "pending-reboot",
        },
        {
          name: "rds.force_ssl",
          value: "0",
          applyMethod: "pending-reboot",
        },
        {
          name: "max_connections",
          value: "1000",
          applyMethod: "pending-reboot",
        },
      ],
    },
  },
});


new sst.x.DevCommand("Studio", {
  link: [postgres, steamEncryptionKey],
  dev: {
    command: "bun db:dev studio",
    directory: "packages/core",
    autostart: true,
  },
});

// const migrator = new sst.aws.Function("DatabaseMigrator", {
//   handler: "packages/functions/src/migrator.handler",
//   link: [postgres],
//   copyFiles: [
//     {
//       from: "packages/core/migrations",
//       to: "./migrations",
//     },
//   ],
// });

// if (!$dev) {
//   new aws.lambda.Invocation("DatabaseMigratorInvocation", {
//     input: Date.now().toString(),
//     functionName: migrator.name,
//   });
// }
