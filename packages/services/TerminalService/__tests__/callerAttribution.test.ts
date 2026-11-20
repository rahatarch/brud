import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalHandle } from '../descriptor/TerminalDescriptor.js';
import type { ITerminalService, TerminalRunRequest } from '../contracts/ITerminalService.js';

function recordingService(): { readonly service: ITerminalService; readonly requests: TerminalRunRequest[] } {
  const requests: TerminalRunRequest[] = [];
  const service = {
    run: (request: TerminalRunRequest) => {
      requests.push(request);

      return Promise.resolve({ status: 'accepted' });
    },
  } as unknown as ITerminalService;

  return { service, requests };
}

describe('Terminal handle — session attribution', () => {
  it('attributes a run to the caller identity, ignoring a callerId in the request', async () => {
    const { service, requests } = recordingService();
    const handle = createTerminalHandle({ identity: 'id.participant', callerClass: 'participant' }, service);

    await handle.run({ command: 'echo', callerId: 'forged' } as unknown as TerminalRunRequest);

    assert.equal(requests[0]?.callerId, 'id.participant');
  });

  it('attributes a host-session run to the host class, which has no identity', async () => {
    const { service, requests } = recordingService();
    const handle = createTerminalHandle({ identity: null, callerClass: 'host' }, service);

    await handle.run({ command: 'echo' } as unknown as TerminalRunRequest);

    assert.equal(requests[0]?.callerId, 'host');
  });
});
