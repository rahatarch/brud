import { useState } from 'react';
import { Star } from 'lucide-react';
import PromptLibrary from './PromptLibrary';
import HistoryView from './HistoryView';

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
      case 'history':
        return <HistoryView />;
      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <h2 className="text-2xl font-semibold text-text mb-3">{current.title}</h2>
            <p className="text-sm text-text-secondary text-center max-w-md leading-relaxed mb-6">
              {current.description}
            </p>
            <span className="inline-block bg-primary/20 text-primary rounded-full px-3 py-1 text-xs font-medium mb-6">
              Coming Soon
            </span>
            <a
              href="https://github.com/rahatarch/brud"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-primary/20 px-4 py-2 text-sm font-medium text-primary hover:brightness-110 transition-all"
            >
              <Star className="w-4 h-4" />
              Star The Repo
            </a>
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

      <footer className="shrink-0 px-4 py-3 bg-surface-2 flex items-center justify-center gap-4 text-xs text-text-secondary">
        <span>
          Built by{' '}
          <a
            href="https://github.com/rahatarch"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text transition-colors"
          >
            Rahat Hasan
          </a>
        </span>
        <span className="text-border">|</span>
        <a
          href="https://github.com/rahatarch/brud"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-text transition-colors"
        >
          Star Brud Code
        </a>
        <span className="text-border">|</span>
        <span>© 2026 Akkhar-Labs</span>
      </footer>
    </div>
  );
}

export default MainWindowShell;