# VoteBox

Online voting for schools, departments and churches.

VoteBox has three kinds of people:

- **Owner**: approves, suspends and deletes part-time admins.
- **Part-time admin**: registers, waits for the owner's approval, then runs their own elections. Each admin sees only their own elections and voters.
- **Voter**: registers through an election link, is approved by the admin, then votes once, signing in with their index number and a 4-digit PIN.

## How an election runs

1. A person registers as a part-time admin and waits for the owner to approve them.
2. The admin creates an election, adds positions and candidates (with passport photos) and shares the registration link.
3. Voters register with their name, index number, phone number, institution and a 4-digit PIN that they choose.
4. The admin approves voters. If a voter forgets their PIN, the admin resets it and tells them the new one.
5. The admin opens voting. The voter list and candidates are now locked.
6. Voters vote with their code. Candidates appear in a different random order for each voter. A position with only one aspirant becomes a YES / NO vote.
7. Counts and percentages update live as each vote comes in. The admin always sees them, and the admin can switch on a public live results page on the election link. The admin closes voting when time is up.
8. When the admin is finished, the owner deletes their account.

## Setting it up (in this order)

1. **GitHub:** create a new repository, upload everything in this folder, and keep `index.html` at the top level.
2. **Supabase:** create a free project at supabase.com.
3. In Supabase, open **SQL Editor**, paste all of `supabase/schema.sql`, and press Run. Run it once only.
4. In Supabase, go to **Project Settings > API**. Copy the Project URL and the anon public key into `config.js`, and commit the change. Never use the `service_role` key.
5. In Supabase, go to **Authentication > Sign In / Providers > Email**. Turn off "Confirm email" if you want admins to log in straight after registering. Leave it on if you want them to confirm their email first.
6. Open the app and register your own account. Then in the SQL Editor run: `update public.profiles set role = 'owner', status = 'approved' where email = 'your-email@example.com';`
7. **Go live:** in GitHub, open Settings > Pages and publish from the main branch, root folder. Your app is at the link GitHub shows.

## Folder guide

| Path | What it is |
| --- | --- |
| `index.html` | The app. Open this page |
| `config.js` | Where you paste your Supabase URL and anon key |
| `js/` and `css/` | The app's pages and styles |
| `supabase/schema.sql` | The whole database: tables, security rules, voting functions, photo storage |
| `assets/logo.svg` | The VoteBox logo |
| `docs/design-preview.html` | Design preview (colours, logo, key screens) |
| `docs/prototype-single-device.html` | The first prototype (one device, no accounts) |

## Build progress

- [x] Logo and design
- [x] Database and security rules
- [x] Owner dashboard
- [x] Admin pages (elections, candidates, voters, PIN reset, live results)
- [x] Voter pages (register, sign in, vote, YES / NO, live results)
- [ ] Put the app online and test it with real accounts

## Security notes

- Ballots are stored with no voter id and no timestamp. Nobody can read the votes table directly. Live totals come only from `get_results()` (the admin) and `get_public_results()` (the public page, if the admin leaves it on).
- Live results are a trade-off. In a small election, someone watching the screen while a person votes could tell how that person voted, and early leaders can sway late voters. The admin can switch the public page off.
- A voter can vote once. The vote and the "has voted" mark are saved together in one step. Nobody, including the admin and the owner, can see who voted for whom, only the totals.
- PINs are stored hashed and admins cannot read them. After 5 wrong PINs a voter is locked until the admin resets the PIN. A reset PIN is shown to the admin once, and the voter can change it themselves after signing in.
- Each voter shows how many times their PIN was reset, so resets are visible.
- The admin approves the voters, so voters must trust their admin. The voter list locks when voting opens.
- The Supabase **anon key** is meant to be public. The **service_role key** is secret: never put it in this repository.
- Deleting an admin deletes their elections, voters and votes. Download results first.
