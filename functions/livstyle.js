// netlify/functions/livstyle.js
// Server-side auth + country-scoped data + add-a-person for the LivStyle dashboard.
// The Airtable token lives ONLY here (Netlify env var AIRTABLE_PAT).
//
// GET  /.netlify/functions/livstyle                         -> health check
// POST {login,password}                                     -> auth + scoped data
// POST {action:"add", login, password, fields:{...}}        -> create an assessment record

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
      let detail = ""; try { detail = (await res.text()).slice(0, 300); } catch {}
      const err = new Error(`Airtable ${table} returned ${res.status}. ${detail}`);
      err.status = res.status; throw err;
    }
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function airtableCreate(table, fields) {
  const url = `${API}/${BASE_ID}/${encodeURIComponent(table)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) {
    let detail = ""; try { detail = (await res.text()).slice(0, 400); } catch {}
    const err = new Error(`Create failed (${res.status}). ${detail}`);
    err.status = res.status; throw err;
  }
  return res.json();
}

async function airtableUpdate(table, id, fields) {
  const url = `${API}/${BASE_ID}/${encodeURIComponent(table)}/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) {
    let detail = ""; try { detail = (await res.text()).slice(0, 400); } catch {}
    const err = new Error(`Update failed (${res.status}). ${detail}`);
    err.status = res.status; throw err;
  }
  return res.json();
}

async function airtableUpdateMany(table, ids, fields) {
  const url = `${API}/${BASE_ID}/${encodeURIComponent(table)}`;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).map((id) => ({ id, fields }));
    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (!res.ok) {
      let detail = ""; try { detail = (await res.text()).slice(0, 400); } catch {}
      const err = new Error(`Bulk update failed (${res.status}). ${detail}`);
      err.status = res.status; throw err;
    }
  }
}

