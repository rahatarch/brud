import { before, describe, it } from 'node:test';
import assert from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { appendDiagnosticCopy, DiagnosticDisclosure, formatDiagnosticLines } from './diagnostics';

type TerminalRenderer = typeof import('./terminalRenderer').terminalRenderer;
type ToolInfoRenderer = typeof import('./toolInfoRenderer').toolInfoRenderer;

let terminalRenderer: TerminalRenderer;
let toolInfoRenderer: ToolInfoRenderer;

before(async () => {
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({
      postMessage: () => undefined,
      getState: () => undefined,
      setState: () => undefined,
    }),
  });
  terminalRenderer = (await import('./terminalRenderer')).terminalRenderer;
  toolInfoRenderer = (await import('./toolInfoRenderer')).toolInfoRenderer;
});

describe('diagnostics helpers', () => {
  it('formats code and details lines', () => {
    const text = formatDiagnosticLines({ code: 'EXECUTION_FAILED', details: 'Command failed.' });
    assert.strictEqual(text, 'Code: EXECUTION_FAILED\nDetails: Command failed.');
  });

  it('indents multi-line details by two spaces', () => {
    const text = formatDiagnosticLines({ details: 'first\nsecond' });
    assert.strictEqual(text, 'Details: first\n  second');
  });

  it('returns an empty string when no diagnostics exist', () => {
    assert.strictEqual(formatDiagnosticLines({}), '');
  });

  it('appends two-space indented copy lines', () => {
    const lines = appendDiagnosticCopy(['Summary'], { code: 'X', details: 'why\nmore' });
    assert.deepStrictEqual(lines, ['Summary', '  Code: X', '  Details: why\n  more']);
  });

  it('renders a native disclosure with code and details', () => {
    const html = renderToStaticMarkup(<DiagnosticDisclosure code="EXECUTION_FAILED" details="boom" />);
    assert.ok(html.includes('<details'));
    assert.ok(html.includes('Error Details'));
    assert.ok(html.includes('Code: EXECUTION_FAILED'));
    assert.ok(html.includes('Details: boom'));
  });

  it('supports a custom disclosure label', () => {
    const html = renderToStaticMarkup(<DiagnosticDisclosure details="boom" label="Failure Details" />);
    assert.ok(html.includes('Failure Details'));
  });

  it('renders nothing when diagnostics are absent', () => {
    assert.strictEqual(renderToStaticMarkup(<DiagnosticDisclosure />), '');
  });
});

describe('terminalRenderer diagnostics', () => {
  const failed = {
    command: 'npm test',
    output: 'assert failed',
    exitCode: 1,
    duration: 12,
    success: false,
    code: 'EXECUTION_FAILED',
    details: 'The command "npm test" exited with code 1.',
    status: 'failed',
  };

  it('renders the disclosure for failed commands', () => {
    const html = renderToStaticMarkup(terminalRenderer.renderSection(failed) as React.ReactElement);
    assert.ok(html.includes('Error Details'));
    assert.ok(html.includes('Code: EXECUTION_FAILED'));
    assert.ok(html.includes('Details: The command'));
  });

  it('does not render the disclosure for successful commands', () => {
    const html = renderToStaticMarkup(
      terminalRenderer.renderSection({ ...failed, success: true, code: undefined, details: undefined }) as React.ReactElement,
    );
    assert.ok(!html.includes('Error Details'));
  });

  it('appends Code and Details to the copy output', () => {
    const copied = terminalRenderer.copyFormatter(failed);
    assert.ok(copied.includes('Command: npm test'));
    assert.ok(copied.includes('\n  Code: EXECUTION_FAILED'));
    assert.ok(copied.includes('\n  Details: The command'));
  });

  it('keeps the summary on a single line', () => {
    const summaryFormatter = terminalRenderer.summaryFormatter;
    assert.ok(summaryFormatter);
    const summary = summaryFormatter(failed);
    assert.strictEqual(summary.includes('\n'), false);
    assert.ok(summary.includes('[failure] Terminal: npm test'));
  });
});

describe('toolInfoRenderer diagnostics', () => {
  const failed = {
    message: 'Tool "ghost" not found.',
    status: 'failed',
    kind: 'get_tool_info',
    toolKind: 'ghost',
    code: 'TOOL_NOT_FOUND',
    details: 'No tool registered with kind "ghost".',
  };

  it('renders the disclosure for a failed lookup', () => {
    const html = renderToStaticMarkup(toolInfoRenderer.renderSection(failed) as React.ReactElement);
    assert.ok(html.includes('Error Details'));
    assert.ok(html.includes('Code: TOOL_NOT_FOUND'));
  });

  it('appends diagnostics to the copy output', () => {
    const copied = toolInfoRenderer.copyFormatter(failed);
    assert.ok(copied.startsWith('Tool "ghost" not found.'));
    assert.ok(copied.includes('  Code: TOOL_NOT_FOUND'));
    assert.ok(copied.includes('  Details: No tool registered'));
  });

  it('prints the queried tool kind in the summary', () => {
    assert.strictEqual(toolInfoRenderer.summaryFormatter!(failed), '[failed] Tool Info: ghost');
  });
});
