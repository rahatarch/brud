import * as fs from 'node:fs';
import * as path from 'node:path';

export type ConversationEventType =
  | 'pre_fetch'
  | 'request'
  | 'response'
  | 'block_execute'
  | 'block_result'
  | 'block_error'
  | 'final_answer'
  | 'loop_capped';

export interface ConversationEvent {
  timestamp: string;
  type: ConversationEventType;
  turn: number | 'pre-fetch';
  data: Record<string, unknown>;
}

let logDir: string | null = null;
let enabled = true;

export function initConversationLog(dir: string): string {
  logDir = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'conversation.jsonl');
    fs.writeFileSync(logFile, '');
    return path.resolve(logFile);
  } catch {
    enabled = false;
    return '';
  }
}

export function logEvent(event: ConversationEvent): void {
  if (!enabled || !logDir) return;
  try {
    const logFile = path.join(logDir, 'conversation.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(event) + '\n');
  } catch {
  }
}