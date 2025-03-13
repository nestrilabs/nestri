import { vpc } from "./vpc";
import { isPermanentStage } from "./stage";

// TODO: Add a dev db to use, this will help with running zero locally... and testing it
export const postgres = new sst.aws.Aurora("Postgres", {
  vpc,
  engine: "postgres",
  // dataApi: true,
  scaling: isPermanentStage
    ? undefined
    : {
      min: "0 ACU",
      max: "1 ACU",
    },
  // dev: {
  //   username: "postgres",
  //   password: "password",
  //   database: "local",
  //   port: 5432
  // },
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

// const cwd = process.cwd();

// new sst.x.DevCommand("LocalDB", {
//   dev: {
//     command: [
//       "docker",
//       "--rm",
//       "-it",
//       "-p 5432:5432",
//       "-v",
//       `${cwd}/.sst/storage/postgres:/var/lib/postgresql/data`,
//       "-e",
//       "POSTGRES_USER=postgres",
//       "-e",
//       "POSTGRES_PASSWORD=password",
//       "-e",
//       "POSTGRES_DB=local",
//       "postgres:16.4"
//     ].join(" "),
//     autostart: true,
//   },
// });


// new sst.x.DevCommand("Studio", {
//   link: [postgres],
//   dev: {
//     command: "bun pg studio",
//     directory: "packages/core",
//     autostart: true,
//   },
// });

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
