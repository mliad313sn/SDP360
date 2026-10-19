#!/usr/bin/env python3
"""Build a faithful render.py-shape QA fixture from kpis-may.json.

The hand-authored kpis-may.json carries nested blocks (csat{}, trend{},
activity_tracker{}) that the *browser* sends; the live server build()
normalises them to the flat keys render.py actually reads. This script
replicates that normalisation so we can QA render.py locally with realistic
data (charts + tracker populated) without a 5-min live fetch.

Output: kpis-may-qa.json (flat, render.py-ready).
Run:  python tools/exec-pptx/_mk_qa_fixture.py
"""
import json, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'fixtures', 'kpis-may.json')
OUT = os.path.join(HERE, 'fixtures', 'kpis-may-qa.json')

with open(SRC, encoding='utf-8') as f:
    k = json.load(f)

# ── monthly_trend (slide 4) — from trend{} arrays ─────────────────────
tr = k.get('trend', {})
months = tr.get('months', [])
inb = tr.get('inbound', [])
clo = tr.get('closed', [])
res = tr.get('sla_compliance', [])
frt = tr.get('frt_compliance', [])
k['monthly_trend'] = [
    {'label': months[i], 'inbound': inb[i] if i < len(inb) else 0,
     'closed': clo[i] if i < len(clo) else 0,
     'res_sla': res[i] if i < len(res) else 0,
     'frt_sla': frt[i] if i < len(frt) else 0}
    for i in range(len(months))
]

# ── monthly_channels (slide 5 channel line) — synthesise email/webform %
# Email share gently declining as web-form adoption rises.
em_share = [72, 71, 70, 69, 69, 68, 68, 67, 67, 66, 66, 66]
k['monthly_channels'] = [
    {'label': months[i], 'email_pct': em_share[i] if i < len(em_share) else 66,
     'webform_pct': (100 - (em_share[i] if i < len(em_share) else 66)) - 2}
    for i in range(len(months))
]

# ── categories_prev (slide 5 Apr-vs-Mar grouped) — prior-month counts ─
# We don't have a real prior-month breakdown in this fixture; synthesise a
# plausible April set (~ current ±10%) so the grouped bars show two series.
cats = k.get('categories', {})
_bump = {0:1.08,1:0.94,2:1.12,3:0.9,4:1.05,5:0.96,6:1.1,7:0.88}
k['categories_prev'] = {name: int(round(v * _bump.get(i, 1.0)))
                        for i, (name, v) in enumerate(cats.items())}

# ── CSAT flatten (slide 7) ────────────────────────────────────────────
c = k.get('csat', {})
k['csat_satisfied']       = c.get('satisfied', 0)
k['csat_neutral']         = c.get('neutral', 0)
k['csat_dissatisfied']    = c.get('dissatisfied', 0)
k['csat_no_rating']       = c.get('no_rating', 0)
k['csat_total_responses'] = c.get('total_responses', 0)
k['csat_pct']             = c.get('csat_pct', 0)
k['csat_avg_score']       = c.get('avg_score_pct', 0)
k['nps_proxy']            = c.get('nps_proxy', 0)

# ── Major incidents (slide 9) — resolved/open/mom + per-incident action
recs = k.get('mi_records', [])
_actions = {
    307800: 'Complete PIR and document root cause; review server-room access redundancy at Lafigué.',
    307645: 'Complete PIR; reinforce monitoring and HA/redundancy on the Centric database tier.',
    307580: 'Complete PIR; assess GSM/LSI link redundancy and carrier escalation path.',
}
_descs = {
    307800: 'Access to the SML-CENT-01 server lost at Lafigué. Service restored within 29h. Category: IT Infrastructure / Servers. Status: Closed.',
    307645: 'Centric database server went down at Abidjan, impacting dependent services for 94h before restoration. Category: IT Infrastructure / Servers. Status: Closed.',
    307580: 'GSM and LSI connectivity disruption at Lafigué affecting network reachability; service restored within the period. Category: Network & Internet Access. Status: Closed.',
}
for r in recs:
    rid = r.get('id')
    try: rid = int(rid)
    except Exception: pass
    if 'action' not in r:
        r['action'] = _actions.get(rid, 'Complete post-incident review and capture lessons learned.')
    if 'mttr_h' not in r:
        r['mttr_h'] = {307800: 29, 307645: 94, 307580: 12}.get(rid)
    # richer description used by the single-column card
    if 'description' not in r:
        r['description'] = _descs.get(rid, f"{r.get('subject','')}. Status: {r.get('status','—')}.")
