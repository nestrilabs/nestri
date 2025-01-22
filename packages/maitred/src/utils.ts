import { color } from "bun" with { type: "macro" };

const infoBgColor = color("#f267ad", "ansi")?.replace("38", "48")
const errorBgColor = color("red", "ansi")?.replace("38", "48")
const resetColor = "\x1b[0m"


export const log = {
    Info: (r: string) => console.log(`> ${infoBgColor}[INF]${resetColor} ${r}`),
    Error: (r: string) => console.log(`> ${errorBgColor}[ERR]${resetColor} ${r}`)
}
