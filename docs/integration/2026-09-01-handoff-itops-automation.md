---
title: "Claude Handoff — IT OPS Automation with SDP Cloud, Teams, Azure OpenAI and ManageEngine Stack"
created: "2026-09-01"
owner_context: "Endeavour Mining IT Operations / One IT Support"
handoff_type: "implementation and advisory handoff"
---

# Claude Handoff — IT OPS Automation

## 1. Purpose

The user wants to increase automation across IT Operations and Infrastructure using the existing stack:

- ServiceDesk Plus Cloud (SDP Cloud)
- Microsoft Teams
- Microsoft Copilot / Copilot Studio
- Azure OpenAI integration inside SDP Cloud
- ManageEngine OpManager
- ManageEngine ADManager
- ManageEngine ADAudit
- ManageEngine Patch Manager
- SDP Analytics / reporting dashboards
- PowerShell / Python automation where useful

The strategic goal is not only to answer questions with AI, but to automate and accelerate IT operations: ticket triage, correct form selection, categorization, validation, approval routing, assignment, technician notification, reporting, and eventually safe remediation workflows.

## 2. Current Situation

The user currently has two Teams-facing assistant options.

### A. Native ServiceDesk Plus Cloud Teams agent

This is the official ManageEngine / Zoho ServiceDesk Plus Cloud app inside Microsoft Teams.

Observed behavior:

- It can ask the user to sign in to ServiceDesk Plus Cloud.
- It can create/list tickets and show SDP actions.
- It is tied directly to SDP authentication and permissions.
- It does not depend on the user’s custom Copilot Studio environment credits in the same way.

Use this for production helpdesk actions where native SDP permissions and supported actions are enough.

### B. Custom Copilot Studio agent: “One IT Support”

This is the user-built custom agent intended to guide employees, technicians, and asset managers.

Current configuration already includes:

- Bilingual French/English support instructions.
- SDP form guidance.
- Knowledge files:
  - `sdp-form-routing-table.csv`
  - `one-it-support-sdp-knowledge-fr-en.md`
  - `Category_1.csv`
- Skill:
  - `sdp-form-routing-request-guidance`
- Tool connection:
  - `One IT Support`

Observed issue:

- In Teams, the custom agent returns: “You need credits to continue. This environment is out of credits.”
- This means the custom Copilot Studio agent is blocked by Power Platform / Copilot Studio credit capacity, not by SDP itself.

Recommended action:

- Ask the Microsoft / Power Platform admin to verify Copilot Studio credits or metered billing for the environment.
- Check Power Platform Admin Center → Licensing / Capacity → Copilot Studio credits.

## 3. Recommended Target Architecture

Use a layered model:

```text
Microsoft Teams
   ↓
Native SDP Cloud Teams app
   ↓
ServiceDesk Plus Cloud
   ├─ Templates & Forms
   ├─ Business Rules
   ├─ Workflows / Approvals
   ├─ Assignment Rules
   ├─ Notification Rules
   ├─ Teams Integration
   ├─ Azure OpenAI / Zia GenAI
   └─ Analytics / Reports

Advanced automation layer:

SDP Custom Trigger / Webhook
   ↓
Power Automate / Azure Function / Python API
   ↓
Teams Adaptive Cards / OpManager / ADManager / ADAudit / Patch Manager / PowerShell
```

Principle:

- Use SDP native rules for deterministic actions.
- Use Azure OpenAI / Zia for intelligence: summarization, classification, template prediction, response drafting, PIR generation, and knowledge suggestions.
- Use external automation only where SDP native workflow is not enough.
- Require human approval before any risky action.

## 4. Azure OpenAI Integration in SDP Cloud

The SDP Cloud integration screen asks for:

- Azure OpenAI Resource URL
- Base model
- Model name / deployment name
- API key

Recommended model approach:

- Use a cost-efficient model for normal helpdesk tasks such as ticket summary, category suggestion, reply drafting, and template prediction.
- Use a stronger model only for complex PIR, RCA, major incident summaries, or multi-ticket analysis.

Security and privacy position:

- Azure OpenAI is not the same product as Microsoft 365 Copilot.
- It can provide a strong enterprise-grade privacy posture when deployed in the organization’s Azure tenant.
- Prompts and responses are processed through Azure OpenAI and are not used to train public base models by default.
- However, because SDP Cloud is involved, the data path is:

```text
SDP Cloud / Zoho → Azure OpenAI endpoint → SDP Cloud
```

Therefore, the final security assessment must include both Microsoft Azure OpenAI terms and ManageEngine / Zoho data handling.

Recommendation:

- Prefer Azure OpenAI integration over direct ChatGPT integration for sensitive ITSM data.
- Do not use direct ChatGPT integration for production helpdesk data unless Security / Legal approves.
- If strict local-only processing is required, use a local LLM architecture outside Copilot Studio and outside SDP Cloud GenAI.

## 5. Priority Automation Use Cases

### 5.1 Ticket triage and categorization

Goal:

Automatically suggest or assign the correct category, subcategory, item, priority, and support group based on the user’s description.

