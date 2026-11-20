/**
 * Escape data for Azure Pipelines logging commands.
 * @see https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands
 */
export function escapeLoggingCommandData(value: string): string {
  return value
    .replaceAll("%", "%AZP25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(";", "%3B")
    .replaceAll("]", "%5D");
}

export function prependPath(pathValue: string): void {
  process.stdout.write(`##vso[task.prependpath]${escapeLoggingCommandData(pathValue)}\n`);
}

export function setVariable(
  name: string,
  value: string,
  options: { isOutput?: boolean; isReadonly?: boolean; isSecret?: boolean } = {},
): void {
  const parts = [`variable=${name}`];
  if (options.isOutput) parts.push("isOutput=true");
  if (options.isReadonly) parts.push("isReadonly=true");
  if (options.isSecret) parts.push("issecret=true");
  process.stdout.write(
    `##vso[task.setvariable ${parts.join(";")}]${escapeLoggingCommandData(value)}\n`,
  );
}

export function logWarning(message: string): void {
  process.stdout.write(`##vso[task.logissue type=warning]${escapeLoggingCommandData(message)}\n`);
}

const LOGGING_COMMAND_PREFIX_RE = /##(?=vso\[|\[)/g;

// The Azure agent scans the entire output line, including text after a log prefix.
function escapePlainLog(message: string): string {
  return message.replace(LOGGING_COMMAND_PREFIX_RE, "# #");
}

export function logInfo(message: string): void {
  console.log(escapePlainLog(message));
}

export function logError(message: string): void {
  console.error(escapePlainLog(message));
}
