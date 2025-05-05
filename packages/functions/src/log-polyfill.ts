import { format } from "util";

/**
 * Overrides the default Node.js console logging methods with a custom logger.
 *
 * This function patches console.log, console.warn, console.error, console.trace, and console.debug so that each logs
 * messages prefixed with a log level. The messages are formatted using Node.js formatting conventions, with newline
 * characters replaced by carriage returns, and are written directly to standard output.
 *
 * @example
 * patchLogger();
 * console.info("Server started on port %d", 3000);
 */
export function patchLogger() {
  const log =
    (level: "INFO" | "WARN" | "TRACE" | "DEBUG" | "ERROR") =>
    (msg: string, ...rest: any[]) => {
      let formattedMessage = format(msg, ...rest);
      // Split by newlines, prefix each line with the level, and join back
      const lines = formattedMessage.split('\n');
      const prefixedLines = lines.map(line => `${level}\t${line}`);
      const output = prefixedLines.join('\n');
      process.stdout.write(output + '\n');
    };
  console.log = log("INFO");
  console.warn = log("WARN");
  console.error = log("ERROR");
  console.trace = log("TRACE");
  console.debug = log("DEBUG");
}