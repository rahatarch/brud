import { BrudSettings, DEFAULT_SETTINGS } from './types';

export function mergeSettings(
  vscodeGlobal: Partial<BrudSettings>,
  vscodeWorkspace: Partial<BrudSettings>,
  brudJson: Partial<BrudSettings>,
): { settings: BrudSettings; warnings: string[] } {
  const warnings: string[] = [];
  if (Object.keys(vscodeWorkspace).length > 0 && Object.keys(brudJson).length > 0) {
    warnings.push('Both VS Code workspace settings and .brud/settings.json are active. .brud/settings.json takes precedence.');
  }

  const mergedToolAllowList: Record<string, boolean> = {
    ...(vscodeGlobal.toolAllowList ?? {}),
    ...(vscodeWorkspace.toolAllowList ?? {}),
    ...(brudJson.toolAllowList ?? {}),
  };

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...vscodeGlobal,
      ...vscodeWorkspace,
      ...brudJson,
      toolAllowList: mergedToolAllowList,
    },
    warnings,
  };
}