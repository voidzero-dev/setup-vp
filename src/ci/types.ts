export type RunInstallEntry = {
  cwd?: string;
  args?: string[];
};

export type RunInstallInput = null | boolean | RunInstallEntry | RunInstallEntry[];

export type RuntimeEnv = Record<string, string | undefined>;

export type InstallCommand = "vp" | "sfw";

export enum LockFileType {
  Npm = "npm",
  Pnpm = "pnpm",
  Yarn = "yarn",
  Bun = "bun",
}

export interface LockFileInfo {
  type: LockFileType;
  path: string;
  filename: string;
}

export type ExportVariable = (name: string, value: string | undefined) => void;

export type LogFn = (message: string) => void;