Recommended implementation:

1. Enable Azure OpenAI / Zia features in SDP:
   - Template Prediction
   - Request Summarization
   - Reply Assistant
   - Context-aware Solution Suggestion
2. Configure SDP Business Rules to enforce final category, priority, group, and technician routing.
3. Keep AI suggestions reviewable by technicians at first.
4. Move only low-risk, high-confidence routing to automation.

Example:

```text
User says: “I need access to USB ports.”
AI suggests:
- Category: Security Services & IT Deviation
- Template: Endeavour IT / IS Deviation Approval Form
- Approval path: Manager → Cybersecurity → EVP
- Assignment group: Security / IT deviation team
```

### 5.2 Correct form selection

Known SDP forms and routing:

| User need | SDP category | Form/template |
|---|---|---|
| Report an issue / incident | Incident Templates | Issue Reporting_ |
| ERP / business app access | Business Software & ERP | Enterprise Applications Access |
| Hardware, desktop software, email, Wi-Fi, VPN, SIM, shared mailbox, distribution list | IT Support & Hardware Requests | New User IT services and Hardware request |
| USB access, local admin, unauthorized software, IT/IS deviation | Security Services & IT Deviation | Endeavour IT / IS Deviation Approval Form |
| Microsoft 365 Copilot paid license | Business Software & ERP | Microsoft 365 Copilot Licence Request |

The custom One IT Support agent should guide the requester to the right form before creating or submitting anything.

### 5.3 Field validation before submission

Goal:

Reduce incomplete tickets and back-and-forth with users.

Validation examples:

- ERP access request must include application, access type, group/profile, manager approver email, and justification.
- EAM access must include EAM group.
- USB/local admin deviation must include business justification, duration, risk classification, manager, EVP, and cybersecurity review.
- Incident must include impacted service, urgency, business impact, affected site, screenshot if available, and contact details.

Implementation:

- Use Copilot/agent for conversational pre-check.
- Use SDP mandatory fields and form rules for hard validation.
- Use Business Rules to reject, reassign, or flag incomplete requests.

### 5.4 Assignment of technicians and groups

Goal:

Assign tickets to the right group or technician without manual dispatcher effort.

Recommended implementation:

- SDP Business Rules for category/site/priority-based assignment.
- Technician auto-assignment if supported and suitable.
- Site coordinators for site-specific generic services.
- Application owners for known application support.
- General IT Issues for uncategorized or multi-domain incidents.

Start with group assignment before individual technician assignment. Individual assignment should come later after workload and availability rules are reliable.

### 5.5 Teams push notifications

Goal:

Notify technicians and coordinators directly in Microsoft Teams when action is required.

Native SDP Teams integration can support:

- Creating and managing requests from Teams.
- Posting request updates in Teams.
- Tagging service desk members to collaborate on tasks.
- Publishing relevant SDP solutions.
- Handling tickets through chatbots.

Advanced option:

- SDP Custom Trigger or Webhook sends event to Power Automate / Azure Function / Python.
- Automation posts a Teams Adaptive Card to a technician, group channel, or site coordinator.
- The card can include approve/reject, assign, update status, add note, or open ticket link actions.

Recommended staged approach:

1. Enable native Teams notifications first.
2. Add custom Teams Adaptive Cards only for high-value flows:
   - Major incidents
   - SLA breach
   - Security deviation approval
   - VIP tickets
   - Site weekly reporting

### 5.6 Reporting automation

Existing context:

- A platform has already been developed to facilitate helpdesk dashboard follow-up and automated reports for site coordinators and technicians.
- Reports support weekly and monthly generation.
- SDP dashboard already tracks portal adoption.

Recommended next automations:

- Weekly site coordinator report push.
- Monthly IT Ops dashboard summary.
- SLA breach and backlog alerts.
- Adoption tracking for web form vs email submission.
- Asset scan coverage and QR tagging status.
- CAB/action tracker summary.
- PIR tracker for major incidents only.

### 5.7 Asset management automation

Known status:

- 2,232 assets are currently in SDP.
- Servers and laptops are scanned and in SDP.
- Assets are tagged using QR codes.

Recommended automations:

- Detect assets not scanned in the last N days.
- Notify site coordinator for missing or stale assets.
- Create asset audit task automatically.
- Generate QR code compliance report.
- Link user, asset, site, warranty, and incident history.

### 5.8 Infrastructure monitoring and remediation

Use OpManager and PowerShell/Python for infrastructure tasks.

Potential automations:

- Convert OpManager alerts into SDP incidents.
- Enrich tickets with server/device name, site, severity, and last known metrics.
- Auto-notify Teams channel for critical alerts.
- Trigger safe read-only diagnostics:
  - Ping
  - DNS check
  - Disk space check
  - Service status check
  - Event log query
- Suggest remediation steps.
- For risky remediation, require approval before execution:
  - Restart service
  - Reboot server
  - Firewall changes
  - Patch deployment
  - Account changes

### 5.9 Active Directory / identity automation

Available tools:

