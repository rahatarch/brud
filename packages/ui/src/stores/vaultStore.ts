import { create } from 'zustand';
import type { VaultSanitizedProvider, VaultModelSelection, VaultProviderConfig } from '@brud/protocol';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';
import type { ProvidersLoadedMessage, ModelSelectedMessage } from '@brud/protocol';

export interface VaultStore {
  providers: VaultSanitizedProvider[];
  activeSelection: VaultModelSelection | null;
  isLoading: boolean;
  initVault: () => () => void;
  selectModel: (selection: VaultModelSelection) => void;
  connectKey: (providerId: string, apiKey: string) => void;
  disconnectKey: (providerId: string) => void;
  saveProvider: (provider: VaultProviderConfig, apiKey?: string) => void;
  deleteProvider: (providerId: string) => void;
}

export const useVaultStore = create<VaultStore>((set) => ({
  providers: [],
  activeSelection: null,
  isLoading: true,

  initVault: () => {
    const cleanup = onExtensionMessage((message) => {
      if (message.command === 'providersLoaded') {
        const msg = message as ProvidersLoadedMessage;
        set({ providers: msg.providers, activeSelection: msg.activeSelection, isLoading: false });
      } else if (message.command === 'modelSelected') {
        const msg = message as ModelSelectedMessage;
        set({ activeSelection: msg.selection });
      }
    });
    sendToExtension({ command: 'requestProviders' } as never);
    return cleanup;
  },

  selectModel: (selection) => {
    sendToExtension({ command: 'selectModel', selection } as never);
    set({ activeSelection: selection });
  },

  connectKey: (providerId, apiKey) => {
    sendToExtension({ command: 'connectKey', providerId, apiKey } as never);
  },

  disconnectKey: (providerId) => {
    sendToExtension({ command: 'disconnectKey', providerId } as never);
  },

  saveProvider: (provider, apiKey) => {
    sendToExtension({ command: 'saveProvider', provider, apiKey } as never);
  },

  deleteProvider: (providerId) => {
    sendToExtension({ command: 'deleteProvider', providerId } as never);
  },
}));