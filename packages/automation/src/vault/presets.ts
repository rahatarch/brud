import type { ProviderConfig, ModelSelection } from './types.js';

export const DEFAULT_PRESET_PROVIDERS: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', supportsReasoning: true },
    ],
    requiresKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'o1', name: 'o1', supportsReasoning: true },
      { id: 'o3-mini', name: 'o3-mini', supportsReasoning: true },
    ],
    requiresKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
    ],
    requiresKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3', name: 'Llama 3' },
      { id: 'deepseek-r1', name: 'DeepSeek R1', supportsReasoning: true },
    ],
    requiresKey: false,
  },
];

export const DEFAULT_MODEL_SELECTION: ModelSelection = {
  providerID: 'deepseek',
  modelID: 'deepseek-chat',
};