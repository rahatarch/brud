export function generateSessionId(timestamp: Date, sequence: number): string {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');
  const seq = String(sequence).padStart(3, '0');
  return `BR-${year}${month}${day}-${seq}`;
}

export function parseSessionId(sessionId: string): { date: string; sequence: number } | null {
  const match = sessionId.match(/^BR-(\d{4})(\d{2})(\d{2})-(\d{3})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, seq] = match;
  return {
    date: `${year}-${month}-${day}`,
    sequence: parseInt(seq, 10),
  };
}