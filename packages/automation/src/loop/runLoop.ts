import { getPromptById, initializeToolRegistry } from '@brud/core';
import type { AIProvider, ChatMessage } from '../ai/provider.js';
import { executeBrudBlock } from '../execution/executor.js';
import { initConversationLog, logEvent } from '../debug/conversationLogger.js';

let toolRegistryInitialized = false;

const BRUD_TAG_OPEN = '<BRUD_INSTRUCTIONS>';
const BRUD_TAG_CLOSE = '</BRUD_INSTRUCTIONS>';

function extractBlock(text: string): string | null {
  const openIdx = text.indexOf(BRUD_TAG_OPEN);
  const closeIdx = text.indexOf(BRUD_TAG_CLOSE);

  if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
    return text.substring(openIdx + BRUD_TAG_OPEN.length, closeIdx).trim();
  }

  if (text.includes('<<<<<<<') && openIdx === -1) {
    return text.trim();
  }

  return null;
}

export async function runAutomationTurn(params: {
  userMessage: string;
  workspaceRoot: string;
  provider: AIProvider;
  maxTurns?: number;
  model?: string;
  baseUrl?: string;
}): Promise<string> {
  const maxTurns = params.maxTurns ?? 10;

  if (!toolRegistryInitialized) {
    initializeToolRegistry();
    toolRegistryInitialized = true;
  }

  const logDir = `${params.workspaceRoot}/.brud/automation-debug`;
  const logPath = initConversationLog(logDir);
  if (logPath) {
    console.error(`Brud Auto: conversation log -> ${logPath}`);
  }

  const CODEBASE_METADATA_BLOCK = `<<<<<<< CODEBASE_METADATA [1]

>>>>>>> END CODEBASE_METADATA [1]`;

  let metadataText = '';
  let metadataSuccess = false;
  try {
    metadataText = await executeBrudBlock(CODEBASE_METADATA_BLOCK, params.workspaceRoot);
    metadataSuccess = true;
    console.error(`Brud Auto: pre-fetched CODEBASE_METADATA (${metadataText.length} chars)`);
  } catch {
    console.error('Brud Auto: CODEBASE_METADATA pre-fetch failed, continuing without it');
  }

  logEvent({
    timestamp: new Date().toISOString(),
    type: 'pre_fetch',
    turn: 'pre-fetch',
    data: {
      block: CODEBASE_METADATA_BLOCK,
      success: metadataSuccess,
      resultChars: metadataText.length,
      result: metadataSuccess ? metadataText : 'CODEBASE_METADATA pre-fetch failed',
    },
  });

  const userContent = metadataText
    ? `${metadataText}\n\n---\n\n${params.userMessage}`
    : params.userMessage;

  const masterPromptObj = getPromptById('autonomous-system');
  const masterPrompt = masterPromptObj?.content ?? '';

  const messages: ChatMessage[] = [
    { role: 'system', content: masterPrompt },
    { role: 'user', content: userContent },
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    logEvent({
      timestamp: new Date().toISOString(),
      type: 'request',
      turn,
      data: {
        model: params.model ?? '(unknown)',
        baseUrl: params.baseUrl ?? '(unknown)',
        totalChars: messages.reduce((sum, m) => sum + m.content.length, 0),
        systemChars: messages[0]?.role === 'system' ? messages[0].content.length : 0,
        messageCount: messages.length,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      },
    });

    const responseText = await params.provider.chat(messages, { maxTokens: 4096 });

    const block = extractBlock(responseText);

    logEvent({
      timestamp: new Date().toISOString(),
      type: 'response',
      turn,
      data: {
        responseChars: responseText.length,
        responseText,
        hasBlock: block !== null,
      },
    });

    console.error(`--- Turn ${turn}/${maxTurns} ---`);
    console.error(responseText.substring(0, 200));

    if (!block) {
      logEvent({
        timestamp: new Date().toISOString(),
        type: 'final_answer',
        turn,
        data: {
          answer: responseText,
          turnsUsed: turn,
        },
      });
      return responseText;
    }

    logEvent({
      timestamp: new Date().toISOString(),
      type: 'block_execute',
      turn,
      data: {
        blockChars: block.length,
        block,
      },
    });

    let resultText: string;
    let executionFailed = false;
    let errorMessage = '';
    let errorCode = '';
    let errorDetails = '';

    try {
      const rawResult = await executeBrudBlock(block, params.workspaceRoot);
      resultText = rawResult;
      logEvent({
        timestamp: new Date().toISOString(),
        type: 'block_result',
        turn,
        data: { resultChars: rawResult.length, result: rawResult },
      });
    } catch (err) {
      executionFailed = true;
      const e = err as { message?: string; code?: string; friendly?: string; details?: string };
      errorMessage = e.friendly ?? e.message ?? String(err);
      errorCode = e.code ?? 'UNKNOWN';
      errorDetails = e.details ?? '';

      logEvent({
        timestamp: new Date().toISOString(),
        type: 'block_error',
        turn,
        data: {
          errorMessage,
          errorCode,
          errorDetails,
          stack: err instanceof Error ? err.stack ?? '' : '',
        },
      });

      resultText = '';
    }

    messages.push({ role: 'assistant', content: responseText });

    if (executionFailed) {
      messages.push({
        role: 'user',
        content: `Your previous response produced a Brud block, but executing it failed.

Error: ${errorMessage}
Code: ${errorCode}
Details: ${errorDetails}

Please review the block syntax and produce a corrected Brud block. Remember: every tool call must include an [INDEX], e.g. READ_FILE [1].`,
      });
    } else {
      messages.push({ role: 'user', content: resultText });
    }
  }

  const lastResponse = messages[messages.length - 1]?.content ?? '(no response)';

  logEvent({
    timestamp: new Date().toISOString(),
    type: 'loop_capped',
    turn: maxTurns,
    data: {
      lastResponse,
      turnsUsed: maxTurns,
    },
  });

  return `[Loop capped at ${maxTurns} turns without final answer]\n\nLast AI response:\n${lastResponse}`;
}