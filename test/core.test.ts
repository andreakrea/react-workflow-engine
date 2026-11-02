import { createHmac } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  checkLicense,
  createEngine,
  defineBlocks,
  defineHooks,
  memoryStores,
  memoryWorkflowStore,
  v,
  validateLicense,
  validateWorkflow,
  type Workflow,
} from '../src';
import { _resetLicenseForTests } from '../src/core/license';
import { activateTestLicense, LEGACY_KEY, signKey, TEST_PUBLIC_KEY } from './helpers';

beforeAll(() => activateTestLicense());

const blocks = defineBlocks({
  start: { kind: 'start', label: 'Start' },
  review: { kind: 'step', label: 'Review' },
  email: { kind: 'step', label: 'Email', variables: { to: v.string({ required: true }), retries: v.number({ default: 2 }), tone: v.select(['formal', 'casual']) } },
  approve: { kind: 'decision', label: 'Approve?' },
  route: { kind: 'decision', label: 'Route', branches: ['low', 'high', 'urgent'] },
  done: { kind: 'end', label: 'Done' },
  rejected: { kind: 'end', label: 'Rejected' },
});

const hooks = defineHooks({
  audit: { trigger: 'on_transition', label: 'Audit' },
  enter: { trigger: 'on_node_entry', label: 'Enter', config: { channel: v.string() } },
  msg: { trigger: 'on_message', label: 'Message' },
});

const node = (id: string, type: string, variables?: Record<string, unknown>) => ({ id, position: { x: 0, y: 0 }, data: { type, variables } });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, sourceHandle });

function approvalFlow(): Workflow {
  return {
    id: 1,
    name: 'Approval',
    nodes: [node('n1', 'start'), node('n2', 'review'), node('n3', 'approve'), node('n4', 'done'), node('n5', 'rejected')],
    edges: [edge('n1', 'n2'), edge('n2', 'n3'), edge('n3', 'n4', 'yes'), edge('n3', 'n5', 'no')],
    hooks: [],
  };
}

function setup(workflow: Workflow = approvalFlow(), extra: Partial<Parameters<typeof createEngine>[0]> = {}) {
  const stores = memoryStores({ workflows: [workflow], subjects: [{ id: 1 }, { id: 2 }] });
  const engine = createEngine({ ...stores, blocks, hooks, logger: {}, ...(extra as object) });
  return { engine, stores };
}

describe('license', () => {
  it('accepts Ed25519 keys signed with the private key, rejects tampered or foreign ones', () => {
    _resetLicenseForTests(TEST_PUBLIC_KEY);
    const key = signKey({ org: 'Acme', plan: 'pro' });
    expect(checkLicense(key)).toMatchObject({ valid: true, org: 'Acme', plan: 'pro' });
    const [, payload, sig] = key.split('.');
    const forged = Buffer.from(JSON.stringify({ org: 'Acme', plan: 'enterprise' })).toString('base64url');
    expect(checkLicense(`vwe2.${forged}.${sig}`).valid).toBe(false);
    expect(checkLicense(signKey({ org: 'Mallory' }, ed25519.utils.randomPrivateKey())).valid).toBe(false);
    expect(checkLicense(signKey({ org: 'Old', exp: Date.now() - 1000 }))).toMatchObject({ valid: false, error: expect.stringMatching(/expired/) });
    expect(checkLicense(`vwe2.${payload}`).valid).toBe(false);
    activateTestLicense();
  });

  it('still accepts 1.x keys, flagged as legacy, with a one-time warning', () => {
    const payload = Buffer.from(JSON.stringify({ org: 'Old Co', plan: 'pro' })).toString('base64');
    const sig = createHmac('sha256', 'vise-wfe-2026').update(payload).digest('hex').slice(0, 16);
    expect(checkLicense(`${payload}.${sig}`)).toMatchObject({ valid: true, org: 'Old Co', legacy: true });
    expect(checkLicense(`${payload}.0000000000000000`).valid).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _resetLicenseForTests(TEST_PUBLIC_KEY);
    validateLicense(LEGACY_KEY);
    validateLicense(LEGACY_KEY);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    activateTestLicense();
  });

  it('memory stores need no key; real stores do', () => {
    _resetLicenseForTests(TEST_PUBLIC_KEY);
    expect(() => createEngine({ ...memoryStores(), logger: {} })).not.toThrow();
    const m = memoryWorkflowStore();
    // A store without the in-memory marker, like a database adapter.
    const real = { workflows: { get: m.get, list: m.list, create: m.create, update: m.update, remove: m.remove }, subjects: memoryStores().subjects };
    expect(() => createEngine({ workflows: real.workflows, subjects: memoryStores().subjects })).toThrow(/License key required/);
    expect(() => createEngine({ ...real, licenseKey: signKey({ org: 'Acme' }) })).not.toThrow();
    activateTestLicense();
  });
});

