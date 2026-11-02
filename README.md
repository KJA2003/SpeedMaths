# Mathlete

**Daily mental-maths challenge by [nerdle](https://www.nerdlegame.com).** Every day
there's a 2-minute Daily Challenge, the same for everyone, with its own leaderboard
and streak. Alongside it, practice games track your progress over time, and the Train
tab uses a lightweight on-device skill model to drill your weak spots.

Wording used in the game: **Daily** (the challenge), **Practice** (free practice
games, page id `play`), **Train** (skill-model drills, page id `practice`). The page
ids and GA `mode` values (`play`, `practice`) are unchanged, so analytics stay
continuous.

> Relaunched as a daily game on 31 Oct 2026. `main` and `mathlete` are in step; deploy
> from `main`. Originally authored as *SpeedMaths* by Kiran Allen.

---

## Overview

Mathlete is a single self-contained `index.html` — all HTML, CSS and vanilla JS,
**no build step and no dependencies**. It runs anywhere a static file can be
served. Two hosted backends are used at runtime:

- **Supabase** — the leaderboards (daily and all-time) and the ML training-data log.
- **Google Analytics (GA4)** — usage analytics, sent to two properties:
  `G-VQLZ9L5D0H` (original) and `G-MRLY2WKXE9` (nerdle games, exported to BigQuery).

Everything else (game history, the skill model, level progress, preferences)
lives in the browser's `localStorage`.

## Features

- **Daily** — the Daily Challenge (see [below](#daily-challenge)). The landing page
  and main game for everyone.
- **Practice** (the `play` page) — practice games, the alternative to the Daily, under
  a permanent "mathlete practice mode" heading: choose operations (+, −, ×, ÷) and
  number ranges, pick a duration (30 s / 1 / 2 / 5 / 10 min), and answer as many as
  you can. A live **pace bar** shows your speed vs your own average. "Or play today's
  Daily Challenge" (or "See today's Daily result") under the button leads back.
- **Results** — score, accuracy, per-operation timing chart, and an instant "Train on
  mistakes" drill.
- **History** — score / accuracy / avg-time trends (theme-aware canvas graphs),
  high scores per duration, and a full game log.
- **Train** (the `practice` page) — targeted drilling driven by the skill model: "Weakest questions",
  auto-detected trouble patterns, and specialised sets (carrying, primes, large
  multiplications, …).
- **Leaderboard** — global best scores by duration and time window (Supabase),
  with a display-name submission and profanity filter.
- **Learn** — a generated level ladder (1 → 10 000+) with star targets.
- **Dark mode** — follows the OS, with a manual toggle in the header.

## Daily Challenge

One 2-minute attempt a day. Everyone gets the same questions: 600 are generated from
the date with a seeded random number generator (`generateDailyQuestions`), so no
server is needed.

**Rules shown to players** (under "How it works" on the Daily intro screen, collapsed
until tapped):

- One attempt a day. Everyone gets the same questions.
- Quit or refresh and your attempt ends.
- Difficulty rises from Monday to Sunday. Friday is a special mode.
- Score 5 or more to count towards your streak.
- Your streak survives up to 2 missed days in any 7.

**Difficulty.** Number ranges grow from Monday ("Very Easy", add/subtract up to 20)
to Sunday ("Extreme", add/subtract up to 100, multiply up to 12 × 100), like
Crossnerdle. Fridays use one of eight special modes, rotating weekly (by week of the
year, so the cycle restarts each January): addition & subtraction, addition,
subtraction, multiplication & division, multiplication, division, prime numbers,
and single-digit answers. The three multiplication/division modes use times tables
up to 15 × 15 rather than the usual Friday ranges. See `getDailyConfig` and
`DAILY_SPECIAL_MODES`.

**Streak.** Only the Daily Challenge counts; Practice and Learn don't. Each day with 5+
correct adds 1. The streak survives up to 2 missed days in any 7 (a day played with
fewer than 5 correct counts as missed), and days before a streak began can't count as
missed, so a new streak is safe from day one. The displayed streak is recalculated
every time it's shown (`currentStreak`), so a lapsed streak shows as 0. Shown on the
Daily results screen and on History.

**Attempts.** The attempt is saved the moment the game starts and the score is
updated after every correct answer, so a refresh or closed tab can't give a replay.
There's no pause: the clock runs off wall-clock time and the tabs are hidden during
the game. An unfinished attempt is settled on the next visit — today's when the
Daily page opens, earlier days' on load — and reported as `how_ended: abandoned`.

**Landing and links.** Everyone lands on the Daily. First-time visitors see "One
2-minute maths challenge a day" and a looping demo (questions typed and turning green,
no Enter) above it. "Play Daily Challenge" is the first button on the page; "Or play a
practice game" at the bottom of the intro, and "Play a practice game" on the results
screen, lead to the Practice tab, whose button reads "Play practice game". Under that,
"Or play today's Daily Challenge" (or "See today's Daily result" once played) leads
back. The share text links to `nerdlegame.com/mathlete/#daily`, which also switches an
open Mathlete back to the Daily.

**Leaderboard.** Scores go to the Supabase `daily_scores` table through the same
handle dialog as the main leaderboard. What's shown never includes a position or how
many have played:
- **10+ scores today:** the top 5, plus a row "RIC_q3zitz (you) · better than 27% of today's players"
  (or your row highlighted if you're in the top 5).
- **Fewer:** no table, just your score against "usual" past-day scores: the same
  weekday if there are 20+ such scores in the last 4 weeks, else the last 7 days. With
  too little Daily history, on Saturdays and Sundays (whose ranges match a default
  2-minute practice game) it falls back to `PRACTICE_2MIN_CUTS`, the score percentiles
  of 3,102 such practice games (3–30 Oct 2026). Below 10 today, the row reads "better
  than 65% of recent players" (whichever baseline is used). Otherwise nothing.

Percentiles count ties as half and use your score from this device, so they work
whether or not you submitted. Thresholds: `DAILY_LB_MIN_TODAY`, `DAILY_LB_TOP`,
`DAILY_LB_MIN_PAST`. One attempt per device is enforced in the
browser only (local storage), not by the database.

**Analytics events** (GA4, via `gaEvent`). `daily_start`, `daily_complete` and
`daily_share` carry `challenge_date`, `day_of_week` and `friday_mode` (the mode id,
or `none`):

| Event | Extra parameters |
|---|---|
| `daily_start` | — |
| `daily_complete` | `score`, `streak`, `did_complete` (`true` only if time ran out), `how_ended` (`time`, `quit` or `abandoned`) |
| `daily_share` | — |
| `daily_announce_view` / `daily_announce_dismiss` | — (the one-time "New: the Daily Challenge" card) |
| `daily_to_practice` | `from` (`intro` or `results`): a practice-game link on the Daily |
| `practice_to_daily` | `played_today` (`true`/`false`): the Daily link on the Practice tab |

**Launch announcement.** Players with Mathlete history from before the launch
(`DAILY_LAUNCH_TS`, 31 Oct 2026) see a one-time card on the Daily page explaining the
new streak rules.

To use these parameters in GA4's standard reports they must be registered as
custom dimensions; the BigQuery export has them regardless.

## Skill model (the "ML")

A lightweight **online, per-skill ability estimator** running entirely in the
browser (`localStorage['arith_skills']`). Each question is decomposed into skill
keys (operation, units digits, prime operands, carry/borrow, magnitude buckets,
the exact question) and every answer nudges a per-key ability score `θ`, weighted
by speed and time-pressure. It powers the weakness-ranked practice.

Separately, every answer is logged to Supabase (`question_log`) as a feature row
— this is the raw training data for a future, properly-trained difficulty model.
See [Data & backends](#data--backends).

---

## Repository layout

```
index.html      The entire app (HTML + CSS + JS)
package.json     Deploy / invalidate scripts (no build, no deps)
README.md        This file
```

## Running locally

No install or build. Two options:

**Quickest** — open the file directly:
```
# just double-click index.html, or:
start index.html        # Windows
open index.html         # macOS
```
Gameplay, history, the skill model, dark mode and the leaderboard all work from
`file://`.

**Recommended** — serve over HTTP (needed for anything origin-sensitive, e.g. the
nerdle login flow once it's added):
```
# any static server on port 8080, e.g.:
npx http-server . -p 8080
# or
python -m http.server 8080
```
Then visit <http://localhost:8080>. (VS Code's *Live Preview* extension also works.)

---

## Data & backends

### Supabase
Project: `xlsyaqvkziurxzqgbqps` — the anon key is embedded in `index.html`
(public by design; access is governed by Row-Level Security, not secrecy).

| Object | Type | Purpose |
|---|---|---|
| `leaderboard` | table | Submitted scores (`name`, `score`, `duration`, `created_at`). |
| `daily_scores` | table | Daily Challenge scores (`name`, `score`, `challenge_date`, `device_id`). The page inserts and reads it with the anon key. |
| `get_best_scores` | RPC | Returns top scores for a duration + time window. |
| `question_log` | table | One row per answered question — ML training data. |
| `survey_responses` | table | One row per completed feedback survey (see below). |

#### Feedback survey (`survey_responses`)

A short, on-completion feedback survey — modelled on the maffdoku survey format,
ported to this single-file app. It is **schema-driven**: the entire survey is the
`SURVEY` object in `index.html` (`SURVEY.questions`), so editing or adding
questions needs no other code change. Bump the `SURVEY.id` suffix (`-v1` → `-v2`)
to re-prompt everyone after a breaking change.

- **When:** a prominent green *"Give feedback"* button on the results screen after
  a Play game. **Once per user** — hidden after completion (localStorage
  `mathlete_survey_done`); never forced (the results page stays fully usable).
- **Questions** (`answers` jsonb): `enjoyment` (1–5), `difficulty` (1–5, where
  1 = too easy → 5 = too hard), `returnTomorrow` (Definitely / Maybe / Probably
  not), `nps` (0–10), `comeback` (free text, optional).
- **Hidden fields** (`hidden` jsonb — captured silently, not asked): the game just
  played (`score`, `mode`, `accuracy`, `duration`, `ops`), `games_played_total`,
  `used_practice`, `username`, `device_id`, `session_id`, `ga_client_id` (joins to
  the GA4→BQ export), device / PWA / theme / locale — **plus nerdle-ecosystem
  signals** read from shared, same-origin localStorage (works logged-in *or* not):
  `nerdle_classic_games_played` / `_won`, `nerdle_classic_current_streak` /
  `_max_streak`, `is_registered`, `nerdle_token_hash` (SHA-256 of `lbl_token` — a
  stable per-account join key; the raw token is never stored), and
  `nerdle_games_ever_count`. These let you segment responses by how deep a
  respondent is in the nerdleverse (fanatic vs newcomer) without a login flow.
- **Promoted columns** (copied out of `hidden` for easy joins): `device_id`,
  `username`, `ga_client_id`.

Anon-insert, **write-only** — read via the Supabase dashboard (see
[Querying](#querying--analysing-the-data)). Kiran owns the Supabase project;
Richard has dashboard access.

**`question_log` columns** (features + identifiers):

```
op, a, b, correct, elapsed_ms, game_position, time_pressure,
units_a, units_b, has_prime, has_carry, mag_a, mag_b,
device_id, session_id, user_id, username, client_ts, created_at   -- identifiers
```

- `device_id` — persistent anonymous per-device UUID (groups a person's answers
  while logged out). **Note:** a browser tab and the installed PWA have separate
  `localStorage`, so one person can appear as two `device_id`s / handles until login.
- `session_id` — fresh per game (groups a single sitting). Daily Challenge games use
  `daily-<YYYY-MM-DD>-<uuid>`, so `session_id LIKE 'daily-%'` separates Daily answers
  (fixed questions, the same for everyone that day) from practice games. Daily answers
  go to `question_log` and the skill model from 31 Oct 2026; before that they weren't
  recorded.
- `user_id` — nerdle account id; `null` until login is wired, then auto-filled.
- `username` — the chosen leaderboard handle (`HANDLE_xxxxxx`); `null` until the
  player sets one. Only captured from the game *after* the handle exists, so a
  brand-new player's very first game logs `null`.
- `client_ts` — client `Date.now()` epoch-ms per answer.
- `created_at` — server timestamp (`timestamptz`); prefer this for date filtering.

Migrations that added the identifier columns:
```sql
alter table question_log
  add column if not exists device_id  text,
  add column if not exists session_id text,
  add column if not exists user_id    text,
  add column if not exists client_ts  bigint;
-- later:
alter table question_log add column if not exists username text;
```

**Size.** The project is on the Supabase free plan (500 MB database cap; over it the
database goes read-only). On 2 Nov 2026 `question_log` was 262 MB of 303 MB (929k rows,
~280 bytes each) and growing ~10–12k rows/day since the Daily started logging. To save
space and insert IO, the `username`, `acq_source` and `(op, correct)` indexes were
dropped that day (they were barely used); only `question_log_pkey` and
`question_log_created_at_idx` remain. Don't recreate them for one-off analysis. Still
to decide: trim old rows + sample games, or upgrade to Pro.

> Note: `correct = false` is logged on the first *backspace* (a hesitation /
> self-correction), not a wrong submission — the game only advances on a correct
> answer. Kept intentionally.

### Querying / analysing the data

The embedded anon key is effectively **write-mostly**: RLS lets clients INSERT
question / survey rows and read the `leaderboard`, but **`question_log` and
`survey_responses` SELECT are blocked** for the anon role (raw training data /
feedback). A read with the anon key returns an empty array (HTTP 200), *not* an
error — so "0 rows" from the client does **not** mean the table is empty.

To read/analyse it (or run migrations) you need a privileged credential — keep it
**outside this repo**, never commit or deploy it (the anon key belongs in
`index.html`; these do not):

- **Supabase dashboard SQL editor** — the everyday path. Kiran (project owner) and
  invited collaborators query here; it runs as the service role and bypasses RLS.
  The **Table Editor** gives a spreadsheet view of any table.
- **Management API** — run arbitrary SQL (including DDL) from a script/CLI:
  ```bash
  curl -s "https://api.supabase.com/v1/projects/xlsyaqvkziurxzqgbqps/database/query" \
    -H "Authorization: Bearer $SUPABASE_PAT" \
    -H "Content-Type: application/json" \
    -d '{"query":"select count(distinct session_id) as games from question_log;"}'
  ```
  `SUPABASE_PAT` is a **personal access token** from supabase.com → Account →
  Access Tokens (account-scoped, revocable). Store it in an env file outside the
  repo (e.g. under `~/.claude/…`), not in the tree.

Example — unique users and games per hour since a date:
```sql
select date_trunc('hour', created_at) as hour,
       count(distinct device_id)  as users,
       count(distinct session_id) as games
from question_log
where created_at >= '2026-07-09'
group by 1 order by 1;
```

Example — survey headline metrics (avg enjoyment / difficulty + NPS score):
```sql
select count(*) as responses,
       round(avg((answers->>'enjoyment')::numeric),1)  as avg_enjoyment,
       round(avg((answers->>'difficulty')::numeric),1) as avg_difficulty,
       round(100.0 * (
         count(*) filter (where (answers->>'nps')::int >= 9) -
         count(*) filter (where (answers->>'nps')::int <= 6)
       ) / nullif(count(*) filter (where answers->>'nps' is not null),0), 0) as nps_score
from survey_responses where survey_id = 'mathlete-launch-v1';
```

Example — do nerdle veterans rate it differently from newcomers?
```sql
select case
         when coalesce((hidden->>'nerdle_classic_games_played')::int,0) >= 100 then 'veteran (100+ classic)'
         when coalesce((hidden->>'nerdle_classic_games_played')::int,0) > 0   then 'casual'
         else 'new / no classic' end as segment,
       count(*) as responses,
       round(avg((answers->>'enjoyment')::numeric),1) as avg_enjoyment,
       round(avg((answers->>'nps')::numeric),1)       as avg_nps
from survey_responses where survey_id = 'mathlete-launch-v1'
group by 1 order by 2 desc;
```
> Early rows dated 12 Jul 2026 (comments like "test…") are internal tests — filter them out.

### localStorage keys
```
arith_v3           Game history + trouble questions + totalCorrect
arith_skills       On-device skill model (θ per skill key)
arith_learn        Learn-mode level progress + stars
arith_pace         Pace-bar preference
arith_streak       Daily Challenge streak: streak, lastDate, streakStart, activeDates
mathlete_daily_YYYY-MM-DD  That day's Daily attempt: score, ts, done (false = unfinished)
mathlete_daily_whatsnew_seen  '1' once the launch card has been dismissedarith_name         Legacy free-text leaderboard name (old build)
mathlete_username  Leaderboard handle (HANDLE_xxxxxx); set once, editable
mathlete_device_id Persistent anonymous device id (ML logging)
mathlete_user_id   Cached nerdle account id (set once login is wired)
mathlete_theme     'light' | 'dark' manual theme override
mathlete_used_practice  '1' once the player has used Practice (survey hidden field)
mathlete_survey_done    survey id the player has completed (once-per-user dedup)
```

> The survey also *reads* (never writes) shared same-origin nerdle keys —
> `statsState` (classic stats), `lbl_token` (login), `lastPlayed` (cross-game
> recency) — for its hidden fields.

---

## Deployment

### Deploy log

Times are UK time (GMT). Add a line for each deploy. The live file's upload time is
`aws s3api head-object --bucket nerdle-serverless-app --key mathlete/index.html --query LastModified`.

| Deployed | What |
|---|---|
| 2026-10-31 21:07 | **Current.** Daily page rework, Practice/Train tabs, Daily answers logged to the skill model and `question_log`, new Daily leaderboard rules. |
| 2026-10-31 18:33 | Daily is the default landing page for everyone; practice-mode links. |
| 2026-10-31 18:22 | Launch announcement (what's-new card for existing players). |
| 2026-10-31 18:16 | Friday ×/÷ modes capped at 15 × 15. |
| 2026-10-31 17:42 | **Daily Challenge relaunch** (first live version: Kiran's Daily Challenge plus the `#daily` link and settling of abandoned attempts). |
| 2026-07-18 09:54 | Last version before the relaunch. |

Mathlete is served at **<https://nerdlegame.com/mathlete>** from the shared
nerdle serverless app: S3 bucket **`nerdle-serverless-app`** (prefix `/mathlete`)
behind CloudFront distribution **`E2GV7CU2G3KWL8`**. A viewer-request Lambda on
that distribution rewrites any `/mathlete*` path to `/mathlete/index.html`:

```js
if (newuri.startsWith('/mathlete')) {
  newuri = newuri.replace(/^\/mathlete.*/, '/mathlete/index.html');
}
```

### Prerequisites
- AWS CLI installed and configured with credentials that can write to the bucket
  and create CloudFront invalidations (`aws configure`).

### Commands
```bash
npm run deploySub      # sync the site to s3://nerdle-serverless-app/mathlete
npm run invalidateSub  # invalidate /mathlete/* on CloudFront E2GV7CU2G3KWL8
npm run deploy         # both, in order
```

`deploySub` syncs the repo root (excluding `.git`, `.claude`, `node_modules`,
`*.md` and the package files), so the deployable set is effectively `index.html`
plus any static assets you add (favicon, logo, etc.).

> If the `/mathlete` Lambda rewrite lives on a different CloudFront distribution,
> update the id in `package.json` (`invalidateSub`).

---

## Configuration reference

Values worth knowing, all currently in `index.html` / `package.json`:

| What | Where | Value |
|---|---|---|
| GA4 measurement ids | `index.html` head | `G-VQLZ9L5D0H`, `G-MRLY2WKXE9` |
| Supabase URL | `index.html` (`SUPA_URL`) | `https://xlsyaqvkziurxzqgbqps.supabase.co` |
| Supabase anon key | `index.html` (`SUPA_KEY`) | public anon JWT |
| S3 bucket / prefix | `package.json` | `nerdle-serverless-app` / `mathlete` |
| CloudFront distribution | `package.json` | `E2GV7CU2G3KWL8` |

---

## Credits

Game by KJA (SpeedMaths). Nerdle integration and launch prep for
[nerdlegame.com](https://www.nerdlegame.com).
