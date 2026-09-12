import { info, debug, warning } from "@actions/core";
import { getWorkspaceDir } from "./utils.js";
import { createLockfileResolver } from "./ci/lockfile-version.js";

export const { tryResolveVitePlusVersionFromLockfile, parseVitePlusVersionFromLockfile } =
  createLockfileResolver({ getWorkspaceDir, info, debug, warning });
