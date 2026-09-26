import { useState, useEffect, useCallback } from 'react';
import { KeyRound, ChevronRight, ArrowLeft } from 'lucide-react';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';
import ProviderSettingsView from './ProviderSettingsView';

interface ToolInfo {
  kind: string;
  name: string;
  description: string;
}

type ViewState = 'main' | 'tools' | 'providers';

interface SettingsViewProps {
  setView?: (view: any) => void;
  initialSubView?: 'main' | 'tools' | 'providers';
  onSubViewChange?: (subView: 'main' | 'tools' | 'providers') => void;
}

function SettingsView({ initialSubView, onSubViewChange }: SettingsViewProps) {
  const [view, setView] = useState<ViewState>(initialSubView || 'main');
  const [workspaceBoundaryEnabled, setWorkspaceBoundaryEnabled] = useState(true);
  const [toolAllowList, setToolAllowList] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [source, setSource] = useState<string>('default');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sendToExtension({ command: 'getSettings' });
    sendToExtension({ command: 'getToolList' });
    return onExtensionMessage((message) => {
      if (message.command === 'settingsResult' && message.settings) {
        setWorkspaceBoundaryEnabled(message.settings.workspaceBoundaryEnabled !== false);
        setToolAllowList(message.settings.toolAllowList || {});
        setSource(message.source || 'default');
        setWarnings(message.warnings || []);
        setLoaded(true);
      }
      if (message.command === 'toolListResult' && message.tools) {
        setTools(message.tools);
      }
    });
  }, []);

  useEffect(() => {
    if (initialSubView) {
      setView(initialSubView);
    }
  }, [initialSubView]);

  const handleBoundaryToggle = useCallback(() => {
    const next = !workspaceBoundaryEnabled;
    setWorkspaceBoundaryEnabled(next);
    setSaving(true);
    sendToExtension({ command: 'saveSettings', settings: { workspaceBoundaryEnabled: next, toolAllowList } });
    setTimeout(() => setSaving(false), 300);
  }, [workspaceBoundaryEnabled, toolAllowList]);

  const handleToolToggle = useCallback((toolKind: string) => {
    const current = toolAllowList[toolKind];
    const next = current === undefined ? false : (current === false ? true : undefined);
    const newList = { ...toolAllowList };
    if (next === undefined) {
      delete newList[toolKind];
    } else {
      newList[toolKind] = next;
    }
    setToolAllowList(newList);
    setSaving(true);
    sendToExtension({ command: 'saveSettings', settings: { workspaceBoundaryEnabled, toolAllowList: newList } });
    setTimeout(() => setSaving(false), 300);
  }, [workspaceBoundaryEnabled, toolAllowList]);

  const disabledCount = tools.filter(t => toolAllowList[t.kind] === false).length;
  const enabledCount = tools.length - disabledCount;

  const navigate = (newView: ViewState) => {
    setView(newView);
    onSubViewChange?.(newView);
  };

  if (!loaded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-secondary">Loading settings...</p>
      </div>
    );
  }

  const sourceLabels: Record<string, string> = {
    default: 'Default',
    'vscode-global': 'VS Code (User)',
    'vscode-workspace': 'VS Code (Workspace)',
    'brud-json': '.brud/settings.json',
  };

  if (view === 'providers') {
    return <ProviderSettingsView onBack={() => navigate('main')} />;
  }

  if (view === 'tools') {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => navigate('main')}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} /> Back
          </button>
        </div>

        <h2 className="text-xl font-semibold text-text mb-4">Tool Allow List</h2>

        <div className="bg-surface-2 border border-border rounded-lg p-4">
          <p className="text-xs text-text-secondary mb-3">
            Disable specific tools. Disabled tools will return an error when used.
          </p>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {tools.map((tool) => {
              const isEnabled = toolAllowList[tool.kind] !== false;
              return (
                <div
                  key={tool.kind}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-surface-3 transition-colors"
                >
                  <div className="flex-1 min-w-0 pr-3">
                    <span className="text-sm text-text font-medium block truncate">
                      {tool.name}
                    </span>
                    <span className="text-xs text-text-secondary block truncate">
                      {tool.description}
                    </span>
                  </div>
                  <button
                    onClick={() => handleToolToggle(tool.kind)}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer ${
                      isEnabled ? 'bg-primary' : 'bg-surface-3'
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                        isEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <h2 className="text-xl font-semibold text-text mb-1">Settings</h2>
      <p className="text-sm text-text-secondary mb-4">
        Source: <span className="text-text font-medium">{sourceLabels[source] || source}</span>
      </p>

      {warnings.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-yellow-400">{w}</p>
          ))}
        </div>
      )}

      {saving && (
        <div className="mb-4 p-2 bg-primary/10 border border-primary/30 rounded-md">
          <p className="text-xs text-primary">Saving...</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="bg-surface-2 border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-text">Workspace Boundary Enforcement</h3>
              <p className="text-xs text-text-secondary mt-1">
                When enabled, operations are restricted to files inside the workspace.
              </p>
            </div>
            <button
              onClick={handleBoundaryToggle}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                workspaceBoundaryEnabled ? 'bg-primary' : 'bg-surface-3'
              }`}
            >
              <span
                className={`block w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                  workspaceBoundaryEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <div className="mt-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
              workspaceBoundaryEnabled
                ? 'bg-green-500/10 text-green-400'
                : 'bg-yellow-500/10 text-yellow-400'
            }`}>
              {workspaceBoundaryEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        <button
          onClick={() => navigate('tools')}
          className="w-full bg-surface-2 border border-border rounded-lg p-4 hover:bg-surface-3 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-text">Tool Allow List</h3>
              <p className="text-xs text-text-secondary mt-1">
                {disabledCount > 0
                  ? `${disabledCount} tool${disabledCount !== 1 ? 's' : ''} disabled, ${enabledCount} enabled`
                  : `All ${tools.length} tools enabled`}
              </p>
            </div>
            <ChevronRight size={16} className="text-text-secondary" />
          </div>
        </button>

        <div
          onClick={() => navigate('providers')}
          className="bg-surface-2 border border-border hover:border-primary/50 rounded-lg p-4 cursor-pointer transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-surface-3 flex items-center justify-center text-primary">
              <KeyRound size={20} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-text group-hover:text-primary transition-colors">AI Providers</h3>
              <p className="text-xs text-text-muted">Configure AI providers, API keys, and reasoning models</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-text-muted group-hover:text-primary transition-colors" />
        </div>
      </div>
    </div>
  );
}

export default SettingsView;