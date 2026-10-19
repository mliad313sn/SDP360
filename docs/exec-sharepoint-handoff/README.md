# Executive view for SharePoint — handoff package

This folder is the complete handoff for the all-staff executive IT view that
will be **embedded in a SharePoint M365 page**. Hand it to the Designer (and the
integration teams) as described below.

> Note: the mockup has **no logo / minimal header on purpose** — the view is
> embedded inside a SharePoint page that already provides the Endeavour site
> header, logo and navigation. Adding our own logo would duplicate it.

## What's in here

| File | For | Notes |
|---|---|---|
| **EXEC_SHAREPOINT_VIEW_HANDOFF.md** | Designer — **start here** | The brief: context, content, brand tokens, the fidelity-vs-delivery note, what to deliver back |
| **exec-sharepoint-mockup.html** | Designer — **the visual** | Options A + B + C (stacked). Opens in any browser; only fonts + chart load from the internet (no other dependency) |
| BOOMI_SHAREPOINT_INTEGRATION_SPEC.md | Integration / M365 / Security | Not for the Designer — the "how it gets to SharePoint" (governed Boomi path) |

## How to hand off — pick the channel that fits

1. **Designer has repo / GitHub access** → send the link to this folder; they
   open `exec-sharepoint-mockup.html` directly.
2. **Email / Teams** → attach **two files**: `EXEC_SHAREPOINT_VIEW_HANDOFF.md`
   + `exec-sharepoint-mockup.html`. Tell them: "open the .html in a browser; the
   brief explains the rest." (The page is self-contained except web fonts and the
   chart library, which load from the internet.)
3. **One bundle** → zip this whole folder and send it.

## What we're asking the Designer to do

See `EXEC_SHAREPOINT_VIEW_HANDOFF.md` §9. In short: refine the master visual,
help pick layout A vs B (we recommend B), design it as **embedded content** (no
logo / light header — SharePoint provides the page chrome), and — if the native-
SharePoint delivery is chosen — also produce a SharePoint-native variant.

## Still open (decide with stakeholders first)

Layout A/B · which content blocks · delivery mode · refresh cadence · language
(EN / FR / bilingual — the audience is largely francophone).
