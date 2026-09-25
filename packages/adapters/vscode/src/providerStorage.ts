import * as vscode from 'vscode';
import type { ProviderConfig, ModelSelection, ProviderStorageAdapter } from '@brud/automation';

const PROVIDERS_KEY = 'brud.vault.providers';
const SELECTION_KEY = 'brud.vault.activeSelection';

export class VSCodeProviderStorage implements ProviderStorageAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  async loadProviders(): Promise<ProviderConfig[] | undefined> {
    return this.context.globalState.get<ProviderConfig[]>(PROVIDERS_KEY);
  }

  async saveProviders(providers: ProviderConfig[]): Promise<void> {
    return this.context.globalState.update(PROVIDERS_KEY, providers);
  }

  async loadSelection(): Promise<ModelSelection | undefined> {
    return this.context.globalState.get<ModelSelection>(SELECTION_KEY);
  }

  async saveSelection(selection: ModelSelection): Promise<void> {
    return this.context.globalState.update(SELECTION_KEY, selection);
  }
}