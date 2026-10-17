/* VoteBox: part-time admin pages (elections, candidates, voters, live results). */
(function () {
  'use strict';
  const VB = window.VB;
  const esc = VB.esc;
  const sb = () => VB.sb;

  // what the admin page is currently showing
  const A = (VB.adm = { id: null, tab: 'setup', el: null, adminId: null, voters: [], filter: 'pending', q: '', lastRes: null });

  /* =====================================================================
     My elections
     ===================================================================== */

  VB.viewAdminHome = async function () {
    const prof = await VB.requireUser();
    if (!prof) return;
    const els = VB.must(
      await sb().from('elections').select('id,title,organization,slug,status,created_at').order('created_at', { ascending: false })
    ) || [];

    let h = '<h1>My elections</h1>';
    h +=
      '<div class="card"><h2>New election</h2><form data-form="newElection" class="stack">' +
      '<label>Election name<input name="title" required minlength="3" maxlength="120" placeholder="e.g. SRC Elections 2026"></label>' +
      '<label>School, department or church<input name="organization" maxlength="120" value="' + esc(prof.organization) + '"></label>' +
      '<button class="btn" type="submit">Create election</button></form></div>';
    if (!els.length) h += '<p class="muted">You have not created any elections yet.</p>';
    els.forEach(function (e) {
      h +=
        '<a class="card" href="#/admin/election/' + e.id + '"><div class="split"><div><b>' + esc(e.title) + '</b>' +
        '<small>' + esc(e.organization) + ' &middot; ' + VB.date(e.created_at) + '</small></div>' + VB.pill(e.status) + '</div></a>';
    });
    VB.render(VB.shell(h, prof));
  };

  VB.forms.newElection = async function (f, fd) {
    const row = VB.must(
      await sb()
        .from('elections')
        .insert({ admin_id: VB.state.profile.id, title: String(fd.get('title')).trim(), organization: String(fd.get('organization') || '').trim() })
        .select('id')
        .single()
    );
    location.hash = '#/admin/election/' + row.id;
  };

  /* =====================================================================
     One election
     ===================================================================== */

  VB.viewAdminElection = async function (id, tab, keep) {
    const prof = await VB.requireUser();
    if (!prof) return;
    tab = ['setup', 'voters', 'results'].indexOf(tab) !== -1 ? tab : 'setup';

    const el = VB.must(
      await sb().from('elections').select('id,title,organization,slug,status,public_results,admin_id').eq('id', id).maybeSingle()
    );
    if (!el) {
      VB.viewMessage('Election not found', 'This election does not exist, or it belongs to another admin.', '<a class="btn" href="#/admin">Back to my elections</a>', prof);
      return;
    }
    A.id = id;
    A.tab = tab;
    A.el = el;
    A.adminId = prof.id;

    let body = '';
    if (tab === 'setup') {
      const positions = VB.must(
        await sb().from('positions').select('id,name,sort_order,candidates(id,name,photo_path,sort_order)').eq('election_id', id).order('sort_order')
      ) || [];
      body = setupTab(el, positions);
    } else if (tab === 'voters') {
      A.voters = await fetchVoters(id);
      body = votersTab(el);
    } else {
      body = '<div id="resbody"><p class="muted">Loading results&hellip;</p></div>';
    }

    const base = '#/admin/election/' + id + '/';
    const link = VB.voterLink(el.slug);
    let control = '';
    if (el.status === 'setup') control = '<button class="btn gold" data-act="openVoting">Open voting</button>';
    if (el.status === 'open') control = '<button class="btn danger" data-act="closeVoting">Close voting</button>';

    const h =
      VB.backLink('#/admin', 'My elections') +
      '<div class="split"><div><h1>' + esc(el.title) + '</h1><p class="muted">' + esc(el.organization) + '</p></div>' +
      '<div>' + VB.pill(el.status) + (el.status === 'open' ? '<span class="live">Live</span>' : '') + '</div></div>' +
      '<div class="card"><b>Voter link</b><p><code>' + esc(link) + '</code></p>' +
      '<div class="actions"><button class="btn secondary small" data-act="copyLink" data-link="' + esc(link) + '">Copy link</button>' +
      (control ? control : '') + '</div>' +
      '<label class="top-gap" style="display:flex;gap:8px;align-items:center;font-weight:400">' +
      '<input type="checkbox" data-act="togglePublic" ' + (el.public_results ? 'checked' : '') + ' style="width:auto"> Show live results on the voter link</label>' +
      (el.status === 'setup' ? '<p class="hint top-gap">Share the link so voters can register. Approve them in the Voters tab, then open voting. Once voting opens, candidates and the voter list are locked.</p>' : '') +
      '</div>' +
      '<nav class="tabs" aria-label="Election sections">' +
      tabLink(base, 'setup', 'Candidates', tab) + tabLink(base, 'voters', 'Voters', tab) + tabLink(base, 'results', 'Results', tab) + '</nav>' +
      body;

    VB.render(VB.shell(h, prof), keep);
    if (tab === 'results') startResults();
  };

  function tabLink(base, t, label, current) {
    return '<a href="' + base + t + '"' + (t === current ? ' aria-current="page"' : '') + '>' + label + '</a>';
  }

  const reload = () => VB.viewAdminElection(A.id, A.tab, true);

  /* ---------- election controls ---------- */

  VB.acts.copyLink = (d) => VB.copy(d.link);

  VB.acts.togglePublic = async function (d, el) {
    VB.must(await sb().from('elections').update({ public_results: el.checked }).eq('id', A.id));
    A.el.public_results = el.checked;
    VB.toast(el.checked ? 'Live results are public' : 'Live results are hidden from voters');
  };

  VB.acts.openVoting = function () {
    VB.confirmModal(
      'Open voting?',
      'Once voting opens you cannot add or change candidates, or add or approve voters. You can still reset a voter\u2019s PIN. Make sure every voter has been approved.',
      'Open voting',
      async function () {
        VB.must(await sb().from('elections').update({ status: 'open' }).eq('id', A.id));
        VB.toast('Voting is open');
        await VB.viewAdminElection(A.id, 'results');
        location.hash = '#/admin/election/' + A.id + '/results';
      }
    );
  };

  VB.acts.closeVoting = function () {
    VB.confirmModal('Close voting?', 'Nobody will be able to vote after this. This cannot be undone.', 'Close voting', async function () {
      VB.must(await sb().from('elections').update({ status: 'closed' }).eq('id', A.id));
      VB.toast('Voting closed');
      await reload();
    }, true);
  };

  VB.acts.delElection = function () {
    VB.confirmModal('Delete this election?', 'All its candidates, voters and votes will be deleted for good. Download your results first.', 'Delete election', async function () {
      VB.must(await sb().from('elections').delete().eq('id', A.id));
      VB.toast('Election deleted');
      location.hash = '#/admin';
    }, true);
  };

  /* =====================================================================
     Candidates tab
     ===================================================================== */

  function setupTab(el, positions) {
    const editable = el.status === 'setup';
    let h = '';
    if (!positions.length) h += '<p class="muted">Add the positions people are standing for, for example President or Secretary.</p>';

    positions.forEach(function (p) {
      const cands = (p.candidates || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      h += '<div class="card"><div class="split"><h3>' + esc(p.name) + '</h3>' +
        (editable ? '<button class="btn danger small" data-act="delPos" data-id="' + p.id + '">Remove position</button>' : '') + '</div>';
      if (cands.length === 1) h += '<p class="hint">One aspirant, so voters will choose YES or NO.</p>';
      cands.forEach(function (c) {
        h += '<div class="cand"><div class="thumb">' + VB.photo(c.photo_path, c.name) + '</div><span>' + esc(c.name) + '</span>' +
          (editable ? '<button class="btn secondary small" data-act="delCand" data-id="' + c.id + '" data-path="' + esc(c.photo_path || '') + '">Remove</button>' : '') + '</div>';
      });
      if (!cands.length) h += '<p class="muted">No aspirants yet.</p>';
      if (editable) {
        h += '<form data-form="addCand" class="stack top-gap"><input type="hidden" name="position_id" value="' + p.id + '">' +
          '<input type="hidden" name="next" value="' + cands.length + '">' +
          '<label>Aspirant\u2019s name<input name="name" required minlength="2" maxlength="80"></label>' +
          '<label>Passport photo (optional)<input type="file" name="photo" accept="image/*"></label>' +
          '<button class="btn secondary" type="submit">Add aspirant</button></form>';
      }
      h += '</div>';
    });

    if (editable) {
      h += '<div class="card"><h3>Add a position</h3><form data-form="addPos" class="row">' +
        '<input type="hidden" name="next" value="' + positions.length + '">' +
        '<div class="grow"><input name="name" required minlength="2" maxlength="80" placeholder="e.g. Treasurer" aria-label="Position name"></div>' +
        '<button class="btn" type="submit">Add position</button></form></div>';
    }
    h += '<div class="actions"><button class="btn danger small" data-act="delElection">Delete this election</button></div>';
    return h;
  }

  VB.forms.addPos = async function (f, fd) {
    VB.must(await sb().from('positions').insert({ election_id: A.id, name: String(fd.get('name')).trim(), sort_order: Number(fd.get('next')) || 0 }));
    await reload();
  };

  VB.acts.delPos = function (d) {
    VB.confirmModal('Remove this position?', 'Its aspirants will be removed too.', 'Remove', async function () {
      VB.must(await sb().from('positions').delete().eq('id', d.id));
      await reload();
    }, true);
  };

  VB.forms.addCand = async function (f, fd) {
    const file = fd.get('photo');
    let path = null;
    if (file && file.size > 0) {
      const blob = await VB.resizeImage(file);
      path = A.adminId + '/' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)) + '.jpg';
      const up = await sb().storage.from('candidate-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw new Error('Photo upload failed: ' + up.error.message);
    }
    const res = await sb().from('candidates').insert({
      position_id: String(fd.get('position_id')),
      name: String(fd.get('name')).trim(),
      photo_path: path,
      sort_order: Number(fd.get('next')) || 0,
    });
    if (res.error) {
      if (path) sb().storage.from('candidate-photos').remove([path]);
      throw new Error(res.error.message);
    }
    await reload();
  };

  VB.acts.delCand = async function (d) {
    VB.must(await sb().from('candidates').delete().eq('id', d.id));
    if (d.path) sb().storage.from('candidate-photos').remove([d.path]);
    await reload();
  };

  /* =====================================================================
     Voters tab
     ===================================================================== */

  async function fetchVoters(electionId) {
    const cols = 'id,full_name,index_number,phone,institution,status,has_voted,failed_attempts,pin_resets,created_at';
    let all = [];
    let from = 0;
    const size = 1000;
    for (;;) {
      const rows = VB.must(await sb().from('voters').select(cols).eq('election_id', electionId).order('created_at').order('id').range(from, from + size - 1)) || [];
      all = all.concat(rows);
      if (rows.length < size) break;
      from += size;
    }
    return all;
  }

  function votersTab(el) {
    const editable = el.status === 'setup';
    const count = (s) => A.voters.filter((v) => v.status === s).length;
    const voted = A.voters.filter((v) => v.has_voted).length;

    let h =
      '<div class="stats"><div><b>' + count('pending') + '</b><small>Pending</small></div>' +
      '<div><b>' + count('approved') + '</b><small>Approved</small></div>' +
      '<div><b>' + voted + '</b><small>Voted</small></div></div>';

    if (editable) {
      h += '<div class="card"><h3>Add a voter yourself</h3><form data-form="addVoter" class="stack">' +
        '<label>Full name<input name="full_name" required minlength="2" maxlength="100"></label>' +
        '<label>Index number<input name="index_number" required maxlength="40" autocapitalize="characters"></label>' +
        '<label>Phone number<input type="tel" name="phone" required maxlength="20"></label>' +
        '<label>Department, church, school or institution<input name="institution" maxlength="120" value="' + esc(el.organization) + '"></label>' +
        '<button class="btn secondary" type="submit">Add and approve voter</button></form>' +
        '<p class="muted small top-gap">A voter you add gets a PIN from you. You will see it once, so tell them straight away.</p></div>';
    }

    h += '<div class="chips" role="group" aria-label="Filter voters">' +
      ['pending', 'approved', 'rejected', 'all'].map(function (f) {
        return '<button class="chip" data-act="vfilter" data-f="' + f + '" aria-pressed="' + (A.filter === f) + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
      }).join('') + '</div>';

    h += '<input type="search" data-input="vsearch" placeholder="Search name, index number or phone" aria-label="Search voters" value="' + esc(A.q) + '" style="margin-bottom:10px">';

    const actions = [];
    if (editable && count('pending') > 0) actions.push('<button class="btn small" data-act="approveAll">Approve all pending (' + count('pending') + ')</button>');
    if (A.voters.length) actions.push('<button class="btn secondary small" data-act="downloadVoters">Download voter list</button>');
    if (actions.length) h += '<div class="actions" style="margin:0 0 10px">' + actions.join('') + '</div>';

    h += '<div id="vlist">' + votersList() + '</div>';
    return h;
  }

  function votersList() {
    const el = A.el;
    const editable = el.status === 'setup';
    const q = A.q.trim().toLowerCase();
    const rows = A.voters.filter(function (v) {
      if (A.filter !== 'all' && v.status !== A.filter) return false;
      if (!q) return true;
      return (v.full_name + ' ' + v.index_number + ' ' + v.phone + ' ' + v.institution).toLowerCase().indexOf(q) !== -1;
    });
    if (!rows.length) return '<p class="muted">No voters to show here.</p>';

    return rows.map(function (v) {
      let acts = '';
      if (editable && v.status !== 'approved') acts += '<button class="btn small" data-act="setVoter" data-id="' + v.id + '" data-status="approved">Approve</button>';
      if (editable && v.status !== 'rejected') acts += '<button class="btn danger small" data-act="setVoter" data-id="' + v.id + '" data-status="rejected">Reject</button>';
      if (el.status !== 'closed' && v.status === 'approved' && !v.has_voted) acts += '<button class="btn gold small" data-act="resetPin" data-id="' + v.id + '">Reset PIN</button>';
      if (editable) acts += '<button class="btn secondary small" data-act="delVoter" data-id="' + v.id + '">Delete</button>';

      let meta = VB.pill(v.status);
      if (v.has_voted) meta += VB.pill('voted');
      if (v.failed_attempts >= 5) meta += VB.pill('locked');
      if (v.pin_resets > 0) meta += '<small>PIN set/reset ' + v.pin_resets + ' time(s)</small>';

      return (
        '<div class="card voter"><b>' + esc(v.full_name) + '</b>' +
        '<small>' + esc(v.index_number) + ' &middot; ' + esc(v.phone) + '</small>' +
        (v.institution ? '<small>' + esc(v.institution) + '</small>' : '') +
        '<div class="meta">' + meta + '</div>' +
        (acts ? '<div class="actions">' + acts + '</div>' : '') + '</div>'
      );
    }).join('');
  }

  VB.inputs.vsearch = function (el) {
    A.q = el.value;
    const box = document.getElementById('vlist');
    if (box) box.innerHTML = votersList();
  };

  VB.acts.vfilter = function (d) {
    A.filter = d.f;
    reload();
  };

  VB.acts.setVoter = async function (d) {
    VB.must(await sb().from('voters').update({ status: d.status }).eq('id', d.id));
    await reload();
  };

  VB.acts.approveAll = function () {
    const n = A.voters.filter((v) => v.status === 'pending').length;
    VB.confirmModal('Approve all pending voters?', 'This approves ' + n + ' voter(s). Only do this if you have checked them against your list.', 'Approve all', async function () {
      VB.must(await sb().from('voters').update({ status: 'approved' }).eq('election_id', A.id).eq('status', 'pending'));
      VB.toast('Voters approved');
      await reload();
    });
  };

  VB.acts.delVoter = function (d) {
    const v = A.voters.find((x) => x.id === d.id);
    VB.confirmModal('Delete this voter?', esc(v ? v.full_name : '') + ' will be removed from this election.', 'Delete', async function () {
      VB.must(await sb().from('voters').delete().eq('id', d.id));
      await reload();
    }, true);
  };

  VB.forms.addVoter = async function (f, fd) {
    const name = String(fd.get('full_name')).trim();
    if (String(fd.get('phone')).replace(/\D/g, '').length < 9) throw new Error('Enter a valid phone number.');
    const row = VB.must(
      await sb().from('voters').insert({
        election_id: A.id,
        full_name: name,
        index_number: String(fd.get('index_number')).trim().toUpperCase(),
        phone: String(fd.get('phone')).trim(),
        institution: String(fd.get('institution') || '').trim(),
        status: 'approved',
      }).select('id').single()
    );
    // give them a first PIN
    const r = VB.must(await sb().rpc('admin_reset_voter_pin', { p_voter: row.id, p_new_pin: null }));
    if (!r.ok) throw new Error(r.error);
    await reload();
    showPin(name, r.pin);
  };

  /* ---------- PIN reset ---------- */

  VB.acts.resetPin = function (d) {
    const v = A.voters.find((x) => x.id === d.id);
    if (!v) return;
    VB.modal(
      '<h3>Reset PIN</h3><p>' + esc(v.full_name) + ' &middot; ' + esc(v.index_number) + '</p>' +
        '<form data-form="resetPin" class="stack"><input type="hidden" name="id" value="' + v.id + '">' +
        '<input type="hidden" name="name" value="' + esc(v.full_name) + '">' +
        '<label>New 4-digit PIN (leave empty for a random one)' +
        '<input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"></label>' +
        '<div class="actions"><button class="btn" type="submit">Reset PIN</button>' +
        '<button class="btn secondary" type="button" data-act="closeModal">Cancel</button></div></form>'
    );
  };

  VB.forms.resetPin = async function (f, fd) {
    const pin = String(fd.get('pin') || '').trim();
    if (pin && !/^[0-9]{4}$/.test(pin)) throw new Error('The PIN must be exactly 4 digits.');
    const r = VB.must(await sb().rpc('admin_reset_voter_pin', { p_voter: String(fd.get('id')), p_new_pin: pin || null }));
    if (!r.ok) throw new Error(r.error);
    await reload();
    showPin(String(fd.get('name')), r.pin);
  };

  function showPin(name, pin) {
    VB.modal(
      '<h3>PIN for ' + esc(name) + '</h3><div class="bigpin">' + esc(pin) + '</div>' +
        '<p class="top-gap">Tell the voter this PIN now. It is not shown again. After signing in they can change it to one only they know.</p>' +
        '<div class="actions"><button class="btn" data-act="closeModal">Done</button></div>'
    );
  }

  VB.acts.downloadVoters = function () {
    const rows = [['Name', 'Index number', 'Phone', 'Institution', 'Status', 'Voted']];
    A.voters.forEach((v) => rows.push([v.full_name, v.index_number, v.phone, v.institution, v.status, v.has_voted ? 'Yes' : 'No']));
    VB.download('voters-' + A.el.slug + '.csv', rows);
  };

  /* =====================================================================
     Results tab (live)
     ===================================================================== */

  async function refreshResults() {
    const box = document.getElementById('resbody');
    if (!box) return;
    if (A.el.status === 'setup') {
      box.innerHTML = '<p class="muted">Results appear here as soon as voting opens.</p>';
      return;
    }
    const data = VB.must(await sb().rpc('get_results', { p_election: A.id }));
    A.lastRes = data;
    box.innerHTML =
      (A.el.status === 'open' ? '<p class="muted small">Updates automatically as people vote.</p>' : '') +
      VB.resultsHtml(data, A.el.status === 'closed') +
      '<div class="actions"><button class="btn secondary" data-act="downloadResults">Download results (CSV)</button></div>';
  }

  function startResults() {
    refreshResults().catch((e) => VB.toast(e.message, 'err'));
    if (A.el.status === 'open') VB.startPoll(refreshResults, 4000);
  }

  VB.acts.downloadResults = function () {
    if (A.lastRes) VB.download('results-' + A.el.slug + '.csv', VB.resultsCsv(A.lastRes));
  };
})();
