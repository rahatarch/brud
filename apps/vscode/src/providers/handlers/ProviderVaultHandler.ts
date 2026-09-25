import { ProviderRegistry } from '@brud/automation';
import type {
  ExtensionMessage,
  WebviewMessage,
  SelectModelMessage,
  SaveProviderMessage,
  DeleteProviderMessage,
  ConnectKeyMessage,
  DisconnectKeyMessage,
  ProvidersLoadedMessage,
  ModelSelectedMessage,
} from '@brud/protocol';

export class ProviderVaultHandler {
  constructor(
    private registry: ProviderRegistry,
    private postMessage: (message: ExtensionMessage) => Thenable<boolean>,
  ) {}

  async handleMessage(message: WebviewMessage): Promise<boolean> {
    switch (message.command) {
      case 'requestProviders':
        await this.handleRequestProviders();
        return true;
      case 'selectModel':
        await this.handleSelectModel(message as SelectModelMessage);
        return true;
      case 'saveProvider':
        await this.handleSaveProvider(message as SaveProviderMessage);
        return true;
      case 'deleteProvider':
        await this.handleDeleteProvider(message as DeleteProviderMessage);
        return true;
      case 'connectKey':
        await this.handleConnectKey(message as ConnectKeyMessage);
        return true;
      case 'disconnectKey':
        await this.handleDisconnectKey(message as DisconnectKeyMessage);
        return true;
      default:
        return false;
    }
  }

  private async postProvidersLoaded(): Promise<void> {
    const providers = await this.registry.getSanitizedProviders();
    const activeSelection = this.registry.getActiveSelection();
    const msg: ProvidersLoadedMessage = {
      command: 'providersLoaded',
      providers,
      activeSelection,
    };
    await this.postMessage(msg);
  }

  private async handleRequestProviders(): Promise<void> {
    try {
      await this.postProvidersLoaded();
    } catch (error) {
      console.error('[ProviderVaultHandler] Failed to request providers:', error);
    }
  }

  private async handleSelectModel(msg: SelectModelMessage): Promise<void> {
    try {
      await this.registry.setActiveSelection(msg.selection);
      const selectionMsg: ModelSelectedMessage = {
        command: 'modelSelected',
        selection: msg.selection,
      };
      await this.postMessage(selectionMsg);
      await this.postProvidersLoaded();
    } catch (error) {
      console.error('[ProviderVaultHandler] Failed to select model:', error);
    }
  }

  private async handleSaveProvider(msg: SaveProviderMessage): Promise<void> {
    try {
      await this.registry.saveCustomProvider(msg.provider, msg.apiKey);
      await this.postProvidersLoaded();
    } catch (error) {
      console.error('[ProviderVaultHandler] Failed to save provider:', error);
    }
  }

  private async handleDeleteProvider(msg: DeleteProviderMessage): Promise<void> {
    try {
      await this.registry.deleteCustomProvider(msg.providerId);
      await this.postProvidersLoaded();
    } catch (error) {
      console.error('[ProviderVaultHandler] Failed to delete provider:', error);
    }
  }

  private async handleConnectKey(msg: ConnectKeyMessage): Promise<void> {
    try {
      await this.registry.connectKey(msg.providerId, msg.apiKey);
      await this.postProvidersLoaded();
    } catch (error) {
      console.error('[ProviderVaultHandler] Failed to connect key:', error);
    }
  }

  private async handleDisconnectKey(msg: DisconnectKeyMessage): Promise<void> {
    try {
      await this.registry.disconnectKey(msg.providerId);
      await this.postProvidersLoaded();
    } catch (error) {
      console.error('[ProviderVaultHandler] Failed to disconnect key:', error);
    }
  }
}