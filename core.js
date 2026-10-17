/* VoteBox core: Supabase connection, small helpers and pieces shared by every page. */
(function () {
  'use strict';

  const cfg = window.VOTEBOX_CONFIG || {};
  const VB = (window.VB = { acts: {}, forms: {}, inputs: {}, state: {}, pollTimer: null });

  const keysOk =
    !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) &&
    !/PASTE/i.test(String(cfg.SUPABASE_URL) + String(cfg.SUPABASE_ANON_KEY));
  VB.libLoaded = !!window.supabase;
  VB.keysOk = keysOk;
  VB.configured = keysOk && VB.libLoaded;
  VB.version = '2026-10-17-c';
  VB.sb = VB.configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  /* ---------- small helpers ---------- */

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  VB.esc = esc;

  VB.must = function (res) {
    if (res && res.error) throw new Error(res.error.message || 'Something went wrong.');
    return res ? res.data : null;
  };

  VB.pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);
  VB.date = (s) => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  VB.voterLink = (slug) => location.origin + location.pathname + '#/e/' + slug;

  VB.toast = function (msg, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'show' + (kind === 'err' ? ' err' : '');
    clearTimeout(VB._toastTimer);
    VB._toastTimer = setTimeout(() => (t.className = ''), kind === 'err' ? 5000 : 2600);
  };

  VB.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      VB.toast('Copied');
    } catch (e) {
      window.prompt('Copy this:', text);
    }
  };

  VB.download = function (filename, rows) {
    const csv = rows.map((r) => r.map((x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /* ---------- art ---------- */

  const LOGO =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#C8102E"/>' +
    '<g transform="rotate(-8 32 24)"><rect x="22" y="9" width="20" height="28" rx="2.5" fill="#fff"/>' +
    '<path d="M26.5 21.5 30.5 25.5 38 16.5" fill="none" stroke="#C8102E" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="25" y="30" width="14" height="2" rx="1" fill="#F2C9D0"/></g>' +
    '<rect x="12" y="35" width="40" height="19" rx="3.5" fill="#FFFFFF"/><rect x="20" y="38.5" width="24" height="3.4" rx="1.7" fill="#C8102E"/>' +
    '<rect x="12" y="47" width="40" height="3" fill="#8E0B21"/></svg>';
  VB.LOGO = LOGO;

  const AVATAR =
    '<svg viewBox="0 0 60 80" aria-hidden="true"><circle cx="30" cy="28" r="13" fill="currentColor"/>' +
    '<path d="M4 80C4 56 16 48 30 48S56 56 56 80Z" fill="currentColor"/></svg>';

  VB.photo = function (path, name) {
    if (!path || !VB.sb) return AVATAR;
    const url = VB.sb.storage.from('candidate-photos').getPublicUrl(path).data.publicUrl;
    return '<img src="' + esc(url) + '" alt="' + esc(name || '') + '" loading="lazy">';
  };

  const LABELS = {
    setup: 'Not open yet', open: 'Voting open', closed: 'Voting closed',
    pending: 'Pending', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended',
    voted: 'Voted', locked: 'Locked',
  };
  VB.pill = (status) => '<span class="pill ' + esc(status) + '">' + esc(LABELS[status] || status) + '</span>';

  /* ---------- rendering ---------- */

  VB.render = function (html, keepScroll) {
    const y = window.scrollY;
    document.getElementById('app').innerHTML = html;
    window.scrollTo(0, keepScroll ? y : 0);
  };

  VB.shell = function (inner, profile) {
    let nav = '';
    if (profile) {
      nav =
        '<nav class="nav" aria-label="Main"><a href="#/admin">My elections</a>' +
        (profile.role === 'owner' ? '<a href="#/owner">Owner</a>' : '') +
        '<button class="link" data-act="logout">Log out</button></nav>';
    }
    return (
      '<header class="top"><a class="brand" href="#/">' + LOGO + '<span>VoteBox</span></a>' + nav + '</header>' +
      '<main class="wrap">' + inner + '</main>' +
      '<p class="foot">VoteBox &middot; version ' + VB.version + '</p>'
    );
  };

  VB.viewMessage = function (title, textHtml, actionsHtml, profile) {
    VB.render(
      VB.shell(
        '<div class="card"><h2>' + esc(title) + '</h2><p>' + textHtml + '</p>' +
          (actionsHtml ? '<div class="actions">' + actionsHtml + '</div>' : '') + '</div>',
        profile
      )
    );
  };

  /* ---------- back buttons ---------- */

  VB.backLink = (href, label) => '<a class="backbtn" href="' + esc(href) + '">&larr; ' + esc(label || 'Back') + '</a>';
  VB.backAct = (act, attrs, label) =>
    '<button type="button" class="backbtn" data-act="' + act + '" ' + (attrs || '') + '>&larr; ' + esc(label || 'Back') + '</button>';

  /* ---------- modal ---------- */

  VB.closeModal = function () {
    const m = document.getElementById('modal');
    if (m) m.remove();
  };
  VB.modal = function (html) {
    VB.closeModal();
    const d = document.createElement('div');
    d.id = 'modal';
    d.className = 'overlay';
    d.innerHTML = '<div class="dialog" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(d);
    const f = d.querySelector('input:not([type=hidden]),button');
    if (f) f.focus();
  };
  VB.acts.closeModal = () => VB.closeModal();

  VB.confirmModal = function (title, textHtml, yesLabel, fn, danger) {
    VB._yes = fn;
    VB.modal(
      '<h3>' + esc(title) + '</h3><p>' + textHtml + '</p><div class="actions">' +
        '<button class="btn ' + (danger ? 'danger' : '') + '" data-act="confirmYes">' + esc(yesLabel) + '</button>' +
        '<button class="btn secondary" data-act="closeModal">Cancel</button></div>'
    );
  };
  VB.acts.confirmYes = async function () {
    const fn = VB._yes;
    VB._yes = null;
    VB.closeModal();
    if (fn) await fn();
  };

  /* ---------- polling (live results) ---------- */

  VB.stopPoll = function () {
    clearInterval(VB.pollTimer);
    VB.pollTimer = null;
  };
  VB.startPoll = function (fn, ms) {
    VB.stopPoll();
    VB.pollTimer = setInterval(function () {
      if (!document.hidden) Promise.resolve(fn()).catch(function () {});
    }, ms || 4000);
  };

  /* ---------- photos: crop to a 3:4 passport shape and shrink ---------- */

  VB.resizeImage = function (file, w, h) {
    w = w || 450;
    h = h || 600;
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const scale = Math.max(w / img.width, h / img.height);
        const sw = w / scale;
        const sh = h / scale;
        const sx = (img.width - sw) / 2;
        const sy = (img.height - sh) * 0.25; // lean towards the top so faces stay in
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not process the photo.')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file is not a picture. Choose a JPG or PNG photo.'));
      };
      img.src = url;
    });
  };

  /* ---------- results (shared by the admin and the public page) ---------- */

  VB.resultsHtml = function (r, closed) {
    const t = r.turnout || { voted: 0, approved: 0 };
    const row = function (labelHtml, n, total, lead, red, photoHtml) {
      const p = VB.pct(n, total);
      return (
        '<div class="rr">' + (photoHtml ? '<div class="thumb sm">' + photoHtml + '</div>' : '') +
        '<div class="rbody"><div class="rt"><span>' + labelHtml + '</span><span>' + n + ' &middot; ' + p + '%</span></div>' +
        '<div class="tr"><div class="fl' + (lead ? ' lead' : '') + (red ? ' red' : '') + '" style="width:' + p + '%"></div></div></div></div>'
      );
    };

    let h =
      '<div class="stats"><div><b>' + t.voted + '</b><small>Voted</small></div>' +
      '<div><b>' + t.approved + '</b><small>Approved voters</small></div>' +
      '<div><b>' + VB.pct(t.voted, t.approved) + '%</b><small>Turnout</small></div></div>';

    (r.positions || []).forEach(function (p) {
      h += '<div class="card"><h3>' + esc(p.name) + '</h3>';
      const cands = p.candidates || [];
      if (p.mode === 'yes_no') {
        const c = cands[0] || { name: '', votes: 0, photo_path: null };
        const yes = c.votes;
        const no = p.no_votes;
        const total = yes + no;
        let verdict = '';
        if (closed && total > 0) verdict = yes > no ? 'Approved' : yes < no ? 'Not approved' : 'Tie';
        h +=
          '<div class="cand"><div class="thumb">' + VB.photo(c.photo_path, c.name) + '</div><span><b>' + esc(c.name) + '</b>' +
          (verdict ? ' <span class="verdict' + (yes > no ? ' win' : '') + '">' + verdict + '</span>' : '') + '</span></div>';
        h += row('YES', yes, total, yes > no, false);
        h += row('NO', no, total, false, true);
      } else {
        const total = cands.reduce(function (s, c) { return s + c.votes; }, 0);
        const top = Math.max.apply(null, [0].concat(cands.map(function (c) { return c.votes; })));
        const leaders = cands.filter(function (c) { return c.votes === top && top > 0; });
        cands.forEach(function (c) {
          const lead = leaders.indexOf(c) !== -1;
          const tag = closed && lead
            ? leaders.length === 1 ? ' <span class="verdict win">Winner</span>' : ' <span class="verdict">Tie</span>'
            : '';
          h += row(esc(c.name) + tag, c.votes, total, lead, false, VB.photo(c.photo_path, c.name));
        });
        h += '<p class="muted small">Abstained: ' + p.abstained + '</p>';
      }
      h += '</div>';
    });
    return h;
  };

  VB.resultsCsv = function (r) {
    const rows = [['Position', 'Option', 'Votes', 'Percent']];
    (r.positions || []).forEach(function (p) {
      const cands = p.candidates || [];
      if (p.mode === 'yes_no') {
        const yes = cands[0] ? cands[0].votes : 0;
        const total = yes + p.no_votes;
        rows.push([p.name, 'YES (' + (cands[0] ? cands[0].name : '') + ')', yes, VB.pct(yes, total) + '%']);
        rows.push([p.name, 'NO', p.no_votes, VB.pct(p.no_votes, total) + '%']);
      } else {
        const total = cands.reduce(function (s, c) { return s + c.votes; }, 0);
        cands.forEach(function (c) { rows.push([p.name, c.name, c.votes, VB.pct(c.votes, total) + '%']); });
        rows.push([p.name, 'Abstained', p.abstained, '']);
      }
    });
    rows.push([]);
    rows.push(['Turnout', r.turnout.voted + ' of ' + r.turnout.approved + ' approved voters', '', VB.pct(r.turnout.voted, r.turnout.approved) + '%']);
    return rows;
  };
})();
