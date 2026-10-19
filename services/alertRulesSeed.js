'use strict';
// Step 9 — the initial alert rules (arbitration 4: ≥ 10 rules live). In-app channel only at seed time —
// e-mail/Teams/webhook are opted into per rule by an admin (anti-noise policy, arbitration 5):
// streak ≥ 1 breach, cool-down 24 h per rule × site, null never fires.
const ADMINS = { roles: ['admin'] };
const SEED_RULES = [
  { key: 'sla.resolution.red', name: 'Resolution SLA below 80 %', metric: 'helpdesk.resolution_sla_pct', scope: 'site', op: 'lt', threshold: 80, streak: 1, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS, description: 'Monthly resolution SLA under the ITSM floor.' },
  { key: 'sla.first_reply.red', name: 'First-reply SLA below 80 %', metric: 'helpdesk.first_reply_sla_pct', scope: 'site', op: 'lt', threshold: 80, streak: 1, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS },
  { key: 'helpdesk.major_incident', name: 'Major incident this week', metric: 'helpdesk.window_major_incidents', scope: 'site', op: 'gte', threshold: 1, streak: 1, cooldown_min: 720, channels: ['inapp'], recipients: ADMINS },
  { key: 'helpdesk.overdue.high', name: 'More than 10 overdue tickets', metric: 'helpdesk.window_overdue', scope: 'site', op: 'gt', threshold: 10, streak: 2, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS },
  { key: 'inspection.critical', name: 'Critical inspection finding', metric: 'inspection.critical_count', scope: 'site', op: 'gte', threshold: 1, streak: 1, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS },
  { key: 'inspection.overdue_actions', name: 'Overdue inspection actions', metric: 'inspection.overdue_actions', scope: 'site', op: 'gte', threshold: 5, streak: 2, cooldown_min: 2880, channels: ['inapp'], recipients: ADMINS },
  { key: 'meetings.engagement.red', name: '5 Engagements score red', metric: 'meetings.engagement_score', scope: 'site', op: 'rag_in', threshold: 'RED', streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'meetings.overdue_issues', name: 'Overdue meeting issues', metric: 'meetings.overdue_issues', scope: 'site', op: 'gte', threshold: 5, streak: 2, cooldown_min: 2880, channels: ['inapp'], recipients: ADMINS },
  { key: 'assets.completeness.low', name: 'Asset register completeness below 60 %', metric: 'assets.completeness_pct', scope: 'site', op: 'lt', threshold: 60, streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'assets.ghosts', name: 'Ghost assets detected', metric: 'assets.ghost', scope: 'site', op: 'gte', threshold: 10, streak: 2, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'tracker.site.red', name: 'Activity tracker site score red', metric: 'tracker.site_score_pct', scope: 'site', op: 'rag_in', threshold: 'RED', streak: 1, cooldown_min: 10080, channels: ['inapp'], recipients: ADMINS },
  { key: 'wan.wan1.availability', name: 'WAN1 availability below 97 %', metric: 'wan.wan1_availability_pct', scope: 'site', op: 'lt', threshold: 97, streak: 1, cooldown_min: 1440, channels: ['inapp'], recipients: ADMINS },
];
module.exports = { SEED_RULES };
