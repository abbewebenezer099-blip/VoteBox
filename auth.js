/* VoteBox: home page, admin registration and login. */
(function () {
  'use strict';
  const VB = window.VB;
  const esc = VB.esc;

  /* ---------- who is signed in? ---------- */

  // Returns the approved profile, or shows the right screen and returns null.
  VB.requireUser = async function () {
    const { data } = await VB.sb.auth.getSession();
    const session = data && data.session;
    if (!session) {
      location.hash = '#/login';
      return null;
    }
    const prof = VB.must(
      await VB.sb.from('profiles').select('id,email,full_name,organization,phone,role,status').eq('id', session.user.id).maybeSingle()
    );
    if (!prof) {
      VB.viewMessage('Account not ready', 'Your account was created but your profile is missing. Log out and register again, or contact the VoteBox owner.', '<button class="btn" data-act="logout">Log out</button>');
      return null;
    }
    VB.state.profile = prof;
    if (prof.status !== 'approved') {
      VB.viewStatus(prof);
      return null;
    }
    return prof;
  };

  VB.viewStatus = function (prof) {
    const text = {
      pending: 'Thank you for registering, <b>' + esc(prof.full_name) + '</b>. The VoteBox owner has to approve your account before you can create elections. Please check back soon.',
      rejected: 'Sorry, your admin account was not approved. Please contact the VoteBox owner.',
      suspended: 'Your admin account has been suspended. Please contact the VoteBox owner.',
    }[prof.status];
    VB.viewMessage(
      prof.status === 'pending' ? 'Waiting for approval' : 'Account not active',
      text,
      (prof.status === 'pending' ? '<button class="btn" data-act="refresh">Check again</button>' : '') +
        '<button class="btn secondary" data-act="logout">Log out</button>'
    );
  };

  /* ---------- pages ---------- */

  VB.viewHome = function () {
    VB.render(
      VB.shell(
        '<div class="hero">' + VB.LOGO + '<h1>VoteBox</h1><p>Fair, private elections for schools, departments and churches.</p></div>' +
          '<div class="card"><h2>Voting in an election?</h2>' +
          '<p class="muted">Type the election code your admin gave you, or open the link they sent.</p>' +
          '<form data-form="gocode" class="row"><div class="grow"><input name="code" required placeholder="Election code, e.g. 4821" inputmode="numeric" autocomplete="off" autocapitalize="off" aria-label="Election code"></div>' +
          '<button class="btn" type="submit">Go</button></form></div>' +
          '<div class="card"><h2>Running an election?</h2>' +
          '<p class="muted">Register as a part-time admin. After the VoteBox owner approves you, you can create elections, register voters and watch live results.</p>' +
          '<div class="actions"><a class="btn" href="#/register">Register as admin</a><a class="btn secondary" href="#/login">Admin login</a></div></div>' +
          '<div class="card" id="install" hidden><h2>Install VoteBox</h2><p class="muted">Add VoteBox to your phone\u2019s home screen so it opens like an app.</p>' +
          '<div class="actions"><button class="btn gold" data-act="install">Install app</button></div></div>'
      )
    );
    if (VB.showInstall) VB.showInstall();
  };

  VB.viewLogin = function () {
    VB.render(
      VB.shell(
        VB.backLink('#/') + '<div class="card"><h2>Admin login</h2><form data-form="login" class="stack">' +
          '<label>Email<input type="email" name="email" required autocomplete="email"></label>' +
          '<label>Password<input type="password" name="password" required autocomplete="current-password"></label>' +
          '<div class="err" id="ferr" hidden></div>' +
          '<button class="btn" type="submit">Log in</button></form>' +
          '<p class="muted top-gap">New here? <a href="#/register">Register as an admin</a></p></div>'
      )
    );
  };

  VB.viewRegister = function () {
    VB.render(
      VB.shell(
        VB.backLink('#/') + '<div class="card"><h2>Register as a part-time admin</h2>' +
          '<p class="muted">You will be able to run elections once the VoteBox owner approves your account.</p>' +
          '<form data-form="register" class="stack">' +
          '<label>Full name<input name="full_name" required minlength="2" maxlength="100" autocomplete="name"></label>' +
          '<label>School, department or church<input name="organization" required maxlength="120"></label>' +
          '<label>Phone number<input type="tel" name="phone" required maxlength="20" autocomplete="tel"></label>' +
          '<label>Email<input type="email" name="email" required autocomplete="email"></label>' +
          '<label>Password (at least 8 characters)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>' +
          '<div class="err" id="ferr" hidden></div>' +
          '<button class="btn" type="submit">Register</button></form>' +
          '<p class="muted top-gap">Already registered? <a href="#/login">Log in</a></p></div>'
      )
    );
  };

  VB.viewNotConfigured = function () {
    const msg = !VB.libLoaded
      ? 'VoteBox could not load. Check your internet connection and refresh the page.'
      : 'VoteBox is not connected to its database yet. Open <code>config.js</code> and paste in your Supabase project URL and anon key.';
    VB.viewMessage('Almost there', msg);
  };

  VB.ferr = function (msg) {
    const e = document.getElementById('ferr');
    if (e) {
      e.textContent = msg;
      e.hidden = !msg;
    } else if (msg) {
      VB.toast(msg, 'err');
    }
  };

  /* ---------- actions ---------- */

  VB.forms.gocode = function (f, fd) {
    let code = String(fd.get('code') || '').trim();
    const m = code.match(/#\/e\/([A-Za-z0-9]+)/);
    if (m) code = m[1];
    code = code.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (code) location.hash = '#/e/' + code;
  };

  VB.forms.login = async function (f, fd) {
    VB.ferr('');
    const { error } = await VB.sb.auth.signInWithPassword({
      email: String(fd.get('email')).trim(),
      password: String(fd.get('password')),
    });
    if (error) return VB.ferr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    const { data } = await VB.sb.auth.getUser();
    const prof = VB.must(await VB.sb.from('profiles').select('role').eq('id', data.user.id).maybeSingle());
    location.hash = prof && prof.role === 'owner' ? '#/owner' : '#/admin';
    VB.route();
  };

  VB.forms.register = async function (f, fd) {
    VB.ferr('');
    const { data, error } = await VB.sb.auth.signUp({
      email: String(fd.get('email')).trim(),
      password: String(fd.get('password')),
      options: {
        data: {
          full_name: String(fd.get('full_name')).trim(),
          organization: String(fd.get('organization')).trim(),
          phone: String(fd.get('phone')).trim(),
        },
      },
    });
    if (error) return VB.ferr(error.message);
    if (data.session) {
      location.hash = '#/admin';
      VB.route();
    } else {
      VB.viewMessage(
        'Check your email',
        'We sent a confirmation link to your email address. Click it, then log in. After that, the VoteBox owner will approve your account.',
        '<a class="btn" href="#/login">Go to login</a>'
      );
    }
  };

  VB.acts.logout = async function () {
    await VB.sb.auth.signOut();
    VB.state.profile = null;
    location.hash = '#/';
    VB.route();
  };

  VB.acts.refresh = () => VB.route();
})();
