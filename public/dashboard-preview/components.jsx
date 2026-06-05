// IT Activity Tracker — Dashboard components

const { useMemo } = React;

// ---------- helpers ----------
const fmtDelta = (n) => {
  if (n === 0) return '—';
  const arrow = n > 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(n)} pp`;
};
const deltaClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

const ragColor = (rag) => ({ red: '#D90038', amber: '#D97706', green: '#1B9A3A' }[rag] || '#6B7785');

// ---------- AppBar ----------
const AppBar = () => (
  <header className="appbar" data-screen-label="App Bar">
    <div className="appbar__row">
      <div className="brand">
        <img src="../../assets/logos/endeavour-logo.png" alt="Endeavour Mining" />
        <span className="brand__divider" />
        <span className="brand__product">IT Activity Tracker</span>
      </div>
      <span className="appbar__spacer" />
      <div className="period" title="Reporting period">
        <span className="period__icon">◷</span>
        <select defaultValue="May"><option>Mar</option><option>Apr</option><option>May</option></select>
        <select defaultValue="2026"><option>2024</option><option>2025</option><option>2026</option></select>
      </div>
      <div className="appbar__user">AB</div>
    </div>
  </header>
);

// ---------- Tabs ----------
// Tabs now accept an activeId + onSelect callback so App can switch
// between panels (Dashboard / Scoring / …) without reloading the page.
// Falls back to the old `active: true` flag on the data if no activeId
// is passed — preserves the original static-screenshot demo mode.
const Tabs = ({ tabs, activeId, onSelect }) => (
  <nav className="tabs" data-screen-label="Tabs">
    <div className="tabs__row">
      {tabs.map(t => {
        const isActive = activeId ? (t.id === activeId) : !!t.active;
        return (
          <button
            key={t.id}
            type="button"
            className={`tab ${isActive ? 'is-active' : ''}`}
            onClick={() => onSelect && onSelect(t.id)}
          >
            {t.label}
            {t.badge && <span className="badge-new">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  </nav>
);

// ---------- Sparkline ----------
// Tuned for the light headline card: EDV blue line, soft area fill, and
// dark slate text/stroke (used to be white-on-dark; the card is no longer dark).
const Sparkline = ({ data, color = '#145FAE' }) => {
  const w = 460, h = 110;
  const pad = { l: 0, r: 0, t: 18, b: 6 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const min = Math.min(...data.map(d => d.value)) - 4;
  const max = Math.max(...data.map(d => d.value)) + 4;
  const range = max - min || 1;
  const x = i => pad.l + (i * innerW) / (data.length - 1);
  const y = v => pad.t + innerH - ((v - min) / range) * innerH;
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(data.length - 1)} ${pad.t + innerH} L ${x(0)} ${pad.t + innerH} Z`;
  const last = data[data.length - 1];
  return (
    <svg className="headline__spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkFill)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* mid points */}
      {data.map((d, i) => (
        i === data.length - 1 ? null :
          <circle key={i} cx={x(i)} cy={y(d.value)} r="2.4" fill="rgba(20,95,174,0.55)" />
      ))}
      <circle cx={x(data.length - 1)} cy={y(last.value)} r="5" fill={color} stroke="#fff" strokeWidth="2" />
      <text x={x(data.length - 1)} y={y(last.value) - 12} textAnchor="end"
            fontSize="13" fontWeight="700" fill="#3A4A60" fontFamily="Libre Franklin">{last.value}%</text>
    </svg>
  );
};

// ---------- Headline ----------
const Headline = ({ overall, trend, period }) => (
  <section className="headline" data-screen-label="Headline" data-comment-anchor="headline">
    <div className="headline__grid">
      <div>
        <div className="headline__label">Overall score · {period.month} {period.year}</div>
        <div className="headline__score">
          <span className="num tnum">{overall.score}</span>
          <span className="unit">%</span>
          <span className={`headline__delta ${deltaClass(overall.delta)}`}>{fmtDelta(overall.delta)}</span>
        </div>
        <div className="headline__sub">
          <span><b>{overall.onTarget}%</b> of activities on target</span>
          <span className="dot">·</span>
          <span><b>{overall.progressing}%</b> showing progress</span>
          <span className="dot">·</span>
          <span className="accent-best">Best <b>{overall.bestSite.code}</b> {overall.bestSite.score}%</span>
          <span className="dot">·</span>
          <span className="accent-watch">Watch <b>{overall.watchSite.code}</b> {overall.watchSite.score}%</span>
        </div>
      </div>
      <div className="headline__trend">
        <div className="headline__trend-label">6-month trend</div>
        <Sparkline data={trend} />
        <div className="headline__months">
          {trend.map(t => <span key={t.month}>{t.month}</span>)}
        </div>
      </div>
    </div>
  </section>
);

// ---------- Pillar Health ----------
const PillarRow = ({ pillar }) => {
  const fill = `linear-gradient(90deg, ${pillar.color}, ${pillar.color}d0)`;
  return (
    <div className="pillar" data-comment-anchor={`pillar-${pillar.id.toLowerCase()}`}>
      <div className="pillar__badge" style={{ background: pillar.color }}>{pillar.id}</div>
      <div className="pillar__body">
        <div className="pillar__name">{pillar.name}</div>
        <div className="pillar__caption tnum">{pillar.weight}% weight · {pillar.sites} active sites</div>
        <div className="pillar__bar">
          <span style={{ width: `${pillar.score}%`, background: fill }} />
        </div>
      </div>
      <div className="pillar__right">
        <div className="pillar__score tnum">{pillar.score}<span style={{fontSize:11, fontWeight:600, color:'var(--d-text-3)', marginLeft:2}}>%</span></div>
        <div className={`pillar__delta ${deltaClass(pillar.delta)} tnum`}>{fmtDelta(pillar.delta)}</div>
      </div>
    </div>
  );
};

