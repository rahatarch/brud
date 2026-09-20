import { useState, useEffect, useCallback, useRef } from 'react';
import { sendToExtension, onExtensionMessage } from '../bridge/vscodeBridge';
import { detectFields, substituteFields } from '@brud/core';
import { Copy, Check, Plus, Edit, Trash2, History, ArrowLeft, Globe, Folder, Tag, Search, Save, X, Play, FileText, ChevronDown } from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';

type ViewState = 'list' | 'editor' | 'history' | 'fill';

interface PromptData {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  scope: 'global' | 'workspace';
  versions: Array<{
    version: number;
    content: string;
    timestamp: string;
    message?: string;
  }>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function formatDate(ts?: string): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function PromptsView() {
  const [view, setView] = useState<ViewState>('list');
  const [prompts, setPrompts] = useState<PromptData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState<PromptData | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<PromptData | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editScope, setEditScope] = useState<'global' | 'workspace'>('global');
  const [editContent, setEditContent] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editorSelectionStart, setEditorSelectionStart] = useState(0);
  const [editorSelectionEnd, setEditorSelectionEnd] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [fillFields, setFillFields] = useState<string[]>([]);
  const [fillValues, setFillValues] = useState<Record<string, string>>({});

  const [historyPrompt, setHistoryPrompt] = useState<PromptData | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<PromptData | null>(null);

  function parseSearchQuery(query: string): { textQuery: string; inlineTags: string[] } {
    const tagMatches = query.match(/#([a-zA-Z0-9_-]+)/g) || [];
    const inlineTags = tagMatches.map(t => t.slice(1));
    const textQuery = query.replace(/#[a-zA-Z0-9_-]+/g, '').trim();
    return { textQuery, inlineTags };
  }

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const removeTag = (tag: string) => {
    const newSelected = new Set(selectedTags);
    newSelected.delete(tag);
    setSelectedTags(newSelected);
    const regex = new RegExp(`#${tag}\\b`, 'g');
    setSearchQuery(prev => prev.replace(regex, '').trim());
  };

  useEffect(() => {
    sendToExtension({ command: 'getPrompts' });
  }, []);

  useEffect(() => {
    return onExtensionMessage((message) => {
      if (message.command === 'promptsResult' && message.prompts) {
        setPrompts(message.prompts);
      } else if (message.command === 'promptSaved' && message.savedPromptId) {
        sendToExtension({ command: 'getPrompts' });
        setView('list');
        setEditingPrompt(null);
      } else if (message.command === 'promptDeleted' && message.savedPromptId) {
        sendToExtension({ command: 'getPrompts' });
        if (selectedPrompt?.id === message.savedPromptId) setSelectedPrompt(null);
        setView('list');
      } else if (message.command === 'promptReverted' && message.savedPromptId) {
        sendToExtension({ command: 'getPrompts' });
        setView('list');
        setHistoryPrompt(null);
      }
    });
  }, [selectedPrompt]);

  const promptForEdit = editingPrompt ?? selectedPrompt;

  const openNewPrompt = () => {
    const now = new Date().toISOString();
    setEditingPrompt({
      id: generateId(),
      title: '',
      description: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
      currentVersion: 0,
      scope: 'global',
      versions: [],
    });
    setEditTitle('');
    setEditDescription('');
    setEditTags('');
    setEditScope('global');
    setEditContent('');
    setEditMessage('');
    setView('editor');
  };

  const openEditPrompt = (prompt: PromptData) => {
    const currentVersion = prompt.versions.find(v => v.version === prompt.currentVersion) || prompt.versions[0];
    setEditingPrompt(prompt);
    setEditTitle(prompt.title);
    setEditDescription(prompt.description);
    setEditTags(prompt.tags.join(', '));
    setEditScope(prompt.scope);
    setEditContent(currentVersion?.content || '');
    setEditMessage('');
    setView('editor');
  };

  const handleSave = () => {
    if (!editingPrompt || !editTitle.trim()) return;

    const now = new Date().toISOString();
    const existingVersion = editingPrompt.versions.find(v => v.version === editingPrompt.currentVersion);
    const contentChanged = existingVersion?.content !== editContent;

    let updatedVersions = [...editingPrompt.versions];
    let newVersionNumber = editingPrompt.currentVersion;

    if (editingPrompt.currentVersion === 0 || editingPrompt.versions.length === 0) {
      newVersionNumber = 1;
      updatedVersions = [{
        version: 1,
        content: editContent,
        timestamp: now,
        message: editMessage.trim() || 'Initial version',
      }];
    } else if (contentChanged) {
      newVersionNumber = editingPrompt.currentVersion + 1;
      updatedVersions.push({
        version: newVersionNumber,
        content: editContent,
        timestamp: now,
        message: editMessage.trim() || `Version ${newVersionNumber}`,
      });
    }

    const updated: PromptData = {
      ...editingPrompt,
      title: editTitle.trim(),
      description: editDescription.trim(),
      tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
      updatedAt: now,
      currentVersion: newVersionNumber,
      scope: editScope,
      versions: updatedVersions,
    };

    sendToExtension({ command: 'savePrompt', promptData: updated });
  };

  const handleDelete = (prompt: PromptData) => {
    setDeleteConfirm(prompt);
  };

  const handleConfirmDelete = () => {
    if (!deleteConfirm) return;
    sendToExtension({ command: 'deletePrompt', promptId: deleteConfirm.id });
    setDeleteConfirm(null);
  };

  const handleCancelDelete = () => setDeleteConfirm(null);

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const openFillAndCopy = (prompt: PromptData) => {
    const currentVersion = prompt.versions.find(v => v.version === prompt.currentVersion) || prompt.versions[0];
    const fields = detectFields(currentVersion?.content || '');
    setSelectedPrompt(prompt);
    setFillFields(fields);
    setFillValues({});
    setView('fill');
  };

  const handleFillCopy = async () => {
    if (!selectedPrompt) return;
    const currentVersion = selectedPrompt.versions.find(v => v.version === selectedPrompt.currentVersion) || selectedPrompt.versions[0];
    const result = substituteFields(currentVersion?.content || '', fillValues);
    await handleCopy(result, 'fill-copy');
  };

  const allFieldsFilled = fillFields.every(f => (fillValues[f]?.trim() ?? '') !== '');

  const openHistory = (prompt: PromptData) => {
    setHistoryPrompt(prompt);
    setView('history');
  };

  const handleRevert = (prompt: PromptData, version: number) => {
    sendToExtension({ command: 'revertPrompt', promptId: prompt.id, version });
  };

  const handleWrapField = () => {
    if (!editorRef.current) return;
    const start = editorRef.current.selectionStart;
    const end = editorRef.current.selectionEnd;
    if (start === end) return;
    const selected = editContent.substring(start, end);
    const wrapped = '${[' + selected + ']}';
    const newContent = editContent.substring(0, start) + wrapped + editContent.substring(end);
    setEditContent(newContent);
  };

  const handleUnwrap = () => {
    if (!editorRef.current) return;
    const start = editorRef.current.selectionStart;
    const end = editorRef.current.selectionEnd;
    if (start === end) return;
    const selected = editContent.substring(start, end);
    const unwrapped = selected.replace(/\$\{\[([^\[\]]+)\]\}/g, '$1');
    const newContent = editContent.substring(0, start) + unwrapped + editContent.substring(end);
    setEditContent(newContent);
  };

  const { textQuery, inlineTags } = parseSearchQuery(searchQuery);
  const activeTags = new Set([...selectedTags, ...inlineTags]);

  const filteredPrompts = prompts.filter(p => {
    for (const tag of activeTags) {
      if (!p.tags.includes(tag)) return false;
    }
    if (textQuery) {
      const q = textQuery.toLowerCase();
      const currentVersion = p.versions.find(v => v.version === p.currentVersion) || p.versions[0];
      if (!p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q) && !(currentVersion?.content.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const allTags = [...new Set(prompts.flatMap(p => p.tags))].sort();
  const tagCounts = new Map<string, number>();
  for (const prompt of prompts) {
    for (const tag of prompt.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const scopeIcon = (scope: string) => scope === 'global' ? <Globe size={12} /> : <Folder size={12} />;

  if (view === 'editor' && promptForEdit) {
    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full min-h-0">
        <button onClick={() => { setView('list'); setEditingPrompt(null); }} className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-4 cursor-pointer self-start">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-text">{editingPrompt ? (editingPrompt.id ? 'Edit Prompt' : 'New Prompt') : 'Edit Prompt'}</h2>
        </div>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Title" className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary" />

          <input value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder="Description" className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary" />

          <input value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="Tags (comma-separated)" className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary" />

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="radio" name="scope" checked={editScope === 'global'} onChange={() => setEditScope('global')} className="accent-primary" />
              Global
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="radio" name="scope" checked={editScope === 'workspace'} onChange={() => setEditScope('workspace')} className="accent-primary" />
              Workspace
            </label>
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={handleWrapField} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                <FileText size={12} /> Wrap as field
              </button>
              <button onClick={handleUnwrap} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                <X size={12} /> Unwrap
              </button>
            </div>
            <textarea
              ref={editorRef}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onSelect={() => {
                if (editorRef.current) {
                  setEditorSelectionStart(editorRef.current.selectionStart);
                  setEditorSelectionEnd(editorRef.current.selectionEnd);
                }
              }}
              placeholder="Prompt content..."
              className="flex-1 w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary resize-none font-mono"
            />
          </div>

          <input value={editMessage} onChange={e => setEditMessage(e.target.value)} placeholder="Save message (optional)" className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary" />

          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => { setView('list'); setEditingPrompt(null); }} className="px-4 py-2 text-sm rounded-md border border-border bg-surface hover:bg-surface-2 text-text cursor-pointer">Cancel</button>
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-white hover:brightness-110 cursor-pointer disabled:opacity-50" disabled={!editTitle.trim()}>
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'history' && historyPrompt) {
    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full min-h-0">
        <button onClick={() => setView('list')} className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-4 cursor-pointer self-start">
          <ArrowLeft size={16} /> Back
        </button>

        <h2 className="text-xl font-semibold text-text mb-4">Version History: {historyPrompt.title}</h2>

        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
          {[...historyPrompt.versions].reverse().map((v) => (
            <div key={v.version} className="bg-surface border border-border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-sm font-medium text-text">v{v.version}</span>
                  <span className="text-xs text-text-secondary ml-2">{formatDate(v.timestamp)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleCopy(v.content, `hist-${v.version}`)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                    {copiedId === `hist-${v.version}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                    {copiedId === `hist-${v.version}` ? 'Copied!' : 'Copy'}
                  </button>
                  <button onClick={() => handleRevert(historyPrompt, v.version)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                    <History size={12} /> Revert
                  </button>
                </div>
              </div>
              {v.message && <p className="text-xs text-text-secondary mb-2">{v.message}</p>}
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap bg-surface-2 border border-border-subtle rounded p-2 max-h-[200px] overflow-y-auto">{v.content.length > 500 ? v.content.substring(0, 500) + '...' : v.content}</pre>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view === 'fill' && selectedPrompt) {
    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full min-h-0">
        <button onClick={() => { setView('list'); setSelectedPrompt(null); }} className="flex items-center gap-2 text-sm text-text-secondary hover:text-text mb-4 cursor-pointer self-start">
          <ArrowLeft size={16} /> Back
        </button>

        <h2 className="text-xl font-semibold text-text mb-1">Fill & Copy: {selectedPrompt.title}</h2>
        <p className="text-sm text-text-secondary mb-6">Fill in the fields to customize this prompt before copying.</p>

        {fillFields.length === 0 ? (
          <p className="text-sm text-text-secondary">No dynamic fields found in this prompt.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {fillFields.map(f => (
              <div key={f}>
                <label className="block text-sm font-medium text-text mb-1">{f}</label>
                <input value={fillValues[f] || ''} onChange={e => setFillValues(prev => ({ ...prev, [f]: e.target.value }))} placeholder={`Enter ${f}...`} className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary" />
              </div>
            ))}
            <button onClick={handleFillCopy} disabled={!allFieldsFilled} className="flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-white hover:brightness-110 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2">
              {copiedId === 'fill-copy' ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy to Clipboard</>}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-4xl mx-auto w-full min-h-0">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-text">My Prompts</h2>
          <p className="text-sm text-text-secondary mt-1">Your personal prompt vault. Global prompts are stored in ~/.brud/prompts/, workspace prompts in .brud/prompts/.</p>
        </div>
        <button onClick={openNewPrompt} className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-white hover:brightness-110 cursor-pointer">
          <Plus size={16} /> New Prompt
        </button>
      </div>

      <div className="flex items-center gap-4 mb-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search prompts... (#tag to filter)" className="w-full pl-9 pr-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text placeholder:text-text-muted outline-none focus:border-primary" />
        </div>
        <div ref={dropdownRef} className="relative">
          <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-surface-2 border border-border text-text-secondary hover:text-text cursor-pointer">
            <Tag size={14} /> Tags {activeTags.size > 0 && <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary">{activeTags.size}</span>}
          </button>
          {isDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 py-2 max-h-64 overflow-y-auto">
              {allTags.length === 0 ? (
                <p className="px-3 py-2 text-sm text-text-muted">No tags yet</p>
              ) : (
                allTags.map(tag => {
                  const isSelected = selectedTags.has(tag);
                  const count = tagCounts.get(tag) || 0;
                  return (
                    <label key={tag} className="flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-surface-2 cursor-pointer">
                      <input type="checkbox" checked={isSelected} onChange={() => {
                        const next = new Set(selectedTags);
                        if (isSelected) next.delete(tag); else next.add(tag);
                        setSelectedTags(next);
                      }} className="accent-primary" />
                      <span className="flex-1">{tag}</span>
                      <span className="text-xs text-text-muted">({count})</span>
                    </label>
                  );
                })
              )}
              {allTags.length > 0 && <div className="border-t border-border mt-2 pt-2 px-3"><button onClick={() => setSelectedTags(new Set())} className="text-xs text-text-secondary hover:text-text cursor-pointer">Clear all</button></div>}
            </div>
          )}
        </div>
      </div>

      {activeTags.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {[...activeTags].sort().map(tag => (
            <span key={tag} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary/20 text-primary">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-text cursor-pointer"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {filteredPrompts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1">
          <p className="text-sm text-text-secondary">{searchQuery || activeTags.size > 0 ? 'No matching prompts.' : 'No prompts yet. Create your first one!'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPrompts.map(p => {
            const currentVersion = p.versions.find(v => v.version === p.currentVersion) || p.versions[0];
            return (
              <div key={p.id} className="bg-surface border border-border rounded-lg p-4 hover:border-primary transition-colors flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${p.scope === 'global' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                      {scopeIcon(p.scope)} {p.scope}
                    </span>
                    <h3 className="text-base font-medium text-text truncate">{p.title}</h3>
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">v{p.currentVersion}</span>
                </div>
                {p.description && <p className="text-xs text-text-secondary mb-2 line-clamp-2">{p.description}</p>}
                {p.tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mb-3">
                    {p.tags.map(t => <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-surface-2 border border-border-subtle text-text-muted">{t}</span>)}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-auto flex-wrap">
                  <button onClick={() => handleCopy(currentVersion?.content || '', p.id)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                    {copiedId === p.id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                    {copiedId === p.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button onClick={() => openFillAndCopy(p)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                    <Play size={11} /> Fill & Copy
                  </button>
                  <button onClick={() => openEditPrompt(p)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                    <Edit size={11} /> Edit
                  </button>
                  <button onClick={() => openHistory(p)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-text-secondary cursor-pointer">
                    <History size={11} /> History
                  </button>
                  <button onClick={() => handleDelete(p)} className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-2 text-red-400 cursor-pointer ml-auto">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmationModal
        isOpen={deleteConfirm !== null}
        title={`Delete "${deleteConfirm?.title}"?`}
        message="This prompt will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

export default PromptsView;