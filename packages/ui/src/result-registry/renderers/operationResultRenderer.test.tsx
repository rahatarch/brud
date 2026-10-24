import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { operationResultRenderer } from './operationResultRenderer';

function failedDirectory(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'OP-test-001',
    operationIndex: 0,
    kind: 'read_directory',
    status: 'failed',
    message: 'Read batch too large.',
    path: '.',
    ...overrides,
  };
}

describe('operationResultRenderer diagnostics', () => {
  it('appends Code and Details lines to the copy formatter', () => {
    const formatted = operationResultRenderer.copyFormatter(failedDirectory({
      code: 'BATCH_LIMIT_EXCEEDED',
      details: 'Requested 435 files; the limit is 100 per batch. Narrow the pattern.',
    }));

    const lines = formatted.split('\n');
    assert.strictEqual(lines[0], '[failed] Read Directory: . — Read batch too large.');
    assert.strictEqual(lines[1], '  Code: BATCH_LIMIT_EXCEEDED');
    assert.strictEqual(lines[2], '  Details: Requested 435 files; the limit is 100 per batch. Narrow the pattern.');
  });

  it('re-indents multi-line details by two spaces', () => {
    const formatted = operationResultRenderer.copyFormatter(failedDirectory({
      details: 'first line\nsecond line',
    }));

    assert.ok(formatted.includes('\n  Details: first line\n  second line'));
  });

  it('keeps the copy formatter unchanged when diagnostics are absent', () => {
    const formatted = operationResultRenderer.copyFormatter(failedDirectory());
    assert.strictEqual(formatted, '[failed] Read Directory: . — Read batch too large.');
  });

  it('keeps summaryFormatter on a single line without diagnostics', () => {
    const summary = operationResultRenderer.summaryFormatter(failedDirectory({
      code: 'BATCH_LIMIT_EXCEEDED',
      details: 'Requested 435 files; the limit is 100 per batch.',
    }));

    assert.strictEqual(summary, '[failed] Read Directory: . — Read batch too large.');
    assert.strictEqual(summary.includes('\n'), false);
    assert.strictEqual(summary.includes('Requested 435'), false);
  });

  it('renders an expandable disclosure with code and details for failed operations', () => {
    const html = renderToStaticMarkup(
      operationResultRenderer.renderSection(failedDirectory({
        code: 'BATCH_LIMIT_EXCEEDED',
        details: 'Requested 435 files; the limit is 100 per batch.',
      })) as React.ReactElement,
    );

    assert.ok(html.includes('<details'));
    assert.ok(html.includes('Error Details'));
    assert.ok(html.includes('Code: BATCH_LIMIT_EXCEEDED'));
    assert.ok(html.includes('Details: Requested 435 files; the limit is 100 per batch.'));
  });

  it('does not render the disclosure for successful operations', () => {
    const html = renderToStaticMarkup(
      operationResultRenderer.renderSection(failedDirectory({
        status: 'success',
        code: 'SHOULD_NOT_RENDER',
        details: 'should not render',
      })) as React.ReactElement,
    );

    assert.ok(!html.includes('Error Details'));
    assert.ok(!html.includes('SHOULD_NOT_RENDER'));
  });

  it('does not render the disclosure when diagnostics are absent', () => {
    const html = renderToStaticMarkup(
      operationResultRenderer.renderSection(failedDirectory()) as React.ReactElement,
    );

    assert.ok(!html.includes('Error Details'));
    assert.ok(html.includes('Read batch too large.'));
  });
});
