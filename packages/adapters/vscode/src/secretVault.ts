import * as vscode from 'vscode';
import type { SecretVault } from '@brud/automation';

const KEY_PREFIX = 'brud.vault.';

export class VSCodeSecretVault implements SecretVault {
  constructor(private context: vscode.ExtensionContext) {}

  async getSecret(key: string): Promise<string | undefined> {
    return this.context.secrets.get(KEY_PREFIX + key);
  }

  async storeSecret(key: string, value: string): Promise<void> {
    return this.context.secrets.store(KEY_PREFIX + key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    return this.context.secrets.delete(KEY_PREFIX + key);
  }
}