import { PluginDependencyError, PluginDuplicateError } from './errors.js';
import type { IBrudPlugin } from './IBrudPlugin.js';

type VisitState = 'VISITING' | 'VISITED';

/**
 * Resolves a deterministic topological activation order.
 *
 * Every dependency listed in `manifest.dependencies` is placed before its
 * dependent. Ties are broken by registration order, so the same input always
 * yields the same output.
 *
 * @param plugins - Registered plugins, in registration order.
 * @returns Plugin identifiers with dependencies first.
 * @throws PluginDuplicateError when two plugins share an identifier.
 * @throws PluginDependencyError when a dependency is missing or a cycle exists.
 */
export function resolveActivationOrder(plugins: readonly IBrudPlugin[]): readonly string[] {
  const byId = new Map<string, IBrudPlugin>();

  for (const plugin of plugins) {
    const pluginId = plugin.manifest.id;

    if (byId.has(pluginId)) {
      throw new PluginDuplicateError(pluginId);
    }

    byId.set(pluginId, plugin);
  }

  const visitStates = new Map<string, VisitState>();
  const path: string[] = [];
  const ordered: string[] = [];

  const visit = (pluginId: string, dependentId: string | undefined): void => {
    const visitState = visitStates.get(pluginId);

    if (visitState === 'VISITED') {
      return;
    }

    if (visitState === 'VISITING') {
      const cycleStart = path.indexOf(pluginId);
      const cyclePath = path.slice(cycleStart === -1 ? 0 : cycleStart);
      cyclePath.push(pluginId);
      throw new PluginDependencyError({ pluginId, cyclePath });
    }

    const plugin = byId.get(pluginId);
    if (plugin === undefined) {
      throw new PluginDependencyError({
        pluginId: dependentId ?? pluginId,
        dependencyId: pluginId,
      });
    }

    visitStates.set(pluginId, 'VISITING');
    path.push(pluginId);

    for (const dependencyId of plugin.manifest.dependencies ?? []) {
      visit(dependencyId, pluginId);
    }

    path.pop();
    visitStates.set(pluginId, 'VISITED');
    ordered.push(pluginId);
  };

  for (const plugin of plugins) {
    visit(plugin.manifest.id, undefined);
  }

  return ordered;
}

/**
 * Derives the deactivation order from a resolved activation order.
 *
 * Deactivation is always the exact reverse of activation, guaranteeing that a
 * plugin is stopped before any plugin it depends on.
 *
 * @param activationOrder - Order returned by {@link resolveActivationOrder}.
 * @returns The same identifiers in reverse order.
 */
export function resolveDeactivationOrder(
  activationOrder: readonly string[],
): readonly string[] {
  return [...activationOrder].reverse();
}
