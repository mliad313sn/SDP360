'use strict';
// Step 9 — the initial alert rules (arbitration 4: ≥ 10 rules live). In-app channel only at seed time —
// e-mail/Teams/webhook are opted into per rule by an admin (anti-noise policy, arbitration 5):
// streak ≥ 1 breach, cool-down 24 h per rule × site, null never fires.
// G16 — severity: critical = act today (major incident, critical-risk inspection), warning = act this week, info =
// housekeeping. A PROPOSAL of the delivery team until the service owner confirms it (ADR-G16). The WAN rules read the
// weekly % Time Up — an operational figure, NOT the contract (which counts total outages in service hours only).
// Cool-downs match the metric window so one event is announced once (a weekly count → 7 days, a monthly count → 30 days).
const ADMINS = { roles: ['admin'] };
const SEED_RULES = [
  { key: 'sla.resolution.red', severity: 'warning', name: 'Resolution SLA below 80 %', metric: 'helpdesk.resolution_sla_pct', scope: 'site', op: 'lt', threshold: 80, streak: 1, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS, description: 'Monthly resolution SLA under the ITSM floor.' },
  { key: 'sla.first_reply.red', severity: 'warning', name: 'First-reply SLA below 80 %', metric: 'helpdesk.first_reply_sla_pct', scope: 'site', op: 'lt', threshold: 80, streak: 1, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS },
  { key: 'helpdesk.major_incident', severity: 'critical', name: 'Major incident this week', metric: 'helpdesk.window_major_incidents', scope: 'site', op: 'gte', threshold: 1, streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'helpdesk.overdue.high', severity: 'warning', name: 'More than 10 overdue tickets', metric: 'helpdesk.window_overdue', scope: 'site', op: 'gt', threshold: 10, streak: 2, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS },
  { key: 'inspection.critical', severity: 'critical', name: 'Critical-risk inspection this month', metric: 'inspection.critical_count', scope: 'site', op: 'gte', threshold: 1, streak: 1, cooldown_min: 43200, channels: ['inapp'], recipients: ADMINS },
  { key: 'inspection.overdue_actions', severity: 'warning', name: 'Overdue inspection actions', metric: 'inspection.overdue_actions', scope: 'site', op: 'gte', threshold: 5, streak: 2, cooldown_min: 2880, channels: ['inapp'], recipients: ADMINS },
  { key: 'meetings.engagement.red', severity: 'warning', name: '5 Engagements score red', metric: 'meetings.engagement_score', scope: 'site', op: 'rag_in', threshold: 'RED', streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'meetings.overdue_issues', severity: 'warning', name: 'Overdue meeting issues', metric: 'meetings.overdue_issues', scope: 'site', op: 'gte', threshold: 5, streak: 2, cooldown_min: 2880, channels: ['inapp'], recipients: ADMINS },
  { key: 'assets.completeness.low', severity: 'info', name: 'Asset register completeness below 60 %', metric: 'assets.completeness_pct', scope: 'site', op: 'lt', threshold: 60, streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'assets.ghosts', severity: 'info', name: 'Ghost assets detected', metric: 'assets.ghost', scope: 'site', op: 'gte', threshold: 10, streak: 2, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'tracker.site.red', severity: 'warning', name: 'Activity tracker site score red', metric: 'tracker.site_score_pct', scope: 'site', op: 'rag_in', threshold: 'RED', streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'wan.wan1.availability', severity: 'warning', name: 'WAN1 % Time Up below 97 % (operational, not the contract)', metric: 'wan.wan1_availability_pct', scope: 'site', op: 'lt', threshold: 97, streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'wan.wan2.availability', severity: 'warning', name: 'WAN2 % Time Up below 97 % (operational, not the contract)', metric: 'wan.wan2_availability_pct', scope: 'site', op: 'lt', threshold: 97, streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
];
module.exports = { SEED_RULES };
