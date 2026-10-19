/**
 * tracker-pptx.js — Server-side IT Activity Tracker PPTX generator
 *
 * Generates 2-slide PPTX pixel-matched to the Endeavour Mining template.
 * Slide size: LAYOUT_16x9 = 10" × 5.625"
 * Applies fixComboChartAxes for full PowerPoint compatibility.
 */
'use strict';

const PptxGenJS = require('pptxgenjs');
const fs        = require('fs');
const path      = require('path');
const { fixComboChartAxes } = require('./pptx-fix-axes');

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Embedded template images (base64 PNG) ─────────────────────────────────────
// Loaded once at module init from the template assets folder
function loadImg(name) {
  const p = path.join(__dirname, 'public', 'tracker-icons', name);
  try { return fs.readFileSync(p).toString('base64'); } catch(e) { return null; }
}
// image1=logo, image2-5=pillar icons P1-P4, image6=green-check, image7=amber-warn, image8=amber-warn2
let _imgs = null;
function imgs() {
  if (_imgs) return _imgs;
  _imgs = {
    logo:    loadImg('logo.png'),
    p1:      loadImg('pillar1.png'),
    p2:      loadImg('pillar2.png'),
    p3:      loadImg('pillar3.png'),
    p4:      loadImg('pillar4.png'),
    green:   loadImg('green-check.png'),
    amber:   loadImg('amber-warn.png'),
    amber2:  loadImg('amber-warn2.png'),
  };
  return _imgs;
}

// ── Pillar helpers ────────────────────────────────────────────────────────────
function gP(D) {
  return [...new Set(D.activities.map(a => a.pillar))];
}
function gPS(p) {
  return p
    .replace(/^P\d+-\s*/, '')
    .replace(/Network Infrast\w*/,'Network Infra')
    .replace(/Business Partner\w*/,'Biz Partnering')
    .replace(/Manage People\w*/,'People Dev')
    .replace(/Risk & Complia\w*/,'Risk & Compl.');
}

// Pillar box colors
const PILLAR_COLORS = ['0D9488','E87722','7C3AED','EAB308'];
function pillarColor(idx) { return PILLAR_COLORS[idx] || '334155'; }

