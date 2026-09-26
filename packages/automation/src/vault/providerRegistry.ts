import type {
  SecretVault,
  ProviderConfig,
  ProviderStorageAdapter,
  ModelSelection,
  SanitizedProvider,
  ActiveCredentials,
} from './types.js';
import { DEFAULT_PRESET_PROVIDERS, DEFAULT_MODEL_SELECTION } from './presets.js';

function cacheKey(providerId: string, baseUrl: string): string {
  return `${providerId}::${baseUrl.replace(/\/+$/, '')}`;
}

function secretKeyFor(providerId: string): string {
  return `provider:${providerId}:apiKey`;
}

export class ProviderRegistry {
  private providers: Map<string, ProviderConfig> = new Map();
  private activeSelection: ModelSelection = { ...DEFAULT_MODEL_SELECTION };
  private keyCache: Map<string, string> = new Map();

  constructor(
    private vault: SecretVault,
    private storage: ProviderStorageAdapter,
  ) {}

  async init(): Promise<void> {
    const stored = await this.storage.loadProviders();
    if (stored && stored.length > 0) {
      for (const p of stored) {
        this.providers.set(p.id, p);
      }
    } else {
      for (const p of DEFAULT_PRESET_PROVIDERS) {
        this.providers.set(p.id, p);
      }
      await this.storage.saveProviders(Array.from(this.providers.values()));
    }

    const selection = await this.storage.loadSelection();
    if (selection) {
      this.activeSelection = { ...selection };
    } else {
      this.activeSelection = { ...DEFAULT_MODEL_SELECTION };
      await this.storage.saveSelection(this.activeSelection);
    }
  }

  async getSanitizedProviders(): Promise<SanitizedProvider[]> {
    const result: SanitizedProvider[] = [];
    for (const provider of this.providers.values()) {
      let hasKey = false;
      if (provider.requiresKey === false) {
        hasKey = true;
      } else {
        const ck = cacheKey(provider.id, provider.baseUrl);
        if (this.keyCache.has(ck)) {
          hasKey = true;
        } else {
          const stored = await this.vault.getSecret(secretKeyFor(provider.id));
          if (stored !== undefined) {
            this.keyCache.set(ck, stored);
            hasKey = true;
          }
        }
      }
      result.push({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: provider.models,
        isCustom: provider.isCustom,
        requiresKey: provider.requiresKey,
        hasKey,
      });
    }
    return result;
  }

  getActiveSelection(): ModelSelection {
    return { ...this.activeSelection };
  }

  async setActiveSelection(selection: ModelSelection): Promise<void> {
    const provider = this.providers.get(selection.providerID);
    if (!provider) {
      throw new Error(`Provider not found: ${selection.providerID}`);
    }
    const model = provider.models.find(m => m.id === selection.modelID);
    if (!model) {
      throw new Error(`Model not found: ${selection.modelID} for provider ${provider.name}`);
    }
    this.activeSelection = { ...selection };
    await this.storage.saveSelection(this.activeSelection);
  }

  async connectKey(providerId: string, apiKey: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    await this.vault.storeSecret(secretKeyFor(providerId), apiKey);
    this.keyCache.set(cacheKey(providerId, provider.baseUrl), apiKey);
  }

  async disconnectKey(providerId: string): Promise<void> {
    await this.vault.deleteSecret(secretKeyFor(providerId));
    for (const [key] of this.keyCache) {
      if (key.startsWith(`${providerId}::`)) {
        this.keyCache.delete(key);
      }
    }
  }

  async saveCustomProvider(config: ProviderConfig, apiKey?: string): Promise<void> {
    const entry: ProviderConfig = { ...config, isCustom: true };
    this.providers.set(entry.id, entry);
    if (apiKey !== undefined) {
      await this.connectKey(entry.id, apiKey);
    }
    await this.storage.saveProviders(Array.from(this.providers.values()));
  }

  async deleteCustomProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    if (!provider.isCustom) {
      throw new Error(`Cannot delete built-in provider: ${provider.name}`);
    }
    this.providers.delete(providerId);
    await this.disconnectKey(providerId);
    await this.storage.saveProviders(Array.from(this.providers.values()));
  }

  async resolveActiveCredentials(): Promise<ActiveCredentials> {
    if (this.providers.size === 0) {
      throw new Error(
        'No AI providers configured. Please add a provider in AI Providers settings.',
      );
    }

    const provider = this.providers.get(this.activeSelection.providerID);
    if (!provider) {
      throw new Error(
        `Active provider not found: ${this.activeSelection.providerID}`,
      );
    }

    const model = provider.models.find(
      m => m.id === this.activeSelection.modelID,
    );
    if (!model) {
      throw new Error(
        `Active model not found: ${this.activeSelection.modelID} in provider ${provider.name}`,
      );
    }

    let apiKey: string | undefined;
    if (provider.requiresKey !== false) {
      const ck = cacheKey(provider.id, provider.baseUrl);
      apiKey = this.keyCache.get(ck);
      if (!apiKey) {
        apiKey = await this.vault.getSecret(secretKeyFor(provider.id));
        if (apiKey) {
          this.keyCache.set(ck, apiKey);
        }
      }
      if (!apiKey) {
        throw new Error(`API key not configured for provider: ${provider.name}`);
      }
    }

    return {
      providerId: provider.id,
      baseUrl: provider.baseUrl,
      apiKey,
      modelId: model.id,
      supportsReasoning: model.supportsReasoning,
    };
  }
}