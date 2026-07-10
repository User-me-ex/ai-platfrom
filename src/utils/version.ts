/**
 * 9 Router CLI — Version Management
 */

export const CLI_VERSION = "0.1.0";
export const CLI_CODENAME = "Scarab";

/** Get the full version string */
export function getVersionString(): string {
  return `v${CLI_VERSION} "${CLI_CODENAME}"`;
}

/** Get version info for display */
export function getVersionInfo(): Record<string, string> {
  return {
    version: CLI_VERSION,
    codename: CLI_CODENAME,
    runtime: process.release?.name ?? "bun",
    runtimeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

/** Format version info for display */
export function formatVersionInfo(): string {
  const info = getVersionInfo();
  const lines = [
    `9 Router CLI ${info.version} (${info.codename})`,
    `Runtime: ${info.runtime} ${info.runtimeVersion}`,
    `Platform: ${info.platform} ${info.arch}`,
  ];
  return lines.join("\n");
}
