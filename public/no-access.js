/* "No access" page (UAT F-13): a role gate used to send the user back to the home page without a word.
 * It now lands here, with the page asked for, the role it needs, the roles held and who can grant it.
 * Only names travel in the query string (page file name and role codes) — never anything secret. */
(function () {
  'use strict';
  const LABELS = {
    super_admin: ['Super administrator', 'Super administrateur'], executive: ['Executive', 'Direction'],
    admin: ['Administrator', 'Administrateur'], editor: ['Site editor', 'Éditeur de site'], viewer: ['Viewer', 'Lecteur'],
    'tracker-admin': ['Tracker administrator', 'Administrateur du tracker'], 'tracker-editor': ['Tracker editor', 'Éditeur du tracker'],
    'report-author': ['Report author', 'Auteur de rapports'], 'audit-viewer': ['Audit reader', 'Lecteur du journal d’audit'],
    'scorecard-viewer': ['Scorecard reader', 'Lecteur du tableau de bord'], 'finance-viewer': ['Finance reader', 'Lecteur finance'],
    'site-business': ['Site business view', 'Vue métier du site'], 'group-business': ['Group business view', 'Vue métier groupe'],
  };
  const DICT = {
    'You do not have access to this page': 'Vous n’avez pas accès à cette page',
    'Your account is signed in, but this page needs a role it does not hold.': 'Votre compte est connecté, mais cette page demande un rôle qu’il n’a pas.',
    'Page': 'Page', 'Needed': 'Rôle requis', 'Your roles': 'Vos rôles',
    'Who can give you access': 'Qui peut vous donner l’accès',
    'A dashboard administrator (Admin ▸ Users). For a site page, your site IT coordinator can ask for it on your behalf. Copy the line below into your request.':
      'Un administrateur du tableau de bord (Admin ▸ Utilisateurs). Pour une page de site, votre coordinateur IT de site peut la demander pour vous. Copiez la ligne ci-dessous dans votre demande.',
    'Copy': 'Copier', 'Copied': 'Copié', 'Back to my home page': 'Retour à ma page d’accueil', 'none': 'aucun', 'or': 'ou',
  };
  const clean = (s, max) => String(s || '').replace(/[^\w.\-|]/g, '').slice(0, max);
  const q = new URLSearchParams(location.search);
  const page = clean(q.get('page'), 80) || '—';
  const need = clean(q.get('need'), 120).split('|').filter(Boolean);
  const user = window.__authUser || {};
  const have = (Array.isArray(user.roles) && user.roles.length ? user.roles : (user.role ? [user.role] : [])).map((r) => clean(r, 40));
  const fr = () => window.I18nText && window.I18nText.lang() === 'fr';
  const label = (r) => (LABELS[r] ? LABELS[r][fr() ? 1 : 0] : r);
  const $ = (id) => document.getElementById(id);
  function render() {
    const t = (s) => (window.I18nText ? window.I18nText.t(s) : s);
    $('naPage').textContent = page;
    $('naNeed').textContent = need.length ? need.map(label).join(' ' + t('or') + ' ') : '—';
    $('naHave').textContent = have.length ? have.map(label).join(', ') : t('none');
    $('naLine').textContent = (fr() ? 'Demande d’accès — ' : 'Access request — ') + (user.username || '?') + ' · ' + page + ' · ' + (need.join(' | ') || '?');
  }
  if (window.I18nText) {
    window.I18nText.install({ dict: DICT, storageKey: 'ui_lang', toggle: { en: $('naEn'), fr: $('naFr') }, root: document.body });
    window.I18nText.onChange(render);
  }
  render();
  $('naCopyBtn').addEventListener('click', () => {
    const txt = $('naLine').textContent;
    const done = () => { $('naCopyBtn').textContent = window.I18nText ? window.I18nText.t('Copied') : 'Copied'; };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => {}); else done();
  });
})();
