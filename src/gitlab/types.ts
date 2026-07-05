export type RunInstallEntry = {
  cwd?: string;
  args?: string[];
};

export type RunInstallInput = null | boolean | RunInstallEntry | RunInstallEntry[];

export type RuntimeEnv = Record<string, string | undefined>;

export type InstallCommand = "vp" | "sfw";
