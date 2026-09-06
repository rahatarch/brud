import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseLegacyFormat } from './legacy.js';
import { parseYamlFormat } from './yaml.js';

describe('Terminal Parser - Legacy Format', () => {

  it('parses single command', () => {
    const input = `<<<<<<< TERMINAL_COMMAND [1]
Command: echo hello
>>>>>>> END TERMINAL_COMMAND [1]`;
    const ops = parseLegacyFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].kind, 'terminal_command');
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'echo hello');
  });

  it('parses sequential commands', () => {
    const input = `<<<<<<< TERMINAL_COMMAND [1]
Commands:
- npm install
- npm run build
Mode: sequential
>>>>>>> END TERMINAL_COMMAND [1]`;
    const ops = parseLegacyFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.deepStrictEqual(op.commands, ['npm install', 'npm run build']);
    assert.strictEqual(op.mode, 'sequential');
  });

  it('parses parallel commands', () => {
    const input = `<<<<<<< TERMINAL_COMMAND [1]
Commands:
- npm run lint
- npm run test
Mode: parallel
>>>>>>> END TERMINAL_COMMAND [1]`;
    const ops = parseLegacyFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.deepStrictEqual(op.commands, ['npm run lint', 'npm run test']);
    assert.strictEqual(op.mode, 'parallel');
  });

  it('parses conditional with OnSuccess', () => {
    const input = `<<<<<<< TERMINAL_COMMAND [1]
Command: npm run build
OnSuccess: npm run deploy
>>>>>>> END TERMINAL_COMMAND [1]`;
    const ops = parseLegacyFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'npm run build');
    assert.ok(op.onSuccess);
    assert.strictEqual(op.onSuccess.commands[0], 'npm run deploy');
  });

  it('parses conditional with OnFailure', () => {
    const input = `<<<<<<< TERMINAL_COMMAND [1]
Command: npm run build
OnFailure: npm run cleanup
>>>>>>> END TERMINAL_COMMAND [1]`;
    const ops = parseLegacyFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'npm run build');
    assert.ok(op.onFailure);
    assert.strictEqual(op.onFailure.commands[0], 'npm run cleanup');
  });

  it('parses interactive with answers', () => {
    const input = `<<<<<<< TERMINAL_INTERACTIVE [1]
Command: bash setup.sh
Answers:
- Brud
- 1
>>>>>>> END TERMINAL_INTERACTIVE [1]`;
    const ops = parseLegacyFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].kind, 'terminal_interactive');
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'bash setup.sh');
    assert.deepStrictEqual(op.answers, ['Brud', '1']);
  });
});

describe('Terminal Parser - YAML Format', () => {

  it('parses single command', () => {
    const input = `operation: terminal_command
index: "1"
command: echo hello`;
    const ops = parseYamlFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'echo hello');
  });

  it('parses sequential commands array', () => {
    const input = `operation: terminal_command
index: "1"
commands:
  - npm install
  - npm run build
mode: sequential`;
    const ops = parseYamlFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.deepStrictEqual(op.commands, ['npm install', 'npm run build']);
    assert.strictEqual(op.mode, 'sequential');
  });

  it('parses parallel commands array', () => {
    const input = `operation: terminal_command
index: "1"
commands:
  - npm run lint
  - npm run test
mode: parallel`;
    const ops = parseYamlFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.deepStrictEqual(op.commands, ['npm run lint', 'npm run test']);
    assert.strictEqual(op.mode, 'parallel');
  });

  it('parses conditional with on_success', () => {
    const input = `operation: terminal_command
index: "1"
command: npm run build
on_success:
  type: sequential
  commands:
    - npm run deploy`;
    const ops = parseYamlFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'npm run build');
    assert.ok(op.onSuccess);
    assert.strictEqual(op.onSuccess.commands[0], 'npm run deploy');
  });

  it('parses conditional with on_failure', () => {
    const input = `operation: terminal_command
index: "1"
command: npm run build
on_failure:
  type: sequential
  commands:
    - npm run cleanup`;
    const ops = parseYamlFormat(input, ['/workspace']);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as any;
    assert.strictEqual(op.command, 'npm run build');
    assert.ok(op.onFailure);
    assert.strictEqual(op.onFailure.commands[0], 'npm run cleanup');
  });
});