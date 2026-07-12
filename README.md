# E-Team Insight Dashboard

A password-gated dashboard for the Josiah Venture Executive Team, reading live from the
**LivStyle Personality Assessments** Airtable base.

- Base: `apppGh1toMfYP7NGK`
- Table: `Assessments` (`tblVTZNf2RDVg97r5`)
- Shows **all staff**, with a one-tap toggle to isolate the **Leadership Set** (currently 45
  people with full multi-framework profiles and Key Threads).

---

## Files

| File | What it is |
|---|---|
| `index.html` | The whole dashboard — password gate, roster, person panels, Compare, Build-a-team |
| `netlify/functions/people.js` | Server-side proxy: checks the password, then reads Airtable |
| `netlify.toml` | Netlify config + no-index / no-frame headers |

---

## Deploy

1. Push this folder to a new private GitHub repo (e.g. `Melnwood/eteam-insight`).
2. Netlify → **Add new site → Import an existing project** → pick the repo.
   No build command needed; publish directory is `.`.
3. Netlify → **Site configuration → Environment variables** → add both:

   | Key | Value |
   |---|---|
   | `AIRTABLE_TOKEN` | Airtable personal access token with `data.records:read` on this base |
   | `ETEAM_PASSWORD` | the shared E-Team password you choose |

4. Deploy.

> If the site loads but says *"Server not configured"*, the environment variables are missing
> or misspelled. Add them and **redeploy** — Netlify only picks up env vars on a new build.

---

## How it's secured

The password is verified **inside the Netlify function**, never in the browser. Someone who
opens the site without it — or views source — gets an empty shell: no names, no assessments,
nothing. Data is returned only after the password matches. The Airtable token stays
server-side and is never exposed.

Sign-in lasts for the browser tab only (`sessionStorage`); closing the tab signs out.

**Worth being clear-eyed about:** once someone has the password, they can see every staff
member's assessment results. That's the intended design — the E-Team sees everybody — but it
means the password is the only thing protecting the most personal data JV holds on its people.
Choose something strong, share it verbally rather than by email, and change it if someone
rotates off the team.

---

## The two views

The toggle under the title switches between:

- **Leadership set** — the people ticked in the `Leadership Set` field. Full profiles.
- **Everyone** — all staff. Most currently show LivStyle only, with honest
  "not on file yet" placeholders. This doubles as a coverage map of who still owes assessments.
  Leadership-set people carry a gold ★ so they stay findable in the crowd.

### Changing who's in the Leadership Set

Tick or untick the **`Leadership Set`** checkbox on any person in Airtable. It's reflected on
the next page load. No code change, no redeploy.

---

## Adding a Key Thread for someone

Write it into the **`Key Thread`** field on their record, in this format:

```
[evidence across the frameworks]. Thread: [the essence].
```

The dashboard splits on `Thread:` — the part after becomes the headline in the dark banner,
the part before becomes the supporting evidence line beneath it. Anyone without a Key Thread
shows a neutral placeholder rather than an invented one.

---

## Fields the dashboard reads

`Full Name` · `Division` · `Country` · `Primary Personality` ·
`Personality Under Pressure` · `16P Type` · `16P Identity` · `WG Geniuses` ·
`CS1`–`CS5` · `SG1`–`SG3` · `Key Thread` · `Leadership Set`

Nothing else is touched. Compensation, notes, and every other field in the base are never read.

---

## Grouping

People are grouped by the **`Division`** field, falling back to **`Country`** when Division is
empty. If the E-Team would rather see the leadership tiers (Presidents / IRD / National /
Council / Countries), add a field for that in Airtable and it's a one-line change in
`people.js`.
