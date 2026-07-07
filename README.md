# LivStyle Assessment Directory

A password-protected, country-scoped dashboard over the **LivStyle Personality Assessments** Airtable base.
Same stack as your other apps: single-file HTML on Netlify, Airtable backend, a Netlify Function proxy holding the token, GitHub for version control.

**Airtable base:** `apppGh1toMfYP7NGK` — tables `Assessments` and `Leaders`.

## How access control works

Access rules live in the **Leaders** table, not in the code:

- **All Access** checked → sees every country.
- Otherwise → sees only the countries listed in **Allowed Countries**.

The filtering happens *inside the Netlify Function*. A scoped leader's browser never receives another country's rows, so the scoping can't be bypassed from the client. Seeded so far:

| Login | Password | Access |
|---|---|---|
| `mel` | `changeme-mel` | All countries |
| `kuba` | `changeme-kuba` | Czech Republic only |

Passwords are stored as plain text in the Leaders table — fine for low-sensitivity internal use, but **change the two placeholders** and set real passwords for anyone you add. (If you ever want hashed passwords instead, that's a small change to the function.)

## Repo layout

```
/dashboard.html            → deploy as the site's index (rename to index.html)
/netlify/functions/livstyle.js
/netlify.toml              → see below
```

Minimal `netlify.toml`:

```toml
[build]
  functions = "netlify/functions"
  publish = "."
```

## Netlify setup

1. Push the repo to GitHub (e.g. `github.com/Melnwood/livstyle`) and connect it in Netlify, or drag-and-drop the folder.
2. In **Site settings → Environment variables**, add:
   - `AIRTABLE_PAT` → an Airtable personal access token with `data.records:read` on this base. **This is the only place the token lives.**
   - Optional overrides (defaults shown): `AIRTABLE_BASE_ID=apppGh1toMfYP7NGK`, `AIRTABLE_ASSESSMENTS_TABLE=Assessments`, `AIRTABLE_LEADERS_TABLE=Leaders`.
3. Deploy. Open the site, sign in as `mel` / `changeme-mel`.

## Loading the assessment data

50 records are already in the **Assessments** table. To load the remaining 473:

1. Open the **Assessments** table in Airtable.
2. Top-right of the table → **+ / Import data → CSV file** → choose **`LivStyle_Assessments_import_473.csv`**.
3. Choose **“Insert into current table”** (not new table). Columns are named to match the fields exactly, so they auto-map. Confirm the Country and personality columns map to the existing single-select fields.

`LivStyle_Assessments_ALL_523.csv` is a full backup of all 523 rows — only use it if the first 50 get removed (importing it on top of the existing 50 would duplicate them).

## Data notes

The source spreadsheet was cleaned on the way in:
- One fully-blank row dropped (524 → 523 people).
- Country spellings normalized (e.g. the two “Former 1st/2nd Culture Staff” typo variants).
- Three out-of-range cells corrected against their 0–1 scale: Jirka Jedlicka (Recognition 3.25 → 0.25), Mitchell Bradford (Consistency “00%” → 0), Michal Skiba (four C.A.R.E. values “x” → blank).
- Personality spelling “Vysionary” → “Visionary”.
- Trait scores stored as decimals (0.70 displays as 70%); PP#/PUP# kept as two-digit text to preserve leading zeros.
- Three people appear twice (David Drapak, Ian Landis, Sam Lunz) — legitimate re-assessments, both kept.
