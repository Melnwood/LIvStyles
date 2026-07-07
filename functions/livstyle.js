// netlify/functions/livstyle.js
// Server-side auth + country-scoped data for the LivStyle dashboard.
// The Airtable token lives ONLY here (Netlify env var AIRTABLE_PAT).
//
// GET  /.netlify/functions/livstyle        -> health check (open in a browser to diagnose)
// POST /.netlify/functions/livstyle {login,password} -> auth + scoped data

const BASE_ID = process.env.AIRTABLE_BASE_ID || "apppGh1toMfYP7NGK";
const ASSESSMENTS_TABLE = process.env.AIRTABLE_ASSESSMENTS_TABLE || "Assessments";
const LEADERS_TABLE = process.env.AIRTABLE_LEADERS_TABLE || "Leaders";
const PAT = process.env.AIRTABLE_PAT;

const API = "https://api.airtable.com/v0";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body, null, 2),
  };
}

async function airtableList(table, params = {}) {
  const records = [];
  let offset;
  do {
    const url = new URL(`${API}/${BASE_ID}/${encodeURIComponent(table)}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch {}
      const err = new Error(`Airtable ${table} returned ${res.status}. ${detail}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function esc(v) { return String(v).replace(/'/g, "\\'"); }

async function health() {
  const report = { ok: false, patPresent: !!PAT, baseId: BASE_ID, leadersTable: LEADERS_TABLE, assessmentsTable: ASSESSMENTS_TABLE };
  if (!PAT) { report.problem = "AIRTABLE_PAT is not set in this deploy. Add it in Netlify, then Clear cache and deploy."; return json(200, report); }
  try {
    const leaders = await airtableList(LEADERS_TABLE);
    report.leadersFound = leaders.length;
    report.activeLogins = leaders.filter(r => r.fields.Active === true).map(r => (r.fields.Login || "").toString());
    if (!report.leadersFound) report.problem = "Connected, but the Leaders table has no rows.";
    else if (!report.activeLogins.length) report.problem = "Leaders exist but none have Active checked.";
  } catch (e) {
    report.problem = "Can't read the Leaders table. " + e.message +
      (e.status === 403 ? " (403 = this token doesn't have access to this base — add the base to the token in Airtable.)" :
       e.status === 404 ? " (404 = base id or table name is wrong.)" : "");
    return json(200, report);
  }
  try {
    const url = new URL(`${API}/${BASE_ID}/${encodeURIComponent(ASSESSMENTS_TABLE)}`);
    url.searchParams.set("pageSize", "1");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    report.assessmentsReadable = res.ok;
    if (!res.ok) report.assessmentsNote = `Assessments table returned ${res.status}.`;
  } catch (e) { report.assessmentsReadable = false; report.assessmentsNote = e.message; }
  report.ok = !report.problem;
  if (report.ok) report.problem = "Everything looks good — the function can read your base. If sign-in still fails it's the password (must match the Leaders row exactly) or a stale deploy of index.html.";
  return json(200, report);
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") return health();
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  if (!PAT) return json(500, { error: "Server is missing its Airtable token. Set AIRTABLE_PAT in Netlify and redeploy." });

  let login, password;
  try { ({ login, password } = JSON.parse(event.body || "{}")); }
  catch { return json(400, { error: "Bad request." }); }
  if (!login || !password) return json(400, { error: "Enter your login and password." });

  let leaders;
  try {
    leaders = await airtableList(LEADERS_TABLE, { filterByFormula: `LOWER({Login})='${esc(String(login).toLowerCase())}'` });
  } catch (e) {
    return json(502, { error: "Couldn't reach the directory (" + (e.status || "network") + "). The token may not have access to the base." });
  }

  const leader = leaders.find((r) => (r.fields.Password || "") === password && r.fields.Active === true);
  if (!leader) return json(401, { error: "That login and password don't match, or the account is inactive." });

  const allAccess = leader.fields["All Access"] === true;
  const allowed = Array.isArray(leader.fields["Allowed Countries"]) ? leader.fields["Allowed Countries"] : [];

  let assessments;
  try { assessments = await airtableList(ASSESSMENTS_TABLE); }
  catch (e) { return json(502, { error: "Couldn't load assessments. Try again in a moment." }); }

  const visible = allAccess ? assessments : assessments.filter((r) => allowed.includes(r.fields.Country));
  const records = visible.map((r) => ({ id: r.id, ...r.fields }));

  return json(200, {
    ok: true,
    name: leader.fields.Name || login,
    role: leader.fields.Role || "",
    allAccess,
    allowedCountries: allAccess ? [...new Set(assessments.map((r) => r.fields.Country).filter(Boolean))].sort() : allowed.slice().sort(),
    count: records.length,
    records,
  });
};
