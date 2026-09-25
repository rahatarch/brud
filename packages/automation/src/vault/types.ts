export interface SecretVault {
  getSecret(key: string): Promise<string | undefined>;
  storeSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextLength?: number;
  supportsReasoning?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
  isCustom?: boolean;
  requiresKey?: boolean;
}

export interface SanitizedProvider extends Omit<ProviderConfig, 'models'> {
  models: ProviderModel[];
  hasKey: boolean;
}

export interface ModelSelection {
  providerID: string;
  modelID: string;
}

export interface ProviderStorageAdapter {
  loadProviders(): Promise<ProviderConfig[] | undefined>;
  saveProviders(providers: ProviderConfig[]): Promise<void>;
  loadSelection(): Promise<ModelSelection | undefined>;
  saveSelection(selection: ModelSelection): Promise<void>;
}

export interface ActiveCredentials {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  supportsReasoning?: boolean;
}