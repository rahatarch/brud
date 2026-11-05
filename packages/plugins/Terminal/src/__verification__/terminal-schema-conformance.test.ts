/**
 * Goal 3 — Terminal schema conformance.
 *
 * The schemas are read from the live kernel registry, not from the plugin's
 * exported constants, so a registration drift is visible here.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RegisteredToolInfo } from '@brud/kernel';
import { bootTerminalHarness, errorText } from './support/harness.test.js';
import type { TerminalHarness } from './support/harness.test.js';

interface ObjectSchema extends Record<string, unknown> {
  readonly type?: string;
  readonly properties?: Record<string, Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

let harness: TerminalHarness;
let command: RegisteredToolInfo;
let interactive: RegisteredToolInfo;

function schemaOf(tool: RegisteredToolInfo): ObjectSchema {
  return tool.parametersSchema as ObjectSchema;
}

before(async () => {
  harness = await bootTerminalHarness({ prefix: 'brud-terminal-schema-' });

  const commandTool = harness.tools.getTool('terminal_command');
  const interactiveTool = harness.tools.getTool('terminal_interactive');

  assert.ok(commandTool, 'terminal_command must be registered');
  assert.ok(interactiveTool, 'terminal_interactive must be registered');
  command = commandTool;
  interactive = interactiveTool;
});

after(async () => {
  await harness.shutdown();
});

describe('Goal 3 — live registration', () => {
  it('registers terminal_command in the live kernel', () => {
    assert.equal(command.name, 'terminal_command');
    assert.equal(command.ownerPluginId, 'akkhar-labs.plugin.terminal');
  });

  it('registers terminal_interactive in the live kernel', () => {
    assert.equal(interactive.name, 'terminal_interactive');
    assert.equal(interactive.ownerPluginId, 'akkhar-labs.plugin.terminal');
  });
});

describe('Goal 3 — schema shape', () => {
  it('marks terminal_command additionalProperties false', () => {
    assert.equal(schemaOf(command).additionalProperties, false);
  });

  it('marks terminal_interactive additionalProperties false', () => {
    assert.equal(schemaOf(interactive).additionalProperties, false);
  });

  it('contains no index or kind property in terminal_command', () => {
    const properties = schemaOf(command).properties ?? {};

    assert.equal('index' in properties, false);
    assert.equal('kind' in properties, false);
  });

  it('contains no index or kind property in terminal_interactive', () => {
    const properties = schemaOf(interactive).properties ?? {};

    assert.equal('index' in properties, false);
    assert.equal('kind' in properties, false);
  });

  it('requires command and answers for terminal_interactive', () => {
    assert.deepEqual(schemaOf(interactive).required, ['command', 'answers']);
    assert.ok('command' in (schemaOf(interactive).properties ?? {}));
    assert.ok('answers' in (schemaOf(interactive).properties ?? {}));
  });

  it('requires no fields for terminal_command', () => {
    assert.deepEqual(schemaOf(command).required, []);
  });

  it('types timeout as a number of seconds in terminal_command', () => {
    const timeout = (schemaOf(command).properties ?? {}).timeout;

    assert.equal(timeout?.type, 'number');
    assert.match(String(timeout?.description), /seconds/iu);
  });

  it('types timeout as a number of seconds in terminal_interactive', () => {
    const timeout = (schemaOf(interactive).properties ?? {}).timeout;

    assert.equal(timeout?.type, 'number');
    assert.match(String(timeout?.description), /seconds/iu);
  });

  it('enumerates only sequential and parallel for mode', () => {
    const mode = (schemaOf(command).properties ?? {}).mode;

    assert.deepEqual(mode?.enum, ['sequential', 'parallel']);
  });

  it('declares array item types for commands and answers', () => {
    const commands = (schemaOf(command).properties ?? {}).commands;
    const answers = (schemaOf(interactive).properties ?? {}).answers;

    assert.equal(commands?.type, 'array');
    assert.deepEqual(commands?.items, { type: 'string' });
    assert.equal(answers?.type, 'array');
    assert.deepEqual(answers?.items, { type: 'string' });
  });
});

describe('Goal 3 — schema enforcement', () => {
  it('rejects an unknown terminal_command field with TOOL_VALIDATION_ERROR', async () => {
    const result = await harness.run({ command: 'echo hi', unexpected: true });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /TOOL_VALIDATION_ERROR/u);
  });

  it('rejects an unknown terminal_interactive field with TOOL_VALIDATION_ERROR', async () => {
    const result = await harness.execute('terminal_interactive', {
      command: 'echo hi',
      answers: [],
      unexpected: true,
    });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /TOOL_VALIDATION_ERROR/u);
  });

  it('rejects terminal_interactive without answers at the schema gate', async () => {
    const result = await harness.execute('terminal_interactive', { command: 'echo hi' });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /TOOL_VALIDATION_ERROR/u);
  });
});