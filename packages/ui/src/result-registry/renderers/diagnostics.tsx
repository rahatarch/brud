interface DiagnosticData {
  code?: string;
  details?: string;
}

export function formatDiagnosticLines(data: DiagnosticData): string {
  const lines: string[] = [];
  if (data.code) {
    lines.push(`Code: ${data.code}`);
  }
  if (data.details) {
    lines.push(`Details: ${data.details.split('\n').join('\n  ')}`);
  }
  return lines.join('\n');
}

export function appendDiagnosticCopy(lines: string[], data: DiagnosticData): string[] {
  if (data.code) {
    lines.push(`  Code: ${data.code}`);
  }
  if (data.details) {
    lines.push(`  Details: ${data.details.split('\n').join('\n  ')}`);
  }
  return lines;
}

export function DiagnosticDisclosure({ code, details, label = 'Error Details' }: DiagnosticData & { label?: string }) {
  if (!code && !details) {
    return null;
  }

  return (
    <details className="group">
      <summary className="text-xs font-medium text-red-400 cursor-pointer list-none flex items-center gap-1 hover:text-red-300 select-none py-1">
        <span className="opacity-60 group-open:opacity-100 transition-opacity">▶</span>
        {label}
      </summary>
      <pre className="mt-1 ml-3 text-xs text-text-secondary bg-surface-2 border border-border-subtle rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto">
        {formatDiagnosticLines({ code, details })}
      </pre>
    </details>
  );
}
