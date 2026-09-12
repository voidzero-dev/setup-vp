export interface ResolutionContext {
  getWorkspaceDir: () => string;
  info: (message: string) => void;
  debug: (message: string) => void;
  warning: (message: string) => void;
}

export function resolutionContext(workspaceRoot: string): ResolutionContext {
  return {
    getWorkspaceDir: () => workspaceRoot,
    info: console.info,
    debug: () => {},
    warning: console.warn,
  };
}
