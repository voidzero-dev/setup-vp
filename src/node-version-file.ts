import { info } from "@actions/core";
import { getWorkspaceDir } from "./utils.js";
import { createNodeVersionResolver } from "./ci/node-version-file.js";

export const { resolveNodeVersionFile } = createNodeVersionResolver({ getWorkspaceDir, info });
