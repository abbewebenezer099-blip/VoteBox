-- =====================================================================
-- VoteBox database setup
-- Run this whole file ONCE in Supabase: SQL Editor > New query > paste > Run.
--
-- Who can do what
--   owner  : approves / rejects / suspends / deletes part-time admins
--   admin  : (approved) creates elections, candidates, approves voters,
--            opens/closes voting, reads results of their OWN elections only
--   voter  : not a logged-in user; registers (choosing a 4-digit PIN) and
--            votes through the functions at the bottom, signing in with
--            index number + PIN. A forgotten PIN is reset by the admin.
--
-- Ballot secrecy: the "votes" table has no voter id and no timestamp.
-- Nobody (not even the owner or an admin) can read it directly. Counts are
-- LIVE: the admin (get_results) and, if switched on, anyone with the
-- election link (get_public_results) see totals and percentages update as
-- soon as each vote is cast. Positions with ONE candidate are YES / NO.
-- =====================================================================


create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text not null default '',
  organization  text not null default '',
  phone         text not null default '',
  role          text not null default 'admin'   check (role in ('owner','admin')),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  created_at    timestamptz not null default now()
);

create table public.elections (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (char_length(title) between 3 and 120),
  organization  text not null default '',
  slug          text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  status        text not null default 'setup' check (status in ('setup','open','closed')),
  public_results boolean not null default true,   -- live results page on the election link
  created_at    timestamptz not null default now()
);
create index on public.elections (admin_id);

create table public.positions (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references public.elections(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  sort_order    int  not null default 0
);
create index on public.positions (election_id);

create table public.candidates (
  id            uuid primary key default gen_random_uuid(),
  position_id   uuid not null references public.positions(id) on delete cascade,
  election_id   uuid not null references public.elections(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  photo_path    text,
  sort_order    int  not null default 0
);
create index on public.candidates (position_id);

create table public.voters (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references public.elections(id) on delete cascade,
  full_name     text not null check (char_length(full_name) between 2 and 100),
  index_number  text not null check (char_length(index_number) between 1 and 40),
  phone         text not null check (char_length(phone) between 7 and 20),
  institution   text not null default '',
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  pin_hash      text,                         -- 4-digit PIN, stored hashed; admins can never read it
  failed_attempts int not null default 0,     -- the voter is locked after 5 wrong PINs
  pin_resets    int not null default 0,       -- how many times an admin set/reset this PIN
  has_voted     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (election_id, index_number)
);

-- Secret ballots: no voter id, no timestamp.
--   candidate_id = candidate, is_no = false  -> a vote for that candidate (or YES)
--   candidate_id = the only candidate, is_no = true -> NO (single-candidate position)
--   candidate_id NULL                        -> abstain
create table public.votes (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references public.elections(id) on delete cascade,
  position_id   uuid not null references public.positions(id) on delete cascade,
  candidate_id  uuid references public.candidates(id) on delete cascade,
  is_no         boolean not null default false
);
create index on public.votes (election_id, position_id);


-- ---------- Helper functions -------------------------------------------

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'owner' and status = 'approved');
$$;

create or replace function public.is_approved_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('admin','owner') and status = 'approved');
$$;

