import { useState } from 'react';
import PromptLibrary from './PromptLibrary';

type TabId = 'prompt-library' | 'history' | 'templates' | 'tools' | 'rules' | 'settings';

interface Tab {
  id: TabId;
  label: string;
}

const tabs: Tab[] = [
  { id: 'prompt-library', label: 'Prompt Library' },
  { id: 'history', label: 'History' },
  { id: 'templates', label: 'Templates' },
  { id: 'tools', label: 'Tools' },
  { id: 'rules', label: 'Rules' },
  { id: 'settings', label: 'Settings' },
];

const tabContent: Record<TabId, { title: string; description: string }> = {
  'prompt-library': { title: 'Prompt Library', description: 'Browse and manage your saved Brud prompts. Organize frequently used prompts for quick access.' },
  'history': { title: 'History', description: 'View your past Brud sessions, including prompts, patches, and execution results.' },
  'templates': { title: 'Templates', description: 'Create and manage reusable prompt templates for common code modification patterns.' },
  'tools': { title: 'Tools', description: 'Configure and access Brud tools including code analysis, refactoring, and batch operations.' },
  'rules': { title: 'Rules', description: 'Define custom rules and constraints for Brud to follow during code generation and patching.' },
  'settings': { title: 'Settings', description: 'Configure Brud preferences, keybindings, and extension behavior.' },
};

function MainWindowShell() {
  const [activeTab, setActiveTab] = useState<TabId>('prompt-library');

  const current = tabContent[activeTab];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'prompt-library':
        return <PromptLibrary />;
      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <h2 className="text-2xl font-semibold text-text mb-3">{current.title}</h2>
            <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed">
              {current.description}
            </p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <div className="flex items-center border-b border-border bg-surface-2 px-4 gap-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'border-primary text-text'
                : 'border-transparent text-text-secondary hover:text-text hover:border-border-subtle'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {renderTabContent()}
    </div>
  );
}

export default MainWindowShell;