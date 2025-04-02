import { format } from "util";

export function patchLogger() {
  const log =
    (level: "INFO" | "WARN" | "TRACE" | "DEBUG" | "ERROR") =>
    (msg: string, ...rest: any[]) => {
      let line = `${level}\t${format(msg, ...rest)}`;
      line = line.replace(/\n/g, "\r");
      process.stdout.write(line + "\n");
    };
  console.log = log("INFO");
  console.warn = log("WARN");
  console.error = log("ERROR");
  console.trace = log("TRACE");
  console.debug = log("DEBUG");
}