import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
}

export function hasVitePlusDependencies(versionDir: string, version: string): boolean {
  const wrapper = JSON.parse(readFileSync(join(versionDir, "package.json"), "utf8")) as PackageJson;
  if (
    wrapper.name !== "vp-global" ||
    wrapper.version !== version ||
    wrapper.dependencies?.["vite-plus"] !== version
  ) {
    return false;
  }
  const packageFile = realpathSync(join(versionDir, "node_modules", "vite-plus", "package.json"));
  if (!isInside(versionDir, packageFile)) return false;
  const pkg = JSON.parse(readFileSync(packageFile, "utf8")) as PackageJson;
  if (pkg.name !== "vite-plus" || pkg.version !== version || !pkg.dependencies) return false;
  const packageRequire = createRequire(packageFile);
  if (!statSync(join(dirname(packageFile), "dist", "bin.js")).isFile()) return false;

  // Follow pnpm's dependency links without executing JS or relying on packages
  // exporting package.json. Do not accept dependencies from outside this install.
  return Object.keys(pkg.dependencies).every((name) =>
    packageRequire.resolve.paths(name)?.some((modulesDir) => {
      const dependencyFile = join(modulesDir, name, "package.json");
      return existsSync(dependencyFile) && isInside(versionDir, realpathSync(dependencyFile));
    }),
  );
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function hasVitePlusNativeBinding(
  versionDir: string,
  options: ExecFileSyncOptionsWithStringEncoding,
): boolean {
  const loader = realpathSync(
    join(versionDir, "node_modules", "vite-plus", "binding", "index.cjs"),
  );
  if (!isInside(versionDir, loader) || !statSync(loader).isFile()) return false;

  // Let the installed loader select the platform, architecture, and libc.
  // A child process isolates native load failures from the action runtime.
  const script = `
require(process.argv[1]);
process.stdout.write(JSON.stringify(Object.keys(require.cache).filter(file => file.endsWith('.node'))));
`;
  const files: unknown = JSON.parse(
    execFileSync(process.execPath, ["--input-type=commonjs", "--eval", script, loader], {
      ...options,
      env: { ...options.env, NAPI_RS_ENFORCE_VERSION_CHECK: "1" },
    }),
  );
  // A binding from another installation must not hide a damaged active one.
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(
      (file) =>
        typeof file === "string" && isAbsolute(file) && isInside(versionDir, realpathSync(file)),
    )
  );
}
