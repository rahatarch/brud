import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServiceToken } from '../contracts/serviceToken.js';
import type { ServiceToken } from '../contracts/serviceToken.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceAccessPolicy } from '../contracts/policy.js';
import {
  AllowlistViolationError,
  BlacklistedAccessViolationError,
} from '../contracts/policy.js';
import { KernelRegistry } from '../engine/KernelRegistry.js';
import { KernelAccessBroker } from '../engine/KernelAccessBroker.js';
import { LifecycleStateError, ServiceNotFoundError } from '../engine/errors.js';
import type { KernelLifecycleState } from '../engine/state.js';

interface SensitiveService {
  read(): string;
}

const SENSITIVE = createServiceToken<SensitiveService>('sensitive', 'Sensitive service');
const ROGUE_TOKEN = createServiceToken<unknown>('rogue', 'Rogue service');

function caller(callerId: string): ServiceContext {
  return {
    callerId,
    tier: 'userland',
    workspaceRoot: '/tmp/brud-policy-test',
  };
}

function sensitiveDescriptor(
  policy?: ServiceAccessPolicy,
  tokenId: ServiceToken<SensitiveService> = SENSITIVE,
): ServiceDescriptor<SensitiveService> {
  return {
    token: tokenId,
    tier: 'core',
    dependencies: [],
    accessPolicy: policy,
    factory: () => ({ read: () => 'classified' }),
  };
}

function harness<T>(
  descriptor: ServiceDescriptor<T>,
  initialState: KernelLifecycleState = 'RUNNING',
): { registry: KernelRegistry; broker: KernelAccessBroker; setState(state: KernelLifecycleState): void } {
  const registry = new KernelRegistry();
  registry.register(descriptor);
  registry.setInstance(descriptor.token.id, {
    value: 'instantiated',
    read: () => 'classified',
  });

  let state = initialState;
  const broker = new KernelAccessBroker(registry, () => state);

  return {
    registry,
    broker,
    setState(nextState: KernelLifecycleState): void {
      state = nextState;
    },
  };
}

