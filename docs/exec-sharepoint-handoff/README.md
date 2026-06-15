# Executive view for SharePoint — handoff package

This folder is the complete handoff for the all-staff executive IT view that
will be published to SharePoint M365. Hand it to the Designer (and the
integration teams) as described below.

## What's in here

| File | For | Notes |
|---|---|---|
| **EXEC_SHAREPOINT_VIEW_HANDOFF.md** | Designer — **start here** | The brief: context, content, brand tokens, the fidelity-vs-delivery note, what to deliver back |
| **exec-sharepoint-mockup.portable.html** | Designer — **send this one** | The visual (Options A + B). Self-contained: logo embedded, opens in any browser. Needs internet for fonts + chart only. |
| exec-sharepoint-mockup.html | editing inside the repo | Same visual, but the logo loads via the repo path `../../public/brand/`. Use this one only if working within the repository. |
| BOOMI_SHAREPOINT_INTEGRATION_SPEC.md | Integration / M365 / Security | Not for the Designer — the "how it gets to SharePoint" (governed Boomi path) |

## How to hand off — pick the channel that fits

1. **Designer has repo / GitHub access** → just send them the link to this folder.
   They open `exec-sharepoint-mockup.html` directly.
2. **Email / Teams (no repo access)** → attach **two files**:
   `EXEC_SHAREPOINT_VIEW_HANDOFF.md` + `exec-sharepoint-mockup.portable.html`.
   Tell them: "open the .html in a browser; the brief explains the rest."
   (The portable file has the logo baked in, so it renders correctly on their
   machine — fonts and the chart load from the internet.)
3. **One bundle** → zip this whole folder and send it.

## What we're asking the Designer to do

See `EXEC_SHAREPOINT_VIEW_HANDOFF.md` §9. In short: refine the master visual,
help pick layout A vs B (we recommend B), and — if the native-SharePoint delivery
is chosen — also produce a SharePoint-native variant. The brief explains why
pixel-fidelity depends on the delivery mode.

## Still open (decide with stakeholders first)

Layout A/B · which content blocks · delivery mode · refresh cadence · language
(EN / FR / bilingual — the audience is largely francophone).
