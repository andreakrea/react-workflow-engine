import type { ReactNode } from 'react';

/** Small stroke icons for the demo's blocks and hooks (16×16, currentColor). */
const icon = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

export const icons: Record<string, ReactNode> = {
  start: icon(<path d="M5.5 3.5v9l7-4.5z" />),
  auto_classify: icon(<><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2" /><circle cx="8" cy="8" r="3" /></>),
  route_priority: icon(<><circle cx="4" cy="4" r="1.5" /><circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="8" r="1.5" /><path d="M4 5.5v5M5.5 4c3 0 5 1.5 5.2 2.8M5.5 12c3 0 5-1.5 5.2-2.8" /></>),
  manual_review: icon(<><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>),
  send_email: icon(<><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5L8 9l5.5-4.5" /></>),
  needs_approval: icon(<><path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><path d="M5.8 8l1.6 1.6L10.4 6.6" /></>),
  escalate_or_close: icon(<><path d="M8 13V3M4.5 6.5L8 3l3.5 3.5" /></>),
  wait_for_reply: icon(<><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>),
  resolved: icon(<><circle cx="8" cy="8" r="5.5" /><path d="M5.6 8.1l1.7 1.7 3.2-3.4" /></>),
  rejected: icon(<><circle cx="8" cy="8" r="5.5" /><path d="M6 6l4 4M10 6l-4 4" /></>),
  send_slack_alert: icon(<path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />),
  log_transition: icon(<><path d="M4 2.5h6l2.5 2.5v8.5H4z" /><path d="M6 7.5h4.5M6 10h4.5" /></>),
  escalation_detector: icon(<><path d="M8 2.5L14 13H2z" /><path d="M8 6.5v3M8 11.2v.01" /></>),
  sla_timer: icon(<><circle cx="8" cy="9" r="5" /><path d="M8 6.5V9l1.8 1.2M6.5 2h3" /></>),
};
