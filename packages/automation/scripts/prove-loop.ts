import { OpenAICompatibleProvider } from '../src/ai/openaiCompatibleProvider.js';
import { runAutomationTurn } from '../src/loop/runLoop.js';

function main(): void {
  const args = process.argv.slice(2);

  let userMessage: string | undefined;
  let workspaceRoot: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && i + 1 < args.length) {
      workspaceRoot = args[i + 1];
      i++;
    } else if (!userMessage) {
      userMessage = args[i];
    }
  }

  if (!userMessage) {
    console.error('Usage: node --import tsx scripts/prove-loop.ts "<user message>" [--workspace <path>]');
    process.exit(1);
  }

  const baseUrl = process.env.BRUD_AI_BASE_URL;
  const apiKey = process.env.BRUD_AI_API_KEY;
  const model = process.env.BRUD_AI_MODEL;

  const missing: string[] = [];
  if (!baseUrl) missing.push('BRUD_AI_BASE_URL');
  if (!apiKey) missing.push('BRUD_AI_API_KEY');
  if (!model) missing.push('BRUD_AI_MODEL');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
  });

  const resolvedWorkspace = workspaceRoot ?? process.cwd();

  console.error(`Brud Auto: sending prompt to ${model} at ${baseUrl}`);
  console.error(`Workspace: ${resolvedWorkspace}`);

  runAutomationTurn({
    userMessage,
    workspaceRoot: resolvedWorkspace,
    provider,
  }).then((result) => {
    console.log(result);
  });
}

main();