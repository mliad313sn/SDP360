'use strict';
// fetchView is the server.js primitive, injected by init(): fetchView(viewId, maxRows) → { rows }.
// RECON FACT (2026-07-17): the AP /data endpoint ignores maxRows and returns the WHOLE view,
// or times out on a huge one (software_installations = 121k took 13.6 min → past fetchView's
// 120s cap, which is why it moved to sub-project C). So for A's 5 small views this is a plain
// single fetch that returns everything, fast. No truncation guard — the API doesn't truncate.
// The hardCap is only a data-gone-wrong tripwire (a view should not suddenly be 10x its size);
// a slow/huge view fails via fetchView's timeout (throws), and the engine (Task 2) keeps the
// table intact on any throw.
async function fetchAll(viewId, fetchView, { maxRows = 20000, hardCap = 50000 } = {}) {
  const { rows } = await fetchView(viewId, maxRows);   // maxRows passed but the API ignores it
  if (rows.length > hardCap) {
    throw new Error(`fetchAll(${viewId}): ${rows.length} rows exceeds the hard cap ${hardCap} — ` +
      `unexpectedly large for a Foundation view. Refusing to store; investigate before raising the cap.`);
  }
  return rows;
}
module.exports = { fetchAll };
