import { info, debug, warning } from "@actions/core";
import { getWorkspaceDir } from "./utils.js";
import { createVersionResolver } from "./ci/version-file.js";

export const {
  resolveVitePlusVersion,
  resolveVitePlusVersionFile,
  tryResolveVitePlusVersionFile,
  tryResolveVitePlusVersionFromProject,
} = createVersionResolver({ getWorkspaceDir, info, debug, warning });
