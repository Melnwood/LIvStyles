// netlify/functions/livstyle.js
// Server-side auth + country-scoped data for the LivStyle dashboard.
// The Airtable token lives ONLY here (Netlify env var AIRTABLE_PAT).
// A leader is authenticated against the Leaders table, then receives ONLY
// the assessments for the countries they're allowed to see (or all, if All Access).

const BASE_ID = process.env.AIRTABLE_BASE_ID || "apppGh1toMfYP7NGK";
const ASSESSMENTS_TABLE = process.env.AIRTABLE_ASSESSMENTS_TABLE || "Assessments";
const LEADERS_TABLE = process.env.AIRTABLE_LEADERS_TABLE || "Leaders";
const PAT = process.env.AIRTABLE_PAT;

const API = "https://api.airtable.com/v0";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
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
    if (!res.ok) throw new Error(`Airtable ${table} ${res.status}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

// Escape a value for use inside an Airtable formula string literal.
function esc(v) {
  return String(v).replace(/'/g, "\\'");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  if (!PAT) return json(500, { error: "Server is missing its Airtable token. Set AIRTABLE_PAT in Netlify." });

  let login, password;
  try {
    ({ login, password } = JSON.parse(event.body || "{}"));
  } catch {
    return json(400, { error: "Bad request." });
  }
  if (!login || !password) return json(400, { error: "Enter your login and password." });

  let leaders;
  try {
    leaders = await airtableList(LEADERS_TABLE, {
      filterByFormula: `LOWER({Login})='${esc(String(login).toLowerCase())}'`,
    });
  } catch (e) {
    return json(502, { error: "Couldn't reach the directory. Try again in a moment." });
  }

  const leader = leaders.find((r) => (r.fields.Password || "") === password && r.fields.Active === true);
  if (!leader) return json(401, { error: "That login and password don't match, or the account is inactive." });

  const allAccess = leader.fields["All Access"] === true;
  const allowed = Array.isArray(leader.fields["Allowed Countries"]) ? leader.fields["Allowed Countries"] : [];

  let assessments;
  try {
    assessments = await airtableList(ASSESSMENTS_TABLE);
  } catch (e) {
    return json(502, { error: "Couldn't load assessments. Try again in a moment." });
  }

  // Enforce scope SERVER-SIDE: a scoped leader never receives other countries' rows.
  const visible = allAccess
    ? assessments
    : assessments.filter((r) => allowed.includes(r.fields.Country));

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
