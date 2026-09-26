import { useState, useEffect, useRef } from 'react';
import { Cpu, ChevronDown, Sparkles, Check, Search, KeyRound, Settings } from 'lucide-react';
import { useVaultStore } from '../stores/vaultStore';
import { sendToExtension } from '../bridge/vscodeBridge';

export default function ModelSelector() {
  const { providers, activeSelection, selectModel } = useVaultStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  const activeProvider = providers.find((p) => p.id === activeSelection?.providerID);
  const activeModel = activeProvider?.models.find((m) => m.id === activeSelection?.modelID);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const filteredProviders = providers
    .map((p) => ({
      ...p,
      models: p.models.filter((m) =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((p) => p.models.length > 0);

  return (
    <div className="relative" ref={popoverRef}>
      <div
        className="bg-surface-3 hover:bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text flex items-center gap-1.5 cursor-pointer transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Cpu size={12} />
        <span>{providers.length === 0 ? 'No Providers (Click to Configure)' : (activeModel?.name ?? 'Select Model...')}</span>
        {activeModel?.supportsReasoning && <Sparkles size={10} className="text-accent" />}
        <ChevronDown size={10} />
      </div>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full left-0 mb-1 bg-surface border border-border rounded-lg shadow-xl w-64 max-h-80 flex flex-col z-40">
            {providers.length === 0 ? (
              <div className="p-4 text-center space-y-2">
                <p className="text-xs text-text-muted">No providers configured.</p>
                <div
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover cursor-pointer transition-colors"
                  onClick={() => { sendToExtension({ command: 'openMainWindow', tab: 'settings', subView: 'providers' }); setIsOpen(false); }}
                >
                  <Settings size={12} />
                  <span>Configure Provider</span>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-surface-2 border-b border-border p-2">
                  <div className="flex items-center gap-1.5 bg-surface-3 border border-border rounded px-2 py-1">
                    <Search size={12} className="text-text-muted" />
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-transparent border-none outline-none text-xs text-text w-full placeholder:text-text-muted"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="overflow-y-auto flex-1">
                  {filteredProviders.length === 0 ? (
                    <div className="p-3 text-xs text-text-muted text-center">No models found</div>
                  ) : (
                    filteredProviders.map((provider) => (
                      <div key={provider.id}>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider border-b border-border-subtle">
                          {provider.name}
                          {provider.hasKey || provider.requiresKey === false ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-success" />
                          ) : (
                            <KeyRound size={10} className="text-warning" />
                          )}
                        </div>
                        {provider.models.map((model) => {
                          const isSelected =
                            activeSelection?.providerID === provider.id &&
                            activeSelection?.modelID === model.id;
                          return (
                            <div
                              key={model.id}
                              className="flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-2 cursor-pointer transition-colors"
                              onClick={() => {
                                selectModel({ providerID: provider.id, modelID: model.id });
                                setIsOpen(false);
                              }}
                            >
                              <span className="w-4 shrink-0">
                                {isSelected && <Check size={12} className="text-primary" />}
                              </span>
                              <span className="flex-1">{model.name}</span>
                              {model.supportsReasoning && (
                                <Sparkles size={10} className="text-accent shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>

                <div
                  className="border-t border-border p-2"
                  onClick={() => { sendToExtension({ command: 'openMainWindow', tab: 'settings', subView: 'providers' }); setIsOpen(false); }}
                >
                  <div className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text cursor-pointer transition-colors px-2 py-1">
                    <Settings size={12} />
                    <span>Manage Providers & Keys</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}