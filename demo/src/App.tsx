import { useState } from 'react';
import './mock-api';
import { WorkflowEditor } from 'vise-workflow-engine/frontend';
import 'vise-workflow-engine/frontend/style.css';
import { blockTypes, hookTypes } from './blocks';
import WorkflowSimulator from './WorkflowSimulator';

const DEMO_LICENSE_KEY = 'eyJvcmciOiJEZW1vIiwicGxhbiI6InBybyJ9.c61270d419656170';

export default function App() {
  const [tab, setTab] = useState<'editor' | 'simulator'>('editor');

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div className="bg-white border-b flex items-center gap-1 px-4 pt-2">
        <button
          onClick={() => setTab('editor')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition ${
            tab === 'editor'
              ? 'bg-white border border-b-white -mb-px text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          📐 Editor
        </button>
        <button
          onClick={() => setTab('simulator')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition ${
            tab === 'simulator'
              ? 'bg-white border border-b-white -mb-px text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          🎮 Simulator
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'editor' ? (
          <WorkflowEditor
            apiUrl=""
            blockTypes={blockTypes}
            hookTypes={hookTypes}
            title="vise-workflow-engine — Demo"
            licenseKey={DEMO_LICENSE_KEY}
          />
        ) : (
          <WorkflowSimulator />
        )}
      </div>
    </div>
  );
}
