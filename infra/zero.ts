import { auth } from "./auth";
import { domain } from "./dns";
import { readFileSync } from "fs";
import { cluster } from "./cluster";
import { storage } from "./storage";
import { postgres } from "./postgres";

// const connectionString = $interpolate`postgresql://${postgres.username}:${postgres.password}@${postgres.host}/${postgres.database}`
const connectionString = $interpolate`postgresql://${postgres.username}:${postgres.password}@${postgres.host}:${postgres.port}/${postgres.database}`;

const tag = $dev
    ? `latest`
    : JSON.parse(
        readFileSync("./node_modules/@rocicorp/zero/package.json").toString(),
    ).version.replace("+", "-");

const zeroEnv = {
    FORCE: "1",
    NO_COLOR: "1",
    ZERO_LOG_LEVEL: "info",
    ZERO_LITESTREAM_LOG_LEVEL: "info",
    ZERO_UPSTREAM_DB: connectionString,
    ZERO_IMAGE_URL: `rocicorp/zero:${tag}`,
    ZERO_CVR_DB: connectionString,
    ZERO_CHANGE_DB: connectionString,
    ZERO_REPLICA_FILE: "/tmp/nestri.db",
    ZERO_LITESTREAM_RESTORE_PARALLELISM: "64",
    ZERO_SHARD_ID: $app.stage,
    ZERO_AUTH_JWKS_URL: $interpolate`${auth.url}/.well-known/jwks.json`,
    ...($dev
        ? {
        }
        : {
            ZERO_LITESTREAM_BACKUP_URL: $interpolate`s3://${storage.name}/zero`,
        }),
};

// Replication Manager Service
const replicationManager = !$dev
    ? new sst.aws.Service(`ZeroReplication`, {
        cluster,
        wait: true,
        ...($app.stage === "production"
            ? {
                cpu: "2 vCPU",
                memory: "4 GB",
            }
            : {}),
        architecture: "arm64",
        image: zeroEnv.ZERO_IMAGE_URL,
        link: [storage, postgres],
        health: {
            command: ["CMD-SHELL", "curl -f http://localhost:4849/ || exit 1"],
            interval: "5 seconds",
            retries: 3,
            startPeriod: "300 seconds",
        },
        environment: {
            ...zeroEnv,
            ZERO_CHANGE_MAX_CONNS: "3",
            ZERO_NUM_SYNC_WORKERS: "0",
        },
        logging: {
            retention: "1 month",
        },
        loadBalancer: {
            public: false,
            ports: [
                {
                    listen: "80/http",
                    forward: "4849/http",
                },
            ],
        },
        transform: {
            loadBalancer: {
                idleTimeout: 3600,
            },
            service: {
                healthCheckGracePeriodSeconds: 900,
            },
        },
    }) : undefined;

if ($app.stage === "production" && false) {
    new sst.aws.Service(`ZeroReplicationTest`, {
        cluster,
        ...($app.stage === "production"
            ? {
                cpu: "2 vCPU",
                memory: "4 GB",
            }
            : {}),
        image: zeroEnv.ZERO_IMAGE_URL,
        wait: true,
        link: [storage, postgres],
        health: {
            command: ["CMD-SHELL", "curl -f http://localhost:4849/ || exit 1"],
            interval: "5 seconds",
            retries: 3,
            startPeriod: "300 seconds",
        },
        environment: {
            ...zeroEnv,
            ZERO_CHANGE_MAX_CONNS: "3",
            ZERO_NUM_SYNC_WORKERS: "0",
            ZERO_SHARD_ID: $app.stage + "_test",
            ZERO_LITESTREAM_BACKUP_URL: undefined,
        },
        logging: {
            retention: "1 month",
        },
        transform: {
            service: {
                healthCheckGracePeriodSeconds: 900,
            },
            taskDefinition: {
                ephemeralStorage: {
                    sizeInGib: 200,
                },
            },
            loadBalancer: {
                idleTimeout: 60 * 60,
            },
        },
    });
}

if (replicationManager) {
    new command.local.Command(
        "ZeroPermission",
        {
            dir: process.cwd() + "/packages/zero",
            environment: {
                ZERO_UPSTREAM_DB: connectionString,
            },
            create: "bun run zero-deploy-permissions",
            triggers: [Date.now()],
        },
        {
            dependsOn: [replicationManager],
        },
    );
}

export const zero = new sst.aws.Service("Zero", {
    cluster,
    image: zeroEnv.ZERO_IMAGE_URL,
    link: [storage, postgres],
    architecture: "arm64",
    ...($app.stage === "production"
        ? {
            cpu: "2 vCPU",
            memory: "4 GB",
            capacity: "spot"
        }
        : {
            capacity: "spot"
        }),
    environment: {
        ...zeroEnv,
        ...($dev
            ? {
                ZERO_NUM_SYNC_WORKERS: "1",
            }
            : {
                ZERO_CHANGE_STREAMER_URI: replicationManager.url.apply((val) =>
                    val.replace("http://", "ws://"),
                ),
                ZERO_UPSTREAM_MAX_CONNS: "15",
                ZERO_CVR_MAX_CONNS: "160",
            }),
    },
    wait: true,
    health: {
        retries: 3,
        command: ["CMD-SHELL", "curl -f http://localhost:4848/ || exit 1"],
        interval: "5 seconds",
        startPeriod: "300 seconds",
    },
    loadBalancer: {
        domain: {
            name: "zero." + domain,
            dns: sst.cloudflare.dns()
        },
        rules: [
            { listen: "443/https", forward: "4848/http" },
            { listen: "80/http", forward: "4848/http" },
        ],
    },
    scaling: {
        min: 1,
        max: 4,
    },
    logging: {
        retention: "1 month",
    },
    transform: {
        service: {
            healthCheckGracePeriodSeconds: 900,
        },
        // taskDefinition: {
        //     ephemeralStorage: {
        //         sizeInGib: 200,
        //     },
        // },
        loadBalancer: {
            idleTimeout: 3600,
        },
    },
    dev: {
        command: "bun dev",
        directory: "packages/zero",
        url: "http://localhost:4848",
    },
});

export const outputs = {
    zero: `https://zero.${domain}`
}