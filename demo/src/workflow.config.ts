/**
 * Shared workflow configuration — in a real app this file is imported by both
 * the server (createEngine) and the client (WorkflowEditor).
 * Block ids match the 1.x demo, so workflows saved with it still open.
 */
import { defineBlocks, defineHooks, v, type Workflow } from 'vise-workflow-engine';

export const blocks = defineBlocks({
  start: { kind: 'start', label: 'Start', color: { bg: '#dcfce7', text: '#15803d' }, description: 'Entry point of the workflow' },
  auto_classify: {
    kind: 'step',
    label: 'Auto Classify',
    color: { bg: '#cffafe', text: '#0e7490' },
    description: 'AI classifies the ticket',
    variables: {
      model: v.select(['gpt-4o', 'claude-sonnet', 'local'], { label: 'Model', required: true }),
      confidence: v.number({ label: 'Min. confidence', default: 0.8, description: 'Between 0 and 1' }),
      custom_prompt: v.text({ label: 'Prompt override' }),
    },
  },
  route_priority: {
    kind: 'decision',
    label: 'Route by priority',
    color: { bg: '#ffedd5', text: '#c2410c' },
    description: 'Three-way branch on ticket priority',
    branches: [
      { id: 'low', label: 'Low', color: '#16a34a' },
      { id: 'normal', label: 'Normal', color: '#2563eb' },
      { id: 'urgent', label: 'Urgent', color: '#dc2626' },
    ],
  },
  manual_review: { kind: 'step', label: 'Manual Review', color: { bg: '#dbeafe', text: '#1d4ed8' }, description: 'A person reviews the ticket' },
  wait_for_reply: {
    kind: 'step',
    label: 'Wait for reply',
    color: { bg: '#f1f5f9', text: '#334155' },
    description: 'Pause, then continue on its own',
    variables: { duration: v.select(['10s', '30s', '1m', '1h', '1d'], { label: 'Wait', required: true }) },
  },
  send_email: {
    kind: 'step',
    label: 'Send Email',
    color: { bg: '#e0e7ff', text: '#4338ca' },
    description: 'Send a notification email',
    variables: {
      to: v.string({ label: 'Recipient', required: true, placeholder: 'support@example.com' }),
      template: v.select(['welcome', 'follow_up', 'resolution', 'escalation'], { label: 'Template', required: true }),
      include_transcript: v.boolean({ label: 'Attach transcript' }),
    },
  },
  needs_approval: { kind: 'decision', label: 'Needs Approval?', color: { bg: '#fef9c3', text: '#a16207' }, description: 'Approve or reject' },
  escalate_or_close: {
    kind: 'decision',
    label: 'Escalate or Close?',
    color: { bg: '#fed7aa', text: '#c2410c' },
    description: 'Escalate or close the case',
    branches: [
      { id: 'yes', label: 'Escalate', color: '#dc2626' },
      { id: 'no', label: 'Close', color: '#16a34a' },
    ],
  },
  resolved: { kind: 'end', label: 'Resolved', color: { bg: '#d1fae5', text: '#047857' }, description: 'Successfully resolved' },
  rejected: { kind: 'end', label: 'Rejected', color: { bg: '#fee2e2', text: '#b91c1c' }, description: 'Rejected / denied' },
});

export const hooks = defineHooks({
  send_slack_alert: {
    trigger: 'on_node_entry',
    label: 'Slack Alert',
    color: { bg: '#f3e8ff', text: '#7e22ce' },
    description: 'Post to Slack when a node is entered',
    config: { channel: v.string({ label: 'Channel', default: '#support' }) },
  },
  log_transition: { trigger: 'on_transition', label: 'Audit Log', color: { bg: '#f1f5f9', text: '#334155' }, description: 'Record every transition' },
  escalation_detector: { trigger: 'on_message', label: 'Escalation Detector', color: { bg: '#ffe4e6', text: '#be123c' }, description: 'Checks each incoming message' },
  sla_timer: {
    trigger: 'on_node_entry',
    label: 'SLA Timer',
    color: { bg: '#fef3c7', text: '#b45309' },
    description: 'Start an SLA countdown',
    config: { hours: v.number({ label: 'Hours', default: 24 }) },
  },
});

const node = (id: string, type: string, x: number, y: number, variables: Record<string, unknown> = {}) => ({
  id,
  type: 'block',
  position: { x, y },
  data: { type, variables },
});
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `e_${source}_${sourceHandle ?? 'out'}_${target}`, source, target, sourceHandle });

/** Example shown the first time the demo opens. */
export const exampleWorkflow: Workflow = {
  id: 1,
  name: 'Support ticket',
  description: 'Classify, route by priority, review and resolve.',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  nodes: [
    node('start', 'start', 320, 0),
    node('classify', 'auto_classify', 320, 110, { model: 'claude-sonnet', confidence: 0.8 }),
    node('route', 'route_priority', 284, 260),
    node('email', 'send_email', 0, 420, { to: 'customer@example.com', template: 'resolution', include_transcript: false }),
    node('wait', 'wait_for_reply', 0, 590, { duration: '10s' }),
    node('review', 'manual_review', 320, 420),
    node('escalate', 'escalate_or_close', 640, 420),
    node('approve', 'needs_approval', 320, 560),
    node('resolved', 'resolved', 160, 740),
    node('rejected', 'rejected', 480, 740),
  ],
  edges: [
    edge('start', 'classify'),
    edge('classify', 'route'),
    edge('route', 'email', 'low'),
    edge('route', 'review', 'normal'),
    edge('route', 'escalate', 'urgent'),
    edge('email', 'wait'),
    edge('wait', 'resolved'),
    edge('review', 'approve'),
    edge('approve', 'resolved', 'yes'),
    edge('approve', 'rejected', 'no'),
    edge('escalate', 'review', 'yes'),
    edge('escalate', 'resolved', 'no'),
  ],
  hooks: [
    { id: 'h_audit', type: 'log_transition', trigger: 'on_transition', scope: 'all', enabled: true, config: {}, position: { x: -260, y: 0 } },
    { id: 'h_slack', type: 'send_slack_alert', trigger: 'on_node_entry', scope: ['escalate', 'rejected'], enabled: true, config: { channel: '#escalations' }, position: { x: -260, y: 130 } },
  ],
};
