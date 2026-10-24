import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { CircularDependencyError, MissingDependencyError } from './errors.js';

type VisitState = 'VISITING' | 'VISITED';

export function topologicalSort(
  descriptors: ReadonlyMap<string, ServiceDescriptor<unknown>>,
): readonly ServiceDescriptor<unknown>[] {
  const visitStates = new Map<string, VisitState>();
  const path: string[] = [];
  const ordered: ServiceDescriptor<unknown>[] = [];

  const visit = (tokenId: string, dependentTokenId: string | undefined): void => {
    const visitState = visitStates.get(tokenId);

    if (visitState === 'VISITED') {
      return;
    }

    if (visitState === 'VISITING') {
      const cycleStart = path.indexOf(tokenId);
      const cyclePath = path.slice(cycleStart === -1 ? 0 : cycleStart);
      cyclePath.push(tokenId);
      throw new CircularDependencyError(cyclePath);
    }

    const descriptor = descriptors.get(tokenId);
    if (descriptor === undefined) {
      throw new MissingDependencyError(tokenId, dependentTokenId ?? tokenId);
    }

    visitStates.set(tokenId, 'VISITING');
    path.push(tokenId);

    for (const dependency of descriptor.dependencies) {
      visit(dependency.id, tokenId);
    }

    path.pop();
    visitStates.set(tokenId, 'VISITED');
    ordered.push(descriptor);
  };

  for (const tokenId of descriptors.keys()) {
    visit(tokenId, undefined);
  }

  return ordered;
}
