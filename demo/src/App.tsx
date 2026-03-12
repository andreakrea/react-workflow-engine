import './mock-api';
import { WorkflowEditor } from 'vise-workflow-engine/frontend';
import 'vise-workflow-engine/frontend/style.css';
import { blockTypes, hookTypes } from './blocks';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <WorkflowEditor
        apiUrl=""
        blockTypes={blockTypes}
        hookTypes={hookTypes}
        title="vise-workflow-engine — Demo"
      />
    </div>
  );
}