_resolved = sum(1 for r in recs if str(r.get('status', '')).lower() in ('closed', 'resolved'))
k['mi_resolved'] = _resolved
k['mi_open'] = max(0, len(recs) - _resolved)
k['mi_mom'] = 'flat'          # vs April
k['mi_downtime_h'] = 0
k['mi_prev_total'] = 4

# ── Recent changes (slide 8 yellow-box glance line) ───────────────────
k['recent_changes'] = [
    'Network rollout - Toulepleu site link',
    'Secure Print deployment (ITY)',
    'SOC bandwidth stress test',
    'Core infrastructure rebuild (Sabodala)',
]

# ── Tracker block (slides 10/11) — map activity_tracker -> tracker ────
at = k.get('activity_tracker', {})
_SITE_COLORS = ['0D9488', 'E87722', '7C3AED', 'B59A00', '2563EB', '16A34A']
sites_src = at.get('sites', [])
sites = []
for i, s in enumerate(sites_src):
    g, a, r = s.get('g', 0), s.get('a', 0), s.get('r', 0)
    score, d = s.get('score', 0), s.get('delta_pp', 0)
    name = s.get('name', s.get('code', ''))
    # positive line
    if d > 2:
        positive = f"{name} ({g+a+r}). +{d}pp improvement this month."
    elif d < -2:
        positive = f"{name} ({g+a+r}). {g} activities green; momentum to rebuild."
    else:
        positive = f"{name} ({g+a+r}). Holding steady at {score}%."
    # action line
    if r > 0:
        action = f"{r} RED remain - {a} amber items with conversion potential."
    else:
        action = "No red items - maintain cadence."
    sites.append({
        'code': s.get('code', ''), 'name': name, 'score': score,
        'delta_pp': d, 'g': g, 'a': a, 'r': r,
        'color': _SITE_COLORS[i % len(_SITE_COLORS)],
        'activities': g + a + r, 'positive': positive, 'action': action,
    })

pillars_src = at.get('pillars', {})
pillars = {}
for name, p in pillars_src.items():
    pillars[name] = {
        'weight': p.get('weight', 0), 'delta_pp': p.get('delta_pp', 0),
        'green': p.get('g', 0), 'amber': p.get('a', 0), 'red': p.get('r', 0),
        'score': p.get('score_may', 0),
    }

# general review — split exec_commentary into pos/action heuristically
gr = []
for line in at.get('exec_commentary', [])[:5]:
    kind = 'action' if any(w in line.lower() for w in ('red', 'gap', 'declin', 'escalat', 'recommend')) else 'pos'
    gr.append({'text': line, 'kind': kind})

k['tracker'] = {
    'green': at.get('green_total', 0), 'amber': at.get('amber_total', 0),
    'red': at.get('red_total', 0),
    'avg_score': at.get('fleet_avg', 0), 'avg_delta_pp': at.get('fleet_delta_pp', 0),
    'best_site': (max(sites, key=lambda s: s['delta_pp'])['code'] if sites else ''),
    'best_delta_pp': (max(sites, key=lambda s: s['delta_pp'])['delta_pp'] if sites else 0),
    'total_activities': sum(s['activities'] for s in sites),
    'active_sites': len(sites),
    'sites': sites, 'pillars': pillars, 'general_review': gr,
    'commentary': at.get('exec_commentary', []),
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(k, f, ensure_ascii=False, indent=2)
print('wrote', OUT, '-', os.path.getsize(OUT), 'bytes')
print('monthly_trend', len(k['monthly_trend']), '| tracker sites', len(sites),
      '| pillars', len(pillars), '| csat_sat', k['csat_satisfied'])
