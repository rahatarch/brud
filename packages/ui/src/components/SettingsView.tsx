import { useState, useEffect, useCallback } from 'react';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';

const ALL_TOOLS = [
  'search_replace',
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'append_file',
  'create_directory',
  'delete_directory',
  'move_directory',
  'extract_structure',
  'codebase_metadata',
  'search_files',
  'append_file_multi',
  'search_replace_multi',
  'read_file',
  'read_files',
  'read_directory',
  'terminal_interactive',
  'terminal_command',
  'get_tool_info',
];

function SettingsView() {
  const [workspaceBoundaryEnabled, setWorkspaceBoundaryEnabled] = useState(true);
  const [toolAllowList, setToolAllowList] = useState<Record<string, boolean>>({});
  const [source, setSource] = useState<string>('default');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    console.log('[SettingsView] Sending getSettings message');
    sendToExtension({ command: 'getSettings' });
    return onExtensionMessage((message) => {
      console.log('[SettingsView] Received message:', message);
      if (message.command === 'settingsResult' && message.settings) {
        setWorkspaceBoundaryEnabled(message.settings.workspaceBoundaryEnabled !== false);
        setToolAllowList(message.settings.toolAllowList || {});
        setSource(message.source || 'default');
        setWarnings(message.warnings || []);
        setLoaded(true);
        console.log('[SettingsView] Settings loaded:', message.settings);
      }
    });
  }, []);

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

      <div className="space-y-6">
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

        <div className="bg-surface-2 border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-text mb-1">Tool Allow List</h3>
          <p className="text-xs text-text-secondary mb-3">
            Disable specific tools. Disabled tools will return an error when used.
          </p>
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {ALL_TOOLS.map((toolKind) => {
              const isEnabled = toolAllowList[toolKind] !== false;
              return (
                <div
                  key={toolKind}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-surface-3 transition-colors"
                >
                  <span className="text-sm text-text font-mono">{toolKind}</span>
                  <button
                    onClick={() => handleToolToggle(toolKind)}
                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
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
    </div>
  );
}

export default SettingsView;