- ADManager
- ADAudit
- Intune is active for all users.

Potential automations:

- Password reset / unlock guidance.
- Account creation validation.
- Group membership request workflow.
- Local admin or privilege request workflow.
- Inactive account reporting.
- Risky login or account change alert from ADAudit to SDP/Teams.

Important:

- Do not execute account changes directly from AI without explicit human approval.
- Keep approval and audit trail in SDP / ADManager / ADAudit.

### 5.10 Patch compliance automation

Use Patch Manager plus SDP reporting.

Potential automations:

- Weekly patch compliance report.
- Notify site coordinator for non-compliant endpoints.
- Create SDP task for critical missing patches.
- Escalate repeated patch failures.
- Summarize patch status in Teams.

## 6. Safety and Governance Rules

The assistant/automation must never directly execute high-risk actions without human approval.

High-risk actions include:

- Account creation, deletion, privilege changes, group membership changes.
- Local admin approval.
- USB access approval.
- Firewall/security exception.
- Server reboot.
- Service restart on production servers.
- Patch deployment.
- Asset retirement or deletion.
- Change implementation after CAB approval.

Required behavior:

1. Summarize the request.
2. Identify affected system, user, site, and business impact.
3. Assess risk.
4. Propose the action.
5. Ask for explicit approval.
6. Log the action in SDP.

## 7. Suggested Initial Build Plan

### Phase 1 — Stabilize native SDP automation

- Enable / validate SDP Cloud Teams app.
- Confirm users can sign in from Teams.
- Validate create ticket, list ticket, list solutions.
- Configure Teams notification settings.
- Confirm external app access is allowed by Microsoft Teams admin.

### Phase 2 — Enable Azure OpenAI inside SDP

- Create or identify Azure OpenAI resource.
- Deploy selected model.
- Generate API key.
- Configure SDP Azure OpenAI integration.
- Enable initial GenAI/Zia features:
  - Request Summarization
  - Reply Assistant
  - Template Prediction
  - Context-aware Solution Suggestion

### Phase 3 — Build deterministic SDP rules

- Configure Business Rules for:
  - Category
  - Subcategory
  - Item
  - Site
  - Priority
  - Group assignment
  - Technician assignment where safe
- Configure Workflow approvals for:
  - USB access
  - Local admin
  - Unauthorized software
  - ERP access
  - M365 Copilot license

### Phase 4 — Add Teams push automation

- Start with native SDP Teams notifications.
- Add custom Adaptive Cards for:
  - Major incidents
  - SLA breach
  - Security deviation approval
  - VIP tickets
  - Site weekly reporting

### Phase 5 — Add infrastructure and identity automation

- Integrate OpManager alerts to SDP incidents.
- Integrate ADManager/ADAudit events for identity workflows.
- Add PowerShell/Python runbooks for read-only diagnostics first.
- Add approval-gated remediation later.

## 8. Suggested Claude Next Actions

If Claude continues this work, ask the user for:

1. Whether the priority is SDP-native automation, Teams notifications, Azure OpenAI setup, or PowerShell/Python runbooks.
2. A screenshot or export of current SDP Business Rules.
3. A screenshot or export of current notification rules and technician groups.
4. The list of support groups, sites, coordinators, and application owners.
5. Whether the user wants a formal implementation plan, a configuration checklist, or copy-paste rules.

Then produce one of:

- `SDP_Automation_Blueprint.md`
- `SDP_Business_Rules_Matrix.xlsx`
- `Teams_Notification_Flows.md`
- `Azure_OpenAI_SDP_Configuration_Checklist.md`
- `IT_Ops_Automation_Roadmap.pptx`

## 9. Suggested Skills

Recommended skills for the next agent:

- `handoff` — if preparing another transition document.
- `spreadsheets:Spreadsheets` — if building an automation matrix or business rules tracker in Excel.
- `presentations:Presentations` — if preparing a manager-facing deck.
- `documents:documents` — if producing a formal Word/PDF implementation guide.
- `diagnose` — if troubleshooting SDP probes, Teams integration, Copilot credits, or automation failures.
- `skill-creator` or `write-a-skill` — if updating the One IT Support Copilot/agent skill package.

## 10. Key Known Constraints

- The custom Copilot Studio agent is currently blocked by missing environment credits.
- The native SDP Teams app is separate from the custom Copilot Studio agent and may work even when Copilot Studio credits are exhausted.
- Azure OpenAI in SDP is enterprise-grade cloud AI, but not local/offline.
- Direct ChatGPT integration should not be preferred for sensitive ITSM data without security approval.
- For strict confidentiality/local-only processing, use a separate internal Python/FastAPI + local LLM architecture, not Copilot Studio.

## 11. Short Executive Summary

Recommended direction:

Use SDP Cloud as the system of record and automation engine, Teams as the user/technician interface, Azure OpenAI/Zia as the intelligence layer, and Power Automate/Azure Function/Python as the advanced automation layer. Start with low-risk AI assistance and deterministic SDP rules, then progressively add approval-gated remediation for infrastructure, identity, patching, and security workflows.

