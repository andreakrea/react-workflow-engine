import { useEffect, useRef, useState } from 'react';
import { WorkflowEditor, createLocalClient, type WorkflowId } from 'vise-workflow-engine/react';
import { icons } from './icons';
import Simulator from './Simulator';
import { blocks, exampleWorkflow, hooks } from './workflow.config';

// Same storage key as the 1.x demo: workflows saved there open here unchanged.
const client = createLocalClient({ storageKey: 'vise-wfe-demo-workflows', initial: [exampleWorkflow] });

type Theme = 'system' | 'light' | 'dark';
const THEMES: Array<[Theme, string]> = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : initial;
  });
  return [value, (v: T) => { setValue(v); localStorage.setItem(key, JSON.stringify(v)); }];
}

export default function App() {
  const [tab, setTab] = useState<'editor' | 'simulator'>('editor');
  const [workflowId, setWorkflowId] = useStored<WorkflowId | null>('vise-wfe-demo-current', exampleWorkflow.id);
  const [theme, setTheme] = useStored<Theme>('vise-wfe-demo-theme', 'system');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const timer = useRef<number>();

  const notify = (text: string, error = false) => {
    setToast({ text, error });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="demo">
      <header className="demo__bar">
        <div className="demo__brand">
          <span className="demo__mark" aria-hidden>V</span>
          <span>Workflow engine</span>
          <span className="demo__tag">Demo</span>
        </div>
        <nav className="demo__seg" aria-label="Sections">
          {(['editor', 'simulator'] as const).map((t) => (
            <button key={t} type="button" className={`demo__seg-item${tab === t ? ' is-active' : ''}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === 'editor' ? 'Editor' : 'Simulator'}
            </button>
          ))}
        </nav>
        <div className="demo__right">
          <div className="demo__seg demo__seg--small" role="radiogroup" aria-label="Theme">
            {THEMES.map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={theme === v} className={`demo__seg-item${theme === v ? ' is-active' : ''}`} onClick={() => setTheme(v)}>
                {label}
              </button>
            ))}
          </div>
          <a className="demo__link" href="https://github.com/andreakrea/react-workflow-engine">GitHub</a>
        </div>
      </header>
      <main className="demo__main">
        {tab === 'editor' ? (
          <WorkflowEditor
            blocks={blocks}
            hooks={hooks}
            icons={icons}
            client={client}
            theme={theme}
            title="Workflows"
            workflowId={workflowId}
            onWorkflowIdChange={setWorkflowId}
            onSaved={(w) => notify(`Saved “${w.name}”`)}
            onError={(e) => notify(e instanceof Error ? e.message : String(e), true)}
          />
        ) : (
          <Simulator client={client} initialWorkflowId={workflowId} />
        )}
      </main>
      {toast && (
        <div className={`demo__toast${toast.error ? ' is-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
