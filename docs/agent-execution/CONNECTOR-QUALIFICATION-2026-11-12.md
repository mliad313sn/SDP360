# Connector qualification — 2026-11-12 (read-only, redacted)

Credentials supplied by the owner in a local `.env` kept outside the repository (never printed, never committed).
Only metadata is recorded here. The production `PG_URL` and dashboard login in that file were **not used**.
Every call below is a GET (or the OAuth token refresh). No write endpoint was called.

| Connector | Call | Result |
|---|---|---|
| Meraki Dashboard API (`api.meraki.com/api/v1`, org 595601050719773321) | `GET /organizations/{org}/networks`, `GET /organizations/{org}/appliance/uplink/statuses` via `services/merakiClient.js` | **OK** — 31 networks, 29 appliances reporting uplinks; uplink states: 33 active, 17 not connected, 4 ready |
| Zoho OAuth (`accounts.zoho.com`) | refresh-token grant | **OK** — token issued, scope `MEAplus.fullaccess.all`, 3600 s |
| Zoho Analytics Plus (`analyticsplusapi.manageengine.com/restapi/v2`) | `GET /workspaces/{ws}/views` | **OK** — 720 views listed |
| ServiceDesk Plus Cloud (`oneitsupport.endeavourmining.com/app/itdesk/api/v3`) | `GET /requests` (first page, `services/sdpApiClient.js`) | **REFUSED — HTTP 401** |

## Reading

- **Meraki is qualified.** "Not connected" uplinks are expected on sites with a single provisioned WAN; they are not outages.
  The calibrated % Time Up rule (`wan_timeup_loss_pct`) and the SLA instrument are unchanged.
- **Analytics is qualified** with the refresh token in the file. Its token is scoped to Analytics Plus only.
- **SDP Cloud is NOT qualified.** The only refresh token supplied carries the Analytics scope; the SDP REST API needs a
  refresh token minted from the same Self Client with scope `SDPOnDemand.requests.READ` (one token per use — never
  delete/recreate the Self Client or regenerate its secret). Until it is supplied, the Teams SLA alerts and any SDP REST
  read stay at "configured: no", and the hourly Analytics sync remains the SDP source of record.

## Left for a person

1. Mint an SDP refresh token (`SDPOnDemand.requests.READ`) and enter it in Admin ▸ Intégration API ▸ Alertes SLA (write-only field),
   then re-run this qualification.
2. Decide whether the Meraki key in the file is the production key to keep, or a dedicated read-only key should be issued.
