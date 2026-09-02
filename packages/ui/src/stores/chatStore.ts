import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  type: 'user' | 'brud';
  content: string;
}

export type SessionState = 'idle' | 'working' | 'complete';

export interface ChatStore {
  messages: ChatMessage[];
  sessionState: SessionState;
  sendPrompt: (text: string) => void;
  addReport: (content: string) => void;
  resetSession: () => void;
}

export const useChatStore = create<ChatStore>((set) => {
  let idCounter = 0;
  const generateId = () => `msg_${Date.now()}_${idCounter++}`;

  return {
    messages: [],
    sessionState: 'idle',

    sendPrompt: (text) =>
      set((state) => ({
        messages: [...state.messages, { id: generateId(), type: 'user', content: text }],
        sessionState: 'working',
      })),

    addReport: (content) =>
      set((state) => ({
        messages: [...state.messages, { id: generateId(), type: 'brud', content }],
        sessionState: 'complete',
      })),

    resetSession: () =>
      set({ messages: [], sessionState: 'idle' }),
  };
});