create or replace function public.owns_election(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_admin()
     and exists (select 1 from public.elections where id = eid and admin_id = auth.uid());
$$;

create or replace function public.election_is_setup(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.elections where id = eid and status = 'setup');
$$;

-- ---------- New sign-ups become PENDING admins --------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, organization, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'organization', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;   -- role is always 'admin' and status always 'pending'
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------- Guard triggers ---------------------------------------------

-- Elections: slug/admin cannot change; only setup -> open -> closed.
create or replace function public.elections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.admin_id := old.admin_id;
  new.slug     := old.slug;
  if new.status <> old.status then
    if old.status = 'setup' and new.status = 'open' then
      if not exists (select 1 from public.positions where election_id = old.id) then
        raise exception 'Add at least one position first.';
      end if;
      if exists (select 1 from public.positions p
                 where p.election_id = old.id
                   and not exists (select 1 from public.candidates c where c.position_id = p.id)) then
        raise exception 'Every position needs at least one candidate.';
      end if;
      if not exists (select 1 from public.voters where election_id = old.id and status = 'approved') then
        raise exception 'Approve at least one voter first.';
      end if;
    elsif old.status = 'open' and new.status = 'closed' then
      null;
    else
      raise exception 'Invalid status change.';
    end if;
  end if;
  return new;
end $$;

create trigger elections_guard_trg
  before update on public.elections
  for each row execute function public.elections_guard();

-- Candidates always take their election from their position.
create or replace function public.candidates_set_election()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.election_id := (select election_id from public.positions where id = new.position_id);
  if new.election_id is null then raise exception 'Position not found.'; end if;
  return new;
end $$;

create trigger candidates_set_election_trg
  before insert or update on public.candidates
  for each row execute function public.candidates_set_election();

-- Voters: admins cannot touch the PIN, the attempt counter or has_voted.
-- Only the functions further down (which switch on 'votebox.internal') can.
create or replace function public.voters_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  internal boolean := coalesce(current_setting('votebox.internal', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.has_voted := false;
    new.failed_attempts := 0;
    new.pin_resets := 0;
    if not internal then new.pin_hash := null; end if;
  else
    new.election_id := old.election_id;
    if not internal then
      new.has_voted := old.has_voted;
      new.pin_hash := old.pin_hash;
      new.failed_attempts := old.failed_attempts;
      new.pin_resets := old.pin_resets;
    end if;
  end if;
  return new;
end $$;

create trigger voters_guard_trg
  before insert or update on public.voters
  for each row execute function public.voters_guard();


-- ---------- Row Level Security -----------------------------------------

alter table public.profiles   enable row level security;
alter table public.elections  enable row level security;
alter table public.positions  enable row level security;
alter table public.candidates enable row level security;
alter table public.voters     enable row level security;
alter table public.votes      enable row level security;

-- profiles: you see yourself; the owner sees (and manages) everyone.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
create policy profiles_owner_update on public.profiles for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- elections: each admin only ever sees their own.
create policy elections_select on public.elections for select to authenticated
  using (public.owns_election(id));
create policy elections_insert on public.elections for insert to authenticated
  with check (admin_id = auth.uid() and public.is_approved_admin());
create policy elections_update on public.elections for update to authenticated
  using (public.owns_election(id)) with check (public.owns_election(id));
create policy elections_delete on public.elections for delete to authenticated
  using (public.owns_election(id));

-- positions and candidates: own election, and only while it is in setup.
create policy positions_select on public.positions for select to authenticated
  using (public.owns_election(election_id));
create policy positions_write on public.positions for all to authenticated
  using (public.owns_election(election_id) and public.election_is_setup(election_id))
  with check (public.owns_election(election_id) and public.election_is_setup(election_id));

create policy candidates_select on public.candidates for select to authenticated
  using (public.owns_election(election_id));
create policy candidates_write on public.candidates for all to authenticated
  using (public.owns_election(election_id) and public.election_is_setup(election_id))
  with check (public.owns_election(election_id) and public.election_is_setup(election_id));

-- voters: own election; approvals/edits only while in setup (list locks when voting opens).
create policy voters_select on public.voters for select to authenticated
  using (public.owns_election(election_id));
create policy voters_write on public.voters for all to authenticated
  using (public.owns_election(election_id) and public.election_is_setup(election_id))
  with check (public.owns_election(election_id) and public.election_is_setup(election_id));

-- Admins can see everything about their voters EXCEPT pin_hash.
-- (In the app, always list columns; never use select=* on voters.)
revoke all on public.voters from anon, authenticated;
grant select (id, election_id, full_name, index_number, phone, institution, status,
              has_voted, failed_attempts, pin_resets, created_at) on public.voters to authenticated;
grant insert (election_id, full_name, index_number, phone, institution, status) on public.voters to authenticated;
grant update (full_name, index_number, phone, institution, status) on public.voters to authenticated;
grant delete on public.voters to authenticated;

-- votes: NOBODY can read or write directly.
revoke all on public.votes from anon, authenticated;


-- ---------- Owner functions --------------------------------------------

create or replace function public.owner_admin_list()
returns table (id uuid, email text, full_name text, organization text, phone text,
               status text, created_at timestamptz, election_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  return query
    select p.id, p.email, p.full_name, p.organization, p.phone, p.status, p.created_at,
           (select count(*) from public.elections e where e.admin_id = p.id)
    from public.profiles p
    where p.role = 'admin'
    order by p.created_at desc;
end $$;

create or replace function public.owner_set_admin_status(target uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  if new_status not in ('pending','approved','rejected','suspended') then
    raise exception 'Invalid status';
  end if;
  update public.profiles set status = new_status where id = target and role = 'admin';
end $$;

-- Deleting an admin removes their account AND all their elections, voters and votes.
create or replace function public.owner_delete_admin(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.profiles where id = target and role = 'admin') then
    raise exception 'Admin not found';
  end if;
  delete from auth.users where id = target;   -- cascades to profiles, elections, ...
end $$;


-- ---------- Live results -------------------------------------------------
-- Percentages are worked out in the app: votes / valid votes for that position
-- (abstentions are shown separately). For YES / NO positions: YES vs NO.

create or replace function public.build_results(eid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'election', (select jsonb_build_object('title', e.title, 'organization', e.organization, 'status', e.status)
                 from public.elections e where e.id = eid),
    'turnout', jsonb_build_object(
      'voted',    (select count(*) from public.voters where election_id = eid and has_voted),
      'approved', (select count(*) from public.voters where election_id = eid and status = 'approved')
    ),
    'positions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'mode', case when (select count(*) from public.candidates c where c.position_id = p.id) = 1
                       then 'yes_no' else 'choose' end,
          'abstained', (select count(*) from public.votes v where v.position_id = p.id and v.candidate_id is null),
          'no_votes',  (select count(*) from public.votes v where v.position_id = p.id and v.is_no),
          'candidates', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id', c.id, 'name', c.name, 'photo_path', c.photo_path,
                'votes', (select count(*) from public.votes v where v.candidate_id = c.id and not v.is_no)
              )
              order by (select count(*) from public.votes v where v.candidate_id = c.id and not v.is_no) desc, c.name
            ), '[]'::jsonb)
            from public.candidates c where c.position_id = p.id
          )
        ) order by p.sort_order, p.name
      ), '[]'::jsonb)
      from public.positions p where p.election_id = eid
    )
  );
