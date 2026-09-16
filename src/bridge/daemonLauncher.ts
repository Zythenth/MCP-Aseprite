import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

export function launchBridgeDaemon(): ChildProcess {
  const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url));
  const child = spawn(process.execPath, [daemonPath], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });

  child.once("error", (error) => {
    logger.error(`Could not launch the persistent Aseprite bridge daemon: ${error.message}`);
  });
  child.unref();
  return child;
}