const PillarHealth = ({ pillars }) => (
  <div className="card" data-screen-label="Pillar Health">
    <div className="card__header">
      <div>
        <div className="section-head">Pillar health</div>
        <div className="section-sub">Strategic dimensions · weighted by importance</div>
      </div>
    </div>
    <div className="pillars">
      {pillars.map(p => <PillarRow key={p.id} pillar={p} />)}
    </div>
  </div>
);

// ---------- Leaderboard ----------
// Now restores the G/A/R activity counts the legacy dashboard exposed
// (12/8/8 etc.) — the rolled-up score alone doesn't communicate scope.
// Three small chips between the site name and the score: green count,
// amber count, red count + total.
const LeaderRow = ({ site, place, inactive }) => {
  const bg = inactive ? '#C5C6C4' : site.score < 55 ? '#D90038' : site.score < 65 ? '#D97706' : '#1B9A3A';
  const g = site.g || 0, a = site.a || 0, r = site.r || 0;
  const total = g + a + r;
  return (
    <div className={`lb__row ${inactive ? 'inactive' : ''}`}>
      <div className="lb__rank">
        {place != null && <span className="place">{place}</span>}
        {site.code}
      </div>
      <div className="lb__body">
        <div className="lb__name">{site.name}</div>
        <div className="lb__country">{site.country}</div>
        {!inactive && (
          <div className="lb__bar"><span style={{ width: `${site.score}%`, background: bg }} /></div>
        )}
      </div>
      <div className={`lb__gar tnum ${inactive ? 'is-empty' : ''}`} title={`${g} on track · ${a} at risk · ${r} off track · ${total} active`}>
        <span className="gar-chip gar-g" aria-label={`${g} on track`}>{g}</span>
        <span className="gar-sep">/</span>
        <span className="gar-chip gar-a" aria-label={`${a} at risk`}>{a}</span>
        <span className="gar-sep">/</span>
        <span className="gar-chip gar-r" aria-label={`${r} off track`}>{r}</span>
      </div>
      <div className="lb__score tnum">{inactive ? '—' : `${site.score}%`}</div>
      <div className="lb__delta">
        {inactive
          ? <span className="delta-pill flat">—</span>
          : <span className={`delta-pill ${deltaClass(site.delta)}`}>{fmtDelta(site.delta)}</span>}
      </div>
    </div>
  );
};

