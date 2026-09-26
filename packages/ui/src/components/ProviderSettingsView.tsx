import { useState, useEffect } from 'react';
import { ArrowLeft, Key, Plus, Trash2, Check, Sparkles } from 'lucide-react';
import { useVaultStore } from '../stores/vaultStore';

interface ProviderSettingsViewProps {
  onBack: () => void;
}

export default function ProviderSettingsView({ onBack }: ProviderSettingsViewProps) {
  const {
    providers,
    connectKey,
    disconnectKey,
    saveProvider,
    deleteProvider,
  } = useVaultStore();

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newProvider, setNewProvider] = useState({
    id: '',
    name: '',
    baseUrl: '',
    models: '',
    apiKey: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingProviderId && providers.some(p => p.id === pendingProviderId)) {
      setNewProvider({ id: '', name: '', baseUrl: '', models: '', apiKey: '' });
      setPendingProviderId(null);
      setIsSubmitting(false);
      setFormError(null);
      setShowAddCustom(false);
    }
  }, [providers, pendingProviderId]);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-4xl mx-auto w-full">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text mb-4 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Settings
      </button>

      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text mb-1">AI Providers</h1>
          <p className="text-sm text-text-secondary">
            Configure AI providers, API keys, and reasoning models. All keys are stored in your system keychain.
          </p>
        </div>
        <button
          onClick={() => setShowAddCustom(!showAddCustom)}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-md shadow-sm transition-colors flex items-center gap-2 shrink-0 cursor-pointer"
        >
          <Plus size={14} />
          {showAddCustom ? 'Cancel' : 'Add New Provider'}
        </button>
      </div>

      {showAddCustom && (
        <div className="mb-6 bg-surface-2 border border-border rounded-lg p-4 space-y-2">
          <input
            type="text"
            placeholder="Provider ID (e.g., my-provider)"
            value={newProvider.id}
            onChange={(e) => setNewProvider((p) => ({ ...p, id: e.target.value }))}
            className="w-full bg-surface-3 border border-border focus:border-primary focus:outline-none rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors"
          />
          <input
            type="text"
            placeholder="Provider Name"
            value={newProvider.name}
            onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value }))}
            className="w-full bg-surface-3 border border-border focus:border-primary focus:outline-none rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors"
          />
          <input
            type="text"
            placeholder="Base URL (e.g., https://api.example.com)"
            value={newProvider.baseUrl}
            onChange={(e) => setNewProvider((p) => ({ ...p, baseUrl: e.target.value }))}
            className="w-full bg-surface-3 border border-border focus:border-primary focus:outline-none rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors"
          />
          <input
            type="text"
            placeholder="Models (comma-separated, e.g., gpt-4, gpt-3.5-turbo)"
            value={newProvider.models}
            onChange={(e) => setNewProvider((p) => ({ ...p, models: e.target.value }))}
            className="w-full bg-surface-3 border border-border focus:border-primary focus:outline-none rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors"
          />
          <input
            type="password"
            placeholder="API Key (optional)"
            value={newProvider.apiKey}
            onChange={(e) => setNewProvider((p) => ({ ...p, apiKey: e.target.value }))}
            className="w-full bg-surface-3 border border-border focus:border-primary focus:outline-none rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors"
          />
          {formError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-xs text-red-400">
              {formError}
            </div>
          )}
          <button
            onClick={() => {
              setFormError(null);
              const rawName = newProvider.name.trim();
              const rawId = newProvider.id.trim() || rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
              const rawUrl = newProvider.baseUrl.trim();

              if (!rawName) {
                setFormError("Please enter a Provider Name.");
                return;
              }
              if (!rawId) {
                setFormError("Please enter a valid Provider ID.");
                return;
              }
              if (!rawUrl) {
                setFormError("Please enter a Base URL.");
                return;
              }

              const modelIds = newProvider.models
                .split(',')
                .map(m => m.trim())
                .filter(Boolean);

              if (modelIds.length === 0) {
                setFormError("Please specify at least one model ID (e.g. gpt-4o, llama3).");
                return;
              }
              if (providers.some(p => p.id === rawId)) {
                setFormError("A provider with this ID already exists.");
                return;
              }

              setIsSubmitting(true);
              setPendingProviderId(rawId);
              const timer = setTimeout(() => {
                setIsSubmitting((current) => {
                  if (current) {
                    setFormError("Operation timed out. Please refresh or verify if the provider was saved.");
                    setPendingProviderId(null);
                    return false;
                  }
                  return false;
                });
              }, 8000);
              saveProvider(
                {
                  id: rawId,
                  name: rawName,
                  baseUrl: rawUrl.replace(/\/+$/, ''),
                  models: modelIds.map((id) => ({ id, name: id })),
                  isCustom: true,
                  requiresKey: true,
                },
                newProvider.apiKey.trim() || undefined
              );
            }}
            disabled={isSubmitting}
            className="w-full px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? "Adding Provider..." : "Add Provider"}
          </button>
        </div>
      )}

      {providers.length === 0 && !showAddCustom ? (
        <div className="bg-surface-2 border border-border rounded-lg p-8 text-center">
          <p className="text-sm text-text-muted">No AI providers configured yet.</p>
          <p className="text-xs text-text-muted mt-1">Click "Add New Provider" above to configure your first provider.</p>
        </div>
      ) : (
        providers.map((provider) => (
          <div
            key={provider.id}
            className="bg-surface-2 border border-border rounded-lg p-4 mb-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="text-sm font-medium text-text">{provider.name}</h4>
                <span className="inline-block mt-1 px-2 py-0.5 text-[10px] bg-surface-3 border border-border rounded text-text-muted">
                  {provider.baseUrl}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {provider.hasKey ? (
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                    Connected
                  </span>
                ) : (
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    Not Connected
                  </span>
                )}
                {provider.isCustom && (
                  <button
                    onClick={() => deleteProvider(provider.id)}
                    className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-error transition-colors cursor-pointer"
                    title="Delete provider"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {provider.hasKey ? (
              <div className="flex items-center justify-between mb-3">
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check size={12} />
                  Key Configured
                </span>
                <button
                  onClick={() => disconnectKey(provider.id)}
                  className="text-xs text-text-muted hover:text-text underline cursor-pointer"
                >
                  Remove Key
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center gap-1 flex-1 bg-surface-3 border border-border rounded-md px-3 py-2">
                  <Key size={12} className="text-text-muted shrink-0" />
                  <input
                    type="password"
                    placeholder="Enter API key..."
                    value={keyInputs[provider.id] ?? ''}
                    onChange={(e) =>
                      setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))
                    }
                    className="w-full bg-surface-3 border border-border focus:border-primary focus:outline-none rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors"
                  />
                </div>
                <button
                  onClick={() => {
                    const key = keyInputs[provider.id];
                    if (key?.trim()) {
                      connectKey(provider.id, key.trim());
                    }
                  }}
                  disabled={!keyInputs[provider.id]?.trim()}
                  className="px-2 py-1 text-xs font-medium bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
                >
                  Save Key
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-1">
              {provider.models.map((model) => (
                <span
                  key={model.id}
                  className="px-1.5 py-0.5 text-[10px] bg-surface-3 border border-border rounded text-text-muted"
                >
                  {model.name}
                  {model.supportsReasoning && (
                    <Sparkles size={10} className="ml-1 text-accent shrink-0" />
                  )}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}