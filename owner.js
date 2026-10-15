/* VoteBox: owner dashboard. The owner approves, suspends and deletes part-time admins. */
(function () {
  'use strict';
  const VB = window.VB;
  const esc = VB.esc;
  let admins = [];

  VB.viewOwner = async function (keep) {
    const prof = await VB.requireUser();
    if (!prof) return;
    if (prof.role !== 'owner') {
      VB.viewMessage('Owner only', 'This page is only for the VoteBox owner.', '<a class="btn" href="#/admin">My elections</a>', prof);
      return;
    }
    admins = VB.must(await VB.sb.rpc('owner_admin_list')) || [];

    const waiting = admins.filter((a) => a.status === 'pending');
    const active = admins.filter((a) => a.status === 'approved');
    const other = admins.filter((a) => a.status === 'suspended' || a.status === 'rejected');
    const elections = admins.reduce((s, a) => s + Number(a.election_count || 0), 0);

    let h =
      '<h1>Owner dashboard</h1>' +
      '<div class="stats"><div><b>' + waiting.length + '</b><small>Waiting</small></div>' +
      '<div><b>' + active.length + '</b><small>Active admins</small></div>' +
      '<div><b>' + elections + '</b><small>Elections</small></div></div>';

    h += '<h2>Waiting for approval</h2>';
    h += waiting.length ? waiting.map(card).join('') : '<p class="muted">Nobody is waiting.</p>';
    h += '<h2 class="top-gap">Active admins</h2>';
    h += active.length ? active.map(card).join('') : '<p class="muted">No active admins yet.</p>';
    if (other.length) h += '<h2 class="top-gap">Suspended or rejected</h2>' + other.map(card).join('');

    VB.render(VB.shell(h, prof), keep);
  };

  function card(a) {
    let actions = '';
    if (a.status === 'pending' || a.status === 'rejected') {
      actions += '<button class="btn small" data-act="ownerSet" data-id="' + a.id + '" data-status="approved">Approve</button>';
    }
    if (a.status === 'pending') {
      actions += '<button class="btn danger small" data-act="ownerSet" data-id="' + a.id + '" data-status="rejected">Reject</button>';
    }
    if (a.status === 'approved') {
      actions += '<button class="btn secondary small" data-act="ownerSet" data-id="' + a.id + '" data-status="suspended">Suspend</button>';
    }
    if (a.status === 'suspended') {
      actions += '<button class="btn small" data-act="ownerSet" data-id="' + a.id + '" data-status="approved">Reactivate</button>';
    }
    if (a.status !== 'pending') {
      actions += '<button class="btn danger small" data-act="ownerDelete" data-id="' + a.id + '">Delete</button>';
    }
    return (
      '<div class="card"><div class="split"><div><b>' + esc(a.full_name || '(no name)') + '</b>' +
      '<small>' + esc(a.organization) + '</small></div>' + VB.pill(a.status) + '</div>' +
      '<small>' + esc(a.email) + ' &middot; ' + esc(a.phone) + '</small>' +
      '<small>Joined ' + VB.date(a.created_at) + ' &middot; ' + Number(a.election_count || 0) + ' election(s)</small>' +
      '<div class="actions">' + actions + '</div></div>'
    );
  }

  VB.acts.ownerSet = async function (d) {
    VB.must(await VB.sb.rpc('owner_set_admin_status', { target: d.id, new_status: d.status }));
    VB.toast(d.status === 'approved' ? 'Admin approved' : d.status === 'suspended' ? 'Admin suspended' : 'Admin rejected');
    await VB.viewOwner(true);
  };

  VB.acts.ownerDelete = function (d) {
    const a = admins.find((x) => x.id === d.id);
    if (!a) return;
    VB.modal(
      '<h3>Delete ' + esc(a.full_name) + '?</h3>' +
        '<p>This permanently deletes their account and ALL their elections, voters and votes. ' +
        'Ask them to download their results first.</p>' +
        '<form data-form="ownerDelete" class="stack"><input type="hidden" name="id" value="' + a.id + '">' +
        '<label>Type DELETE to confirm<input name="confirm" autocomplete="off"></label>' +
        '<div class="actions"><button class="btn danger" type="submit">Delete forever</button>' +
        '<button class="btn secondary" type="button" data-act="closeModal">Cancel</button></div></form>'
    );
  };

  VB.forms.ownerDelete = async function (f, fd) {
    if (String(fd.get('confirm')).trim() !== 'DELETE') {
      VB.toast('Type DELETE in capital letters to confirm.', 'err');
      return;
    }
    const id = String(fd.get('id'));
    // remove their candidate photos first (best effort)
    try {
      const bucket = VB.sb.storage.from('candidate-photos');
      const { data: files } = await bucket.list(id, { limit: 1000 });
      if (files && files.length) await bucket.remove(files.map((x) => id + '/' + x.name));
    } catch (e) {
      /* photos are small; carry on */
    }
    VB.must(await VB.sb.rpc('owner_delete_admin', { target: id }));
    VB.closeModal();
    VB.toast('Admin deleted');
    await VB.viewOwner(true);
  };
})();
