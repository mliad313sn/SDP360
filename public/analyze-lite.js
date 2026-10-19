/* ═══════════════════════════════════════════════════════════════════
 * Analyze Lite — deterministic, zero-AI commentary generator
 * ───────────────────────────────────────────────────────────────────
 * Stop-gap replacement for the paused cloud-AI Analyze buttons while
 * IT approves the on-prem Mistral Nemo 12B deployment. Reads the same
 * snapshot data (buildAiSnapshot in executive-report.html, the global
 * _baseData / _rawRows in executive.html), applies threshold-based
 * templates, and fills the same commentary fields the AI path fills.
 *
 * NOTHING LEAVES THE BROWSER. Pure JavaScript, no network calls.
 *
 * Quality: produces factual, structured commentary. Reads more like a
 * Bloomberg ticker than analyst prose — that's the trade-off. Wins:
 *   - Same field IDs filled, no UI change
 *   - Bilingual EN / FR via document language
 *   - Zero latency (instant)
 *   - Zero data exposure (no /api/ai/analyze call)
 *   - Same thresholds the AI prompt encodes, so quality of KPI
 *     classification is identical
 *
 * Exposes:
 *   window.AnalyzeLite.runReportLite()    — for executive-report.html
 *   window.AnalyzeLite.runExecutiveLite() — for executive.html
 *
 * Both functions take no arguments — they read existing globals and
 * write into the existing commentary <div> elements.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Language detection ─────────────────────────────────────────────
  // Falls back to English if the document doesn't declare one.
  function _lang() {
    const docLang = (document.documentElement.lang || '').toLowerCase();
    return docLang.startsWith('fr') ? 'fr' : 'en';
  }

  // ── Thresholds (identical to the AI prompt's thresholds) ──────────
  const TH = {
    slaCompGood: 90,  slaCompWarn: 85,
    frtCompGood: 80,  frtCompWarn: 70,   // FRT SLA target is 80% (org standard), not 90% like Res SLA
    avgFrtGood:  4,   avgFrtWarn:  8,        // hours
    avgMttrGood: 1,   avgMttrWarn: 2,        // days
    closureGood: 80,  closureWarn: 60,
    backlogGood: 10,  backlogWarn: 30,
    reopenGood:  5,   reopenWarn:  10,
    fcrGood:     75,  fcrWarn:     60,
    techChangesGood: 0.5, techChangesWarn: 1,
    csatGood:    80,
    npsGood:     30,
    emergencyGood: 5,  // % of RFCs that are Emergency
  };

  // ── Status classifier (returns the same icon set the AI used) ─────
  function _stHigh(v, good, warn) {
    if (v == null || isNaN(parseFloat(v))) return { icon: '—', tag: 'N/A' };
    const n = parseFloat(v);
    if (n >= good) return { icon: '✅', tag: _t('ok') };
    if (n >= warn) return { icon: '⚠️', tag: _t('warn') };
    return { icon: '🔴', tag: _t('alert') };
  }
  function _stLow(v, good, warn) {
    if (v == null || isNaN(parseFloat(v))) return { icon: '—', tag: 'N/A' };
    const n = parseFloat(v);
    if (n <= good) return { icon: '✅', tag: _t('ok') };
    if (n <= warn) return { icon: '⚠️', tag: _t('warn') };
    return { icon: '🔴', tag: _t('alert') };
  }

  // ── Tiny string-table ─────────────────────────────────────────────
  const STR = {
    en: {
      ok:                 'on target',
      warn:               'warn',
      alert:              'alert',
      noData:             'No data loaded — pick a period first.',
      noSnapshot:         'Snapshot builder not available. Make sure data finished loading.',
      done:               '✓ Analyze Lite complete — factual commentary generated without AI. Edit any field as needed.',
      doneShort:          'Lite analysis applied',
      scope:              'Scope',
      tickets:            'tickets',
      sites:              'sites',
      target:             'target',
      below:              'below target',
      above:              'above target',
      within:             'within target',
      worstSite:          'Worst site by SLA',
      worstCategory:      'Worst category by volume',
      reopens:            'reopens',
      gap:                'gap',
      fleetAvg:           'fleet average',
      trendUp:            'rising',
      trendDown:          'falling',
      trendFlat:          'flat',
      vsAvg:              'vs trailing-6m avg',
      volume:             'Volume',
      resolutionSLA:      'Resolution SLA',
      frtSLA:             'FRT SLA',
      reopenRate:         'Reopen Rate',
      closureRate:        'Closure rate',
      openBacklog:        'Open backlog',
      avgMttr:            'Avg MTTR',
      avgFrt:             'Avg FRT',
      fcrRate:            'FCR Rate',
      topRisk:            'Top risk',
      trend12:            '12-month trend',
      blockers:           'Backlog blockers (>60-day open tickets)',
      blockerTotal:       'Total',
      blockerCats:        'Categories',
      blockerSubjects:    'Sample subjects',
      blockerNote:        'Automated subject analysis is paused — manual triage recommended on the items above.',
      pirCoverage:        'PIR triggered',
      rcaCoverage:        'Root cause documented',
      missingPir:         'incidents missing PIR — recommend governance follow-up',
      noIncidents:        'No major incidents recorded this period.',
      rfcSuccess:         'Successful',
      emergencyRate:      'Emergency rate',
      ofRfcs:             'of RFCs',
      reviewEmergency:    'Review emergency RFCs for CAB-compliance gaps.',
      noChanges:          'No RFCs recorded this period.',
      csat:               'CSAT',
      nps:                'NPS',
      trend6m:            '6-month trend',
      csatRecOk:          'Customer satisfaction is within target.',
      csatRecNpsGap:      'NPS lag suggests detractor-side issue — review ratings ≤2 stars this period for common cause.',
      csatRecBoth:        'Both CSAT and NPS below target — broaden review beyond reopened tickets to entire service stream.',
      actions:            'Recommended actions',
      analystNote:        'Generated by Analyze Lite (deterministic rules, no AI). Edit any field above.',
    },
    fr: {
      ok:                 'cible atteinte',
      warn:               'alerte',
      alert:              'critique',
      noData:             'Aucune donnée chargée — choisissez une période.',
      noSnapshot:         'Constructeur de snapshot indisponible. Vérifier que les données sont chargées.',
      done:               '✓ Analyse Lite terminée — commentaire factuel généré sans IA. Modifiez les champs si besoin.',
      doneShort:          'Analyse Lite appliquée',
      scope:              'Périmètre',
      tickets:            'tickets',
      sites:              'sites',
      target:             'cible',
      below:              'sous la cible',
      above:              'au-dessus de la cible',
      within:             'cible atteinte',
      worstSite:          'Site le plus faible (SLA)',
      worstCategory:      'Catégorie la plus volumineuse',
      reopens:            'réouvertures',
      gap:                'écart',
      fleetAvg:           'moyenne flotte',
      trendUp:            'en hausse',
      trendDown:          'en baisse',
      trendFlat:          'stable',
      vsAvg:              'vs moyenne 6m glissants',
      volume:             'Volume',
      resolutionSLA:      'SLA résolution',
      frtSLA:             'SLA 1ère réponse',
      reopenRate:         'Taux de réouverture',
      closureRate:        'Taux de clôture',
      openBacklog:        'Tickets ouverts',
      avgMttr:            'MTTR moyen',
      avgFrt:             '1ère réponse moy.',
      fcrRate:            'Taux FCR',
      topRisk:            'Risque principal',
      trend12:            'Tendance 12 mois',
      blockers:           'Tickets bloqués (>60 jours)',
      blockerTotal:       'Total',
      blockerCats:        'Catégories',
      blockerSubjects:    'Exemples de sujets',
      blockerNote:        "Analyse automatique des sujets en pause — triage manuel recommandé pour les éléments ci-dessus.",
      pirCoverage:        'PIR déclenchée',
      rcaCoverage:        'Cause racine documentée',
      missingPir:         "incident(s) sans PIR — suivi gouvernance recommandé",
      noIncidents:        'Aucun incident majeur sur la période.',
      rfcSuccess:         'Réussis',
      emergencyRate:      'Taux Urgence',
      ofRfcs:             'des RFC',
      reviewEmergency:    'Revue des RFC urgents pour conformité CAB recommandée.',
      noChanges:          'Aucun RFC sur la période.',
      csat:               'CSAT',
      nps:                'NPS',
      trend6m:            'Tendance 6 mois',
      csatRecOk:          'Satisfaction client conforme à la cible.',
      csatRecNpsGap:      'Écart NPS — origine détracteurs probable, revoir les notes ≤2 étoiles pour cause commune.',
      csatRecBoth:        "CSAT et NPS sous la cible — élargir la revue au-delà des tickets réouverts vers tout le flux service.",
      actions:            'Actions recommandées',
      analystNote:        "Généré par Analyse Lite (règles déterministes, sans IA). Modifiez les champs ci-dessus.",
    },
  };

  function _t(key) {
    const lang = _lang();
    return (STR[lang] && STR[lang][key]) || STR.en[key] || key;
  }

  // ── Mini-parsers for the pre-formatted snapshot strings ───────────
  // buildAiSnapshot() in executive-report.html returns several
  // multi-line strings designed for AI consumption. Lite needs them
  // back as objects.
  function _parseCategoryLines(str) {
    if (!str) return [];
    const out = [];
    str.split('\n').forEach(line => {
      // Format: "  Hardware/PC: 143 tickets | open 12 | FRT SLA 91% | Res SLA 85% | reopened 32"
      const m = line.match(/^\s*(.+?):\s*(\d+)\s*tickets\s*\|\s*open\s+(\d+)\s*\|\s*FRT SLA\s+(\d+|—)%?\s*\|\s*Res SLA\s+(\d+|—)%?\s*\|\s*reopened\s+(\d+)/i);
      if (m) out.push({
        name:     m[1].trim(),
        total:    +m[2],
        open:     +m[3],
        frtSla:   m[4] === '—' ? null : +m[4],
        resSla:   m[5] === '—' ? null : +m[5],
        reopened: +m[6],
      });
    });
    return out;
  }

  function _parseSiteLines(str) {
    if (!str) return [];
    const out = [];
    str.split('\n').forEach(line => {
      // Format: "  HOUNDE: 87 tickets, FRT avg 3.2h, FRT SLA 91%"
      const m = line.match(/^\s*(.+?):\s*(\d+)\s+tickets,\s*FRT avg\s+([\d.]+h|N\/A),\s*FRT SLA\s+(\d+|—)%?/i);
      if (m) out.push({
        name:   m[1].trim(),
        total:  +m[2],
        frtAvg: m[3] === 'N/A' ? null : parseFloat(m[3]),
        frtSla: m[4] === '—' ? null : +m[4],
      });
    });
    return out;
  }

  function _parseTrend(str) {
    if (!str) return [];
    return str.split('; ').map(seg => {
      // Format: "Mar 2026: 412 in, 367 closed"
      const m = seg.match(/^(.+?):\s*(\d+|\?)\s*in,\s*(\d+|\?)\s*closed/);
      if (!m) return null;
      return {
        label:   m[1].trim(),
        inbound: m[2] === '?' ? null : +m[2],
        closed:  m[3] === '?' ? null : +m[3],
      };
    }).filter(Boolean);
  }

  // ── Trend analysis: compare last value to trailing-6 average ──────
  function _trendDir(arr, key) {
    if (!arr || arr.length < 2) return null;
    const vals = arr.map(r => r[key]).filter(v => v != null);
    if (vals.length < 2) return null;
    const last = vals[vals.length - 1];
    const prior = vals.slice(0, -1).slice(-6); // up to 6 before last
    if (prior.length === 0) return null;
    const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
    const pct = avg > 0 ? Math.round((last - avg) / avg * 100) : 0;
    let label;
    if (pct > 5)       label = _t('trendUp');
    else if (pct < -5) label = _t('trendDown');
    else               label = _t('trendFlat');
    return { last, avg, pct, label };
  }

  // ── Find worst site / category by metric ─────────────────────────
  // Returns null if the list is empty.
  function _worstSiteByFrtSla(sites, fleetAvg) {
    if (!sites || sites.length === 0) return null;
    const ranked = sites.filter(s => s.frtSla != null && s.total >= 3)
                        .sort((a, b) => a.frtSla - b.frtSla);  // ascending: worst first
    if (ranked.length === 0) return null;
    const w = ranked[0];
    return {
      name:  w.name,
      sla:   w.frtSla,
      total: w.total,
      gap:   fleetAvg != null ? w.frtSla - fleetAvg : null,
    };
  }
  function _worstCategoryByVolume(cats) {
    if (!cats || cats.length === 0) return null;
    const ranked = cats.slice().sort((a, b) => b.total - a.total);
    return ranked[0];
  }

  // ── Section builders for executive-report.html ───────────────────
  function _buildExecSummary(s) {
    const lang = _lang();
    const h = s.helpdesk || {};
    const lines = [];

    // Bullet 1: headline
    const slaStatus = _stHigh(h.slaComp, TH.slaCompGood, TH.slaCompWarn);
    const slaTxt = h.slaComp != null
      ? `${h.slaComp}% ${slaStatus.icon} ${h.slaComp < TH.slaCompGood ? '(' + _t('below') + ')' : '(' + _t('within') + ')'}`
      : 'N/A';
    const fcrPart = h.fcrRate != null ? ` · ${_t('fcrRate')} ${h.fcrRate}%` : '';
    lines.push(`• ${_t('volume')} ${h.total} ${_t('tickets')} · ${_t('resolutionSLA')} ${slaTxt}${fcrPart}.`);

    // Bullet 2: top risk = worst site by FRT SLA
    const fleetFrt = h.total > 0 ? Math.round((h.total - (h.frtOverdue || 0)) / h.total * 1000) / 10 : null;
    const sites = _parseSiteLines(s.siteSummary);
    const ws = _worstSiteByFrtSla(sites, fleetFrt);
    if (ws) {
      const gap = ws.gap != null ? ` (${ws.gap >= 0 ? '+' : ''}${ws.gap.toFixed(1)} pts ${_t('vsAvg').replace('vs trailing-6m avg', 'vs ' + _t('fleetAvg')).replace('vs moyenne 6m glissants', 'vs ' + _t('fleetAvg'))})` : '';
      lines.push(`• ${_t('topRisk')}: ${ws.name} ${_t('frtSLA')} ${ws.sla}%${gap}.`);
    }

    // Bullet 3: trend
    const trend = _parseTrend(s.monthlyTrend);
    const tInbound = _trendDir(trend, 'inbound');
    if (tInbound) {
      const sign = tInbound.pct >= 0 ? '+' : '';
      lines.push(`• ${_t('trend12')}: ${_t('volume')} ${tInbound.label} (${sign}${tInbound.pct}% ${_t('vsAvg')}).`);
    }

    return lines.join('\n');
  }

  function _buildHelpdesk(s) {
    const h    = s.helpdesk || {};
    const cats = _parseCategoryLines(s.categoryBreakdown);
    const sites = _parseSiteLines(s.siteSummary);

    const slaSt = _stHigh(h.slaComp,    TH.slaCompGood, TH.slaCompWarn);
    const frtCompPct = h.total > 0 ? Math.round((h.total - (h.frtOverdue || 0)) / h.total * 1000) / 10 : null;
    const frtSt = _stHigh(frtCompPct,   TH.frtCompGood, TH.frtCompWarn);
    const rrSt  = _stLow (h.reopenRate, TH.reopenGood,  TH.reopenWarn);
    const bkSt  = _stLow (h.openBacklog,TH.backlogGood, TH.backlogWarn);
    const fcrSt = _stHigh(h.fcrRate,    TH.fcrGood,     TH.fcrWarn);

    const lines = [];
    lines.push(`${_t('scope')}: ${s.period} · ${s.siteFilter} · ${s.groupFilter} · ${h.total} ${_t('tickets')}.`);
    lines.push(`${_t('resolutionSLA')}: ${h.slaComp != null ? h.slaComp + '%' : 'N/A'} ${slaSt.icon} (${_t('target')} ≥ ${TH.slaCompGood}%).`);
    lines.push(`${_t('frtSLA')}: ${frtCompPct != null ? frtCompPct + '%' : 'N/A'} ${frtSt.icon} · ${_t('reopenRate')}: ${h.reopenRate != null ? h.reopenRate + '%' : 'N/A'} ${rrSt.icon}.`);
    lines.push(`${_t('closureRate')}: ${h.closureRate != null ? h.closureRate + '%' : 'N/A'} · ${_t('openBacklog')}: ${h.openBacklog} ${bkSt.icon} · ${_t('fcrRate')}: ${h.fcrRate != null ? h.fcrRate + '%' : 'N/A'} ${fcrSt.icon}.`);

    // Worst category
    const wc = _worstCategoryByVolume(cats);
    if (wc) {
      const wcReopenPct = wc.total > 0 ? Math.round(wc.reopened / wc.total * 100) : 0;
      lines.push(`${_t('worstCategory')}: ${wc.name} — ${wc.total} ${_t('tickets')}, ${wcReopenPct}% ${_t('reopens')}.`);
    }

    // Worst site
    const ws = _worstSiteByFrtSla(sites, frtCompPct);
    if (ws) {
      const gapStr = ws.gap != null ? ` (${ws.gap.toFixed(1)} pts ${_t('gap')} ${_t('vsAvg').includes('moyenne') ? 'vs moyenne' : 'vs avg'})` : '';
      lines.push(`${_t('worstSite')}: ${ws.name} — ${_t('frtSLA')} ${ws.sla}%${gapStr}.`);
    }

    // Templated actions
    const actions = [];
    if (wc)               actions.push(`(1) ${_t('worstCategory').toLowerCase()} → ${wc.name}: ` + (_lang() === 'fr' ? 'revoir les tickets ré-ouverts' : 'review reopened tickets'));
    if (ws)               actions.push(`(2) ${_t('worstSite').toLowerCase()} → ${ws.name}: ` + (_lang() === 'fr' ? "vérifier la dotation pendant les pics 14:00-16:00" : 'verify FRT staffing during peak hours'));
    if (h.openBacklog && h.openBacklog > TH.backlogGood) {
      actions.push(`(3) ${_lang() === 'fr' ? 'signaler les ' + h.openBacklog + ' tickets ouverts pour triage' : 'flag the ' + h.openBacklog + ' open tickets for triage'}`);
    }
    if (actions.length) lines.push(`${_t('actions')}: ${actions.join(' · ')}.`);

    return lines.join('\n');
  }

  function _buildSla(s) {
    const h = s.helpdesk || {};
    const slaSt = _stHigh(h.slaComp,    TH.slaCompGood, TH.slaCompWarn);
    const rrSt  = _stLow (h.reopenRate, TH.reopenGood,  TH.reopenWarn);
    const fcrSt = _stHigh(h.fcrRate,    TH.fcrGood,     TH.fcrWarn);
    const mtSt  = _stLow (parseFloat(h.avgMttr), TH.avgMttrGood, TH.avgMttrWarn);

    const lines = [];
    lines.push(`${_t('resolutionSLA')}: ${h.slaComp != null ? h.slaComp + '%' : 'N/A'} ${slaSt.icon} (${_t('target')} ≥ ${TH.slaCompGood}%) — ${slaSt.tag}.`);
    lines.push(`${_t('reopenRate')}: ${h.reopenRate != null ? h.reopenRate + '%' : 'N/A'} ${rrSt.icon} (${_t('target')} < ${TH.reopenGood}%) — ${rrSt.tag}.`);
    lines.push(`${_t('fcrRate')}: ${h.fcrRate != null ? h.fcrRate + '%' : 'N/A'} ${fcrSt.icon} (${_t('target')} ≥ ${TH.fcrGood}%) — ${fcrSt.tag}.`);
    lines.push(`${_t('openBacklog')}: ${h.openBacklog} ${_t('tickets')}.`);
    lines.push(`${_t('avgMttr')}: ${h.avgMttr != null ? h.avgMttr + 'd' : 'N/A'} ${mtSt.icon} (${_t('target')} ≤ ${TH.avgMttrGood}d) — ${mtSt.tag}.`);

    // Backlog blockers
    const bk = s.backlog || {};
    if (bk.total > 0) {
      lines.push('');
      lines.push(`${_t('blockers')}:`);
      lines.push(`  ${_t('blockerTotal')}: ${bk.total} ${_t('tickets')}.`);
      if (bk.categories) {
        // bk.categories is a multi-line string; flatten to one line
        const catTokens = bk.categories.split('\n').map(l => l.trim()).filter(Boolean)
          .map(l => l.replace(/^([^:]+):\s*(\d+)$/, '$1 ($2)'));
        if (catTokens.length) {
          lines.push(`  ${_t('blockerCats')}: ${catTokens.join(' · ')}.`);
        }
      }
      if (bk.subjects) {
        const sample = bk.subjects.split('\n').slice(0, 5);
        if (sample.length) {
          lines.push(`  ${_t('blockerSubjects')}:`);
          sample.forEach(line => lines.push('  ' + line.trim()));
        }
      }
      lines.push(`  ${_t('blockerNote')}`);
    }

    return lines.join('\n');
  }

  function _buildChange(s) {
    const c = s.changes || {};
    if (!c.total) return _t('noChanges');
    const emergencyPct = c.total > 0 ? Math.round(c.emergency / c.total * 100) : 0;
    const emSt = _stLow(emergencyPct, TH.emergencyGood, 10);
    const successPct = c.total > 0 ? Math.round(c.successful / c.total * 100) : 0;
    const lines = [];
    lines.push(`RFC: ${c.total} · ${_t('rfcSuccess')}: ${c.successful} (${successPct}%).`);
    lines.push(`${_t('emergencyRate')}: ${c.emergency}/${c.total} (${emergencyPct}% ${_t('ofRfcs')}) ${emSt.icon} (${_t('target')} < ${TH.emergencyGood}%) — ${emSt.tag}.`);
    if (emergencyPct > TH.emergencyGood) {
      lines.push(_t('reviewEmergency'));
    }
    return lines.join('\n');
  }

  function _buildIncidents(s) {
    const i = s.incidents || {};
    if (!i.total) return _t('noIncidents');
    const pirPct = i.total > 0 ? Math.round((i.pirRequired || 0) / i.total * 100) : 0;
    const rcaPct = i.total > 0 ? Math.round((i.withRca || 0) / i.total * 100) : 0;
    const lines = [];
    lines.push(`P1: ${i.p1} · P2: ${i.p2} · Total: ${i.total}. Downtime: ${i.totalDowntimeHrs || 0}h.`);
    lines.push(`${_t('pirCoverage')}: ${i.pirRequired || 0}/${i.total} (${pirPct}%) · ${_t('rcaCoverage')}: ${i.withRca || 0}/${i.total} (${rcaPct}%).`);
    if (i.lines) {
      lines.push('');
      i.lines.split('\n').slice(0, 12).forEach(l => lines.push(l));
    }
    const missingPir = i.total - (i.pirRequired || 0);
    if (missingPir > 0) {
      lines.push('');
      lines.push(`${missingPir} ${_t('missingPir')}.`);
    }
    return lines.join('\n');
  }

  function _buildCsat(s) {
    const c = s.csat || {};
    const csatNum = parseFloat(c.csatPct);
    const npsNum  = parseFloat(c.nps);
    const cs = _stHigh(csatNum, TH.csatGood, TH.csatGood - 10);
    const ns = _stHigh(npsNum,  TH.npsGood,  TH.npsGood - 10);
    const lines = [];
    lines.push(`${_t('csat')}: ${c.csatPct != null ? c.csatPct + (typeof c.csatPct === 'number' || /^\d+$/.test(String(c.csatPct)) ? '%' : '') : 'N/A'} ${cs.icon} (${_t('target')} ≥ ${TH.csatGood}%).`);
    lines.push(`${_t('nps')}: ${c.nps != null ? c.nps : 'N/A'} ${ns.icon} (${_t('target')} ≥ ${TH.npsGood}).`);
    if (c.trend) {
      lines.push(`${_t('trend6m')}: ${c.trend.split(';').slice(-3).join(';').trim()}.`);
    }
    // Recommendation
    const csatOk = !isNaN(csatNum) && csatNum >= TH.csatGood;
    const npsOk  = !isNaN(npsNum)  && npsNum  >= TH.npsGood;
    if (csatOk && npsOk)       lines.push(_t('csatRecOk'));
    else if (csatOk && !npsOk) lines.push(_t('csatRecNpsGap'));
    else if (!csatOk && !npsOk) lines.push(_t('csatRecBoth'));
    return lines.join('\n');
  }

  // ── Public API: executive-report.html ─────────────────────────────
  function runReportLite() {
    if (typeof buildAiSnapshot !== 'function') {
      alert(_t('noSnapshot'));
      return;
    }
    const s = buildAiSnapshot();
    if (!s || !s.helpdesk) {
      alert(_t('noData'));
      return;
    }
    const fields = {
      'f-exec':      _buildExecSummary(s),
      'f-helpdesk':  _buildHelpdesk(s),
      'f-sla':       _buildSla(s),
      'f-change':    _buildChange(s),
      'f-incidents': _buildIncidents(s),
      'f-csat':      _buildCsat(s),
    };
    Object.keys(fields).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = fields[id];
      el.classList.remove('empty');
      // Visual cue: thin amber left border to flag Lite-generated content
      el.style.borderLeft = '3px solid #d97706';
    });
    const statusEl = document.getElementById('actionStatus');
    if (statusEl) statusEl.textContent = _t('done');
  }

  // ── Public API: executive.html ────────────────────────────────────
  // Different field IDs (f-obs, f-risks, f-actions, f-change, f-incidents,
  // f-outlook). Uses window._baseData and window.activeFilters which the
  // existing buildDataSnapshotForAI() also reads.
  function runExecutiveLite() {
    const ld = window._baseData || {};
    const f  = window.activeFilters || {};
    if (!ld || Object.keys(ld).length === 0) {
      alert(_t('noData'));
      return;
    }

    // Pull KPIs from the summary row the same way buildDataSnapshotForAI does
    const sumRows = ld.summary || [];
    const last    = sumRows[sumRows.length - 1] || {};
    const prev    = sumRows[sumRows.length - 2] || {};
    const isPrebuilt = 'Requests' in last;
    const curIn  = parseInt(isPrebuilt ? last['Requests'] : last.inbound) || 0;
    const prevIn = parseInt(isPrebuilt ? prev['Requests'] : prev.inbound) || 0;
    const curSlaViol = parseFloat(isPrebuilt ? last['% of SLA Violated'] : last.slaViolatedPct) || 0;
    const slaComp = Math.round((100 - curSlaViol) * 10) / 10;
    const slaSt   = _stHigh(slaComp, TH.slaCompGood, TH.slaCompWarn);
    const volPct  = prevIn > 0 ? Math.round((curIn - prevIn) / prevIn * 100) : 0;
    const monthLabel = isPrebuilt ? last['Created Time'] : (last.month || _t('scope'));

    // Aging
    const ageRows = ld.ageing || [];
    const totalOver60 = ageRows.reduce((s, r) => s + (parseInt(r['Over 60 Days'] || r['d60'] || r['tOver60'] || Object.values(r)[4]) || 0), 0);
    const worstAgeSite = ageRows.slice()
      .map(r => ({ site: r['Site'] || Object.values(r)[0], over60: parseInt(r['Over 60 Days'] || r['d60'] || r['tOver60'] || Object.values(r)[4]) || 0 }))
      .filter(x => x.over60 > 0)
      .sort((a, b) => b.over60 - a.over60)[0];

    // f-obs: factual observations
    const obs = [];
    obs.push(`${monthLabel}: ${curIn} ${_t('tickets')} (${volPct >= 0 ? '+' : ''}${volPct}% ${_t('vsAvg').includes('moyenne') ? 'vs mois précédent' : 'vs prior month'}).`);
    obs.push(`${_t('resolutionSLA')}: ${slaComp}% ${slaSt.icon} (${_t('target')} ≥ ${TH.slaCompGood}%).`);
    if (totalOver60 > 0) obs.push(`${totalOver60} ${_t('tickets')} ${_lang() === 'fr' ? 'bloqués >60 jours' : 'stuck >60 days'}.`);

    // f-risks
    const risks = [];
    if (slaComp < TH.slaCompGood) risks.push(`${_t('resolutionSLA')} ${slaComp}% ${_t('below')} ${TH.slaCompGood}%.`);
    if (worstAgeSite) risks.push(`${worstAgeSite.site}: ${worstAgeSite.over60} ${_lang() === 'fr' ? 'tickets bloqués' : 'stuck tickets'}.`);
    if (totalOver60 > 50) risks.push(_lang() === 'fr' ? `Backlog >60 jours élevé (${totalOver60}) — capacité de support à revoir.` : `High >60-day backlog (${totalOver60}) — review support capacity.`);

    // f-actions (templated suggestions)
    const actions = [];
    if (slaComp < TH.slaCompGood) actions.push(_lang() === 'fr' ? "Audit des tickets en retard ce mois-ci" : 'Audit overdue tickets for this month');
    if (worstAgeSite) actions.push(_lang() === 'fr' ? `Triage des ${worstAgeSite.over60} tickets bloqués à ${worstAgeSite.site}` : `Triage ${worstAgeSite.over60} stuck tickets at ${worstAgeSite.site}`);
    if (volPct > 15) actions.push(_lang() === 'fr' ? `Volume en hausse de ${volPct}% — revue de capacité` : `Volume up ${volPct}% — capacity review`);

    // f-change / f-incidents — placeholder if no data globals available
    const changeTxt = ld.changes ? _lang() === 'fr' ? 'Données CAB chargées — voir détail dans la section CAB ci-dessous.' : 'CAB data loaded — see CAB section below for detail.' : _t('noChanges');
    const incTxt    = ld.incidents ? _lang() === 'fr' ? 'Incidents chargés — voir détail dans la section Incidents.' : 'Incidents loaded — see Incidents section.' : _t('noIncidents');

    // f-outlook: 12-month trend direction from inbound volumes
    const inboundSeries = sumRows.map(r => parseInt(isPrebuilt ? r['Requests'] : r.inbound) || 0);
    const dir = _trendDir(inboundSeries.map(v => ({ v })), 'v');
    const outlook = [];
    if (dir) outlook.push(`${_t('trend12')}: ${_t('volume')} ${dir.label} (${dir.pct >= 0 ? '+' : ''}${dir.pct}% ${_t('vsAvg')}).`);
    if (totalOver60 > 0) outlook.push(_lang() === 'fr' ? `Prioriser la résorption du backlog >60 jours en S+1.` : `Prioritise >60-day backlog reduction next month.`);
    if (slaComp < TH.slaCompGood) outlook.push(_lang() === 'fr' ? 'Risque de glissement SLA si la tendance se poursuit.' : 'SLA slippage risk if trend continues.');

    const fields = {
      'f-obs':       obs.join('\n'),
      'f-risks':     risks.length ? risks.join('\n') : (_lang() === 'fr' ? 'Aucun risque majeur identifié sur la période.' : 'No major risks flagged for this period.'),
      'f-actions':   actions.length ? actions.map((a, i) => `${i + 1}. ${a}`).join('\n') : (_lang() === 'fr' ? 'Aucune action automatique générée — éditer manuellement.' : 'No automated actions generated — edit manually.'),
      'f-change':    changeTxt,
      'f-incidents': incTxt,
      'f-outlook':   outlook.length ? outlook.join('\n') : (_lang() === 'fr' ? 'Pas de tendance significative.' : 'No significant trend.'),
    };
    let filledCount = 0;
    Object.keys(fields).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = fields[id];
      el.classList.remove('empty');
      el.style.borderLeft = '3px solid #d97706';
      // Brief amber flash so the user can SEE which fields were updated
      el.style.transition = 'background 1.2s ease-out';
      el.style.background = '#fef3c7';
      setTimeout(() => { el.style.background = ''; }, 1500);
      filledCount++;
    });
    const statusEl = document.getElementById('aiStatus');
    if (statusEl) statusEl.textContent = _t('done');

    // ── Visible toast so the user knows the click did something ────────────
    // Builds a one-line summary of what got populated (fields + verbatim count
    // + incident count) so the analyst gets explicit confirmation. Previously
    // runExecutiveLite ran silently — the fields filled but the user couldn't
    // tell whether the click had any effect because the comments panel often
    // ALREADY contained text from a prior run.
    try {
      const vocCount = (window._vocData && window._vocData.totalComments) || 0;
      const incCount = (ld.incidents || []).length;
      const chgCount = (ld.changeTable || []).length;
      const lang = _lang();
      const msg = lang === 'fr'
        ? `Analyse rapide terminée — ${filledCount} commentaires remplis · ${vocCount} verbatim · ${incCount} incidents · ${chgCount} changements`
        : `Lite analysis complete — ${filledCount} comments filled · ${vocCount} verbatim · ${incCount} incidents · ${chgCount} changes`;
      let toast = document.getElementById('_aliteToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = '_aliteToast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#0f172a;color:#fef3c7;padding:12px 18px;border-radius:8px;border-left:4px solid #d97706;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.25);z-index:99999;max-width:480px;line-height:1.4;opacity:0;transition:opacity 0.3s';
        document.body.appendChild(toast);
      }
      toast.innerHTML = '<span style="font-size:16px;margin-right:8px">⚡</span>' + msg;
      requestAnimationFrame(() => { toast.style.opacity = '1'; });
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { try { toast.remove(); } catch(_){} }, 400);
      }, 4500);
    } catch (_e) { /* toast is cosmetic — never let it break the analysis */ }
  }

  // ── Public API: Voice of Customer Insights (Tab 5 — vai-* fields) ────
  // Generates deterministic text for the 4 editable Customer Voice Insights
  // fields from current _vocData (keyword themes + sentiment) + _lastSurveyData
  // (CSAT/NPS aggregates). Previously these fields held text from the cloud
  // AI's last successful run — saved to data/notes.json and reloaded on every
  // page load. With cloud AI paused, the persisted text drifted out of sync
  // with current numbers. This function replaces the stale text with current-
  // data-driven analysis. Owner-action recommendations are pure templates
  // mapped to the keyword theme (no AI guesswork).
  function runVoiceInsightsLite() {
    const voc    = window._vocData || {};
    const survey = window._lastSurveyData || {};
    const fr     = _lang() === 'fr';

    // Skip if neither data source is available — leave fields untouched
    if ((!voc.totalComments || voc.totalComments === 0) &&
        (!survey.totalResponses || survey.totalResponses === 0)) {
      console.log('[VoiceInsightsLite] no voc or survey data — skipping');
      return 0;
    }

    const totalC   = voc.totalComments || 0;
    const sb       = voc.sentimentBreakdown || { positive:0, neutral:0, negative:0 };
    const csatPct  = survey.csatPct != null ? survey.csatPct : null;
    const avg      = survey.avgRating != null ? survey.avgRating : null;
    const totalR   = survey.totalResponses || 0;
    const nps      = survey.nps != null ? survey.nps : null;
    const promo    = survey.promoters   || 0;
    const passive  = survey.passives    || 0;
    const detrac   = survey.detractors  || 0;
    const npsBase  = promo + passive + detrac;
    const periodLabel = (window.activeFilters && window.activeFilters.periodLabel) || '';

    // ── 1. Satisfaction Assessment (vai-csat) ──────────────────────────
    const csatStr = csatPct != null ? csatPct + '%' : '—';
    const csatBand = csatPct == null ? 'unknown'
                    : csatPct >= 80 ? 'strong'
                    : csatPct >= 65 ? 'acceptable'
                    : 'poor';
    const csatLines = [];
    if (csatPct != null) {
      const headline = fr
        ? `CSAT à ${csatStr} (${avg ? avg + '/100' : ''}) sur ${totalR.toLocaleString()} réponses${periodLabel ? ' — ' + periodLabel : ''}.`
        : `CSAT at ${csatStr}${avg ? ' (avg ' + avg + '/100)' : ''} across ${totalR.toLocaleString()} responses${periodLabel ? ' — ' + periodLabel : ''}.`;
      csatLines.push(headline);
      const reading = csatBand === 'strong'
        ? (fr ? 'Performance solide — au-dessus de la cible de 80%. Maintenir la cadence.' : 'Strong performance — above the 80% target. Maintain the cadence.')
        : csatBand === 'acceptable'
          ? (fr ? 'Acceptable mais sous la cible de 80% — identifier les domaines de friction.' : 'Acceptable but below the 80% target — identify friction areas.')
          : (fr ? 'Sous le seuil de 65% — revue de service urgente requise.' : 'Below the 65% floor — urgent service review required.');
      csatLines.push(reading);
    } else {
      csatLines.push(fr ? 'Aucune donnée CSAT pour la période.' : 'No CSAT data for the period.');
    }
    if (totalC > 0) {
      csatLines.push(fr
        ? `${totalC} commentaire(s) libre(s) analysé(s) (${sb.positive} positif, ${sb.neutral} neutre, ${sb.negative} négatif).`
        : `${totalC} typed comment(s) analysed (${sb.positive} positive, ${sb.neutral} neutral, ${sb.negative} negative).`);
    }

    // ── 2. NPS & Loyalty Analysis (vai-nps) ───────────────────────────
    const npsLines = [];
    if (nps != null && npsBase > 0) {
      const npsBand = nps >= 50 ? 'excellent' : nps >= 30 ? 'good' : nps >= 0 ? 'needs-work' : 'poor';
      const ratio = detrac > 0 ? (promo / detrac).toFixed(1) : '∞';
      const npsLabel = npsBand === 'excellent' ? (fr ? 'Excellent' : 'Excellent')
                     : npsBand === 'good'      ? (fr ? 'Bon'       : 'Good')
                     : npsBand === 'needs-work'? (fr ? 'À améliorer' : 'Needs work')
                     :                          (fr ? 'Faible'    : 'Poor');
      npsLines.push(fr
        ? `NPS = ${nps >= 0 ? '+' + nps : nps} (${npsLabel}). ${promo.toLocaleString()} promoteurs (${Math.round(promo/npsBase*100)}%), ${detrac.toLocaleString()} détracteurs (${Math.round(detrac/npsBase*100)}%) — ratio ${ratio}:1.`
        : `NPS = ${nps >= 0 ? '+' + nps : nps} (${npsLabel}). ${promo.toLocaleString()} promoters (${Math.round(promo/npsBase*100)}%), ${detrac.toLocaleString()} detractors (${Math.round(detrac/npsBase*100)}%) — promoter:detractor ratio ${ratio}:1.`);
      const interpretation = npsBand === 'excellent'
        ? (fr ? 'Base client très loyale — recommandation forte aux pairs.' : 'Highly loyal customer base — strong advocacy to peers.')
        : npsBand === 'good'
          ? (fr ? 'Sain pour une fonction IT interne. Pas de risque immédiat de churn.' : 'Healthy for an internal IT function. No immediate churn risk.')
          : npsBand === 'needs-work'
            ? (fr ? 'Loyauté fragile — investiguer les détracteurs et leurs raisons.' : 'Fragile loyalty — investigate detractors and root causes.')
            : (fr ? 'Plus de détracteurs que de promoteurs — service en crise.' : 'More detractors than promoters — service is in crisis.');
      npsLines.push(interpretation);
    } else {
      npsLines.push(fr ? 'Pas de question NPS dans le sondage ou échantillon insuffisant.' : 'No NPS question in the survey or insufficient sample.');
    }

    // ── 3. Pain Points from Verbatim (vai-pain) ────────────────────────
    // Identify the top 3 negative-sentiment themes from the keyword analysis.
    // These are the themes the dashboard's keyword classifier tagged most
    // frequently on negative comments — pure data, no AI inference.
    const painLines = [];
    const negComments = (voc.allComments || voc.quotes || []).filter(c => c.sentiment === 'negative');
    const negThemeCounts = {};
    negComments.forEach(c => {
      (c.themes || []).forEach(t => { negThemeCounts[t] = (negThemeCounts[t] || 0) + 1; });
    });
    const topPain = Object.keys(negThemeCounts)
      .filter(t => t !== 'Other' && t !== 'Positive Feedback')
      .map(t => ({ theme: t, count: negThemeCounts[t] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    if (topPain.length > 0) {
      painLines.push(fr
        ? `Principaux points de douleur extraits des commentaires négatifs (analyse par mots-clés, sans IA):`
        : `Top pain points extracted from negative comments (keyword analysis, no AI):`);
      topPain.forEach((p, i) => {
        const ownerHint = _painOwnerHint(p.theme, fr);
        painLines.push(`${i + 1}) ${p.theme} (${p.count} mention${p.count > 1 ? 's' : ''}) — ${ownerHint}`);
      });
    } else if (negComments.length > 0) {
      painLines.push(fr
        ? `${negComments.length} commentaire(s) négatif(s) sans thème dominant — voir l'onglet Explorateur de Verbatim pour le détail.`
        : `${negComments.length} negative comment(s) without a dominant theme — see the Verbatim Explorer tab for detail.`);
    } else {
      painLines.push(fr
        ? `Aucun commentaire négatif sur la période — résultat exceptionnel.`
        : `No negative comments in the period — exceptional result.`);
    }

    // ── 4. Improvement Recommendations (vai-improve) ──────────────────
    // Template-driven actions per pain theme. Owner + concrete step + target.
    const improveLines = [];
    if (topPain.length > 0) {
      topPain.forEach((p, i) => {
        improveLines.push(`${i + 1}) ${_improveRecommendation(p.theme, p.count, fr)}`);
      });
    }
    // Always include a general recommendation tied to current CSAT
    if (csatBand === 'poor') {
      improveLines.push(fr
        ? `${topPain.length + 1}) Direction IT: lancer une revue de service trimestrielle — CSAT à ${csatStr} sous le seuil de 65%.`
        : `${topPain.length + 1}) IT Director: launch a quarterly service review — CSAT at ${csatStr} below the 65% floor.`);
    } else if (csatBand === 'acceptable') {
      improveLines.push(fr
        ? `${topPain.length + 1}) Service Desk Manager: enquête détaillée sur les ${sb.negative} commentaires négatifs pour atteindre la cible 80%.`
        : `${topPain.length + 1}) Service Desk Manager: deep-dive on the ${sb.negative} negative comments to reach the 80% target.`);
    }
    if (improveLines.length === 0) {
      improveLines.push(fr
        ? `Pas d'actions correctives requises — service stable. Maintenir les pratiques actuelles.`
        : `No corrective actions required — service stable. Maintain current practices.`);
    }

    // ── Write fields + flash + count ──────────────────────────────────
    const writes = {
      'vai-csat':    csatLines.join('\n'),
      'vai-nps':     npsLines.join('\n'),
      'vai-pain':    painLines.join('\n'),
      'vai-improve': improveLines.join('\n'),
    };
    let filled = 0;
    Object.keys(writes).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = writes[id];
      el.removeAttribute('data-empty');
      el.style.color = '#334155';
      el.style.borderLeftStyle = 'solid';
      // Brief lavender flash to signal a refresh happened
      el.style.transition = 'background 1.2s ease-out';
      const prevBg = el.style.background;
      el.style.background = '#fef3c7';
      setTimeout(() => { el.style.background = prevBg; }, 1500);
      filled++;
    });
    return filled;
  }

  // Map a keyword theme → owner + action hint. Templates ONLY — no inference.
  function _painOwnerHint(theme, fr) {
    const map = fr ? {
      'Resolution Time':       "délais de résolution trop longs; Service Desk Manager à investiguer.",
      'Issue Not Resolved':    "tickets clos sans résolution; IT Manager à réviser le processus de clôture.",
      'Access / Login':        "friction d'authentification ou de portail; Site IT Lead à auditer.",
      'Network / Connectivity':"problèmes de connectivité réseau; Network Engineer à investiguer.",
      'Hardware / Equipment':  "défaillances matérielles; IT Hardware Lead à examiner.",
      'Portal / UX':           "frictions sur le portail self-service; UX/Portal Owner à corriger.",
    } : {
      'Resolution Time':       "resolution time too long; Service Desk Manager to investigate.",
      'Issue Not Resolved':    "tickets closed without true resolution; IT Manager to review closure process.",
      'Access / Login':        "authentication or portal friction; Site IT Lead to audit.",
      'Network / Connectivity':"network connectivity issues; Network Engineer to investigate.",
      'Hardware / Equipment':  "hardware failures; IT Hardware Lead to review.",
      'Portal / UX':           "self-service portal friction; UX/Portal Owner to fix.",
    };
    return map[theme] || (fr ? `examen détaillé requis — ${theme}.` : `detailed review required — ${theme}.`);
  }

  // Template recommendation per pain theme — owner + concrete next step
  function _improveRecommendation(theme, count, fr) {
    const map = fr ? {
      'Resolution Time':       `Service Desk Manager: audit SLA sur les ${count} plaintes de délai; objectif de réduction sous 5 jours.`,
      'Issue Not Resolved':    `IT Manager: initiative 'zéro non-résolu' — auditer les ${count} cas, ajouter un flux de confirmation de résolution.`,
      'Access / Login':        `Site IT Lead: simplifier les flux SSO/MFA, déployer la réinitialisation libre-service du mot de passe (${count} plaintes).`,
      'Network / Connectivity':`Network Engineer: revue de capacité réseau et audit des liens redondants (${count} signalements).`,
      'Hardware / Equipment':  `IT Hardware Lead: programme de renouvellement préventif — cibler les équipements signalés (${count} plaintes).`,
      'Portal / UX':           `UX/Portal Owner: refonte du parcours self-service et tests utilisateurs (${count} retours).`,
    } : {
      'Resolution Time':       `Service Desk Manager: SLA audit on the ${count} resolution-time complaints; target reduction to under 5 days.`,
      'Issue Not Resolved':    `IT Manager: 'zero unresolved' initiative — audit the ${count} cases, add a resolution-confirmation workflow.`,
      'Access / Login':        `Site IT Lead: simplify SSO/MFA flows, deploy self-service password reset (${count} complaints).`,
      'Network / Connectivity':`Network Engineer: network capacity review and redundant-link audit (${count} reports).`,
      'Hardware / Equipment':  `IT Hardware Lead: preventive refresh programme — target flagged equipment (${count} complaints).`,
      'Portal / UX':           `UX/Portal Owner: self-service journey redesign with user testing (${count} signals).`,
    };
    return map[theme] || (fr ? `Owner approprié: examiner les ${count} signalements ${theme}.` : `Appropriate owner: review the ${count} ${theme} signals.`);
  }

  // Chain the Voice Insights refresh from the main Analyze button so the
  // analyst gets one-click refresh across BOTH the IT Manager Comments
  // (f-* fields) AND the Customer Voice Insights (vai-* fields). The
  // separate Tab 5 "Edit Fields" button stays for manual editing.
  const _originalRunExecutiveLite = runExecutiveLite;
  runExecutiveLite = function() {
    _originalRunExecutiveLite.apply(this, arguments);
    try {
      const vaiFilled = runVoiceInsightsLite();
      console.log('[AnalyzeLite] chained Voice Insights refresh — ' + (vaiFilled || 0) + ' fields');
    } catch (e) {
      console.warn('[AnalyzeLite] Voice Insights chain failed:', e.message);
    }
  };

  // ── Expose globally ──────────────────────────────────────────────
  window.AnalyzeLite = {
    runReportLite,
    runExecutiveLite,
    runVoiceInsightsLite,          // expose so a Tab 5 "Refresh" button can call it directly
    // diagnostic helpers exposed for console use
    _parseCategoryLines,
    _parseSiteLines,
    _parseTrend,
    _trendDir,
    _lang,
  };
})();