// Site card colors (matches siteColors in D, or fallback palette)
const SITE_PALETTE = ['0D9488','F97316','8B5CF6','EAB308','0891B2','16A34A','E74C3C','0EA5E9'];
function hex(c) { return c ? String(c).replace(/^#/,'') : '0D9488'; }

// ── Calculation helpers ────────────────────────────────────────────────────────
function gi(D, yr, site, ai, mi) {
  return (D.inputs[yr]?.[site]?.[ai]?.[mi]) || 0;
}

function effWeights(D, site) {
  const tg = D.targets[site] || [];
  const PW = D.pillarWeights;
  const pillars = {};
  D.activities.forEach((a, i) => {
    const p = a.pillar;
    if (!pillars[p]) pillars[p] = { activeW: 0, totalW: 0 };
    pillars[p].totalW += a.weight;
    if (tg[i]?.active) pillars[p].activeW += a.weight;
  });
  const ew = new Array(D.activities.length).fill(0);
  D.activities.forEach((a, i) => {
    if (!tg[i]?.active) return;
    const pl = pillars[a.pillar];
    const pW = a.pillar in PW ? PW[a.pillar] : 0.25;
    if (pl.activeW > 0) ew[i] = pW * (a.weight / pl.activeW);
  });
  return ew;
}

// RAG bands (user policy 2026-09-03): GREEN >= 90% of the pro-rated target ·
// AMBER 75-89% · RED < 75%. BOOLEAN/MILESTONE keep done/in-progress semantics.
// ⚠ Twin engine: public/activity-tracker/engine.js carries the SAME bands.
function score(D, site, yr, mo) {
  const tg = D.targets[site] || [];
  const R  = [];
  const ew = effWeights(D, site);

  D.activities.forEach((a, i) => {
    const t = tg[i];
    if (!t || !t.active) { R.push({ ...a, ix:i, on:false, ya:0, yt:0, sc:'N/A', rg:'N/A', ew:0 }); return; }
    let ya = 0;
    if (a.shared) {
      let mx = 0;
      D.sites.forEach(s2 => { let sm=0; for(let m=0;m<mo;m++) sm+=gi(D,yr,s2,i,m); mx=Math.max(mx,sm); });
      ya = mx;
    } else { for (let m=0; m<mo; m++) ya += gi(D, yr, site, i, m); }

    if (a.kpi === 'BOOLEAN') {
      const sc = Math.min(ya,1);
      const rg = sc>=1?'GREEN':sc>=0.5?'AMBER':(a.end<=mo?'RED':'AMBER');
      R.push({ ...a, ix:i, on:true, ya:Math.round(ya*100)/100, yt:1, sc, rg, ew:ew[i] });
    } else if (a.kpi === 'PERCENT') {
      const months = Math.min(mo,a.end)-a.start+1;
      const avg    = months>0?ya/months:0;
      const tgt    = parseInt(t.target)||100;
      const sc     = Math.min(avg/tgt,1);
      R.push({ ...a, ix:i, on:true, ya:Math.round(avg*10)/10, yt:tgt, sc:Math.round(sc*1000)/1000, rg:sc>=0.9?'GREEN':sc>=0.75?'AMBER':'RED', ew:ew[i] });
    } else if (a.kpi === 'MILESTONE') {
      const tgt  = parseInt(t.target)||1;
      const phase= Math.min(ya,tgt);
      const sc   = Math.min(phase/tgt,1);
      R.push({ ...a, ix:i, on:true, ya:Math.round(phase*100)/100, yt:tgt, sc:Math.round(sc*1000)/1000, rg:sc>=1?'GREEN':sc>0?'AMBER':(a.end<=mo?'RED':'AMBER'), ew:ew[i] });
    } else if (a.kpi === 'CURRENCY') {
      const tgt=parseFloat(t.target)||0;
      if(tgt===0){ R.push({ ...a, ix:i, on:true, ya, yt:0, sc:0, rg:'AMBER', ew:ew[i] }); }
      else { const sc=Math.min(ya/tgt,1); R.push({ ...a, ix:i, on:true, ya:Math.round(ya*100)/100, yt:tgt, sc:Math.round(sc*1000)/1000, rg:sc>=0.9?'GREEN':sc>=0.75?'AMBER':'RED', ew:ew[i] }); }
    } else if (a.kpi === 'RATING') {
      const nz=[]; for(let m2=a.start-1;m2<Math.min(mo,a.end);m2++){const v=gi(D,yr,site,i,m2);if(v>0)nz.push(v);}
      const avg=nz.length>0?nz.reduce((s,v)=>s+v,0)/nz.length:0;
      const tgt=parseFloat(t.target)||4;
      const sc=tgt>0?Math.min(avg/tgt,1):0;
      R.push({ ...a, ix:i, on:true, ya:Math.round(avg*100)/100, yt:tgt, sc:Math.round(sc*1000)/1000, rg:sc>=0.9?'GREEN':sc>=0.75?'AMBER':(nz.length===0&&a.end>mo?'AMBER':'RED'), ew:ew[i] });
    } else {
      if(a.start>mo){ R.push({ ...a, ix:i, on:true, ya, yt:'N/A', sc:'N/A', rg:'N/A', ew:ew[i] }); }
      else{ const mA=Math.min(mo,a.end)-a.start+1; const tot=a.end-a.start+1; const ann=parseInt(t.target)||0; const yt=ann*(mA/tot); const sc=yt>0?Math.min(ya/yt,1):0; R.push({ ...a, ix:i, on:true, ya:Math.round(ya*100)/100, yt:Math.round(yt*100)/100, sc:Math.round(sc*1000)/1000, rg:sc>=0.9?'GREEN':sc>=0.75?'AMBER':'RED', ew:ew[i] }); }
    }
  });
  return R;
}

function ss(D, site, yr, mo) {
  const sc=score(D,site,yr,mo);
  const PW=D.pillarWeights;
  const pScores={};
  gP(D).forEach(p => {
    let wS=0,wT=0;
    sc.forEach(s=>{ if(s.on&&s.pillar===p&&typeof s.sc==='number'){wS+=s.sc*s.weight;wT+=s.weight;} });
    if(wT>0) pScores[p]=wS/wT;
  });
  let oS=0,oT=0;
  Object.keys(pScores).forEach(p=>{ const pw=p in PW?PW[p]:0.25; oS+=pw*pScores[p]; oT+=pw; });
  return { active:sc.filter(s=>s.on).length, g:sc.filter(s=>s.rg==='GREEN').length, a:sc.filter(s=>s.rg==='AMBER').length, r:sc.filter(s=>s.rg==='RED').length, avg:oT>0?oS/oT:0, sc, pScores };
}

function ps2(D, site, p, yr, mo) {
  const sc=score(D,site,yr,mo);
  let wS=0,wT=0;
  sc.forEach(s=>{ if(s.on&&s.pillar===p&&typeof s.sc==='number'){wS+=s.sc*s.weight;wT+=s.weight;} });
  return wT>0?wS/wT:0;
}

function fleetStats(D, sites, yr, mo) {
  const scores=sites.map(s=>ss(D,s,yr,mo).avg);
  const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
  const best=sites.reduce((a,b)=>ss(D,a,yr,mo).avg>=ss(D,b,yr,mo).avg?a:b);
  let totalScored=0,totalGreen=0;
  sites.forEach(s=>{ score(D,s,yr,mo).forEach(a=>{ if(a.on&&['GREEN','AMBER','RED'].includes(a.rg)){totalScored++;if(a.rg==='GREEN')totalGreen++;} }); });
  return { avg, best, attainment:totalScored>0?totalGreen/totalScored:0 };
}

function siteCommentary(D, site, yr, mo) {
  const sm=ss(D,site,yr,mo);
  const sc=score(D,site,yr,mo);
  const prev=mo>1?ss(D,site,yr,mo-1):null;
  const delta=prev?Math.round((sm.avg-prev.avg)*100):0;
  const ac=sc.filter(s=>s.on).length;
  const newG=prev?sc.filter((s,i)=>s.rg==='GREEN'&&score(D,site,yr,mo-1)[i]?.rg!=='GREEN').map(s=>s.name):[];
  const reds=sc.filter(s=>s.rg==='RED'&&s.on);
  const newR=prev?sc.filter((s,i)=>s.rg==='RED'&&score(D,site,yr,mo-1)[i]?.rg!=='RED').map(s=>s.name):[];

  let pos='';
  if(newG.length>=2) pos=(D.siteNames[site]||site)+' ('+ac+' activities). '+newG.slice(0,2).join(' & ')+' \u2192 GREEN. +'+newG.length+' new GREEN items.';
  else if(newG.length===1) pos=(D.siteNames[site]||site)+' ('+ac+'). '+newG[0]+' \u2192 GREEN.'+(delta>0?' +'+delta+'pp improvement.':'');
  else pos=(D.siteNames[site]||site)+' ('+ac+'). '+(delta>0?'+'+delta+'pp improvement.':'Holding steady at '+Math.round(sm.avg*100)+'%.');

  let neg='';
  if(newR.length) neg=newR.slice(0,2).join(' & ')+' turned RED.'+(reds.length>newR.length?' '+reds.length+' RED total to address.':'');
  else if(reds.length) neg=reds.length+' RED remain'+(sm.a>5?' \u2014 '+sm.a+' amber items with conversion potential.':' but no new RED \u2014 upward trajectory.');
  else neg='No RED items. Strong execution across all activities.';

  return [pos, neg];
}

function generalReview(D, sites, yr, mo) {
  const bullets=[];
  const prev=mo>1?mo-1:null;

  D.activities.forEach((a,i)=>{
    if(a.shared) return;
    const allGreen=sites.every(s=>score(D,s,yr,mo)[i]?.rg==='GREEN');
    const wasNotAll=prev&&!sites.every(s=>score(D,s,yr,prev)[i]?.rg==='GREEN');
    if(allGreen&&wasNotAll) bullets.push({ text:'All sites have successfully completed '+a.name+' this month.', ok:true });
  });

  const boolDone=[];
  D.activities.forEach((a,i)=>{
    if(a.kpi==='BOOLEAN'){
      const greens=sites.filter(s=>score(D,s,yr,mo)[i]?.rg==='GREEN');
      if(greens.length>0&&greens.length<sites.length)
        boolDone.push({ text:a.name+' progressing \u2014 '+greens.join(', ')+' now GREEN.', ok:true });
    }
  });
  if(boolDone.length) bullets.push(...boolDone.slice(0,2));

  const P=gP(D);
  const p3=P.find(p=>p.includes('Risk'));
  if(p3){
    const p3avg=sites.reduce((s,si)=>s+ps2(D,si,p3,yr,mo),0)/sites.length;
    if(p3avg<0.6) bullets.push({ text:'Risk & Compliance pillar at '+Math.round(p3avg*100)+'% fleet average \u2014 requires management attention.', ok:false });
  }

  D.activities.forEach((a,i)=>{
    if(a.shared&&score(D,sites[0],yr,mo)[i]?.rg==='RED')
      bullets.push({ text:a.name+' remains RED fleet-wide \u2014 coordinated action needed.', ok:false });
  });

  return bullets.slice(0,4);
}

// ── addImg helper (only if base64 data exists) ────────────────────────────────
function addImg(slide, dataB64, opts) {
  if (!dataB64) return;
  slide.addImage({ data: 'image/png;base64,' + dataB64, ...opts });
}

// ── generateTrackerPptx() — main export ──────────────────────────────────────
async function generateTrackerPptx(D, selectedSites, yr, mo) {
  const aS = selectedSites.filter(s => D.activeSites.includes(s));
  if (!aS.length) throw new Error('No active sites selected');

  const P      = gP(D);
  const f      = fleetStats(D, aS, yr, mo);
  const prevF  = mo>1 ? fleetStats(D, aS, yr, mo-1) : null;
  const bestSt = aS.reduce((a,b)=>ss(D,a,yr,mo).avg>=ss(D,b,yr,mo).avg?a:b);
  const bestDelta = prevF ? Math.round((ss(D,bestSt,yr,mo).avg-ss(D,bestSt,yr,mo-1).avg)*100) : 0;

  // ── Color palette ──────────────────────────────────────────────────────────
  const BG  = '1E293B';   // navy header
  const TW  = 'FFFFFF';
  const TL  = '94A3B8';   // muted blue-grey (footer text)
  const TD  = '1E293B';   // dark text
  const RG  = '16A34A';   // green
  const RA  = 'D97706';   // amber
  const RR  = 'DC2626';   // red
  const TE  = '0D9488';   // teal accent
  const SL  = '475569';   // slate label
  const im  = imgs();

  // Totals across all sites
  let tG=0,tA=0,tR=0,tAct=0;
  aS.forEach(s=>{ const sm=ss(D,s,yr,mo); tG+=sm.g; tA+=sm.a; tR+=sm.r; tAct+=sm.active; });

  const pr = new PptxGenJS();
  pr.layout  = 'LAYOUT_16x9';   // 10" × 5.625"
  pr.author  = 'IT Operations';
  pr.title   = 'IT Ops Strategy \u2014 '+MO[mo-1]+' '+yr;

  const NL = { pt:0, color:TW };  // no-line helper

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 1 — IT Ops Strategy Roadmap
  // ════════════════════════════════════════════════════════════════════════════
  const s1 = pr.addSlide();
  s1.background = { fill: 'F1F5F9' };

  // Header: navy bg  (h=1.30) + teal accent (y=1.22, h=0.08)
  s1.addShape(pr.shapes.RECTANGLE, { x:0, y:0,    w:10, h:1.30, fill:{color:BG}, line:NL });
  s1.addShape(pr.shapes.RECTANGLE, { x:0, y:1.22, w:10, h:0.08, fill:{color:TE}, line:NL });

  // Logo (image1) — top-left
  addImg(s1, im.logo, { x:0.50, y:0.22, w:0.42, h:0.42 });

  // Title
  s1.addText('IT Ops Strategy Roadmap', {
    x:1.10, y:0.12, w:7.00, h:0.48,
    fontSize:20, fontFace:'Calibri', color:TW, bold:true, margin:0, valign:'middle'
  });
  // Subtitle
  s1.addText(MO[mo-1]+' '+yr+'  \u2022  Progress Overview  \u2022  '+aS.length+' Operating Sites  \u2022  '+tAct+' Activities', {
    x:1.10, y:0.62, w:7.00, h:0.28,
    fontSize:8, color:TL, fontFace:'Calibri', margin:0, valign:'middle'
  });

  // Month badge (top-right): x=8.50, y=0.25, w=1.10, h=0.58
  s1.addShape(pr.shapes.RECTANGLE, { x:8.50, y:0.25, w:1.10, h:0.58, fill:{color:TE}, line:NL, rectRadius:0.04 });
  s1.addText(MO[mo-1].toUpperCase(), {
    x:8.50, y:0.27, w:1.10, h:0.32,
    fontSize:14, fontFace:'Calibri', color:TW, bold:true, align:'center', margin:0, valign:'middle'
  });
  s1.addText(String(yr), {
    x:8.50, y:0.57, w:1.10, h:0.22,
    fontSize:9, color:'CCFBF1', align:'center', margin:0, valign:'middle'
  });

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  // Template: x=0.475/2.325/4.175/6.025/7.875  w=1.65  y=1.52  h=0.80
  const kpis = [
    { v:tG,                                    l:'GREEN',           c:RG,     bg:'DCFCE7', acc:RG },
    { v:tA,                                    l:'AMBER',           c:RA,     bg:'FEF3C7', acc:RA },
    { v:tR,                                    l:'RED',             c:RR,     bg:'FEE2E2', acc:RR },
    { v:Math.round(f.avg*100)+'%',             l:'AVG SCORE',       c:TE,     bg:'CCFBF1', acc:TE },
    { v:(bestDelta>=0?'+':'')+bestDelta+'pp',  l:'BEST \u0394 ('+bestSt+')', c:'0EA5E9', bg:'E0F2FE', acc:'0EA5E9' },
  ];
  const kpiXs = [0.475, 2.325, 4.175, 6.025, 7.875];
  const kpiW  = 1.65, kpiY = 1.52, kpiH = 0.80;

  kpis.forEach((k,j) => {
    const tx = kpiXs[j];
    // Light bg
    s1.addShape(pr.shapes.RECTANGLE, { x:tx, y:kpiY, w:kpiW, h:kpiH, fill:{color:k.bg}, line:{color:'E2E8F0',pt:0.5}, rectRadius:0.04 });
    // Accent top bar
    s1.addShape(pr.shapes.RECTANGLE, { x:tx, y:kpiY, w:kpiW, h:0.05, fill:{color:k.acc}, line:NL, rectRadius:0 });
    // Value (big)
    s1.addText(String(k.v), {
      x:tx+0.10, y:kpiY+0.06, w:kpiW-0.20, h:0.42,
      fontSize:24, bold:true, color:k.c, fontFace:'Calibri', margin:0, valign:'middle'
    });
    // Label
    s1.addText(k.l, {
      x:tx+0.10, y:kpiY+0.52, w:kpiW-0.20, h:0.22,
      fontSize:7.5, bold:true, color:SL, fontFace:'Calibri', margin:0, valign:'middle'
    });
  });

  // ── Chart cards ────────────────────────────────────────────────────────────
  // Template: left x=0.40 w=4.50; right x=5.10 w=4.50  y=2.55 h=2.70
  const cY=2.55, cH=2.70, cW=4.50;
  const c1X=0.40, c2X=5.10;

  s1.addShape(pr.shapes.RECTANGLE, { x:c1X, y:cY, w:cW, h:cH, fill:{color:TW}, line:{color:'E2E8F0',pt:0.75}, rectRadius:0.05 });
  s1.addShape(pr.shapes.RECTANGLE, { x:c2X, y:cY, w:cW, h:cH, fill:{color:TW}, line:{color:'E2E8F0',pt:0.75}, rectRadius:0.05 });

  // Chart titles
  s1.addText('Site Performance (%)', {
    x:c1X+0.18, y:cY+0.10, w:cW-0.28, h:0.26,
    fontSize:9.5, bold:true, color:TD, fontFace:'Calibri', margin:0
  });
  s1.addText('RAG Distribution by Pillar', {
    x:c2X+0.18, y:cY+0.10, w:cW-0.28, h:0.26,
    fontSize:9.5, bold:true, color:TD, fontFace:'Calibri', margin:0
  });

  // Chart 1: Site performance bar
  const siteLabels = aS.slice();
  const siteVals   = aS.map(s => Math.round(ss(D,s,yr,mo).avg*100));
  const siteClrs   = aS.map(s => hex(D.siteColors[s]));

  s1.addChart(pr.charts.BAR,
    [{ name:'Score %', labels:siteLabels, values:siteVals }],
    {
      x:c1X+0.15, y:cY+0.42, w:cW-0.25, h:cH-0.55,
      showValue:true, valueFontSize:9, catAxisLabelFontSize:8, valAxisMaxVal:100,
      chartColors:siteClrs, showLegend:false, valAxisLabelFontSize:7,
      barGapWidthPct:55, valGridLine:{color:'F1F5F9'}
    }
  );

  // Chart 2: RAG by Pillar stacked bar
  const pLabels=P.map(p=>gPS(p).substring(0,14));
  const pG2=[],pA2=[],pR2=[];
  P.forEach(p=>{
    let g=0,a=0,r=0;
    aS.forEach(s=>{
      score(D,s,yr,mo).forEach(sc2=>{
        if(sc2.pillar===p&&sc2.on){ if(sc2.rg==='GREEN')g++; else if(sc2.rg==='AMBER')a++; else if(sc2.rg==='RED')r++; }
      });
    });
    pG2.push(g); pA2.push(a); pR2.push(r);
  });
  s1.addChart(pr.charts.BAR,
    [{ name:'Green',labels:pLabels,values:pG2 },{ name:'Amber',labels:pLabels,values:pA2 },{ name:'Red',labels:pLabels,values:pR2 }],
    {
      x:c2X+0.15, y:cY+0.42, w:cW-0.25, h:cH-0.55,
      barGrouping:'stacked', chartColors:[RG,RA,RR], showLegend:true,
      legendPos:'b', legendFontSize:7, catAxisLabelFontSize:7, valAxisLabelFontSize:7, showValue:false,
      valGridLine:{color:'F1F5F9'}
    }
  );

  // Footer text (no black bar — italic gray at y=5.35)
  s1.addText(
    'Source: IT Ops Objectives Tracker \u2014 '+MO[mo-1]+' vs '+(mo>1?MO[mo-2]:'N/A')+' '+yr+'  |  Endeavour Mining PLC',
    { x:0.40, y:5.35, w:9.00, h:0.20, fontSize:7, color:TL, italic:true, fontFace:'Calibri', margin:0, valign:'middle' }
  );

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 2 — Executive Commentary & Site Summaries
  // ════════════════════════════════════════════════════════════════════════════
  const s2 = pr.addSlide();
  s2.background = { fill: 'F8FAFC' };

  // Header navy bg (h=0.72) + teal accent (y=0.65, h=0.07)
  s2.addShape(pr.shapes.RECTANGLE, { x:0, y:0,    w:10, h:0.72, fill:{color:BG}, line:NL });
  s2.addShape(pr.shapes.RECTANGLE, { x:0, y:0.65, w:10, h:0.07, fill:{color:TE}, line:NL });
  s2.addText('Executive Commentary & Site Summaries', {
    x:0.50, y:0.12, w:9.00, h:0.42,
    fontSize:16, fontFace:'Calibri', color:TW, bold:true, margin:0, valign:'middle'
  });

  // ── Pillar header boxes ────────────────────────────────────────────────────
  // Template (4 pillars): w=2.18, gap=0.14, startX=0.43, y=0.84, h=0.46
  // Dynamic: pillarW = (9.14 - (n-1)*0.14) / n,  where 9.14 = 10 - 0.43*2
  const numP   = P.length;
  const pGap   = 0.14;
  const pTotal = 10 - 0.43 * 2;   // 9.14"
  const pW     = (pTotal - (numP-1)*pGap) / numP;
  const pBoxY  = 0.84;
  const pBoxH  = 0.46;
  const pIcons = [im.p1, im.p2, im.p3, im.p4];

  P.forEach((p, j) => {
    const pX     = 0.43 + j*(pW + pGap);
    const pColor = pillarColor(j);
    const psc    = Math.round(aS.reduce((s,si)=>s+ps2(D,si,p,yr,mo),0)/aS.length*100);
    const pPrev  = mo>1 ? Math.round(aS.reduce((s,si)=>s+ps2(D,si,p,yr,mo-1),0)/aS.length*100) : 0;
    const pDelta = psc - pPrev;

    // Full-color box
    s2.addShape(pr.shapes.RECTANGLE, { x:pX, y:pBoxY, w:pW, h:pBoxH, fill:{color:pColor}, line:NL, rectRadius:0.04 });

    // Pillar icon (0.25" × 0.25", left-side)
    if (pIcons[j]) addImg(s2, pIcons[j], { x:pX+0.09, y:pBoxY+0.11, w:0.25, h:0.25 });

    // Label + delta text (right of icon)
    const textX = pX + 0.42;
    const textW = pW - 0.49;
    s2.addText(gPS(p)+' ('+Math.round((D.pillarWeights[p]||0)*100)+'%)', {
      x:textX, y:pBoxY+0.02, w:textW, h:0.20,
      fontSize:7, bold:true, color:TW, fontFace:'Calibri', margin:0, valign:'middle', shrinkText:true
    });
    s2.addText((pDelta>=0?'+':'')+pDelta+'pp', {
      x:textX, y:pBoxY+0.22, w:textW, h:0.20,
      fontSize:12, bold:true, color:TW, fontFace:'Calibri', margin:0, valign:'middle'
    });
  });

  // ── "Site-by-Site Summary" heading ────────────────────────────────────────
  // Teal bar x=0.45 y=1.42 w=0.04 h=0.16; text x=0.58 y=1.41 w=4 h=0.18
  s2.addShape(pr.shapes.RECTANGLE, { x:0.45, y:1.42, w:0.04, h:0.16, fill:{color:TE}, line:NL });
  s2.addText('Site-by-Site Summary', {
    x:0.58, y:1.41, w:4.00, h:0.18,
    fontSize:9.5, bold:true, color:TD, fontFace:'Calibri', margin:0, valign:'middle'
  });

  // ── Site cards ─────────────────────────────────────────────────────────────
  // Template (5 sites): startX=0.37, w=1.74, gap=0.14, y=1.65, h=2.55
  // Dynamic: cardW = (9.26 - (n-1)*0.14) / n,  where 9.26 = 10 - 0.37*2
  const numS   = aS.length;
  const cGap   = 0.14;
  const cTotal = 10 - 0.37 * 2;   // 9.26"
  const cW2    = (cTotal - (numS-1)*cGap) / numS;
  const cardY  = 1.65;
  const cardH  = 2.55;

  // Inner x-offsets are from the template (assuming w=1.74)
  // They work relative to the card's left edge
  const IN = 0.10;   // inner left margin

  aS.forEach((s, j) => {
    const sm    = ss(D, s, yr, mo);
    const prev2 = mo>1 ? ss(D, s, yr, mo-1) : null;
    const d2    = prev2 ? Math.round((sm.avg - prev2.avg)*100) : 0;
    const cx    = 0.37 + j*(cW2 + cGap);
    const sc2   = hex(D.siteColors[s] || SITE_PALETTE[j % SITE_PALETTE.length]);

    // Card background (white, thin border)
    s2.addShape(pr.shapes.RECTANGLE, { x:cx, y:cardY, w:cW2, h:cardH, fill:{color:TW}, line:{color:'E2E8F0',pt:0.75}, rectRadius:0.04 });
    // Colored top bar (h=0.055)
    s2.addShape(pr.shapes.RECTANGLE, { x:cx, y:cardY, w:cW2, h:0.055, fill:{color:sc2}, line:NL });

    // Site code (bold, colored)
    s2.addText(s, {
      x:cx+IN, y:cardY+0.10, w:cW2-IN*2, h:0.24,
      fontSize:11, bold:true, color:sc2, fontFace:'Calibri', margin:0
    });
    // Location + activities
    s2.addText((D.siteNames[s]||s)+'  \u2022  '+sm.active+' activities', {
      x:cx+IN, y:cardY+0.33, w:cW2-IN*2, h:0.14,
      fontSize:6, color:TL, fontFace:'Calibri', margin:0
    });

    // Score % (large bold)
    s2.addText(Math.round(sm.avg*100)+'%', {
      x:cx+IN, y:cardY+0.50, w:0.65, h:0.28,
      fontSize:16, bold:true, color:TD, fontFace:'Calibri', margin:0, valign:'middle'
    });
    // Delta badge
    const deltaTxt = (d2>=0?'+':'')+d2+'pp';
    const dBgColor = d2>=0 ? 'DCFCE7' : 'FEE2E2';
    const dTxColor = d2>=0 ? RG : RR;
    s2.addShape(pr.shapes.RECTANGLE, { x:cx+0.78, y:cardY+0.54, w:0.62, h:0.20, fill:{color:dBgColor}, line:NL, rectRadius:0.03 });
    s2.addText(deltaTxt, {
      x:cx+0.78, y:cardY+0.54, w:0.62, h:0.20,
      fontSize:8, bold:true, color:dTxColor, fontFace:'Calibri', align:'center', margin:0, valign:'middle'
    });

    // RAG badges — G / A / R (x offsets match template: +0.10, +0.61, +1.12)
    const badges = [
      { t:sm.g+'G', x:cx+IN,       bg:'DCFCE7', tc:RG  },
      { t:sm.a+'A', x:cx+IN+0.51,  bg:'FEF3C7', tc:RA  },
      { t:sm.r+'R', x:cx+IN+1.02,  bg:'FEE2E2', tc:RR  },
    ];
    badges.forEach(b => {
      s2.addShape(pr.shapes.RECTANGLE, { x:b.x, y:cardY+0.84, w:0.45, h:0.19, fill:{color:b.bg}, line:NL, rectRadius:0.03 });
      s2.addText(b.t, { x:b.x, y:cardY+0.84, w:0.45, h:0.19, fontSize:7.5, bold:true, color:b.tc, fontFace:'Calibri', align:'center', margin:0, valign:'middle' });
    });

    // Thin separator line at y=cardY+1.12 (template y=2.77 = cardY+1.12)
    s2.addShape(pr.shapes.RECTANGLE, { x:cx+IN, y:cardY+1.12, w:cW2-IN*2, h:0.01, fill:{color:'E2E8F0'}, line:NL });

    // Green commentary (icon + text)
    const coms = siteCommentary(D, s, yr, mo);
    const iconY1 = cardY + 1.18;
    const iconY2 = cardY + 1.90;

    addImg(s2, im.green, { x:cx+IN, y:iconY1, w:0.13, h:0.13 });
    s2.addText(coms[0], {
      x:cx+IN+0.16, y:iconY1, w:cW2-IN-0.20, h:0.57,
      fontSize:6.5, color:'334155', fontFace:'Calibri', margin:0, shrinkText:true, valign:'top'
    });

    // Amber commentary (icon + text)
    addImg(s2, im.amber, { x:cx+IN, y:iconY2, w:0.13, h:0.13 });
    s2.addText(coms[1], {
      x:cx+IN+0.16, y:iconY2, w:cW2-IN-0.20, h:0.46,
      fontSize:6.5, color:RA, fontFace:'Calibri', margin:0, italic:true, shrinkText:true, valign:'top'
    });
  });

  // ── General Review section ─────────────────────────────────────────────────
  // Template: teal bar y=4.30 h=0.04; heading y=4.35; bullets y=4.56,4.75,4.94,5.13
  s2.addShape(pr.shapes.RECTANGLE, { x:0.45, y:4.30, w:9.10, h:0.04, fill:{color:TE}, line:NL });
  s2.addText('General Review', {
    x:0.55, y:4.35, w:3.00, h:0.18,
    fontSize:9, bold:true, color:TD, fontFace:'Calibri', margin:0, valign:'middle'
  });

  const gBullets = generalReview(D, aS, yr, mo);
  const grBulletYs = [4.56, 4.75, 4.94, 5.13];

  gBullets.forEach((b, j) => {
    const bY    = grBulletYs[j] || (4.56 + j*0.19);
    const bIcon = b.ok ? im.green : (im.amber2 || im.amber);
    const bClr  = b.ok ? '334155' : RA;

    addImg(s2, bIcon, { x:0.55, y:bY+0.03, w:0.11, h:0.11 });
    s2.addText(b.text, {
      x:0.74, y:bY, w:8.60, h:0.17,
      fontSize:7.5, color:bClr, fontFace:'Calibri', margin:0, valign:'middle', shrinkText:true
    });
  });

  // Footer: plain italic gray text at very bottom (y=5.38) — NO black bar
  s2.addText(
    'Source: IT Ops Objectives Tracker \u2014 '+MO[mo-1]+' vs '+(mo>1?MO[mo-2]:'N/A')+' '+yr+'  |  Endeavour Mining PLC',
    { x:0.40, y:5.38, w:9.00, h:0.16, fontSize:7, color:TL, italic:true, fontFace:'Calibri', margin:0, valign:'middle' }
  );

  // ── Write + PowerPoint compatibility fix ──────────────────────────────────
  const rawBuf = await pr.write({ outputType: 'nodebuffer' });
  return fixComboChartAxes(rawBuf);
}

// ── addTrackerSlidesTo() — append the same 2 tracker slides to an EXISTING
//                          pres without creating a new one.
// Used by executive-new-report.js so the Executive New Report deck includes
// the IT Activity Tracker slides as its last two slides, matching the Export
// PPTX flow. Internally we render into a temporary pres at LAYOUT_16x9 and
// then transplant the two slide objects via the pres internals so the slides
// inherit the OUTER pres's layout (e.g. LAYOUT_WIDE 13.33x7.5). This is
// cleaner than parameterising every coord in the render code and avoids the
// scaling complexity for the user's current need.
async function addTrackerSlidesTo(targetPres, D, selectedSites, yr, mo) {
  // Render into an isolated pres with the standard LAYOUT_16x9 design.
  // generateTrackerPptx already does exactly that — but we need its
  // internal slide objects, not the serialised buffer. The cleanest way
  // without rewriting all 300 lines of slide code is to call it for its
  // side-effect, then copy slides[0..1] across.
  // (PptxGenJS lets us read pres._slides — internal API but stable since 3.x)
  const tmp = new PptxGenJS();
  tmp.layout  = 'LAYOUT_16x9';
  tmp.author  = 'IT Operations';
  tmp.title   = 'IT Ops Strategy Slides';
  // Inline-call the same code path generateTrackerPptx uses, but on `tmp`.
  // We can't reuse generateTrackerPptx directly (it creates its own pres),
  // so the simplest reuse is to just call it and then merge buffers.
  // Approach: append two slides to targetPres by copying shape/text data.
  // Since pptxgenjs slide objects don't have a public clone API, we
  // instead RENDER a minimal version directly onto targetPres using the
  // exact same helper functions we already have in this module.
  // ---
  // Render slide 1 of tracker on targetPres:
  await _renderTrackerSlideOne(targetPres, D, selectedSites, yr, mo);
  await _renderTrackerSlideTwo(targetPres, D, selectedSites, yr, mo);
}

// Internal — the same slide-1 rendering as generateTrackerPptx, factored for
// reuse by both the standalone export and the embedded-in-exec-report case.
function _renderTrackerSlideOne(pr, D, selectedSites, yr, mo) {
  const aS = selectedSites.filter(s => D.activeSites.includes(s));
  if (!aS.length) return;
  const P      = gP(D);
  const f      = fleetStats(D, aS, yr, mo);
  const prevF  = mo>1 ? fleetStats(D, aS, yr, mo-1) : null;
  const bestSt = aS.reduce((a,b)=>ss(D,a,yr,mo).avg>=ss(D,b,yr,mo).avg?a:b);
  const bestDelta = prevF ? Math.round((ss(D,bestSt,yr,mo).avg-ss(D,bestSt,yr,mo-1).avg)*100) : 0;
  const BG='1E293B', TW='FFFFFF', TL='94A3B8', TD='1E293B';
  const RG='16A34A', RA='D97706', RR='DC2626', TE='0D9488', SL='475569';
  const im = imgs();
  let tG=0,tA=0,tR=0,tAct=0;
  aS.forEach(s=>{ const sm=ss(D,s,yr,mo); tG+=sm.g; tA+=sm.a; tR+=sm.r; tAct+=sm.active; });
  const NL = { pt:0, color:TW };
  const s1 = pr.addSlide();
  s1.background = { fill: 'F1F5F9' };
  s1.addShape(pr.shapes.RECTANGLE, { x:0, y:0,    w:10, h:1.30, fill:{color:BG}, line:NL });
  s1.addShape(pr.shapes.RECTANGLE, { x:0, y:1.22, w:10, h:0.08, fill:{color:TE}, line:NL });
  addImg(s1, im.logo, { x:0.50, y:0.22, w:0.42, h:0.42 });
  s1.addText('IT Ops Strategy Roadmap',
    { x:1.10, y:0.12, w:7.00, h:0.48, fontSize:20, fontFace:'Calibri', color:TW, bold:true, margin:0, valign:'middle' });
  s1.addText(MO[mo-1]+' '+yr+'  •  Progress Overview  •  '+aS.length+' Operating Sites  •  '+tAct+' Activities',
    { x:1.10, y:0.62, w:7.00, h:0.28, fontSize:8, color:TL, fontFace:'Calibri', margin:0, valign:'middle' });
  s1.addShape(pr.shapes.RECTANGLE, { x:8.50, y:0.25, w:1.10, h:0.58, fill:{color:TE}, line:NL, rectRadius:0.04 });
  s1.addText(MO[mo-1].toUpperCase(), { x:8.50, y:0.27, w:1.10, h:0.32, fontSize:14, fontFace:'Calibri', color:TW, bold:true, align:'center', margin:0, valign:'middle' });
  s1.addText(String(yr), { x:8.50, y:0.57, w:1.10, h:0.22, fontSize:9, color:'CCFBF1', align:'center', margin:0, valign:'middle' });
  const kpis = [
    { v:tG, l:'GREEN', c:RG, bg:'DCFCE7', acc:RG },
    { v:tA, l:'AMBER', c:RA, bg:'FEF3C7', acc:RA },
    { v:tR, l:'RED',   c:RR, bg:'FEE2E2', acc:RR },
    { v:Math.round(f.avg*100)+'%', l:'AVG SCORE', c:TE, bg:'CCFBF1', acc:TE },
    { v:(bestDelta>=0?'+':'')+bestDelta+'pp', l:'BEST Δ ('+bestSt+')', c:'0EA5E9', bg:'E0F2FE', acc:'0EA5E9' },
  ];
  const kpiXs = [0.475, 2.325, 4.175, 6.025, 7.875];
  const kpiW = 1.65, kpiY = 1.52, kpiH = 0.80;
  kpis.forEach((k,j)=>{
    const tx = kpiXs[j];
    s1.addShape(pr.shapes.RECTANGLE, { x:tx, y:kpiY, w:kpiW, h:kpiH, fill:{color:k.bg}, line:{color:'E2E8F0',pt:0.5}, rectRadius:0.04 });
    s1.addShape(pr.shapes.RECTANGLE, { x:tx, y:kpiY, w:kpiW, h:0.05, fill:{color:k.acc}, line:NL, rectRadius:0 });
    s1.addText(String(k.v), { x:tx+0.10, y:kpiY+0.06, w:kpiW-0.20, h:0.42, fontSize:24, bold:true, color:k.c, fontFace:'Calibri', margin:0, valign:'middle' });
    s1.addText(k.l, { x:tx+0.10, y:kpiY+0.52, w:kpiW-0.20, h:0.22, fontSize:7.5, bold:true, color:SL, fontFace:'Calibri', margin:0, valign:'middle' });
  });
  const cY=2.55, cH=2.70, cW=4.50;
  const c1X=0.40, c2X=5.10;
  s1.addShape(pr.shapes.RECTANGLE, { x:c1X, y:cY, w:cW, h:cH, fill:{color:TW}, line:{color:'E2E8F0',pt:0.75}, rectRadius:0.05 });
  s1.addShape(pr.shapes.RECTANGLE, { x:c2X, y:cY, w:cW, h:cH, fill:{color:TW}, line:{color:'E2E8F0',pt:0.75}, rectRadius:0.05 });
  s1.addText('Site Performance (%)',     { x:c1X+0.18, y:cY+0.10, w:cW-0.28, h:0.26, fontSize:9.5, bold:true, color:TD, fontFace:'Calibri', margin:0 });
  s1.addText('RAG Distribution by Pillar',{ x:c2X+0.18, y:cY+0.10, w:cW-0.28, h:0.26, fontSize:9.5, bold:true, color:TD, fontFace:'Calibri', margin:0 });
  const siteLabels = aS.slice();
  const siteVals   = aS.map(s2 => Math.round(ss(D,s2,yr,mo).avg*100));
  const siteClrs   = aS.map(s2 => hex(D.siteColors[s2]));
  s1.addChart(pr.charts.BAR,
    [{ name:'Score %', labels:siteLabels, values:siteVals }],
    { x:c1X+0.15, y:cY+0.42, w:cW-0.25, h:cH-0.55, showValue:true, valueFontSize:9, catAxisLabelFontSize:8, valAxisMaxVal:100, chartColors:siteClrs, showLegend:false, valAxisLabelFontSize:7, barGapWidthPct:55, valGridLine:{color:'F1F5F9'} });
  const pLabels = P.map(p=>gPS(p).substring(0,14));
  const pG2=[],pA2=[],pR2=[];
  P.forEach(p=>{
    let g=0,a=0,r=0;
    aS.forEach(s2=>{ score(D,s2,yr,mo).forEach(sc2=>{ if(sc2.pillar===p&&sc2.on){ if(sc2.rg==='GREEN')g++; else if(sc2.rg==='AMBER')a++; else if(sc2.rg==='RED')r++; } }); });
    pG2.push(g); pA2.push(a); pR2.push(r);
  });
  s1.addChart(pr.charts.BAR,
    [{ name:'Green',labels:pLabels,values:pG2 },{ name:'Amber',labels:pLabels,values:pA2 },{ name:'Red',labels:pLabels,values:pR2 }],
    { x:c2X+0.15, y:cY+0.42, w:cW-0.25, h:cH-0.55, barGrouping:'stacked', chartColors:[RG,RA,RR], showLegend:true, legendPos:'b', legendFontSize:7, catAxisLabelFontSize:7, valAxisLabelFontSize:7, showValue:false, valGridLine:{color:'F1F5F9'} });
  s1.addText('Source: IT Ops Objectives Tracker — '+MO[mo-1]+' vs '+(mo>1?MO[mo-2]:'N/A')+' '+yr+'  |  Endeavour Mining PLC',
    { x:0.40, y:5.35, w:9.00, h:0.20, fontSize:7, color:TL, italic:true, fontFace:'Calibri', margin:0, valign:'middle' });
}

function _renderTrackerSlideTwo(pr, D, selectedSites, yr, mo) {
  const aS = selectedSites.filter(s => D.activeSites.includes(s));
  if (!aS.length) return;
  const P  = gP(D);
  const BG='1E293B', TW='FFFFFF', TL='94A3B8', TD='1E293B';
  const RG='16A34A', RA='D97706', RR='DC2626', TE='0D9488';
  const NL = { pt:0, color:TW };
  const im = imgs();
  const s2 = pr.addSlide();
  s2.background = { fill: 'F8FAFC' };
  s2.addShape(pr.shapes.RECTANGLE, { x:0, y:0,    w:10, h:0.72, fill:{color:BG}, line:NL });
  s2.addShape(pr.shapes.RECTANGLE, { x:0, y:0.65, w:10, h:0.07, fill:{color:TE}, line:NL });
  s2.addText('Executive Commentary & Site Summaries',
    { x:0.50, y:0.12, w:9.00, h:0.42, fontSize:16, fontFace:'Calibri', color:TW, bold:true, margin:0, valign:'middle' });
  const numP=P.length, pGap=0.14;
  const pTotal = 10 - 0.43*2;
  const pW = (pTotal - (numP-1)*pGap)/numP;
  const pBoxY=0.84, pBoxH=0.46;
  const pIcons=[im.p1,im.p2,im.p3,im.p4];
  P.forEach((p,j)=>{
    const pX = 0.43 + j*(pW+pGap);
    const pColor = pillarColor(j);
    const psc   = Math.round(aS.reduce((s,si)=>s+ps2(D,si,p,yr,mo),0)/aS.length*100);
    const pPrev = mo>1 ? Math.round(aS.reduce((s,si)=>s+ps2(D,si,p,yr,mo-1),0)/aS.length*100) : 0;
    const pDelta = psc - pPrev;
    s2.addShape(pr.shapes.RECTANGLE, { x:pX, y:pBoxY, w:pW, h:pBoxH, fill:{color:pColor}, line:NL, rectRadius:0.04 });
    if (pIcons[j]) addImg(s2, pIcons[j], { x:pX+0.09, y:pBoxY+0.11, w:0.25, h:0.25 });
    const textX = pX + 0.42;
    const textW = pW - 0.49;
    s2.addText(gPS(p)+' ('+Math.round((D.pillarWeights[p]||0)*100)+'%)',
      { x:textX, y:pBoxY+0.02, w:textW, h:0.20, fontSize:7, bold:true, color:TW, fontFace:'Calibri', margin:0, valign:'middle', shrinkText:true });
    s2.addText((pDelta>=0?'+':'')+pDelta+'pp',
      { x:textX, y:pBoxY+0.22, w:textW, h:0.20, fontSize:12, bold:true, color:TW, fontFace:'Calibri', margin:0, valign:'middle' });
  });
  s2.addShape(pr.shapes.RECTANGLE, { x:0.45, y:1.42, w:0.04, h:0.16, fill:{color:TE}, line:NL });
  s2.addText('Site-by-Site Summary', { x:0.58, y:1.41, w:4.00, h:0.18, fontSize:9.5, bold:true, color:TD, fontFace:'Calibri', margin:0, valign:'middle' });
  const numS=aS.length, cGap=0.14;
  const cTotal = 10 - 0.37*2;
  const cW2 = (cTotal - (numS-1)*cGap)/numS;
  const cardY=1.65, cardH=2.55;
  const IN = 0.10;
  aS.forEach((s,j)=>{
    const sm = ss(D,s,yr,mo);
    const prev2 = mo>1 ? ss(D,s,yr,mo-1) : null;
    const d2 = prev2 ? Math.round((sm.avg - prev2.avg)*100) : 0;
    const cx = 0.37 + j*(cW2+cGap);
    const sc2 = hex(D.siteColors[s] || SITE_PALETTE[j % SITE_PALETTE.length]);
    s2.addShape(pr.shapes.RECTANGLE, { x:cx, y:cardY, w:cW2, h:cardH, fill:{color:TW}, line:{color:'E2E8F0',pt:0.75}, rectRadius:0.04 });
    s2.addShape(pr.shapes.RECTANGLE, { x:cx, y:cardY, w:cW2, h:0.055, fill:{color:sc2}, line:NL });
    s2.addText(s, { x:cx+IN, y:cardY+0.10, w:cW2-IN*2, h:0.24, fontSize:11, bold:true, color:sc2, fontFace:'Calibri', margin:0 });
    s2.addText((D.siteNames[s]||s)+'  •  '+sm.active+' activities', { x:cx+IN, y:cardY+0.33, w:cW2-IN*2, h:0.14, fontSize:6, color:TL, fontFace:'Calibri', margin:0 });
    s2.addText(Math.round(sm.avg*100)+'%', { x:cx+IN, y:cardY+0.50, w:0.65, h:0.28, fontSize:16, bold:true, color:TD, fontFace:'Calibri', margin:0, valign:'middle' });
    const deltaTxt = (d2>=0?'+':'')+d2+'pp';
    const dBgColor = d2>=0 ? 'DCFCE7' : 'FEE2E2';
    const dTxColor = d2>=0 ? RG : RR;
    s2.addShape(pr.shapes.RECTANGLE, { x:cx+0.78, y:cardY+0.54, w:0.62, h:0.20, fill:{color:dBgColor}, line:NL, rectRadius:0.03 });
    s2.addText(deltaTxt, { x:cx+0.78, y:cardY+0.54, w:0.62, h:0.20, fontSize:8, bold:true, color:dTxColor, fontFace:'Calibri', align:'center', margin:0, valign:'middle' });
    const badges = [
      { t:sm.g+'G', x:cx+IN,       bg:'DCFCE7', tc:RG },
      { t:sm.a+'A', x:cx+IN+0.51,  bg:'FEF3C7', tc:RA },
      { t:sm.r+'R', x:cx+IN+1.02,  bg:'FEE2E2', tc:RR },
    ];
    badges.forEach(b=>{
      s2.addShape(pr.shapes.RECTANGLE, { x:b.x, y:cardY+0.84, w:0.45, h:0.19, fill:{color:b.bg}, line:NL, rectRadius:0.03 });
      s2.addText(b.t, { x:b.x, y:cardY+0.84, w:0.45, h:0.19, fontSize:7.5, bold:true, color:b.tc, fontFace:'Calibri', align:'center', margin:0, valign:'middle' });
    });
    s2.addShape(pr.shapes.RECTANGLE, { x:cx+IN, y:cardY+1.12, w:cW2-IN*2, h:0.01, fill:{color:'E2E8F0'}, line:NL });
    const coms = siteCommentary(D, s, yr, mo);
    const iconY1 = cardY+1.18;
    const iconY2 = cardY+1.90;
    addImg(s2, im.green, { x:cx+IN, y:iconY1, w:0.13, h:0.13 });
    s2.addText(coms[0], { x:cx+IN+0.16, y:iconY1, w:cW2-IN-0.20, h:0.57, fontSize:6.5, color:'334155', fontFace:'Calibri', margin:0, shrinkText:true, valign:'top' });
    addImg(s2, im.amber, { x:cx+IN, y:iconY2, w:0.13, h:0.13 });
    s2.addText(coms[1], { x:cx+IN+0.16, y:iconY2, w:cW2-IN-0.20, h:0.46, fontSize:6.5, color:RA, fontFace:'Calibri', margin:0, italic:true, shrinkText:true, valign:'top' });
  });
  s2.addShape(pr.shapes.RECTANGLE, { x:0.45, y:4.30, w:9.10, h:0.04, fill:{color:TE}, line:NL });
  s2.addText('General Review', { x:0.55, y:4.35, w:3.00, h:0.18, fontSize:9, bold:true, color:TD, fontFace:'Calibri', margin:0, valign:'middle' });
  const gBullets = generalReview(D, aS, yr, mo);
  const grBulletYs = [4.56, 4.75, 4.94, 5.13];
  gBullets.forEach((b,j)=>{
    const bY = grBulletYs[j] || (4.56 + j*0.19);
    const bIcon = b.ok ? im.green : (im.amber2 || im.amber);
    const bClr = b.ok ? '334155' : RA;
    addImg(s2, bIcon, { x:0.55, y:bY+0.03, w:0.11, h:0.11 });
    s2.addText(b.text, { x:0.74, y:bY, w:8.60, h:0.17, fontSize:7.5, color:bClr, fontFace:'Calibri', margin:0, valign:'middle', shrinkText:true });
  });
  s2.addText('Source: IT Ops Objectives Tracker — '+MO[mo-1]+' vs '+(mo>1?MO[mo-2]:'N/A')+' '+yr+'  |  Endeavour Mining PLC',
    { x:0.40, y:5.38, w:9.00, h:0.16, fontSize:7, color:TL, italic:true, fontFace:'Calibri', margin:0, valign:'middle' });
}

module.exports = { generateTrackerPptx, addTrackerSlidesTo, fleetStats, ps2, ss, score };