$$;

-- Admin: live results for their own election (while open, and after it closes).
create or replace function public.get_results(p_election uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  el public.elections;
begin
  select * into el from public.elections where id = p_election and admin_id = auth.uid();
  if not found or not public.is_approved_admin() then raise exception 'Not allowed'; end if;
  if el.status = 'setup' then raise exception 'Voting has not opened yet.'; end if;
  return public.build_results(el.id);
end $$;

-- Anyone with the election link (only if the admin left public results switched on).
create or replace function public.get_public_results(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  el public.elections;
begin
  select * into el from public.elections where slug = lower(trim(p_slug));
  if not found then return jsonb_build_object('ok', false, 'error', 'Election not found.'); end if;
  if not el.public_results then
    return jsonb_build_object('ok', false, 'error', 'Live results are not public for this election.');
  end if;
  if el.status = 'setup' then
    return jsonb_build_object('ok', false, 'error', 'Voting has not opened yet.');
  end if;
  return jsonb_build_object('ok', true) || public.build_results(el.id);
end $$;


-- ---------- Voter functions (no login; used from the public election link) ----
-- Voters sign in with their INDEX NUMBER + a 4-digit PIN they chose when registering.

create or replace function public.get_election_public(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', title, 'organization', organization, 'status', status)
  from public.elections where slug = lower(trim(p_slug));
$$;

create or replace function public.register_voter(
  p_slug text, p_name text, p_index text, p_phone text, p_institution text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  el public.elections;
begin
  select * into el from public.elections where slug = lower(trim(p_slug));
  if not found then return jsonb_build_object('ok', false, 'error', 'Election not found.'); end if;
  if el.status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'Registration for this election is closed.');
  end if;

  p_name := trim(coalesce(p_name, ''));
  p_index := upper(trim(coalesce(p_index, '')));
  p_phone := trim(coalesce(p_phone, ''));
  p_institution := trim(coalesce(p_institution, ''));

  if char_length(p_name) < 2 then return jsonb_build_object('ok', false, 'error', 'Enter your full name.'); end if;
  if char_length(p_index) < 1 then return jsonb_build_object('ok', false, 'error', 'Enter your index number.'); end if;
  if char_length(regexp_replace(p_phone, '\D', '', 'g')) < 9 then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid phone number.');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'Choose a PIN of exactly 4 digits.');
  end if;

  perform set_config('votebox.internal', 'on', true);
  begin
    insert into public.voters (election_id, full_name, index_number, phone, institution, pin_hash)
    values (el.id, left(p_name, 100), left(p_index, 40), left(p_phone, 20), left(p_institution, 120),
            crypt(p_pin, gen_salt('bf')));
  exception when unique_violation then
    perform set_config('votebox.internal', 'off', true);
    return jsonb_build_object('ok', false, 'error', 'This index number is already registered for this election.');
  end;
  perform set_config('votebox.internal', 'off', true);

  return jsonb_build_object('ok', true);
end $$;

-- Lets a voter check whether the admin has approved them (index number + phone number).
create or replace function public.check_registration(p_slug text, p_index text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_status text;
  v_locked boolean;
begin
  select v.status, v.failed_attempts >= 5 into v_status, v_locked
  from public.voters v
  join public.elections e on e.id = v.election_id
  where e.slug = lower(trim(p_slug))
    and v.index_number = upper(trim(p_index))
    and regexp_replace(v.phone, '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'status', v_status, 'locked', v_locked);
end $$;

-- Internal: checks index number + PIN. Counts wrong tries and locks after 5.
-- Returns (voter_id, err): err is NULL when the voter may continue.
create or replace function public.verify_voter(eid uuid, p_index text, p_pin text)
returns table (voter_id uuid, err text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  vt public.voters;
begin
  select * into vt from public.voters
   where election_id = eid and index_number = upper(trim(coalesce(p_index, '')))
   for update;

  if not found then
    return query select null::uuid, 'Index number or PIN is incorrect.'::text; return;
  end if;
  if vt.status = 'pending' then
    return query select null::uuid, 'Your registration has not been approved yet.'::text; return;
  end if;
  if vt.status = 'rejected' then
    return query select null::uuid, 'Your registration was not approved. Please contact your election admin.'::text; return;
  end if;
  if vt.pin_hash is null then
    return query select null::uuid, 'You do not have a PIN yet. Ask your election admin to set one for you.'::text; return;
  end if;
  if vt.failed_attempts >= 5 then
    return query select null::uuid, 'Too many wrong attempts. Ask your election admin to reset your PIN.'::text; return;
  end if;

  if vt.pin_hash <> crypt(coalesce(p_pin, ''), vt.pin_hash) then
    perform set_config('votebox.internal', 'on', true);
    update public.voters set failed_attempts = failed_attempts + 1 where id = vt.id;
    perform set_config('votebox.internal', 'off', true);
    if vt.failed_attempts + 1 >= 5 then
      return query select null::uuid, 'Too many wrong attempts. Ask your election admin to reset your PIN.'::text; return;
    end if;
    return query select null::uuid, 'Index number or PIN is incorrect.'::text; return;
  end if;

  if vt.failed_attempts > 0 then
    perform set_config('votebox.internal', 'on', true);
    update public.voters set failed_attempts = 0 where id = vt.id;
    perform set_config('votebox.internal', 'off', true);
  end if;
  if vt.has_voted then
    return query select null::uuid, 'You have already voted.'::text; return;
  end if;

  return query select vt.id, null::text;
end $$;

-- Returns the ballot (candidates shuffled for each voter so order is fair).
-- A position with exactly ONE candidate has mode 'yes_no'; otherwise 'choose'.
create or replace function public.get_ballot(p_slug text, p_index text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  el public.elections;
  rv record;
begin
  select * into el from public.elections where slug = lower(trim(p_slug));
  if not found then return jsonb_build_object('ok', false, 'error', 'Election not found.'); end if;
  if el.status = 'setup'  then return jsonb_build_object('ok', false, 'error', 'Voting has not opened yet.'); end if;
  if el.status = 'closed' then return jsonb_build_object('ok', false, 'error', 'Voting has closed.'); end if;

  select * into rv from public.verify_voter(el.id, p_index, p_pin);
  if rv.err is not null then return jsonb_build_object('ok', false, 'error', rv.err); end if;

  return jsonb_build_object(
    'ok', true,
    'election', jsonb_build_object('title', el.title, 'organization', el.organization),
    'positions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'mode', case when (select count(*) from public.candidates c2 where c2.position_id = p.id) = 1
                       then 'yes_no' else 'choose' end,
          'candidates', (
            select coalesce(jsonb_agg(
              jsonb_build_object('id', c.id, 'name', c.name, 'photo_path', c.photo_path)
              order by random()
            ), '[]'::jsonb)
            from public.candidates c where c.position_id = p.id
          )
        ) order by p.sort_order, p.name
      ), '[]'::jsonb)
      from public.positions p where p.election_id = el.id
    )
  );
end $$;

-- A voter changes their own PIN (for example after the admin gave them a new one).
create or replace function public.voter_change_pin(p_slug text, p_index text, p_old_pin text, p_new_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  el public.elections;
  rv record;
begin
  select * into el from public.elections where slug = lower(trim(p_slug));
  if not found then return jsonb_build_object('ok', false, 'error', 'Election not found.'); end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'The new PIN must be exactly 4 digits.');
  end if;

  select * into rv from public.verify_voter(el.id, p_index, p_old_pin);
  if rv.err is not null then return jsonb_build_object('ok', false, 'error', rv.err); end if;

  perform set_config('votebox.internal', 'on', true);
  update public.voters set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = rv.voter_id;
  perform set_config('votebox.internal', 'off', true);
  return jsonb_build_object('ok', true);
end $$;

-- p_choices looks like {"<position id>": <answer>, ...} where <answer> is
--   'yes' or 'no'                       for a single-candidate position
--   a candidate id, or 'abstain'        for any other position
-- The vote and the "has voted" mark are saved together, in one step.
create or replace function public.cast_vote(p_slug text, p_index text, p_pin text, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  el public.elections;
  rv record;
  pos record;
  choice text;
begin
  select * into el from public.elections where slug = lower(trim(p_slug));
  if not found then return jsonb_build_object('ok', false, 'error', 'Election not found.'); end if;
  if el.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'Voting is not open.'); end if;

  -- also locks this voter's row, so a double-tap cannot count twice
  select * into rv from public.verify_voter(el.id, p_index, p_pin);
  if rv.err is not null then return jsonb_build_object('ok', false, 'error', rv.err); end if;

  -- check every answer first
  begin
    for pos in
      select p.id,
             (select count(*) from public.candidates c where c.position_id = p.id) as n
      from public.positions p where p.election_id = el.id
    loop
      if not jsonb_exists(p_choices, pos.id::text) then
        return jsonb_build_object('ok', false, 'error', 'Choose an option for every position.');
      end if;
      choice := p_choices ->> pos.id::text;
      if pos.n = 1 then
        if choice is null or choice not in ('yes', 'no') then
          return jsonb_build_object('ok', false, 'error', 'Choose YES or NO for every single-candidate position.');
        end if;
      elsif choice is not null and choice <> 'abstain' then
        if not exists (select 1 from public.candidates where id = choice::uuid and position_id = pos.id) then
          return jsonb_build_object('ok', false, 'error', 'Invalid choice.');
        end if;
      end if;
    end loop;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', 'Invalid choice.');
  end;

  for pos in
    select p.id,
           (select count(*) from public.candidates c where c.position_id = p.id) as n,
           (select c.id from public.candidates c where c.position_id = p.id limit 1) as only_cand
    from public.positions p where p.election_id = el.id
  loop
    choice := p_choices ->> pos.id::text;
    if pos.n = 1 then
      insert into public.votes (election_id, position_id, candidate_id, is_no)
      values (el.id, pos.id, pos.only_cand, choice = 'no');
    else
      insert into public.votes (election_id, position_id, candidate_id, is_no)
      values (el.id, pos.id,
              case when choice is null or choice = 'abstain' then null else choice::uuid end,
              false);
    end if;
  end loop;

  perform set_config('votebox.internal', 'on', true);
  update public.voters set has_voted = true where id = rv.voter_id;
  perform set_config('votebox.internal', 'off', true);

  return jsonb_build_object('ok', true);
end $$;

-- Admin: set or reset a voter's PIN (forgotten PIN, or first PIN for a voter the admin
-- added by hand). Leave p_new_pin empty to get a random 4-digit PIN. The new PIN is
-- returned ONCE so the admin can tell the voter; it is stored hashed and cannot be read
-- again. Also clears a lockout. Not allowed once the voter has voted.
create or replace function public.admin_reset_voter_pin(p_voter uuid, p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  vt public.voters;
  new_pin text;
begin
  select v.* into vt from public.voters v where v.id = p_voter;
  if not found or not public.owns_election(vt.election_id) then raise exception 'Not allowed'; end if;
  if exists (select 1 from public.elections where id = vt.election_id and status = 'closed') then
    return jsonb_build_object('ok', false, 'error', 'This election is closed.');
  end if;
  if vt.has_voted then
    return jsonb_build_object('ok', false, 'error', 'This voter has already voted.');
  end if;

  if p_new_pin is null or p_new_pin = '' then
    new_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  elsif p_new_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'The PIN must be exactly 4 digits.');
  else
    new_pin := p_new_pin;
  end if;

  perform set_config('votebox.internal', 'on', true);
  update public.voters
     set pin_hash = crypt(new_pin, gen_salt('bf')),
         failed_attempts = 0,
         pin_resets = pin_resets + 1
   where id = vt.id;
  perform set_config('votebox.internal', 'off', true);

  return jsonb_build_object('ok', true, 'pin', new_pin);
end $$;


-- ---------- Who may call which function ---------------------------------

revoke execute on function public.owner_admin_list()                      from public, anon;
revoke execute on function public.owner_set_admin_status(uuid, text)      from public, anon;
revoke execute on function public.owner_delete_admin(uuid)                from public, anon;
revoke execute on function public.get_results(uuid)                       from public, anon;
revoke execute on function public.admin_reset_voter_pin(uuid, text)       from public, anon;
grant  execute on function public.owner_admin_list()                      to authenticated;
grant  execute on function public.owner_set_admin_status(uuid, text)      to authenticated;
grant  execute on function public.owner_delete_admin(uuid)                to authenticated;
grant  execute on function public.get_results(uuid)                       to authenticated;
grant  execute on function public.admin_reset_voter_pin(uuid, text)       to authenticated;

-- internal helpers: only other functions may use these
revoke execute on function public.build_results(uuid)                     from public, anon, authenticated;
revoke execute on function public.verify_voter(uuid, text, text)          from public, anon, authenticated;

-- voter-facing (no login)
grant execute on function public.get_election_public(text)                          to anon, authenticated;
grant execute on function public.register_voter(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.check_registration(text, text, text)              to anon, authenticated;
grant execute on function public.get_ballot(text, text, text)                       to anon, authenticated;
grant execute on function public.voter_change_pin(text, text, text, text)           to anon, authenticated;
grant execute on function public.cast_vote(text, text, text, jsonb)                 to anon, authenticated;
grant execute on function public.get_public_results(text)                           to anon, authenticated;


-- ---------- Candidate photos (Storage) ----------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-photos', 'candidate-photos', true, 1048576,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Anyone can view photos (voters need to see them on the ballot).
create policy "photos are public" on storage.objects for select
  using (bucket_id = 'candidate-photos');

-- An approved admin can only add/change/remove files inside their own folder.
create policy "admins upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate-photos'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_approved_admin());
create policy "admins update own photos" on storage.objects for update to authenticated
  using (bucket_id = 'candidate-photos'
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_approved_admin());
create policy "admins delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'candidate-photos'
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_approved_admin());


-- The owner can remove photos when deleting an admin.
create policy "owner deletes photos" on storage.objects for delete to authenticated
  using (bucket_id = 'candidate-photos' and public.is_owner());


-- ---------- Make YOURSELF the owner (run separately, after you sign up) --
-- 1. Create your own account in the app (or Supabase > Authentication > Add user).
-- 2. Then run this one line with YOUR email:
--
--   update public.profiles set role = 'owner', status = 'approved'
--   where email = 'your-email@example.com';
