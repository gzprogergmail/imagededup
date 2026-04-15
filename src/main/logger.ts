import { app } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { toLogEntry, type LogLevel } from "../shared/logging";

const LOG_DIRECTORY_NAME = "logs";

export async function logEvent(
  scope: "main" | "renderer" | "scan",
  event: string,
  details?: Record<string, unknown>,
  level: LogLevel = "info"
): Promise<void> {
  const logDirectory = await getLogDirectory();
  const logPath = join(logDirectory, `${scope}.jsonl`);
  const entry = toLogEntry(scope, event, details, level);
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function getLogDirectory(): Promise<string> {
  const baseDirectory = typeof app?.isReady === "function" && app.isReady()
    ? app.getPath("userData")
    : process.cwd();
  const logDirectory = join(baseDirectory, LOG_DIRECTORY_NAME);
  await mkdir(logDirectory, { recursive: true });
  return logDirectory;
}
