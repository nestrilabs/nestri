import { auth, urls } from "./api"


export const cmd = new sst.x.DevCommand("Cmd", {
    link: [urls, auth],
    dev: {
        autostart: true,
        command: "cd packages/cmd && go run main.go"
    }
})