const Leaderboard = ({ sites }) => {
  const active = sites.filter(s => s.active).sort((a,b) => b.score - a.score);
  const inactive = sites.filter(s => !s.active);
  return (
    <div className="card" data-screen-label="Site Leaderboard">
      <div className="card__header">
        <div>
          <div className="section-head">Site leaderboard</div>
          <div className="section-sub">{active.length} active · {inactive.length} inactive</div>
        </div>
      </div>
      <div className="lb">
        {/* Column headers — small grey eyebrow labels so the row data
            (mine code, activity-status chips, score, delta pill) reads
            as a table, not as a string of numbers. Mirrors the same
            5-col grid as .lb__row in styles.css. The G/A/R column gets
            a two-line header so a fresh reader can see at a glance
            that the numbers below are *activity counts* by RAG status,
            not arbitrary ratios. */}
        <div className="lb__head" role="row" aria-hidden="false">
          <span>Site</span>
          <span></span>
          <span title="Number of activities currently green / amber / red">
            <span className="lb__head-main">Activities</span>
            <span className="lb__head-sub">
              <span style={{ color: 'var(--rag-green)' }}>● G</span>
              <span> / </span>
              <span style={{ color: 'var(--rag-amber)' }}>● A</span>
              <span> / </span>
              <span style={{ color: 'var(--rag-red)' }}>● R</span>
            </span>
          </span>
          <span>Score</span>
          <span>vs prev</span>
        </div>
        {active.map((s, i) => <LeaderRow key={s.code} site={s} place={i + 1} />)}
        {inactive.length > 0 && (
          <div className="lb__sep tnum">{inactive.length} sites inactive</div>
        )}
        {inactive.map(s => <LeaderRow key={s.code} site={s} inactive />)}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════
// SCORING TAB — per-site activity-by-activity breakdown
// ════════════════════════════════════════════════════════════════════
// The legacy Scoring view was a dense flat table. The redesign keeps
// the table density but layers in:
//   • a site header card (eyebrow + site name in the site's brand colour)
//   • an overall KPI strip (score + G/A/R counts)
//   • pillar sections with a left accent bar matching the pillar's colour
//   • each activity row has an inline progress bar coloured by RAG
//   • RAG chip column for at-a-glance status
// All numbers come from window.DASHBOARD_DATA.scoring (mock for the
// preview; the live engine emits this shape via score(site)).

const ragLabel = (rag) => ({ green: 'On track', amber: 'At risk', red: 'Off track' }[rag] || rag);

const ScoringHeader = ({ scoring }) => (
  <section className="scoring__hero">
    <div className="scoring__hero-left" style={{ '--site': scoring.siteColor }}>
      <div className="eyebrow">Site scoring · May 2026</div>
      <div className="scoring__hero-name">
        <span className="scoring__hero-code">{scoring.site}</span>
        <span className="scoring__hero-fullname">{scoring.siteName}</span>
      </div>
      <div className="scoring__hero-meta">
        Site IT performance against the 31 activities currently active in the tracker.
      </div>
    </div>
    <div className="scoring__hero-right">
      <div className="scoring__hero-stat">
        <span className="num tnum">{scoring.overall.score}%</span>
        <span className={`headline__delta ${deltaClass(scoring.overall.delta)}`}>{fmtDelta(scoring.overall.delta)}</span>
        <span className="scoring__hero-label">Overall score</span>
      </div>
      <div className="scoring__hero-gar">
        <span className="gar-block gar-block--g"><b>{scoring.overall.g}</b><small>On track</small></span>
        <span className="gar-block gar-block--a"><b>{scoring.overall.a}</b><small>At risk</small></span>
        <span className="gar-block gar-block--r"><b>{scoring.overall.r}</b><small>Off track</small></span>
      </div>
    </div>
  </section>
);

const ScoringPillarSection = ({ pillar }) => (
  <section className="scoring__pillar" style={{ '--pillar-color': pillar.color }}>
    <header className="scoring__pillar-head">
      <span className="scoring__pillar-badge">{pillar.id}</span>
      <div className="scoring__pillar-name">
        <span className="name">{pillar.name}</span>
        <small>{pillar.weight}% of overall · {pillar.activities.length} active activities</small>
      </div>
      <div className="scoring__pillar-score">
        <span className="num tnum">{pillar.score}%</span>
        <span className={`headline__delta ${deltaClass(pillar.delta)}`}>{fmtDelta(pillar.delta)}</span>
      </div>
    </header>
    <div className="scoring__table" role="table" aria-label={`${pillar.name} activities`}>
      <div className="scoring__table-head" role="row">
        <span>#</span>
        <span>Activity</span>
        <span>KPI</span>
        <span style={{ textAlign: 'right' }}>Weight</span>
        <span style={{ textAlign: 'right' }}>YTD</span>
        <span style={{ textAlign: 'right' }}>Target</span>
        <span>Score</span>
        <span>Status</span>
      </div>
      {pillar.activities.map(a => <ScoringActivityRow key={a.num} a={a} />)}
    </div>
  </section>
);

const ScoringActivityRow = ({ a }) => {
  const ragHex = ragColor(a.rag);
  return (
    <div className="scoring__row" role="row" data-rag={a.rag}>
      <span className="scoring__num mono">{a.num}</span>
      <span className="scoring__name">
        {a.name}
        {a.shared && <span className="scoring__tag-shared">SHARED</span>}
      </span>
      <span><span className={`scoring__kpi scoring__kpi--${a.kpi.toLowerCase()}`}>{a.kpi}</span></span>
      <span className="scoring__weight tnum">{a.weight}%</span>
      <span className="scoring__ytd mono">{a.ytd}</span>
      <span className="scoring__target mono">{a.target}</span>
      <span className="scoring__progress">
        <span className="scoring__bar"><span style={{ width: `${Math.min(100, Math.max(0, a.score))}%`, background: ragHex }} /></span>
        <span className="scoring__pct tnum">{a.score}%</span>
      </span>
      <span>
        <span className={`rag-chip rag-chip--${a.rag}`} title={ragLabel(a.rag)}>
          {a.rag.toUpperCase()}
        </span>
      </span>
    </div>
  );
};

const ScoringPanel = ({ scoring }) => (
  <main className="page" data-screen-label="Scoring">
    <ScoringHeader scoring={scoring} />
    <div className="scoring__pillars">
      {scoring.pillars.map(p => <ScoringPillarSection key={p.id} pillar={p} />)}
    </div>
    <div className="footer">
      <span>Site weighted score = Σ (pillar weight × pillar score).</span>
      <span>Click any activity row in the live page to drill into its monthly inputs.</span>
    </div>
  </main>
);

// ════════════════════════════════════════════════════════════════════
// MEETINGS DECISION TRACKER — NEW MODULE proposal
// ════════════════════════════════════════════════════════════════════
// This panel is rendered when the user clicks the "Decisions" tab in
// the dashboard-preview. It's a DESIGN MOCKUP for a separate module
// that will live under Insights ▾ in production (sibling of Executive
// Scorecard / Analytics / Activity Tracker), with its own meetings.db,
// /api/meetings/* routes, and an inline editor.
//
// Data model (proposed, mirrors the Inspections module pattern):
//   md_categories       — parametrable list (admin can add via Settings)
//   md_decisions        — one row per tracked decision / action item
//   md_decision_updates — audit trail (comments + status changes)
//   md_decision_attachments — inline base64 photos/docs
//
// RBAC (proposed):
//   viewer       — read-only
//   editor       — create/edit decisions for their own site
//   admin        — create/edit any site, close, reopen
//   executive    — same as admin + cross-site dashboards
//   super_admin  — manage the parametrable category list
//
// User can override any of the proposals above — they're documented in
// data.js (decisionsModel) and this component reads from them.

const DecisionsCategoryChip = ({ cat, count, active, onClick }) => (
  <button
    type="button"
    className={`dec-cat-chip ${active ? 'is-active' : ''}`}
    style={{ '--cat-color': cat.color }}
    onClick={onClick}
    aria-pressed={active}
  >
    <span className="dec-cat-chip__icon" aria-hidden="true">{cat.icon}</span>
    <span className="dec-cat-chip__label">{cat.name}</span>
    {typeof count === 'number' && <span className="dec-cat-chip__count">{count}</span>}
  </button>
);

const DecisionsKpiTile = ({ label, value, accent, sub }) => (
  <div className={`dec-kpi dec-kpi--${accent || 'neutral'}`}>
    <div className="dec-kpi__label">{label}</div>
    <div className="dec-kpi__value tnum">{value}</div>
    {sub && <div className="dec-kpi__sub">{sub}</div>}
  </div>
);

const StatusPill = ({ status, statusDefs }) => {
  const def = statusDefs.find(s => s.code === status) || { label: status, color: '#6B7785' };
  return <span className="dec-status" style={{ '--st-color': def.color }}>{def.label}</span>;
};

const PriorityPill = ({ priority, priorityDefs }) => {
  const def = priorityDefs.find(p => p.code === priority) || { label: priority, color: '#6B7785' };
  return <span className="dec-priority" style={{ '--p-color': def.color }} title={`${def.label} priority`}>{def.label}</span>;
};

const isOverdue = (d) => {
  if (!d.dueDate || d.status === 'done' || d.status === 'cancelled') return false;
  return d.dueDate < new Date().toISOString().slice(0, 10).replace(/-/g, '-');
  // Note: in the mockup we pretend "today" is 2026-05-23 so anything
  // before that counts as overdue. The live page reads new Date() and
  // doesn't need this hack.
};

// Hard-code "today" = 2026-05-23 for the mockup so the overdue badge
// fires on the right rows (data.js dates are May 2026 vintage).
const MOCK_TODAY = '2026-05-23';
const isOverdueMock = (d) =>
  d.dueDate && d.status !== 'done' && d.status !== 'cancelled' && d.dueDate < MOCK_TODAY;

const fmtDate = (iso) => {
  if (!iso) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = iso.split('-');
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
};

const DecisionRow = ({ d, categoriesByCode, statusDefs, priorityDefs }) => {
  const cat = categoriesByCode[d.category];
  const overdue = isOverdueMock(d);
  return (
    <div className="dec-row" data-overdue={overdue || undefined}>
      <span className="dec-row__cat" style={{ '--cat-color': cat.color }} title={cat.name}>
        <span className="dec-row__cat-dot" />
        <span className="dec-row__cat-icon">{cat.icon}</span>
      </span>
      <span className="dec-row__ref mono">{d.ref}</span>
      <span className="dec-row__title">
        <strong>{d.title}</strong>
        <small>{d.source} · {fmtDate(d.source_date)}{d.site ? ` · ${d.site}` : ' · Group'}</small>
      </span>
      <span className="dec-row__owner">{d.owner}</span>
      <span className="dec-row__due">
        {fmtDate(d.dueDate)}
        {overdue && <span className="dec-row__overdue-badge" title="Past due date">OVERDUE</span>}
      </span>
      <span><PriorityPill priority={d.priority} priorityDefs={priorityDefs} /></span>
      <span><StatusPill status={d.status} statusDefs={statusDefs} /></span>
      <a href="#" className="dec-row__open" onClick={(e) => e.preventDefault()}>Open ›</a>
    </div>
  );
};

const DecisionsPanel = ({ data }) => {
  const { decisionsModel: m, decisionsKpi: k, decisions } = data;
  const [activeCat, setActiveCat] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const categoriesByCode = React.useMemo(() => {
    const o = {};
    m.categories.forEach(c => { o[c.code] = c; });
    return o;
  }, [m.categories]);
  const filtered = decisions.filter(d => {
    if (activeCat !== 'all' && d.category !== activeCat) return false;
    if (search) {
      const q = search.toLowerCase();
      return (d.title + ' ' + d.owner + ' ' + d.ref + ' ' + (d.source || '')).toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <main className="page" data-screen-label="Decisions">
      {/* Hero — title + new-decision CTA + brief context */}
      <section className="dec-hero">
        <div>
          <div className="eyebrow">Insights · NEW module</div>
          <h2 className="dec-hero__title">Meetings Decision Tracker</h2>
          <p className="dec-hero__lede">
            Single source of truth for every <strong>action item</strong> raised in a department
            meeting, customer survey, or Mine IT Council. Tracked through to close with owner,
            due date, status and audit comments.
          </p>
        </div>
        <div className="dec-hero__actions">
          <button type="button" className="btn-primary">+ New decision</button>
          <button type="button" className="btn-ghost">Export · CSV</button>
        </div>
      </section>

      {/* KPI strip */}
      <section className="dec-kpis">
        <DecisionsKpiTile label="Total decisions"    value={k.total}      accent="neutral" sub="YTD" />
        <DecisionsKpiTile label="Open"               value={k.open}       accent="info"    sub="not yet started" />
        <DecisionsKpiTile label="In progress"        value={k.inProgress} accent="info"    sub="being worked on" />
        <DecisionsKpiTile label="Blocked"            value={k.blocked}    accent="danger"  sub="needs escalation" />
        <DecisionsKpiTile label="Overdue"            value={k.overdue}    accent="danger"  sub="past due date" />
        <DecisionsKpiTile label="Due this week"      value={k.thisWeek}   accent="warning" sub="next 7 days" />
        <DecisionsKpiTile label="Closed"             value={k.done}       accent="success" sub="this period" />
      </section>

      {/* Category filter chips (parametrable list — admin can add more) */}
      <section className="dec-filters">
        <div className="dec-filters__chips">
          <DecisionsCategoryChip
            cat={{ name: 'All categories', icon: '⨯', color: '#6B7785' }}
            count={decisions.length}
            active={activeCat === 'all'}
            onClick={() => setActiveCat('all')}
          />
          {m.categories.map(c => (
            <DecisionsCategoryChip
              key={c.code}
              cat={c}
              count={k.byCategory[c.code]}
              active={activeCat === c.code}
              onClick={() => setActiveCat(c.code)}
            />
          ))}
        </div>
        <input
          className="dec-search"
          type="search"
          placeholder="Search title / owner / reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      {/* Decisions table */}
      <section className="card dec-table-card">
        <div className="card__header dec-table-card__header">
          <div>
            <div className="section-head">Decisions ({filtered.length})</div>
            <div className="section-sub">
              Sorted by due date, ascending · click a row for full detail
            </div>
          </div>
        </div>
        <div className="dec-table" role="table">
          <div className="dec-table__head" role="row">
            <span>Cat.</span>
            <span>Ref.</span>
            <span>Decision / source</span>
            <span>Owner</span>
            <span>Due</span>
            <span>Priority</span>
            <span>Status</span>
            <span></span>
          </div>
          {filtered.length === 0 && (
            <div className="dec-table__empty">No decisions match the current filter.</div>
          )}
          {filtered.map(d => (
            <DecisionRow
              key={d.ref}
              d={d}
              categoriesByCode={categoriesByCode}
              statusDefs={m.statuses}
              priorityDefs={m.priorities}
            />
          ))}
        </div>
      </section>

      <div className="footer">
        <span>
          <strong>Mockup only.</strong> Production module will live at
          <code> /meetings.html </code> under Insights ▾, with its own
          <code> meetings.db </code>, <code>/api/meetings/* </code> routes, and inline editor.
        </span>
        <span>
          RBAC: viewer / editor (own site) / admin / executive / super_admin
        </span>
      </div>
    </main>
  );
};

// ════════════════════════════════════════════════════════════════════
// INPUT PANEL — monthly data entry grid
// ════════════════════════════════════════════════════════════════════
// One row per activity, twelve month-cells across. The current month
// is editable (input field); past months are read-only history; future
// months are greyed out. Top status strip shows entry progress.

const InputCell = ({ value, isCurrent, isFuture }) => {
  if (isFuture) return <span className="inp-cell inp-cell--future">·</span>;
  if (isCurrent) return <input className="inp-cell inp-cell--input" defaultValue={value === '' ? '' : value} placeholder="—" />;
  return <span className="inp-cell inp-cell--past">{value === '' || value == null ? '—' : value}</span>;
};

const InputPanel = ({ data }) => {
  const v = data.inputView;
  const [site, setSite] = React.useState(v.site);
  const [month, setMonth] = React.useState(v.currentMonth);
  const monthIx = v.months.indexOf(month);
  const activeSites = data.sites.filter(s => s.active);
  const s = data.summary || v.summary;
  const pctDone = Math.round(100 * v.summary.activities_entered / v.summary.activities_total);
  return (
    <main className="page" data-screen-label="Input">
      <section className="inp-hero">
        <div>
          <div className="eyebrow">Monthly input · {month} {v.currentYear}</div>
          <h2 className="inp-hero__title">
            <span className="inp-hero__site-code" style={{ background: v.siteColor }}>{site}</span>
            {v.siteName} — site IT enters monthly actuals here
          </h2>
          <p className="inp-hero__lede">
            One row per active activity · twelve month columns · current month is editable.
            Past months are read-only history (drift visible at a glance) and future months
            are placeholders for next month's run. Saves to <code>tracker_inputs</code> via
            <code> POST /api/tracker/save </code>.
          </p>
        </div>
        <div className="inp-hero__actions">
          <select className="inp-select" value={site} onChange={e => setSite(e.target.value)}>
            {activeSites.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
          <select className="inp-select" value={month} onChange={e => setMonth(e.target.value)}>
            {v.months.map(m => <option key={m} value={m}>{m} {v.currentYear}</option>)}
          </select>
          <button type="button" className="btn-primary">💾 Save month</button>
        </div>
      </section>

      <section className="inp-statusbar">
        <div className="inp-statusbar__bar">
          <div className="inp-statusbar__fill" style={{ width: pctDone + '%' }} />
        </div>
        <div className="inp-statusbar__text">
          <span><b>{v.summary.activities_entered}</b> / {v.summary.activities_total} activities entered for {month} — <b>{v.summary.activities_pending}</b> pending</span>
          <span>Last saved <b>{v.summary.lastSavedAt}</b> by {v.summary.lastSavedBy}</span>
        </div>
      </section>

      {v.activitiesByPillar.map(p => (
        <section key={p.id} className="inp-pillar" style={{ '--pillar-color': p.color }}>
          <header className="inp-pillar__head">
            <span className="inp-pillar__badge">{p.id}</span>
            <span className="inp-pillar__name">{p.name}</span>
            <small>{p.items.length} activities</small>
          </header>
          <div className="inp-grid" role="table">
            <div className="inp-grid__head" role="row">
              <span>#</span>
              <span>Activity</span>
              <span>Target</span>
              {v.months.map(m => (
                <span key={m} className={m === month ? 'inp-grid__month inp-grid__month--current' : 'inp-grid__month'}>
                  {m}
                </span>
              ))}
            </div>
            {p.items.map(a => (
              <div key={a.num} className="inp-grid__row" role="row">
                <span className="mono">{a.num}</span>
                <span className="inp-grid__name">{a.name}</span>
                <span className="inp-grid__target mono">{a.target === '' ? '—' : a.target}</span>
                {a.vals.map((v, i) => (
                  <InputCell key={i} value={v} isCurrent={i === monthIx} isFuture={i > monthIx} />
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="footer">
        <span>Mock data — production save uses the real <code>tracker_inputs</code> table.</span>
        <span>RBAC: editor (own site only) · admin+ (any site).</span>
      </div>
    </main>
  );
};

// ════════════════════════════════════════════════════════════════════
// HEATMAP PANEL — RAG matrix · site × activity
// ════════════════════════════════════════════════════════════════════
// Sites on Y-axis, activities on X-axis (grouped by pillar header).
// Each cell shows the score with a RAG fill — a fast at-a-glance way
// to spot pockets of weakness across the fleet.

const ragForScore = (s) => {
  if (s == null) return 'na';
  if (s >= 80) return 'green';
  if (s >= 50) return 'amber';
  return 'red';
};

const HeatmapPanel = ({ data }) => {
  const h = data.heatmap;
  const [hovered, setHovered] = React.useState(null);
  const pillarOf = (num) => h.activities.find(a => a.num === num)?.pillar;

  return (
    <main className="page" data-screen-label="Heatmap">
      <section className="hm-hero">
        <div>
          <div className="eyebrow">Heatmap · {data.period.month} {data.period.year}</div>
          <h2 className="hm-hero__title">RAG matrix · 5 sites × 25 activities</h2>
          <p className="hm-hero__lede">
            Quickly spot where the fleet is strong or weak. Rows = sites, columns =
            activities (grouped by pillar). Cell colour reflects the score thresholds
            below; numbers inside are the actual percentage. Hover for the activity name.
          </p>
        </div>
        <div className="hm-legend">
          <span className="hm-legend__item"><span className="hm-cell hm-cell--green hm-cell--legend">≥ 80</span> On target</span>
          <span className="hm-legend__item"><span className="hm-cell hm-cell--amber hm-cell--legend">50–79</span> At risk</span>
          <span className="hm-legend__item"><span className="hm-cell hm-cell--red hm-cell--legend">&lt; 50</span> Off track</span>
        </div>
      </section>

      <section className="card hm-card">
        <div className="hm-scroll">
          <div className="hm-grid" style={{ '--col-count': h.activities.length }}>
            {/* Pillar header band */}
            <div className="hm-grid__pillar-row">
              <div className="hm-grid__corner">Pillar →</div>
              {h.pillars.map(p => {
                const span = h.activities.filter(a => a.pillar === p.id).length;
                return (
                  <div key={p.id} className="hm-grid__pillar-cell" style={{ background: p.color, gridColumn: 'span ' + span }}>
                    <strong>{p.id}</strong> <span>{p.name}</span>
                  </div>
                );
              })}
            </div>
            {/* Activity-number row */}
            <div className="hm-grid__act-row">
              <div className="hm-grid__corner">Site / Activity</div>
              {h.activities.map(a => (
                <div
                  key={a.num}
                  className={'hm-grid__act-cell ' + (hovered === a.num ? 'is-hovered' : '')}
                  onMouseEnter={() => setHovered(a.num)}
                  onMouseLeave={() => setHovered(null)}
                  title={'#' + a.num + ' — ' + a.name}
                >
                  {a.num}
                </div>
              ))}
            </div>
            {/* Site rows */}
            {h.sites.map(site => (
              <div key={site.code} className="hm-grid__site-row">
                <div className="hm-grid__site-cell">
                  <span className="hm-site-code" style={{ background: site.color }}>{site.code}</span>
                  <span className="hm-site-name">{site.name}</span>
                </div>
                {h.activities.map(a => {
                  const score = h.cells[site.code] ? h.cells[site.code][a.num] : null;
                  const rag = ragForScore(score);
                  return (
                    <div
                      key={a.num}
                      className={'hm-cell hm-cell--' + rag + (hovered === a.num ? ' is-hovered' : '')}
                      onMouseEnter={() => setHovered(a.num)}
                      onMouseLeave={() => setHovered(null)}
                      title={site.name + ' · #' + a.num + ' ' + a.name + ' · ' + (score == null ? 'n/a' : score + '%')}
                    >
                      {score == null ? '—' : score}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {hovered != null && (
          <div className="hm-hover-banner">
            <strong>#{hovered}</strong>{' · '}{h.activities.find(a => a.num === hovered).name}
            {' · '}<small>Pillar {pillarOf(hovered)}</small>
          </div>
        )}
      </section>

      <div className="footer">
        <span>Mock data — scores derived from the per-activity engine in production.</span>
        <span>Click any cell in the live page to drill to that site’s scoring view.</span>
      </div>
    </main>
  );
};

// ════════════════════════════════════════════════════════════════════
// ACTIVITIES PANEL — catalog (parametrable)
// ════════════════════════════════════════════════════════════════════
// Cards grouped by pillar. Each card shows the activity number, name,
// KPI type, weight inside its pillar, scope, default target, and a
// one-line description. Search + pillar filter at the top.

const ActivityCard = ({ a, pillarColor }) => (
  <div className="act-card" style={{ '--pillar-color': pillarColor }}>
    <div className="act-card__head">
      <span className="act-card__num mono">#{a.num}</span>
      <span className={`act-card__kpi act-card__kpi--${a.kpi.toLowerCase()}`}>{a.kpi}</span>
      {a.shared && <span className="act-card__tag-shared">SHARED</span>}
      <span className="act-card__weight tnum">{a.weight}%</span>
    </div>
    <div className="act-card__name">{a.name}</div>
    <p className="act-card__desc">{a.desc}</p>
    <div className="act-card__meta">
      <span><span className="act-card__meta-label">Scope</span> <span className="act-card__meta-value">{a.scope}</span></span>
      <span><span className="act-card__meta-label">Default target</span> <span className="act-card__meta-value mono">{a.target === '' ? '—' : a.target}</span></span>
    </div>
  </div>
);

const ActivitiesPanel = ({ data }) => {
  const cat = data.activitiesCatalog || [];
  const pillars = data.heatmap.pillars;
  const [search, setSearch] = React.useState('');
  const [pillarFilter, setPillarFilter] = React.useState('all');
  const pillarColor = (pid) => pillars.find(p => p.id === pid)?.color || '#6B7785';

  const filtered = cat.filter(a => {
    if (pillarFilter !== 'all' && a.pillar !== pillarFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.name + ' ' + a.desc + ' ' + a.num).toLowerCase().includes(q);
    }
    return true;
  });
  const byPillar = pillars.map(p => ({ ...p, items: filtered.filter(a => a.pillar === p.id) }));

  return (
    <main className="page" data-screen-label="Activities">
      <section className="act-hero">
        <div>
          <div className="eyebrow">Activities · master catalog</div>
          <h2 className="act-hero__title">31 IT activities · grouped by pillar</h2>
          <p className="act-hero__lede">
            The parametrable source of truth — every other tab (Input, Heatmap, Targets,
            Scoring, Roadmap) reads from this list. Add new activities or retire old ones
            here; existing scores stay tagged to their original number.
          </p>
        </div>
        <div className="act-hero__actions">
          <button type="button" className="btn-primary">+ New activity</button>
          <button type="button" className="btn-ghost">Export · CSV</button>
        </div>
      </section>

      <section className="act-filters">
        <div className="act-filters__chips">
          <button type="button" className={'act-chip ' + (pillarFilter === 'all' ? 'is-active' : '')} onClick={() => setPillarFilter('all')}>
            All pillars <span className="act-chip__count">{cat.length}</span>
          </button>
          {pillars.map(p => {
            const n = cat.filter(a => a.pillar === p.id).length;
            return (
              <button key={p.id} type="button"
                className={'act-chip ' + (pillarFilter === p.id ? 'is-active' : '')}
                style={{ '--chip-color': p.color }}
                onClick={() => setPillarFilter(p.id)}>
                <span className="act-chip__id">{p.id}</span> {p.name} <span className="act-chip__count">{n}</span>
              </button>
            );
          })}
        </div>
        <input className="act-search" type="search" placeholder="Search by number, name, description…" value={search} onChange={e => setSearch(e.target.value)} />
      </section>

      {byPillar.map(p => p.items.length === 0 ? null : (
        <section key={p.id} className="act-pillar-section" style={{ '--pillar-color': p.color }}>
          <header className="act-pillar-section__head">
            <span className="act-pillar-section__badge">{p.id}</span>
            <span className="act-pillar-section__name">{p.name}</span>
            <small>{p.items.length} activities</small>
          </header>
          <div className="act-grid">
            {p.items.map(a => <ActivityCard key={a.num} a={a} pillarColor={pillarColor(a.pillar)} />)}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <div className="act-empty">No activities match the current filter.</div>
      )}

      <div className="footer">
        <span>RBAC: super_admin can add / retire / re-weight activities via Settings.</span>
        <span>Mock data — production reads from <code>tracker_config.activities[]</code>.</span>
      </div>
    </main>
  );
};

// ════════════════════════════════════════════════════════════════════
// TARGETS PANEL — per-site overrides
// ════════════════════════════════════════════════════════════════════
// Site selector + table of all activities. Default target comes from
// the catalog; site-specific overrides show a small "custom" tag.

const TargetsPanel = ({ data }) => {
  const sites = data.sites.filter(s => s.active);
  const cat = data.activitiesCatalog || [];
  const overrides = data.targets.perSite;
  const pillars = data.heatmap.pillars;
  const [site, setSite] = React.useState(sites[0].code);
  const siteOverrides = overrides[site] || {};
  const pillarColor = (pid) => pillars.find(p => p.id === pid)?.color || '#6B7785';

  return (
    <main className="page" data-screen-label="Targets">
      <section className="tgt-hero">
        <div>
          <div className="eyebrow">Targets · per-site overrides</div>
          <h2 className="tgt-hero__title">
            <span className="tgt-hero__site-code">{site}</span>
            Target values for {sites.find(s => s.code === site).name}
          </h2>
          <p className="tgt-hero__lede">
            Each activity has a default target from the catalog. Overrides let a site
            justify a tighter or looser bar (e.g. a smaller team running fewer daily
            checks). Last edit: {data.targets.lastEditedBy} · {data.targets.lastEditedAt}.
          </p>
        </div>
        <div className="tgt-hero__actions">
          <select className="inp-select" value={site} onChange={e => setSite(e.target.value)}>
            {sites.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
          <button type="button" className="btn-primary">💾 Save overrides</button>
        </div>
      </section>

      <section className="card tgt-table-card">
        <div className="tgt-table" role="table">
          <div className="tgt-table__head" role="row">
            <span>Pillar</span>
            <span>#</span>
            <span>Activity</span>
            <span>KPI</span>
            <span style={{ textAlign: 'right' }}>Catalog default</span>
            <span style={{ textAlign: 'right' }}>{site} target</span>
            <span></span>
          </div>
          {cat.map(a => {
            const override = siteOverrides[a.num];
            const effective = override == null ? a.target : override;
            return (
              <div key={a.num} className="tgt-row" role="row">
                <span className="tgt-row__pillar" style={{ background: pillarColor(a.pillar) }}>{a.pillar}</span>
                <span className="mono">{a.num}</span>
                <span className="tgt-row__name">{a.name}</span>
                <span><span className={`scoring__kpi scoring__kpi--${a.kpi.toLowerCase()}`}>{a.kpi}</span></span>
                <span className="tgt-row__default mono">{a.target === '' ? '—' : a.target}</span>
                <span className="tgt-row__effective mono">
                  <input className="tgt-input" defaultValue={effective === '' ? '' : effective} placeholder="—" />
                </span>
                <span>{override != null && <span className="tgt-tag-custom">CUSTOM</span>}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="footer">
        <span>RBAC: super_admin. Editors see this view read-only.</span>
        <span>Mock data — production reads from <code>tracker_targets</code> table.</span>
      </div>
    </main>
  );
};

// ════════════════════════════════════════════════════════════════════
// ROADMAP PANEL — 12-month Gantt by pillar
// ════════════════════════════════════════════════════════════════════
// One swimlane per pillar. Each bar spans its start→end month, coloured
// by status (done / in_progress / planned). A "today" vertical line
// drops at the current month so progress vs plan reads at a glance.

const RoadmapPanel = ({ data }) => {
  const r = data.roadmap;
  const monthCount = r.months.length;
  const todayPct = ((r.today.month + 0.5) / monthCount) * 100;

  return (
    <main className="page" data-screen-label="Roadmap">
      <section className="rdm-hero">
        <div>
          <div className="eyebrow">Roadmap · 12-month rolling Gantt</div>
          <h2 className="rdm-hero__title">{r.year} — IT delivery plan by pillar</h2>
          <p className="rdm-hero__lede">
            Visualises every major IT delivery across the year, grouped by pillar. Bars
            are coloured by status. The dotted vertical line marks today ({data.period.month}
            {' '}{data.period.year}) so the gap between plan and actual is obvious.
          </p>
        </div>
        <div className="rdm-legend">
          <span className="rdm-legend__item"><span className="rdm-bar rdm-bar--legend rdm-bar--done" />Done</span>
          <span className="rdm-legend__item"><span className="rdm-bar rdm-bar--legend rdm-bar--in_progress" />In progress</span>
          <span className="rdm-legend__item"><span className="rdm-bar rdm-bar--legend rdm-bar--planned" />Planned</span>
        </div>
      </section>

      <section className="card rdm-card">
        <div className="rdm-gantt">
          {/* Month header row */}
          <div className="rdm-month-row">
            <div className="rdm-row-label">Pillar</div>
            <div className="rdm-track" style={{ '--month-count': monthCount }}>
              {r.months.map((m, i) => (
                <div key={m} className={'rdm-month-cell ' + (i === r.today.month ? 'is-current' : '')}>{m}</div>
              ))}
              <div className="rdm-today-line" style={{ left: todayPct + '%' }} title="Today" />
            </div>
          </div>

          {/* Swimlanes */}
          {r.swimlanes.map(sl => (
            <div key={sl.id} className="rdm-swimlane" style={{ '--pillar-color': sl.color }}>
              <div className="rdm-swimlane__head">
                <span className="rdm-swimlane__badge">{sl.id}</span>
                <span className="rdm-swimlane__name">{sl.name}</span>
                <small>{sl.items.length} items</small>
              </div>
              <div className="rdm-swimlane__items">
                {sl.items.map((it, i) => {
                  const leftPct = (it.start / monthCount) * 100;
                  const widthPct = ((it.end - it.start + 1) / monthCount) * 100;
                  return (
                    <div key={i} className="rdm-row">
                      <div className="rdm-row-label">
                        <span className="rdm-row-label__name" title={it.name + ' · ' + it.owner}>{it.name}</span>
                      </div>
                      <div className="rdm-track" style={{ '--month-count': monthCount }}>
                        {r.months.map((m, mi) => <div key={m} className={'rdm-month-cell rdm-month-cell--ghost ' + (mi === r.today.month ? 'is-current' : '')} />)}
                        <div
                          className={'rdm-bar rdm-bar--' + it.status}
                          style={{ left: leftPct + '%', width: widthPct + '%' }}
                          title={it.name + ' · ' + r.months[it.start] + '→' + r.months[it.end] + ' · ' + it.status + ' · ' + it.owner}
                        >
                          <span className="rdm-bar__label">
                            <span className="rdm-bar__site">{it.site}</span>
                            <span className="rdm-bar__owner">{it.owner}</span>
                          </span>
                        </div>
                        <div className="rdm-today-line" style={{ left: todayPct + '%' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="footer">
        <span>Mock data — production will read from a roadmap table (TBD).</span>
        <span>Hover any bar for full owner + date range. Click in live view to open the project.</span>
      </div>
    </main>
  );
};

// Lightweight "coming soon" panel for tabs that don't have a mockup yet.
const StubPanel = ({ tab }) => (
  <main className="page stub" data-screen-label={`Stub: ${tab.label}`}>
    <div className="stub__inner">
      <div className="eyebrow">{tab.label}</div>
      <h2>{tab.label} mockup not yet built</h2>
      <p>This tab will be designed in a future pass. The Scoring tab is the only one currently mocked-up in the preview — see <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('preview-switch-tab', { detail: 'scoring' })); }}>Scoring</a> for the design pattern.</p>
    </div>
  </main>
);

// ---------- Watchlist ----------
const Watchlist = ({ items, size }) => {
  const list = items.slice(0, size);
  const redCount = items.filter(i => i.rag === 'red').length;
  return (
    <div className="card" data-screen-label="Watchlist">
      <div className="card__header">
        <div>
          <div className="section-head">Needs attention this month</div>
          <div className="section-sub">Activities currently red or amber across all active sites</div>
        </div>
        <span className="card__count tnum">{items.length}</span>
      </div>
      {list.length === 0 ? (
        <div className="watch__empty">
          <img src="../../assets/goldy/goldy-trophy.png" alt="" />
          <div>
            <h3>All clear this month</h3>
            <p>No activities in red or amber — first time since November.</p>
          </div>
        </div>
      ) : (
        <div className="watch__list">
          {list.map((w, i) => (
            <div key={i} className="watch__row">
              <span className={`watch__dot ${w.rag}`} style={{ background: ragColor(w.rag) }} />
              <span className="watch__scope">
                <span className="watch__chip">{w.site}</span>
                <span>{w.ref}</span>
              </span>
              <div className="watch__body">
                <div className="watch__activity">{w.activity}</div>
                <div className="watch__reason">{w.reason} · <span className="owner">{w.owner}</span></div>
              </div>
              <button className="btn-outline">Open ›</button>
            </div>
          ))}
        </div>
      )}
      <div className="watch__footer">
        <span className="tnum">{items.length} total · {redCount} red · {items.length - redCount} amber</span>
        <a href="#scoring">Open Scoring filtered to red/amber →</a>
      </div>
    </div>
  );
};

// ---------- Drill-down strip ----------
const DrillDown = ({ items }) => (
  <div className="drill" data-screen-label="Drill-down strip">
    {items.map(d => (
      <a key={d.id} className="drill__card" href={d.href}>
        <div className="drill__icon">{d.icon}</div>
        <div>
          <div className="drill__title">{d.title}</div>
          <div className="drill__desc">{d.description}</div>
        </div>
        {d.isNew && <span className="drill__new">NEW</span>}
      </a>
    ))}
  </div>
);

// ---------- Legacy mini-charts (Tweak: keepLegacyCharts) ----------
const LegacyMiniCharts = () => (
  <div className="legacy" data-screen-label="Legacy charts">
    <div className="legacy__card">
      <div className="legacy__title">Score trend (12 mo)</div>
      <svg className="legacy__chart" viewBox="0 0 200 80" preserveAspectRatio="none">
        <polyline fill="none" stroke="#145FAE" strokeWidth="2"
          points="0,30 20,28 40,35 60,32 80,38 100,30 120,34 140,40 160,42 180,48 200,55" />
      </svg>
    </div>
    <div className="legacy__card">
      <div className="legacy__title">RAG distribution</div>
      <svg className="legacy__chart" viewBox="0 0 200 80" preserveAspectRatio="none">
        <rect x="0"   y="50" width="60" height="30" fill="#1B9A3A" />
        <rect x="70"  y="38" width="60" height="42" fill="#D97706" />
        <rect x="140" y="22" width="60" height="58" fill="#D90038" />
      </svg>
    </div>
    <div className="legacy__card">
      <div className="legacy__title">Target attainment by pillar</div>
      <svg className="legacy__chart" viewBox="0 0 200 80" preserveAspectRatio="none">
        <rect x="10"  y="40" width="35" height="40" fill="#145FAE" />
        <rect x="60"  y="55" width="35" height="25" fill="#EF631A" />
        <rect x="110" y="30" width="35" height="50" fill="#7C3AED" />
        <rect x="160" y="58" width="35" height="22" fill="#0D9488" />
      </svg>
    </div>
  </div>
);

// expose to other scripts
Object.assign(window, {
  AppBar, Tabs, Headline, PillarHealth, Leaderboard, Watchlist, DrillDown, LegacyMiniCharts,
  ScoringPanel, StubPanel, DecisionsPanel,
});
