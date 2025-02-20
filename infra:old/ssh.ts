import { resolve } from "path";
import { writeFileSync } from "fs";

export const privateKey = new tls.PrivateKey("NestriGPUPrivateKey", {
    algorithm: "RSA",
    rsaBits: 4096,
});

// Just in case you want to SSH
export const sshKey = new aws.ec2.KeyPair("NestriGPUKey", {
    keyName: "NestriGPUKeyProd",
    publicKey: privateKey.publicKeyOpenssh
})

export const keyPath = privateKey.privateKeyOpenssh.apply((key) => {
    const path = "key_ssh";
    writeFileSync(path, key, { mode: 0o600 });
    return resolve(path);
});