describe('engine: start and move', () => {
  it('starts on the start node and waits on a step without an action', async () => {
    const { engine, stores } = setup();
    const r = await engine.start(1, 1);
    expect(r).toMatchObject({ node: { id: 'n1' }, status: 'waiting', path: ['n1'] });
    expect(await stores.subjects.get(1)).toMatchObject({ workflowId: 1, nodeId: 'n1', status: 'start' });
  });

  it('move() works (1.x crashed on every transition)', async () => {
    const { engine } = setup();
    await engine.start(1, 1);
    expect((await engine.move(1, { next: true })).node.id).toBe('n2');
    expect((await engine.move(1, { to: 'approve' })).node.id).toBe('n3');
  });

  it('decisions are strict: unknown branches throw instead of taking YES', async () => {
    const { engine } = setup();
    await engine.start(1, 1);
    await engine.move(1, { next: true });
    await engine.move(1, { next: true });
    await expect(engine.move(1, { branch: 'banana' })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(engine.move(1, { next: true })).rejects.toMatchObject({ code: 'AMBIGUOUS_TRANSITION' });
    const r = await engine.move(1, { branch: false });
    expect(r).toMatchObject({ node: { id: 'n5' }, status: 'completed' });
  });

  it('rejects moves to nodes that are not reachable', async () => {
    const { engine } = setup();
    await engine.start(1, 1);
    await expect(engine.move(1, { to: 'n4' })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await engine.can(1, { to: 'n4' })).toBe(false);
    expect(await engine.can(1, { to: 'n2' })).toBe(true);
    expect((await engine.move(1, { to: 'n4', force: true })).node.id).toBe('n4');
  });

  it('resolves a block id among reachable nodes only, and refuses ambiguity', async () => {
    const wf: Workflow = {
      id: 1, name: 'x', hooks: [],
      nodes: [node('a', 'start'), node('b', 'review'), node('c', 'review'), node('d', 'review'), node('e', 'done')],
      edges: [edge('a', 'c'), edge('a', 'd'), edge('c', 'e'), edge('d', 'e'), edge('b', 'e')],
    };
    const { engine } = setup(wf);
    await engine.start(1, 1);
    await expect(engine.move(1, { to: 'review' })).rejects.toMatchObject({ code: 'AMBIGUOUS_TRANSITION' });
    expect((await engine.move(1, { to: 'c' })).node.id).toBe('c');
  });

  it('next() lists options with branches', async () => {
    const { engine } = setup();
    await engine.start(1, 1);
    await engine.move(1, { next: true });
    await engine.move(1, { next: true });
    expect(await engine.next(1)).toEqual([
      { nodeId: 'n4', type: 'done', label: 'Done', branch: 'yes', branchLabel: 'Yes' },
      { nodeId: 'n5', type: 'rejected', label: 'Rejected', branch: 'no', branchLabel: 'No' },
    ]);
  });

  it('errors are typed', async () => {
    const { engine } = setup();
    await expect(engine.move(1, { next: true })).rejects.toMatchObject({ code: 'NO_WORKFLOW' });
    await expect(engine.start(99, 1)).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
    await expect(engine.start(1, 42)).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
  });
});

describe('engine: actions', () => {
  it('passes typed variables and auto-advances when the action returns a move', async () => {
    const seen: unknown[] = [];
    const wf = approvalFlow();
    wf.nodes[1] = node('n2', 'email', { to: 'a@b.c', retries: 3 });
    const { engine } = setup(wf, {
      actions: {
        start: () => ({ next: true }),
        email: ({ variables, input }) => {
          seen.push(variables, input);
          return { next: true };
        },
        approve: ({ subject }) => ({ branch: subject.id === 1 ? 'yes' : 'no' }),
      },
    });
    const r = await engine.start(1, 1, { input: { by: 'test' } });
    expect(r).toMatchObject({ path: ['n1', 'n2', 'n3', 'n4'], status: 'completed', node: { id: 'n4' } });
    expect(seen).toEqual([{ to: 'a@b.c', retries: 3 }, { by: 'test' }]);
    expect((await engine.start(2, 1)).node.id).toBe('n5');
  });

  it('stops cycles with MAX_STEPS', async () => {
    const wf: Workflow = {
      id: 1, name: 'loop', hooks: [],
      nodes: [node('a', 'start'), node('b', 'review')],
      edges: [edge('a', 'b'), edge('b', 'a')],
    };
    const { engine } = setup(wf, { maxSteps: 20, actions: { start: () => ({ next: true }), review: () => ({ next: true }) } });
    await expect(engine.start(1, 1)).rejects.toMatchObject({ code: 'MAX_STEPS' });
  });

  it('wraps action failures with the node id and the cause', async () => {
    const { engine } = setup(approvalFlow(), { actions: { review: () => { throw new Error('smtp down'); } } });
    await engine.start(1, 1);
    const err = await engine.move(1, { next: true }).catch((e) => e);
    expect(err).toMatchObject({ code: 'ACTION_FAILED', details: { nodeId: 'n2' } });
    expect(err.cause.message).toBe('smtp down');
  });

  it('refuses to start invalid workflows', async () => {
    const wf = approvalFlow();
    wf.nodes[1] = node('n2', 'email', {});
    const { engine } = setup(wf);
    await expect(engine.start(1, 1)).rejects.toMatchObject({ code: 'INVALID_WORKFLOW' });
  });

  it('rejects action keys that are not blocks', () => {
    const stores = memoryStores();
    expect(() => createEngine({ ...stores, blocks, actions: { nope: () => {} } as never })).toThrow(/does not match any block/);
  });
});

describe('engine: hooks and events', () => {
  it('fires exit → transition → entry in order, honours scope and enabled', async () => {
    const calls: string[] = [];
    const wf = approvalFlow();
    wf.hooks = [
      { id: 'h1', type: 'audit', trigger: 'on_transition', scope: 'all' },
      { id: 'h2', type: 'enter', trigger: 'on_node_entry', scope: ['n2'], config: { channel: '#ops' } },
      { id: 'h3', type: 'audit', trigger: 'on_node_exit', scope: 'all' },
      { id: 'h4', type: 'enter', trigger: 'on_node_entry', scope: 'all', enabled: false },
    ];
    const { engine } = setup(wf, {
      hookHandlers: {
        audit: ({ trigger, from, to }) => void calls.push(`${trigger}:${from?.id}->${to?.id}`),
        enter: ({ node: n, config }) => void calls.push(`entry:${n?.id}:${config.channel}`),
      },
    });
    await engine.start(1, 1);
    expect(calls).toEqual([]);
    await engine.move(1, { next: true });
    expect(calls).toEqual(['on_node_exit:n1->n2', 'on_transition:n1->n2', 'entry:n2:#ops']);
  });

  it('hook failures are reported, not thrown', async () => {
    const wf = approvalFlow();
    wf.hooks = [{ id: 'm', type: 'msg', trigger: 'on_message', scope: 'all' }];
    const errors: unknown[] = [];
    const { engine } = setup(wf, { hookHandlers: { msg: () => { throw new Error('x'); } } });
    engine.on('hookError', (e) => errors.push(e.hookId));
    await engine.start(1, 1);
    expect(await engine.emit(1, 'on_message', { text: 'hi' })).toEqual({ fired: 1, failed: 1 });
    expect(errors).toEqual(['m']);
  });

  it('emits transitioned and completed events', async () => {
    const events: string[] = [];
    const { engine } = setup(approvalFlow(), { actions: { start: () => ({ next: true }), review: () => ({ next: true }), approve: () => ({ branch: 'yes' }) } });
    engine.on('transitioned', (e) => events.push(`${e.from}->${e.to}${e.branch ? `:${e.branch}` : ''}`));
    const off = engine.on('completed', (e) => events.push(`done@${e.nodeId}`));
    await engine.start(1, 1);
    off();
    expect(events).toEqual(['null->n1', 'n1->n2', 'n2->n3', 'n3->n4:yes', 'done@n4']);
  });
});

describe('1.x data compatibility', () => {
  it('runs workflows saved by the 1.x editor (true/false handles, no block definitions)', async () => {
    const legacy: Workflow = {
      id: 7, name: 'old', hooks: [],
      nodes: [
        { id: 'node_1', type: 'standard', position: { x: 0, y: 0 }, data: { type: 'start', label: '🟢 Start', className: 'bg-green-100' } },
        { id: 'node_2', type: 'decision', position: { x: 0, y: 0 }, data: { type: 'needs_approval', label: '❓ Needs Approval?' } },
        { id: 'node_3', type: 'terminal', position: { x: 0, y: 0 }, data: { type: 'resolved' } },
        { id: 'node_4', type: 'terminal', position: { x: 0, y: 0 }, data: { type: 'rejected' } },
      ],
      edges: [edge('node_1', 'node_2'), edge('node_2', 'node_3', 'true'), edge('node_2', 'node_4', 'false')],
    };
    const stores = memoryStores({ workflows: [legacy], subjects: [{ id: 1 }] });
    const engine = createEngine({ ...stores, logger: {} });
    await engine.start(1, 7);
    await engine.move(1, { next: true });
    expect(await engine.move(1, { branch: 'no' })).toMatchObject({ node: { id: 'node_4' }, status: 'completed' });
  });
});

describe('validateWorkflow', () => {
  it('reports the problems the editor should show', () => {
    const wf: Workflow = {
      id: 1, name: 'bad', hooks: [{ id: 'h', type: 'ghost', trigger: 'on_message', scope: ['zz'] }],
      nodes: [node('a', 'start'), node('b', 'email'), node('c', 'route'), node('d', 'done'), node('e', 'mystery'), node('f', 'review')],
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd', 'low'), edge('c', 'd', 'oops')],
    };
    const codes = validateWorkflow(wf, { blocks, hooks }).map((i) => `${i.level}:${i.code}`);
    expect(codes).toEqual(expect.arrayContaining([
      'error:MISSING_VARIABLE', 'error:UNKNOWN_BRANCH', 'warning:MISSING_BRANCH', 'error:UNKNOWN_BLOCK',
      'warning:UNREACHABLE', 'error:UNKNOWN_HOOK', 'warning:HOOK_SCOPE', 'warning:DEAD_END',
    ]));
    expect(validateWorkflow(approvalFlow(), { blocks, hooks })).toEqual([]);
  });
});

// ─── Type-level checks (verified by `npm run typecheck`) ──────────────────────
export function typeChecks() {
  const stores = memoryStores();
  createEngine({
    ...stores,
    blocks,
    actions: {
      email: ({ variables }) => {
        const to: string = variables.to;
        const retries: number = variables.retries;
        const tone: 'formal' | 'casual' | undefined = variables.tone;
        // @ts-expect-error optional select may be undefined
        const strictTone: 'formal' | 'casual' = variables.tone;
        void tone; void strictTone;
        // @ts-expect-error unknown variable
        void variables.nope;
        void to; void retries;
      },
      approve: () => ({ branch: 'yes' }),
      route: async () => ({ branch: 'urgent' }),
      review: () => ({ next: true }),
    },
  });
  // @ts-expect-error 'maybe' is not a branch of approve
  createEngine({ ...stores, blocks, actions: { approve: () => ({ branch: 'maybe' }) } });
  // @ts-expect-error steps cannot return a branch
  createEngine({ ...stores, blocks, actions: { review: () => ({ branch: 'yes' }) } });
  // @ts-expect-error typo in block id
  createEngine({ ...stores, blocks, actions: { emial: () => {} } });
}

describe('history and get()', () => {
  it('records each move with its actor; automatic steps have none', async () => {
    const { engine } = setup(approvalFlow(), { actions: { start: () => ({ next: true }) } });
    await engine.start(1, 1, { actor: 'alice' });
    await engine.move(1, { next: true }, { actor: 'bob' });
    const h = await engine.history(1);
    expect(h.map((e) => [e.from, e.to, e.actor])).toEqual([[null, 'n1', 'alice'], ['n1', 'n2', null], ['n2', 'n3', 'bob']]);
    expect((await engine.history(1, { limit: 1 }))[0].to).toBe('n3');
  });

  it('get() says where a subject is and what can happen next', async () => {
    const { engine } = setup();
    expect(await engine.get(1)).toMatchObject({ node: null, next: [], status: 'not_started' });
    await engine.start(1, 1);
    expect(await engine.get(1)).toMatchObject({ node: { id: 'n1', label: 'Start' }, status: 'waiting', next: [{ nodeId: 'n2' }] });
  });
});

describe('waits and retries', () => {
  const later = (ms: number) => new Date(Date.now() + ms);
  const waitBlocks = defineBlocks({
    start: { kind: 'start', label: 'Start' },
    cooldown: { kind: 'step', label: 'Wait', variables: { hours: v.number({ default: 24 }) } },
    remind: { kind: 'step', label: 'Remind', retry: { attempts: 3, delay: '1m', backoff: 2 } },
    flaky: { kind: 'step', label: 'Flaky' },
    done: { kind: 'end', label: 'Done' },
  });
  const flow = (middle: string): Workflow => ({
    id: 1, name: 'w', hooks: [],
    nodes: [node('a', 'start'), node('b', middle, middle === 'cooldown' ? { hours: 2 } : {}), node('c', 'done')],
    edges: [edge('a', 'b'), edge('b', 'c')],
  });

  it('waits, then continues when the timer is due', async () => {
    const stores = memoryStores({ workflows: [flow('cooldown')], subjects: [{ id: 1 }] });
    const engine = createEngine({
      ...stores, blocks: waitBlocks, logger: {},
      actions: { start: () => ({ next: true }), cooldown: ({ variables, input }) => (input.timer ? undefined : { wait: `${variables.hours}h` }) },
    });
    const r = await engine.start(1, 1);
    expect(r).toMatchObject({ node: { id: 'b' }, status: 'waiting', wait: { kind: 'resume' } });
    expect(new Date(r.wait!.until).getTime()).toBeGreaterThan(Date.now() + 2 * 3600e3 - 5000);
    expect((await engine.get(1)).timers).toHaveLength(1);
    expect(await engine.runDue({ now: later(3600e3) })).toEqual({ processed: 0, failed: 0 });
    expect(await engine.runDue({ now: later(3 * 3600e3) })).toEqual({ processed: 1, failed: 0 });
    expect(await engine.get(1)).toMatchObject({ node: { id: 'c' }, status: 'completed', timers: [] });
  });

  it('drops a timer when the subject moved on before it fired', async () => {
    const stores = memoryStores({ workflows: [flow('cooldown')], subjects: [{ id: 1 }] });
    const engine = createEngine({ ...stores, blocks: waitBlocks, logger: {}, actions: { start: () => ({ next: true }), cooldown: () => ({ wait: '1h' }) } });
    await engine.start(1, 1);
    await engine.move(1, { next: true });
    expect((await engine.get(1)).timers).toEqual([]);
    expect(await engine.runDue({ now: later(2 * 3600e3) })).toEqual({ processed: 0, failed: 0 });
  });

  it('retries a failing action with backoff, then succeeds', async () => {
    let calls = 0;
    const attempts: number[] = [];
    const stores = memoryStores({ workflows: [flow('remind')], subjects: [{ id: 1 }] });
    const engine = createEngine({
      ...stores, blocks: waitBlocks, logger: {},
      actions: {
        start: () => ({ next: true }),
        remind: ({ attempt }) => {
          attempts.push(attempt);
          if (++calls < 3) throw new Error('smtp down');
          return { next: true };
        },
      },
    });
    const r = await engine.start(1, 1);
    expect(r).toMatchObject({ status: 'waiting', wait: { kind: 'retry', attempt: 2 } });
    expect(await engine.runDue({ now: later(30e3) })).toEqual({ processed: 0, failed: 0 });
    await engine.runDue({ now: later(61e3) });
    const second = (await engine.get(1)).timers[0];
    expect(second).toMatchObject({ kind: 'retry', attempt: 3 });
    expect(new Date(second.dueAt).getTime() - Date.now()).toBeGreaterThan(110e3);
    await engine.runDue({ now: later(10 * 60e3) });
    expect(attempts).toEqual([1, 2, 3]);
    expect(await engine.get(1)).toMatchObject({ node: { id: 'c' }, status: 'completed' });
  });

  it('gives up after the last attempt and reports it', async () => {
    const stores = memoryStores({ workflows: [flow('remind')], subjects: [{ id: 1 }] });
    const errors: unknown[] = [];
    const engine = createEngine({ ...stores, blocks: waitBlocks, logger: {}, actions: { start: () => ({ next: true }), remind: () => { throw new Error('down'); } } });
    engine.on('timerError', (e) => errors.push(e.error));
    await engine.start(1, 1);
    await engine.runDue({ now: later(60e3 + 1) });
    expect(await engine.runDue({ now: later(10 * 60e3) })).toEqual({ processed: 0, failed: 1 });
    expect(errors[0]).toMatchObject({ code: 'ACTION_FAILED', details: { attempt: 3 } });
    expect(await engine.get(1)).toMatchObject({ node: { id: 'b' }, timers: [] });
  });

  it('without a retry policy failures still throw, and wait needs a timers store', async () => {
    const { timers: _t, ...noTimers } = memoryStores({ workflows: [flow('flaky')], subjects: [{ id: 1 }] });
    const engine = createEngine({ ...noTimers, blocks: waitBlocks, logger: {}, actions: { start: () => ({ next: true }), flaky: () => ({ wait: '1h' }) } });
    await expect(engine.start(1, 1)).rejects.toThrow(/no timers store/);
  });
});

describe('translated validation messages', () => {
  it('issues carry params so the editor can phrase them in other languages', async () => {
    const { itLabels } = await import('../src/react/labels');
    const wf = approvalFlow();
    wf.nodes[1] = node('n2', 'email', {});
    wf.edges = wf.edges.filter((e) => e.sourceHandle !== 'no');
    const issues = validateWorkflow(wf, { blocks, hooks });
    const it = issues.map((i) => itLabels.issue(i));
    expect(it).toContain('“Email”: to è obbligatorio');
    expect(it).toContain('“Approve?” non ha un collegamento “No”');
    expect(issues.find((i) => i.code === 'MISSING_BRANCH')?.message).toBe('"Approve?" has no "No" edge');
  });
});
