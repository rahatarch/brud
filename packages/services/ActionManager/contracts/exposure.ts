/** Exposure name for the action manager (`brud.actions@1`). */
export const ACTION_MANAGER_EXPOSURE = 'brud.actions';

/** Capability required by the `brud.actions` policy. */
export const ACTIONS_REGISTER_CAPABILITY = 'actions:register';

/** Kind tag for registered actions; owned by ActionManager (D6). */
export const BRUD_KIND_ACTION = 'action' as const;

/** Dispatch exposure the Router resolves for the `action` kind (kernel callers only). */
export const ACTION_MANAGER_DISPATCH_EXPOSURE = 'brud.actions.dispatch';
