import { describe, expect, it } from "vite-plus/test";
import { applyAuthEnv } from "./auth-env.js";

describe("Azure authEnv", () => {
  it("preserves credential values and removes their transport variables", () => {
    const secret = "quotes \" ' \\ and\nnewlines $(literal) `literal`";
    const env: NodeJS.ProcessEnv = {
      SETUP_VP_AUTH_ENV_CUSTOM_TOKEN: secret,
      SETUP_VP_AUTH_ENV_NODE_AUTH_TOKEN: "registry-token",
      SETUP_VP_AUTH_ENV_NPM_TOKEN: "npm-token",
      SETUP_VP_AUTH_ENV_YARN_NPM_AUTH_TOKEN: "yarn-token",
      SETUP_VP_AUTH_ENV_REGISTRY_PASSWORD: "password",
      SETUP_VP_AUTH_ENV_REGISTRY_SECRET: "secret",
      SETUP_VP_AUTH_ENV_REGISTRY_KEY: "key",
      SETUP_VP_AUTH_ENV_GITHUB_TOKEN: "github-token",
      SETUP_VP_AUTH_ENV_CI_JOB_TOKEN: "gitlab-token",
      SETUP_VP_AUTH_ENV_SYSTEM_ACCESSTOKEN: "azure-token",
      CUSTOM_TOKEN: "previous-token",
      NODE_OPTIONS: "--max-old-space-size=4096",
      UNRELATED: "$(leave-me)",
    };

    applyAuthEnv(env);

    expect(env).toEqual({
      CUSTOM_TOKEN: secret,
      NODE_AUTH_TOKEN: "registry-token",
      NPM_TOKEN: "npm-token",
      YARN_NPM_AUTH_TOKEN: "yarn-token",
      REGISTRY_PASSWORD: "password",
      REGISTRY_SECRET: "secret",
      REGISTRY_KEY: "key",
      GITHUB_TOKEN: "github-token",
      CI_JOB_TOKEN: "gitlab-token",
      SYSTEM_ACCESSTOKEN: "azure-token",
      NODE_OPTIONS: "--max-old-space-size=4096",
      UNRELATED: "$(leave-me)",
    });
  });

  it.each(["$(MISSING)", "$(OTHER_SECRET)", undefined])(
    "treats an unresolved mapping as missing (%s)",
    (value) => {
      const env = { SETUP_VP_AUTH_ENV_CUSTOM_TOKEN: value, CUSTOM_TOKEN: "previous-token" };
      applyAuthEnv(env);
      expect(env).toEqual({});
    },
  );

  it("preserves empty values and the case of custom credential names", () => {
    const env = { setup_vp_auth_env_Custom_Token: "", SETUP_VP_AUTH_ENV__TOKEN: "private" };
    applyAuthEnv(env);
    expect(env).toEqual({ Custom_Token: "", _TOKEN: "private" });
  });

  it.each([
    "NODE_OPTIONS",
    "node_options",
    "Node_Options",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "BASH_ENV",
    "BASHOPTS",
    "ENV",
    "SHELLOPTS",
    "SHELL",
    "ZDOTDIR",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "OPENSSL_CONF",
    "SSL_CERT_FILE",
    "PATH",
    "Path",
    "PATHEXT",
    "COMSPEC",
    "PSModulePath",
    "DOTNET_STARTUP_HOOKS",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "NPM_CONFIG_USERCONFIG",
    "npm_config_script_shell",
    "NPM_EXECPATH",
    "PNPM_HOME",
    "YARN_RC_FILENAME",
    "BUN_OPTIONS",
    "COREPACK_HOME",
    "VP_HOME",
    "SFW_BIN",
    "XDG_CONFIG_HOME",
    "HTTPS_PROXY",
    "SETUP_VP_RUN_INSTALL",
    "SETUP_VP_AUTH_ENV_NODE_OPTIONS",
    "AGENT_TEMPDIRECTORY",
    "SYSTEM_DEFAULTWORKINGDIRECTORY",
    "BUILD_SOURCESDIRECTORY",
    "PIPELINE_WORKSPACE",
    "CI",
    "CI_PROJECT_DIR",
    "GITHUB_ENV",
    "RUNNER_TEMP",
    "INPUT_SCRIPT",
    "VSTS_TASKVARIABLE_SECRET",
    "SETUP_VP_TOKEN",
    "NODE_SECRET",
    "LD_SECRET",
    "AGENT_KEY",
    "PYTHONPATH",
    "PERL5OPT",
    "RUBYOPT",
    "GIT_SSH_COMMAND",
    "ARBITRARY_SETTING",
    "",
    "1TOKEN",
    "TOKEN-NAME",
    "TOKEN=NAME",
    "TOKEN\nNAME",
    "ſECRET",
  ])("rejects %j before applying any mappings", (name) => {
    const env = {
      SETUP_VP_AUTH_ENV_CUSTOM_TOKEN: "secret",
      [`SETUP_VP_AUTH_ENV_${name}`]: "sensitive-value",
    };
    const original = { ...env };

    expect(() => applyAuthEnv(env)).toThrow(
      new Error(`authEnv variable ${JSON.stringify(name)} is not a supported credential name`),
    );
    expect(env).toEqual(original);
  });

  it("rejects case-insensitive duplicate names on every platform", () => {
    const env = { SETUP_VP_AUTH_ENV_TOKEN: "one", SETUP_VP_AUTH_ENV_Token: "two" };
    expect(() => applyAuthEnv(env)).toThrow("duplicate credential name");
    expect(env).toEqual({ SETUP_VP_AUTH_ENV_TOKEN: "one", SETUP_VP_AUTH_ENV_Token: "two" });
  });
});
