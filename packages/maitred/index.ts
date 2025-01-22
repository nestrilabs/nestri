import { color } from "bun" with { type: "macro" };

const infoBgColor = color("#f267ad", "ansi")?.replace("38", "48")
const errorBgColor = color("red", "ansi")?.replace("38", "48")
const resetColor = "\x1b[0m"


const log = {
    Info: (r: string) => console.log(`> ${infoBgColor}[INF]${resetColor} ${r}`),
    Error: (r: string) => console.log(`> ${errorBgColor}[ERR]${resetColor} ${r}`)
}

const handler = () => {
    const teamID = process.argv[2];

    if (!teamID) {
        log.Error("Please provide the team ID to register this container to")
        process.exit(1)
    }

    log.Info("Started successfully")
    log.Error("Did not start successfully")
}

handler()

