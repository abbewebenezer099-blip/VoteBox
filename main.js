/* VoteBox: router and click / form handling. */
(function () {
  'use strict';
  const VB = window.VB;

  function fail(err) {
    console.error(err);
    VB.toast((err && err.message) || 'Something went wrong. Please try again.', 'err');
  }

  /* ---------- router ---------- */

  VB.route = async function () {
    VB.stopPoll();
    VB.closeModal();
    if (!VB.configured) return VB.viewNotConfigured();

    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      switch (parts[0]) {
        case 'e':
          if (parts[1]) return await VB.voterRoute(parts[1], parts[2]);
          break;
        case 'login':
          return VB.viewLogin();
        case 'register':
          return VB.viewRegister();
        case 'owner':
          return await VB.viewOwner();
        case 'admin':
          if (parts[1] === 'election' && parts[2]) return await VB.viewAdminElection(parts[2], parts[3]);
          return await VB.viewAdminHome();
      }
      return VB.viewHome();
    } catch (err) {
      console.error(err);
      VB.viewMessage('Something went wrong', VB.esc((err && err.message) || 'Please refresh the page and try again.'), '<a class="btn" href="#/">Home</a>');
    }
  };

  window.addEventListener('hashchange', VB.route);

  /* ---------- one place for all clicks, form submits and typing ---------- */

  document.addEventListener('click', async function (e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = VB.acts[el.dataset.act];
    if (!fn) return;
    try {
      await fn(el.dataset, el, e);
    } catch (err) {
      fail(err);
    }
  });

  document.addEventListener('submit', async function (e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = VB.forms[form.dataset.form];
    if (!fn) return;
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      await fn(form, new FormData(form));
    } catch (err) {
      VB.ferr ? VB.ferr((err && err.message) || 'Something went wrong.') : fail(err);
      console.error(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener('input', function (e) {
    const el = e.target.closest('[data-input]');
    if (el && VB.inputs[el.dataset.input]) VB.inputs[el.dataset.input](el);
  });

  /* ---------- go ---------- */

  VB.route();
})();
