/* VoteBox: voter pages (register, check status, sign in, vote, change PIN, live results). */
(function () {
  'use strict';
  const VB = window.VB;
  const esc = VB.esc;

  // what this voter is doing right now (kept only in memory)
  const V = (VB.v = { slug: null, el: null, view: 'home', index: '', pin: '', ballot: null, draft: {} });

  const head = () =>
    '<div class="vhead"><h1>' + esc(V.el.title) + '</h1><p class="muted">' + esc(V.el.organization) + '</p>' + VB.pill(V.el.status) + '</div>';

  const page = (inner, keep) => VB.render(VB.shell(head() + inner), keep);
  const bk = () => VB.backAct('vGo', 'data-view="home"');
  const back = '<button class="btn secondary" type="button" data-act="vGo" data-view="home">Back</button>';
  const errBox = '<div class="err" id="ferr" hidden></div>';
  const pinField = (name, label) =>
    '<label>' + label + '<input type="password" name="' + name + '" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="off"></label>';

  /* ---------- entry point from the router ---------- */

  VB.voterRoute = async function (slug, sub) {
    slug = String(slug).toLowerCase();
    if (V.slug !== slug) Object.assign(V, { slug: slug, view: 'home', index: '', pin: '', ballot: null, draft: {}, el: null });
    const data = VB.must(await VB.sb.rpc('get_election_public', { p_slug: slug }));
    if (!data) {
      VB.viewMessage('Election not found', 'Check the link or the election code and try again.', '<a class="btn" href="#/">Home</a>');
      return;
    }
    V.el = data;
    if (sub === 'results') return resultsView();
    show(V.view);
  };

  function show(view, keep) {
    V.view = view;
    const fn = views[view] || views.home;
    page(fn(), keep);
  }

  VB.acts.vGo = (d) => show(d.view);

  // the two big tiles on the voter's first screen
  VB.acts.vTile = function (d) {
    const s = V.el.status;
    if (d.which === 'register') {
      if (s === 'setup') return show('register');
      return VB.toast(s === 'open' ? 'Registration is closed because voting has already opened.' : 'This election has closed.', 'err');
    }
    if (s === 'open') return show('signin');
    VB.toast(s === 'setup' ? 'Voting has not opened yet. Register now and come back when it opens.' : 'Voting has closed.', 'err');
  };

  /* ---------- views ---------- */

  const views = {
    home: function () {
      const s = V.el.status;
      const regOpen = s === 'setup';
      const voteOpen = s === 'open';
      const regNote = regOpen ? 'Registration is open' : s === 'open' ? 'Registration is closed' : 'Registration is closed';
      const voteNote = voteOpen ? 'Voting is open now' : s === 'setup' ? 'Opens when the admin starts voting' : 'Voting has closed';
      let h =
        '<div class="tiles">' +
        '<button type="button" class="tile reg" data-act="vTile" data-which="register" aria-disabled="' + !regOpen + '">' +
        '<b>Register as a voter</b><span>' + regNote + '</span><span class="go">&rarr;</span></button>' +
        '<button type="button" class="tile vote" data-act="vTile" data-which="vote" aria-disabled="' + !voteOpen + '">' +
        '<b>Cast your vote</b><span>' + voteNote + '</span><span class="go">&rarr;</span></button></div>';
      h += '<div class="card"><div class="quick">' +
        '<button class="btn secondary small" data-act="vGo" data-view="status">Check my registration</button>' +
        (s !== 'closed' ? '<button class="btn secondary small" data-act="vGo" data-view="pin">Change my PIN</button>' : '') +
        (s !== 'setup' ? '<a class="btn secondary small" href="#/e/' + esc(V.slug) + '/results">Live results</a>' : '') +
        '</div></div>';
      return h;
    },

    register: function () {
      return (
        bk() + '<div class="card"><h2>Register as a voter</h2><form data-form="vRegister" class="stack">' +
        '<label>Full name<input name="name" required minlength="2" maxlength="100" autocomplete="name"></label>' +
        '<label>Index number<input name="index" required maxlength="40" autocapitalize="characters" autocomplete="off"></label>' +
        '<label>Phone number<input type="tel" name="phone" required maxlength="20" autocomplete="tel"></label>' +
        '<label>Department, church, school or institution<input name="institution" maxlength="120" placeholder="' + esc(V.el.organization) + '"></label>' +
        pinField('pin', 'Choose a 4-digit PIN') + pinField('pin2', 'Type the PIN again') +
        '<p class="muted small">Pick a PIN you will remember. Do not share it with anyone.</p>' + errBox +
        '<div class="actions" style="margin:0"><button class="btn" type="submit">Register</button>' + back + '</div></form></div>'
      );
    },

    registered: function () {
      return (
        bk() + '<div class="card"><h2>You are registered</h2><p>Your election admin will check your details and approve you. ' +
        'Come back later to check your status. If you forget your PIN, ask your admin to reset it.</p>' +
        '<div class="actions"><button class="btn" data-act="vGo" data-view="status">Check my registration</button>' + back + '</div></div>'
      );
    },

    status: function () {
      return (
        bk() + '<div class="card"><h2>Check my registration</h2><form data-form="vStatus" class="stack">' +
        '<label>Index number<input name="index" required maxlength="40" autocapitalize="characters" autocomplete="off"></label>' +
        '<label>Phone number you registered with<input type="tel" name="phone" required maxlength="20"></label>' +
        '<div id="fresult"></div>' + errBox +
        '<div class="actions" style="margin:0"><button class="btn" type="submit">Check</button>' + back + '</div></form></div>'
      );
    },

    signin: function () {
      return (
        bk() + '<div class="card"><h2>Cast your vote</h2><p class="muted">Sign in with your index number and PIN.</p><form data-form="vSignin" class="stack">' +
        '<label>Index number<input name="index" required maxlength="40" autocapitalize="characters" autocomplete="off" value="' + esc(V.index) + '"></label>' +
        pinField('pin', 'Your 4-digit PIN') + errBox +
        '<div class="actions" style="margin:0"><button class="btn gold" type="submit">Continue</button>' + back + '</div>' +
        '<p class="muted small">Forgot your PIN? Ask your election admin to reset it.</p></form></div>'
      );
    },

    pin: function () {
      return (
        bk() + '<div class="card"><h2>Change my PIN</h2><form data-form="vPin" class="stack">' +
        '<label>Index number<input name="index" required maxlength="40" autocapitalize="characters" autocomplete="off"></label>' +
        pinField('old', 'Current PIN') + pinField('next', 'New 4-digit PIN') + errBox +
        '<div class="actions" style="margin:0"><button class="btn" type="submit">Change PIN</button>' + back + '</div></form></div>'
      );
    },

    ballot: function () {
      const b = V.ballot;
      if (!b) return views.home();
      let h = VB.backAct('cancelVote') + '<h2>Your ballot</h2><p class="muted">Choose one option for each position. <b>Abstain</b> means you are not voting for anyone for that position.</p>';
      b.positions.forEach(function (p) {
        const sel = V.draft[p.id];
        h += '<div class="pos" role="group" aria-label="' + esc(p.name) + '"><div class="pos-title">' + esc(p.name) + '</div><div class="pos-body">';
        if (p.mode === 'yes_no') {
          const c = p.candidates[0];
          h += '<div class="solo"><div class="ph">' + VB.photo(c.photo_path, c.name) + '</div><div class="nm">' + esc(c.name) + '</div></div>' +
            '<div class="yn">' +
            '<button type="button" class="' + (sel === 'yes' ? 'on' : '') + '" aria-pressed="' + (sel === 'yes') + '" data-act="pick" data-pos="' + p.id + '" data-val="yes">YES</button>' +
            '<button type="button" class="' + (sel === 'no' ? 'on' : '') + '" aria-pressed="' + (sel === 'no') + '" data-act="pick" data-pos="' + p.id + '" data-val="no">NO</button></div>';
        } else {
          h += '<div class="grid">' + p.candidates.map(function (c) {
            return '<button type="button" class="cc ' + (sel === c.id ? 'on' : '') + '" aria-pressed="' + (sel === c.id) + '" data-act="pick" data-pos="' + p.id + '" data-val="' + c.id + '">' +
              '<div class="ph">' + VB.photo(c.photo_path, c.name) + '</div><div class="nm"><i></i>' + esc(c.name) + '</div></button>';
          }).join('') + '</div>' +
            '<button type="button" class="opt ' + (sel === 'abstain' ? 'on' : '') + '" aria-pressed="' + (sel === 'abstain') + '" data-act="pick" data-pos="' + p.id + '" data-val="abstain"><i></i>Abstain</button>';
        }
        h += '</div></div>';
      });
      h += errBox + '<div class="actions"><button class="btn" data-act="review">Review ballot</button>' +
        '<button class="btn secondary" data-act="cancelVote">Cancel</button></div>';
      return h;
    },

    review: function () {
      let h = VB.backAct('vGo', 'data-view="ballot"') + '<h2>Check your choices</h2><p class="muted">You cannot change your vote after you cast it.</p><div class="card summary">';
      V.ballot.positions.forEach(function (p) {
        h += '<div class="cand"><b>' + esc(p.name) + '</b><span>' + esc(label(p, V.draft[p.id])) + '</span></div>';
      });
      h += '</div>' + errBox +
        '<div class="actions"><button class="btn gold" data-act="cast">Cast my vote</button>' +
        '<button class="btn secondary" data-act="vGo" data-view="ballot">Go back and change</button></div>';
      return h;
    },

    done: function () {
      return (
        '<div class="card"><h2>Your vote has been recorded</h2><p>Thank you for voting. Your PIN cannot be used to vote again.</p>' +
        '<div class="actions"><a class="btn" href="#/e/' + esc(V.slug) + '/results">See live results</a>' +
        '<button class="btn secondary" data-act="vGo" data-view="home">Done</button></div></div>'
      );
    },
  };

  function label(p, val) {
    if (val === 'abstain') return 'Abstain';
    if (val === 'yes') return 'YES';
    if (val === 'no') return 'NO';
    const c = p.candidates.find((x) => x.id === val);
    return c ? c.name : '';
  }

  /* ---------- actions ---------- */

  VB.forms.vRegister = async function (f, fd) {
    VB.ferr('');
    const pin = String(fd.get('pin'));
    if (pin !== String(fd.get('pin2'))) return VB.ferr('The two PINs are not the same.');
    if (!/^[0-9]{4}$/.test(pin)) return VB.ferr('The PIN must be exactly 4 digits.');
    const d = VB.must(
      await VB.sb.rpc('register_voter', {
        p_slug: V.slug,
        p_name: String(fd.get('name')),
        p_index: String(fd.get('index')),
        p_phone: String(fd.get('phone')),
        p_institution: String(fd.get('institution') || ''),
        p_pin: pin,
      })
    );
    if (!d.ok) return VB.ferr(d.error);
    show('registered');
  };

  VB.forms.vStatus = async function (f, fd) {
    VB.ferr('');
    const d = VB.must(
      await VB.sb.rpc('check_registration', { p_slug: V.slug, p_index: String(fd.get('index')), p_phone: String(fd.get('phone')) })
    );
    const box = document.getElementById('fresult');
    let msg;
    if (!d.found) msg = '<div class="err">We could not find a registration with that index number and phone number.</div>';
    else if (d.status === 'pending') msg = '<div class="hint">Waiting for approval. Check again later.</div>';
    else if (d.status === 'rejected') msg = '<div class="err">Your registration was not approved. Please contact your election admin.</div>';
    else msg = '<div class="ok">You are approved. You can vote when voting is open.' + (d.locked ? ' Your PIN is locked after too many wrong tries. Ask your admin to reset it.' : '') + '</div>';
    box.innerHTML = msg;
  };

  VB.forms.vSignin = async function (f, fd) {
    VB.ferr('');
    const index = String(fd.get('index')).trim();
    const pin = String(fd.get('pin'));
    const d = VB.must(await VB.sb.rpc('get_ballot', { p_slug: V.slug, p_index: index, p_pin: pin }));
    if (!d.ok) {
      f.elements.pin.value = '';
      return VB.ferr(d.error);
    }
    V.index = index;
    V.pin = pin;
    V.ballot = d;
    V.draft = {};
    show('ballot');
  };

  VB.forms.vPin = async function (f, fd) {
    VB.ferr('');
    const next = String(fd.get('next'));
    if (!/^[0-9]{4}$/.test(next)) return VB.ferr('The new PIN must be exactly 4 digits.');
    const d = VB.must(
      await VB.sb.rpc('voter_change_pin', { p_slug: V.slug, p_index: String(fd.get('index')), p_old_pin: String(fd.get('old')), p_new_pin: next })
    );
    if (!d.ok) return VB.ferr(d.error);
    VB.toast('PIN changed');
    show('home');
  };

  VB.acts.pick = function (d) {
    V.draft[d.pos] = d.val;
    show('ballot', true);
  };

  VB.acts.review = function () {
    const missing = V.ballot.positions.filter((p) => !V.draft[p.id]).map((p) => p.name);
    if (missing.length) return VB.ferr('Please choose an option (or Abstain) for: ' + missing.join(', ') + '.');
    show('review');
  };

  VB.acts.cancelVote = function () {
    clearSecrets();
    show('home');
  };

  VB.acts.cast = async function (d, btn) {
    btn.disabled = true;
    try {
      const res = VB.must(
        await VB.sb.rpc('cast_vote', { p_slug: V.slug, p_index: V.index, p_pin: V.pin, p_choices: V.draft })
      );
      if (!res.ok) {
        VB.ferr(res.error);
        if (/already|not open|closed/i.test(res.error)) clearSecrets();
        return;
      }
      clearSecrets();
      show('done');
    } finally {
      btn.disabled = false;
    }
  };

  function clearSecrets() {
    V.index = '';
    V.pin = '';
    V.ballot = null;
    V.draft = {};
  }

  /* ---------- public live results ---------- */

  async function resultsView() {
    page(
      VB.backLink('#/e/' + V.slug) + '<h2>Live results</h2><div id="resbody"><p class="muted">Loading&hellip;</p></div>' +
        '<div class="actions"><a class="btn secondary" href="#/e/' + esc(V.slug) + '">Back</a></div>'
    );
    const refresh = async function () {
      const d = VB.must(await VB.sb.rpc('get_public_results', { p_slug: V.slug }));
      const box = document.getElementById('resbody');
      if (!box) return null;
      if (!d.ok) {
        box.innerHTML = '<div class="card"><p>' + esc(d.error) + '</p></div>';
        return d;
      }
      box.innerHTML =
        (d.election.status === 'open' ? '<p class="muted small">Updates automatically as people vote.</p>' : '') +
        VB.resultsHtml(d, d.election.status === 'closed');
      return d;
    };
    const d = await refresh();
    if (d && d.ok && d.election.status === 'open') VB.startPoll(refresh, 4000);
  }
})();
