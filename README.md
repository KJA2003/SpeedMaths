# Mathlete

**Mental-maths training by [nerdle](https://www.nerdlegame.com).** A fast-paced
arithmetic practice tool — not a daily puzzle. Play timed sprints, track your
progress over time, and let a lightweight on-device skill model steer you toward
your weak spots.

> Working branch for the nerdle launch: **`mathlete`**.
> Originally authored as *SpeedMaths*; being adapted into a nerdle brain-training game.

---

## Overview

Mathlete is a single self-contained `index.html` — all HTML, CSS and vanilla JS,
**no build step and no dependencies**. It runs anywhere a static file can be
served. Two hosted backends are used at runtime:

- **Supabase** — the leaderboard and the ML training-data log.
- **Google Analytics (GA4)** — basic usage analytics (`G-VQLZ9L5D0H`).

Everything else (game history, the skill model, level progress, preferences)
lives in the browser's `localStorage`.

## Features

- **Play** — choose operations (+, −, ×, ÷) and number ranges, pick a duration
  (30 s / 1 / 2 / 5 / 10 min), and answer as many as you can. A live **pace bar**
  shows your speed vs your own average.
- **Results** — score, accuracy, per-operation timing chart, and instant
  "practice your mistakes" drills.
- **History** — score / accuracy / avg-time trends (theme-aware canvas graphs),
  high scores per duration, and a full game log.
- **Practise** — targeted drilling driven by the skill model: "practise weakest",
  auto-detected trouble patterns, and specialised sets (carrying, primes, large
  multiplications, …).
- **Leaderboard** — global best scores by duration and time window (Supabase),
  with a display-name submission and profanity filter.
- **Learn** — a generated level ladder (1 → 10 000+) with star targets.
- **Dark mode** — follows the OS, with a manual toggle in the header.

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
| `get_best_scores` | RPC | Returns top scores for a duration + time window. |
| `question_log` | table | One row per answered question — ML training data. |

**`question_log` columns** (features + identifiers):

```
op, a, b, correct, elapsed_ms, game_position, time_pressure,
units_a, units_b, has_prime, has_carry, mag_a, mag_b,
device_id, session_id, user_id, client_ts        -- identifiers
```

- `device_id` — persistent anonymous per-device UUID (groups a person's answers
  while logged out).
- `session_id` — fresh per game (groups a single sitting).
- `user_id` — nerdle account id; `null` until login is wired, then auto-filled.
- `client_ts` — client `Date.now()` epoch-ms per answer.

Migration that added the identifier columns:
```sql
alter table question_log
  add column if not exists device_id  text,
  add column if not exists session_id text,
  add column if not exists user_id    text,
  add column if not exists client_ts  bigint;
```

> Note: `correct = false` is logged on the first *backspace* (a hesitation /
> self-correction), not a wrong submission — the game only advances on a correct
> answer. Kept intentionally.

### localStorage keys
```
arith_v3           Game history + trouble questions + totalCorrect
arith_skills       On-device skill model (θ per skill key)
arith_learn        Learn-mode level progress + stars
arith_pace         Pace-bar preference
arith_name         Leaderboard display name
mathlete_device_id Persistent anonymous device id (ML logging)
mathlete_user_id   Cached nerdle account id (set once login is wired)
mathlete_theme     'light' | 'dark' manual theme override
```

---

## Deployment

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
| GA4 measurement id | `index.html` head | `G-VQLZ9L5D0H` |
| Supabase URL | `index.html` (`SUPA_URL`) | `https://xlsyaqvkziurxzqgbqps.supabase.co` |
| Supabase anon key | `index.html` (`SUPA_KEY`) | public anon JWT |
| S3 bucket / prefix | `package.json` | `nerdle-serverless-app` / `mathlete` |
| CloudFront distribution | `package.json` | `E2GV7CU2G3KWL8` |

---

## Credits

Game by KJA (SpeedMaths). Nerdle integration and launch prep for
[nerdlegame.com](https://www.nerdlegame.com).