function esc(v) { return String(v).replace(/'/g, "\\'"); }
function arr(v) { return Array.isArray(v) ? v : []; }

const CONFIG_LOGIN = "__config__";
async function getOrgConfig() {
  const rows = await airtableList(LEADERS_TABLE, { filterByFormula: `{Login}='${CONFIG_LOGIN}'` });
  const rec = rows[0];
  let cfg = { divisions: [], teams: [] };
  if (rec && rec.fields.OrgConfig) { try { cfg = JSON.parse(rec.fields.OrgConfig); } catch {} }
  if (!Array.isArray(cfg.divisions)) cfg.divisions = [];
  if (!Array.isArray(cfg.teams)) cfg.teams = [];
  return { id: rec && rec.id, cfg };
}
async function saveOrgConfig(id, cfg) {
  await airtableUpdate(LEADERS_TABLE, id, { OrgConfig: JSON.stringify(cfg) });
}

async function findLeader(login, password) {
  const leaders = await airtableList(LEADERS_TABLE, {
    filterByFormula: `LOWER({Login})='${esc(String(login).toLowerCase())}'`,
  });
  return leaders.find((r) => (r.fields.Password || "") === password && r.fields.Active === true) || null;
}

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
      (e.status === 403 ? " (403 = this token doesn't have access to this base.)" :
       e.status === 404 ? " (404 = base id or table name is wrong.)" : "");
    return json(200, report);
  }
  try {
    const url = new URL(`${API}/${BASE_ID}/${encodeURIComponent(ASSESSMENTS_TABLE)}`);
    url.searchParams.set("pageSize", "1");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    report.assessmentsReadable = res.ok;
  } catch (e) { report.assessmentsReadable = false; }
  report.ok = !report.problem;
  if (report.ok) report.problem = "Everything looks good — the function can read your base.";
  return json(200, report);
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") return health();
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  if (!PAT) return json(500, { error: "Server is missing its Airtable token. Set AIRTABLE_PAT in Netlify and redeploy." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Bad request." }); }
  const { action, login, password, fields } = body;
  if (!login || !password) return json(400, { error: "Enter your login and password." });

  let leader;
  try { leader = await findLeader(login, password); }
  catch (e) { return json(502, { error: "Couldn't reach the directory (" + (e.status || "network") + "). The token may not have access to the base." }); }
  if (!leader) return json(401, { error: "That login and password don't match, or the account is inactive." });

  // ---- Org structure: read ----
  if (action === "orgGet") {
    try { const { cfg } = await getOrgConfig(); return json(200, { ok: true, org: cfg }); }
    catch (e) { return json(502, { error: "Couldn't load the structure. " + e.message }); }
  }

  // ---- Org structure: add a division / department / team ----
  if (action === "orgAdd") {
    if (leader.fields["Can Edit"] !== true) return json(403, { error: "This account isn't allowed to manage the structure." });
    const kind = body.kind, name = (body.name || "").trim();
    if (!name) return json(400, { error: "Enter a name." });
    try {
      const { id, cfg } = await getOrgConfig();
      if (!id) return json(502, { error: "Structure record not found." });
      if (kind === "division") {
        if (!cfg.divisions.some(d => d.name.toLowerCase() === name.toLowerCase())) cfg.divisions.push({ name, departments: [] });
      } else if (kind === "department") {
        const dv = cfg.divisions.find(d => d.name === body.division);
        if (!dv) return json(400, { error: "Pick a division for this department." });
        if (!dv.departments.some(x => x.toLowerCase() === name.toLowerCase())) dv.departments.push(name);
      } else if (kind === "team") {
        if (!cfg.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) cfg.teams.push({ name, country: (body.country || "").trim() });
      } else return json(400, { error: "Unknown item type." });
      await saveOrgConfig(id, cfg);
      return json(200, { ok: true, org: cfg });
    } catch (e) { return json(502, { error: "Couldn't save the structure. " + e.message }); }
  }

  // ---- Org structure: delete a division / department / team ----
  if (action === "orgDelete") {
    if (leader.fields["Can Edit"] !== true) return json(403, { error: "This account isn't allowed to manage the structure." });
    const kind = body.kind, name = (body.name || "").trim();
    if (!name) return json(400, { error: "Nothing to delete." });
    try {
      const { id, cfg } = await getOrgConfig();
      if (!id) return json(502, { error: "Structure record not found." });
      if (kind === "division") {
        cfg.divisions = cfg.divisions.filter(d => d.name !== name);
      } else if (kind === "department") {
        const dv = cfg.divisions.find(d => d.name === body.division);
        if (dv) dv.departments = dv.departments.filter(x => x !== name);
      } else if (kind === "team") {
        cfg.teams = cfg.teams.filter(t => t.name !== name);
      } else return json(400, { error: "Unknown item type." });
      await saveOrgConfig(id, cfg);
      return json(200, { ok: true, org: cfg });
    } catch (e) { return json(502, { error: "Couldn't update the structure. " + e.message }); }
  }

  // ---- Edit an existing person (any fields) ----
  if (action === "edit") {
    if (leader.fields["Can Edit"] !== true) return json(403, { error: "This account isn't allowed to edit people." });
    if (!body.id || !fields || typeof fields !== "object") return json(400, { error: "Nothing to update." });
    try {
      const updated = await airtableUpdate(ASSESSMENTS_TABLE, body.id, fields);
      return json(200, { ok: true, id: updated.id, name: fields["Full Name"] });
    } catch (e) {
      return json(502, { error: "Couldn't save the changes. " + e.message });
    }
  }

  // ---- Add a person ----
  if (action === "add") {
    if (leader.fields["Can Add"] !== true) return json(403, { error: "This account isn't allowed to add people." });
    if (!fields || typeof fields !== "object" || !fields["Full Name"]) return json(400, { error: "Missing the person's name." });
    try {
      const created = await airtableCreate(ASSESSMENTS_TABLE, fields);
      return json(200, { ok: true, id: created.id, name: fields["Full Name"] });
    } catch (e) {
      return json(502, { error: "Couldn't save the record. " + e.message });
    }
  }

  // ---- Set status (active / inactive), one or many ----
  if (action === "status") {
    if (leader.fields["Can Add"] !== true) return json(403, { error: "This account isn't allowed to change status." });
    const status = body.status;
    if (status !== "Active" && status !== "Inactive") return json(400, { error: "Bad status request." });
    const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
    if (!ids.length) return json(400, { error: "No records selected." });
    try {
      if (ids.length === 1) await airtableUpdate(ASSESSMENTS_TABLE, ids[0], { Status: status });
      else await airtableUpdateMany(ASSESSMENTS_TABLE, ids, { Status: status });
      return json(200, { ok: true, ids, status, count: ids.length });
    } catch (e) {
      return json(502, { error: "Couldn't update status. " + e.message });
    }
  }

  // ---- Login: return scoped data ----
  const allAccess = leader.fields["All Access"] === true;
  const allowedCountries = arr(leader.fields["Allowed Countries"]);
  const allowedTeams = arr(leader.fields["Allowed Teams"]);
  const allowedDivisions = arr(leader.fields["Allowed Divisions"]);
  const allowedDepartments = arr(leader.fields["Allowed Departments"]);

  let assessments;
  try { assessments = await airtableList(ASSESSMENTS_TABLE); }
  catch (e) { return json(502, { error: "Couldn't load assessments. Try again in a moment." }); }

  const visible = allAccess ? assessments : assessments.filter((r) => {
    const f = r.fields;
    return allowedCountries.includes(f.Country)
      || arr(f.Team).some((t) => allowedTeams.includes(t))
      || allowedDivisions.includes(f.Division)
      || allowedDepartments.includes(f.Department);
  });
  const records = visible.map((r) => ({ id: r.id, ...r.fields }));

  let org = { divisions: [], teams: [] };
  try { org = (await getOrgConfig()).cfg; } catch {}

  return json(200, {
    ok: true,
    name: leader.fields.Name || login,
    role: leader.fields.Role || "",
    allAccess,
    canAdd: leader.fields["Can Add"] === true,
    canEdit: leader.fields["Can Edit"] === true,
    org,
    allowedCountries: allAccess ? [...new Set(assessments.map((r) => r.fields.Country).filter(Boolean))].sort() : allowedCountries.slice().sort(),
    count: records.length,
    records,
  });
};