describe('KernelAccessBroker access policies', () => {
  it('rejects callers listed in the denylist', () => {
    const { broker } = harness(sensitiveDescriptor({ deniedCallers: ['rogue'] }));

    assert.throws(
      () => broker.requestAccess(caller('rogue'), SENSITIVE),
      (error: unknown) => {
        assert.ok(error instanceof BlacklistedAccessViolationError);
        assert.strictEqual(error.code, 'BLACKLISTED_ACCESS');
        assert.strictEqual(error.callerId, 'rogue');
        assert.strictEqual(error.targetServiceId, 'sensitive');
        return true;
      },
    );
  });

  it('matches denylist entries expressed as service tokens', () => {
    const { broker } = harness(sensitiveDescriptor({ deniedCallers: [ROGUE_TOKEN] }));

    assert.throws(
      () => broker.requestAccess(caller('rogue'), SENSITIVE),
      (error: unknown) => error instanceof BlacklistedAccessViolationError && error.code === 'BLACKLISTED_ACCESS',
    );
  });

  it('rejects callers absent from a defined allowlist', () => {
    const { broker } = harness(sensitiveDescriptor({ allowedCallers: ['trusted'] }));

    assert.throws(
      () => broker.requestAccess(caller('stranger'), SENSITIVE),
      (error: unknown) => {
        assert.ok(error instanceof AllowlistViolationError);
        assert.strictEqual(error.code, 'NOT_IN_ALLOWLIST');
        assert.strictEqual(error.callerId, 'stranger');
        assert.strictEqual(error.targetServiceId, 'sensitive');
        return true;
      },
    );
  });

  it('permits callers present in the allowlist', () => {
    const { broker } = harness(sensitiveDescriptor({ allowedCallers: ['trusted'] }));

    assert.strictEqual(broker.requestAccess(caller('trusted'), SENSITIVE).read(), 'classified');
  });

  it('permits unrestricted access when no policy is declared', () => {
    const { broker } = harness(sensitiveDescriptor());

    assert.strictEqual(broker.requestAccess(caller('anyone'), SENSITIVE).read(), 'classified');
  });

  it('prefers the denylist when a caller is both denied and absent from the allowlist', () => {
    const { broker } = harness(sensitiveDescriptor({
      deniedCallers: ['rogue'],
      allowedCallers: ['trusted'],
    }));

    assert.throws(
      () => broker.requestAccess(caller('rogue'), SENSITIVE),
      (error: unknown) => error instanceof BlacklistedAccessViolationError,
    );
  });

  it('returns the dynamic projection for the requesting caller', () => {
    interface PublicView {
      describe(): string;
    }

    interface InternalView extends PublicView {
      readonly secret: string;
    }

    const projectedToken = createServiceToken<PublicView>('projected', 'Projected service');
    const descriptor: ServiceDescriptor<PublicView, InternalView> = {
      token: projectedToken,
      tier: 'core',
      dependencies: [],
      factory: () => ({
        describe: () => 'internal',
        secret: 'classified',
      }),
      project: (instance, context) => ({
        describe: () => `${context.callerId}:${instance.secret}`,
      }),
    };

    const registry = new KernelRegistry();
    registry.register(descriptor);
    registry.setInstance(projectedToken.id, { secret: 'classified' });
    const broker = new KernelAccessBroker(registry, () => 'RUNNING');

    const view = broker.requestAccess(caller('auditor'), projectedToken);
    assert.strictEqual(view.describe(), 'auditor:classified');
    assert.strictEqual('secret' in view, false);
  });

  it('rejects access before the kernel reaches RUNNING', () => {
    const { broker } = harness(sensitiveDescriptor(), 'BOOTING');

    assert.throws(
      () => broker.requestAccess(caller('trusted'), SENSITIVE),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleStateError);
        assert.strictEqual(error.code, 'INVALID_LIFECYCLE_STATE');
        return true;
      },
    );
  });

  it('throws ServiceNotFoundError for unregistered tokens', () => {
    const broker = new KernelAccessBroker(new KernelRegistry(), () => 'RUNNING');

    assert.throws(
      () => broker.requestAccess(caller('trusted'), SENSITIVE),
      (error: unknown) => {
        assert.ok(error instanceof ServiceNotFoundError);
        assert.strictEqual(error.code, 'SERVICE_NOT_FOUND');
        assert.strictEqual(error.tokenId, 'sensitive');
        return true;
      },
    );
  });

  it('throws ServiceNotFoundError when a descriptor has no instance', () => {
    const registry = new KernelRegistry();
    registry.register(sensitiveDescriptor());
    const broker = new KernelAccessBroker(registry, () => 'RUNNING');

    assert.throws(
      () => broker.requestAccess(caller('trusted'), SENSITIVE),
      (error: unknown) => error instanceof ServiceNotFoundError,
    );
  });
});

describe('KernelAccessBroker introspection', () => {
  it('reports registration through hasService', () => {
    const { broker } = harness(sensitiveDescriptor());

    assert.strictEqual(broker.hasService(SENSITIVE), true);
    assert.strictEqual(broker.hasService(ROGUE_TOKEN), false);
  });

  it('lists services with their initialization state', () => {
    const registry = new KernelRegistry();
    registry.register(sensitiveDescriptor());
    const broker = new KernelAccessBroker(registry, () => 'RUNNING');

    assert.deepStrictEqual(broker.listServices(), [{
      id: 'sensitive',
      description: 'Sensitive service',
      tier: 'core',
      initialized: false,
    }]);

    registry.setInstance(SENSITIVE.id, { value: 'instantiated' });

    assert.deepStrictEqual(broker.listServices(), [{
      id: 'sensitive',
      description: 'Sensitive service',
      tier: 'core',
      initialized: true,
    }]);
  });

  it('keeps the access broker state checker live', () => {
    const { broker, setState } = harness(sensitiveDescriptor(), 'BOOTING');

    assert.throws(() => broker.requestAccess(caller('trusted'), SENSITIVE), LifecycleStateError);

    setState('RUNNING');

    assert.strictEqual(broker.requestAccess(caller('trusted'), SENSITIVE).read(), 'classified');
  });
});
