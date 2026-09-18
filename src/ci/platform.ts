export function isWindows(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}
