/**
 * Escape data for Azure Pipelines logging commands.
 * @see https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands
 */
export function escapeLoggingCommandData(value: string): string {
  return value
    .replaceAll("%", "%25")
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
  options: { isOutput?: boolean; isReadonly?: boolean } = {},
): void {
  const parts = [`variable=${name}`];
  if (options.isOutput) parts.push("isOutput=true");
  if (options.isReadonly) parts.push("isReadonly=true");
  process.stdout.write(
    `##vso[task.setvariable ${parts.join(";")}]${escapeLoggingCommandData(value)}\n`,
  );
}

export function logWarning(message: string): void {
  process.stdout.write(`##vso[task.logissue type=warning]${escapeLoggingCommandData(message)}\n`);
}

export function logInfo(message: string): void {
  console.log(message);
}
