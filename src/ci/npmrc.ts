function authKeyFor(registryUrl: string): string {
  return (registryUrl.replace(/^\w+:/, "") + ":_authtoken").toLowerCase();
}

export function analyzeProjectNpmrc(content: string): {
  registriesNeedingAuth: string[];
  envVarRefs: Set<string>;
} {
  const registries = new Set<string>();
  const authKeys = new Set<string>();
  const envVarRefs = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const lowerKey = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();

    if (lowerKey === "registry" || lowerKey.endsWith(":registry")) {
      // Skip values that rely on env-var expansion — the key for the matching
      // `_authToken` line must be a literal URL, and `${VAR}` isn't expanded
      // inside `.npmrc` keys by npm/pnpm.
      if (!value.includes("${")) {
        registries.add(value.endsWith("/") ? value : value + "/");
      }
    }
    if (lowerKey.startsWith("//") && lowerKey.endsWith(":_authtoken")) {
      authKeys.add(lowerKey);
    }
    for (const m of value.matchAll(/\$\{(\w+)\}/g)) {
      envVarRefs.add(m[1]!);
    }
  }

  return {
    registriesNeedingAuth: [...registries].filter((url) => !authKeys.has(authKeyFor(url))),
    envVarRefs,
  };
}
