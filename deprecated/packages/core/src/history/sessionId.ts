import type { HistorySession } from './types.js';

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

export function getNextSequenceNumber(existingSessions: HistorySession[]): number {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const todaySessions = existingSessions.filter(session => {
    const parsed = parseSessionId(session.sessionId);
    return parsed !== null && parsed.date === todayStr;
  });

  if (todaySessions.length === 0) {
    return 1;
  }

  const maxSeq = Math.max(...todaySessions.map(s => {
    const parsed = parseSessionId(s.sessionId);
    return parsed ? parsed.sequence : 0;
  }));

  return maxSeq + 1;
}