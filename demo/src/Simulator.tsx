import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createEngine,
  isWorkflowError,
  memorySubjectStore,
  memoryWorkflowStore,
  type NextOption,
  type Workflow,
  type WorkflowId,
} from 'vise-workflow-engine';
import type { WorkflowClient } from 'vise-workflow-engine/react';
import { blocks, hooks } from './workflow.config';

type Ticket = { id: number; workflowId: WorkflowId | null; nodeId: string | null; title: string; priority: 'low' | 'normal' | 'urgent' };
type Log = { at: string; kind: 'move' | 'action' | 'hook' | 'info' | 'error'; text: string };

const TITLES = ['Printer on fire', 'Refund request', 'Login loop', 'Invoice missing', 'API 500s', 'Dark mode please'];
const PRIORITIES: Ticket['priority'][] = ['low', 'normal', 'urgent'];

/**
 * Runs the real engine in the browser against in-memory stores. The actions
 * below are what a server would register — here they just log.
 */
export default function Simulator({ client, initialWorkflowId }: { client: WorkflowClient; initialWorkflowId: WorkflowId | null }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState<WorkflowId | null>(initialWorkflowId);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [options, setOptions] = useState<Record<number, NextOption[]>>({});
  const [log, setLog] = useState<Log[]>([]);
  const nextTicket = useRef(1);

  useEffect(() => {
    void client.list().then(setWorkflows);
  }, [client]);

  const push = (kind: Log['kind'], text: string) => setLog((l) => [...l, { at: new Date().toLocaleTimeString([], { hour12: false }), kind, text }]);

  const { engine, subjects } = useMemo(() => {
    const subjects = memorySubjectStore<Ticket>();
    const engine = createEngine({
      workflows: memoryWorkflowStore(workflows),
      subjects,
      blocks,
      hooks,
      actions: {
        start: () => ({ next: true }),
        auto_classify: ({ subject, variables }) => {
          push('action', `#${subject.id} classified with ${variables.model}, min. confidence ${variables.confidence}`);
          return { next: true };
        },
        route_priority: ({ subject }) => {
          push('action', `#${subject.id} routed as ${subject.priority}`);
          return { branch: subject.priority };
        },
        send_email: ({ subject, variables }) => {
          push('action', `#${subject.id} emailed ${variables.to} with template “${variables.template}”`);
          return { next: true };
        },
      },
      hookHandlers: {
        log_transition: ({ subject, from, to }) => push('hook', `Audit log: #${subject.id} ${from?.label} → ${to?.label}`),
        send_slack_alert: ({ subject, config, node }) => push('hook', `Slack ${config.channel}: #${subject.id} entered “${node?.label}”`),
        sla_timer: ({ subject, config }) => push('hook', `SLA timer: ${config.hours}h started for #${subject.id}`),
        escalation_detector: ({ subject, input }) => push('hook', `Escalation detector checked a message on #${subject.id}`),
      },
      logger: {},
    });
    engine.on('transitioned', (e) => push('move', `#${e.subjectId} ${e.from ? `${e.from} → ` : 'started at '}${e.to}${e.branch ? ` via ${e.branch}` : ''}`));
    engine.on('completed', (e) => push('info', `#${e.subjectId} finished at ${e.nodeId}`));
    return { engine, subjects };
  }, [workflows]);

  // A new engine means new in-memory subjects: start the simulation over.
  useEffect(() => {
    setTickets([]);
    setOptions({});
  }, [engine]);

  const refresh = async (id: number) => {
    const s = (await subjects.get(id))!;
    const opts = await engine.next(id).catch(() => []);
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, ...s } : t)));
    setOptions((o) => ({ ...o, [id]: opts }));
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      push('error', isWorkflowError(e) ? `${e.code}: ${e.message}` : String(e));
    }
  };

  const create = () =>
    run(async () => {
      if (workflowId == null) return;
      const id = nextTicket.current++;
      const t: Ticket = { id, workflowId: null, nodeId: null, title: TITLES[id % TITLES.length], priority: PRIORITIES[Math.floor(Math.random() * 3)] };
      subjects.add(t);
      setTickets((ts) => [...ts, t]);
      push('info', `#${id} created: “${t.title}”, ${t.priority} priority`);
      await engine.start(id, workflowId);
      await refresh(id);
    });

  const workflow = workflows.find((w) => String(w.id) === String(workflowId));
  const label = (nodeId: string | null) => {
    const n = workflow?.nodes.find((x) => x.id === nodeId);
    return n ? n.data.label || blocks[n.data.type as keyof typeof blocks]?.label || n.data.type : '—';
  };

  const KIND_LABEL: Record<Log['kind'], string> = { move: 'Move', action: 'Action', hook: 'Hook', info: 'Info', error: 'Error' };

  return (
    <div className="sim">
      <div className="sim__toolbar">
        <label className="sim__pill-select">
          <span>Workflow</span>
          <select aria-label="Workflow" value={workflowId ?? ''} onChange={(e) => setWorkflowId(e.target.value || null)}>
            <option value="">Choose…</option>
            {workflows.map((w) => (
              <option key={String(w.id)} value={String(w.id)}>{w.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="sim__btn" onClick={() => void client.list().then(setWorkflows)}>Reload workflows</button>
        <button type="button" className="sim__btn sim__btn--primary" disabled={workflowId == null} onClick={() => void create()}>
          New ticket
        </button>
      </div>
      <div className="sim__cols">
        <section className="sim__frame" aria-label="Tickets">
          <div className="sim__frame-head">
            <strong>Tickets</strong>
            <span className="sim__muted">{tickets.length} total</span>
          </div>
          {tickets.length === 0 ? (
            <p className="sim__empty">No tickets yet. Press <b>New ticket</b> to send one through the selected workflow: actions run on their own, people-steps and decisions wait for you here.</p>
          ) : (
            <ul className="sim__rows">
              {tickets.map((t) => {
                const opts = options[t.id] ?? [];
                const done = t.nodeId != null && opts.length === 0;
                return (
                  <li key={t.id} className="sim__row">
                    <div className="sim__row-main">
                      <span className="sim__id">#{t.id}</span>
                      <span className="sim__title">{t.title}</span>
                      <span className={`sim__badge sim__badge--${t.priority}`}>{t.priority}</span>
                    </div>
                    <div className="sim__row-sub">
                      {done ? <span className="sim__badge sim__badge--done">Finished</span> : <span className="sim__badge sim__badge--wait">Waiting</span>}
                      <span>at <b>{label(t.nodeId)}</b></span>
                    </div>
                    {!done && opts.length > 0 && (
                      <div className="sim__moves">
                        {opts.map((o) => (
                          <button
                            key={`${o.nodeId}:${o.branch}`}
                            type="button"
                            className="sim__btn sim__btn--sm"
                            onClick={() => void run(async () => { await engine.move(t.id, o.branch ? { branch: o.branch } : { to: o.nodeId }); await refresh(t.id); })}
                          >
                            {o.branchLabel ? `${o.branchLabel} → ` : 'Continue → '}{o.label}
                          </button>
                        ))}
                        <button type="button" className="sim__btn sim__btn--sm sim__btn--ghost" onClick={() => void run(() => engine.emit(t.id, 'on_message', { text: 'This is unacceptable!' }))}>
                          Simulate message
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="sim__frame" aria-label="Event log">
          <div className="sim__frame-head">
            <strong>Event log</strong>
            <button type="button" className="sim__btn sim__btn--sm sim__btn--ghost" onClick={() => setLog([])} disabled={!log.length}>Clear</button>
          </div>
          {log.length === 0 ? (
            <p className="sim__empty">Moves, actions and hooks appear here as the engine runs them.</p>
          ) : (
            <ol className="sim__log">
              {log.map((l, i) => (
                <li key={i} className="sim__line">
                  <time>{l.at}</time>
                  <span className={`sim__kind sim__kind--${l.kind}`}>{KIND_LABEL[l.kind]}</span>
                  <span className="sim__text">{l.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
