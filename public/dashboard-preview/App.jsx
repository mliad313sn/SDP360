// IT Activity Tracker — App composition + Tweaks

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "order": "pillars-first",
  "watchlistSize": 9,
  "drillPosition": "bottom",
  "keepLegacyCharts": false,
  "headlineCopy": "Overall score"
}/*EDITMODE-END*/;

const App = () => {
  const data = window.DASHBOARD_DATA;
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // ── Active tab state ──────────────────────────────────────────────
  // Defaults to whichever tab in data.tabs has `active: true` (Dashboard
  // for now), but can be switched by clicking the tab buttons. Also
  // listens for the custom `preview-switch-tab` event a StubPanel
  // dispatches when a user clicks "see Scoring" inside it.
  const defaultTab = (data.tabs.find(x => x.active) || data.tabs[0]).id;
  const [activeTab, setActiveTab] = React.useState(defaultTab);
  React.useEffect(() => {
    const handler = (e) => setActiveTab(e.detail);
    window.addEventListener('preview-switch-tab', handler);
    return () => window.removeEventListener('preview-switch-tab', handler);
  }, []);

  // For Tweaks: optionally override the headline label live
  const period = data.period;

  const headlineSection = (
    <Headline overall={data.overall} trend={data.trend} period={period} />
  );

  const pillarSection = <PillarHealth pillars={data.pillars} />;
  const siteSection   = <Leaderboard sites={data.sites} />;
  const twoCol = (
    <div className="twocol">
      {t.order === 'sites-first' ? <>{siteSection}{pillarSection}</> : <>{pillarSection}{siteSection}</>}
    </div>
  );

  const watchSection = <Watchlist items={data.watchlist} size={t.watchlistSize} />;
  const drillSection = <DrillDown items={data.drilldowns} />;
  const legacySection = t.keepLegacyCharts ? <LegacyMiniCharts /> : null;

  // Pick the panel to render based on the active tab. Dashboard is the
  // full composition; Scoring is its own mocked panel; everything else
  // shows a placeholder stub until its mockup is built.
  const tabsForBar = t.drillPosition === 'tabs'
    ? [...data.tabs, ...data.drilldowns.filter(d => !data.tabs.find(tt => tt.id === d.id)).map(d => ({ id: d.id, label: d.title, badge: d.isNew ? 'NEW' : undefined }))]
    : data.tabs;
  const currentTab = data.tabs.find(x => x.id === activeTab) || data.tabs[0];

  let panel;
  if (activeTab === 'dashboard') {
    panel = (
      <main className="page" data-screen-label="Dashboard">
        {headlineSection}
        {twoCol}
        {watchSection}
        {t.drillPosition === 'bottom' && drillSection}
        {legacySection}
        <div className="footer">
          <span>Data as of <b>{period.month} 31, {period.year}</b> · auto-refresh nightly</span>
          <span>Source: Activity Tracker scoring engine · <a href="#">View calculation</a></span>
        </div>
      </main>
    );
  } else if (activeTab === 'scoring' && data.scoring) {
    panel = <ScoringPanel scoring={data.scoring} />;
  } else if (activeTab === 'decisions' && data.decisions) {
    panel = <DecisionsPanel data={data} />;
  } else if (activeTab === 'input' && data.inputView) {
    panel = <InputPanel data={data} />;
  } else if (activeTab === 'heatmap' && data.heatmap) {
    panel = <HeatmapPanel data={data} />;
  } else if (activeTab === 'activities' && data.activitiesCatalog) {
    panel = <ActivitiesPanel data={data} />;
  } else if (activeTab === 'targets' && data.targets) {
    panel = <TargetsPanel data={data} />;
  } else if (activeTab === 'roadmap' && data.roadmap) {
    panel = <RoadmapPanel data={data} />;
  } else {
    panel = <StubPanel tab={currentTab} />;
  }

  return (
    <div className="app">
      <AppBar />
      <Tabs tabs={tabsForBar} activeId={activeTab} onSelect={setActiveTab} />
      {panel}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Layout">
          <TweakRadio
            label="Section order"
            value={t.order}
            onChange={v => setTweak('order', v)}
            options={[
              { value: 'pillars-first', label: 'Pillars first' },
              { value: 'sites-first',   label: 'Sites first' },
            ]}
          />
          <TweakSelect
            label="Drill-down placement"
            value={t.drillPosition}
            onChange={v => setTweak('drillPosition', v)}
            options={[
              { value: 'bottom', label: 'Bottom of dashboard' },
              { value: 'tabs',   label: 'In the tab bar' },
            ]}
          />
        </TweakSection>

        <TweakSection title="Watchlist">
          <TweakSlider
            label="Visible items"
            min={0} max={9} step={1}
            value={t.watchlistSize}
            onChange={v => setTweak('watchlistSize', v)}
          />
        </TweakSection>

        <TweakSection title="Legacy">
          <TweakToggle
            label="Keep old 6-chart strip"
            value={t.keepLegacyCharts}
            onChange={v => setTweak('keepLegacyCharts', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
