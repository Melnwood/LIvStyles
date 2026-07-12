// E-Team Insight Dashboard — secure Airtable proxy
// Password is verified HERE, server-side. No data leaves Airtable unless the
// password is correct, so nothing sensitive is ever shipped to an anonymous browser.

const BASE_ID = "apppGh1toMfYP7NGK";
const TABLE_ID = "tblVTZNf2RDVg97r5";

// Only these fields are ever read. Compensation, personal notes, etc. are never touched.
const FIELDS = [
  "Full Name", "Division", "Country",
  "Primary Personality", "Personality Under Pressure",
  "16P Type", "16P Identity",
  "WG Geniuses",
  "CS1", "CS2", "CS3", "CS4", "CS5",
  "SG1", "SG2", "SG3",
  "Key Thread",
  "Leadership Set",
];

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const PASSWORD = process.env.ETEAM_PASSWORD;
  const TOKEN = process.env.AIRTABLE_TOKEN;

  if (!PASSWORD || !TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server not configured. Set ETEAM_PASSWORD and AIRTABLE_TOKEN in Netlify." }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  // Fail closed: wrong or missing password returns nothing at all.
  if (!body.password || body.password !== PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Incorrect password." }) };
  }

  try {
    const people = [];
    let offset;

    // Everyone in the base — the Leadership Set checkbox becomes a filter in the UI,
    // not a gate on what loads.
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
      url.searchParams.set("pageSize", "100");
      FIELDS.forEach((f) => url.searchParams.append("fields[]", f));
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });

      if (!res.ok) {
        const detail = await res.text();
        return { statusCode: 502, body: JSON.stringify({ error: "Airtable error", detail }) };
      }

      const data = await res.json();

      data.records.forEach((r) => {
        const f = r.fields || {};
        const name = f["Full Name"];
        if (!name) return; // skip blank rows

        const cs = ["CS1", "CS2", "CS3", "CS4", "CS5"].map((k) => f[k]).filter(Boolean);
        const sg = ["SG1", "SG2", "SG3"].map((k) => f[k]).filter(Boolean);

        people.push({
          id: r.id,
          n: name,
          g: f["Division"] || f["Country"] || "Unassigned",
          co: f["Country"] || "",
          lead: f["Leadership Set"] === true,
          lp: f["Primary Personality"] || "",
          lu: f["Personality Under Pressure"] || "",
          t: f["16P Type"] || "",
          id16: f["16P Identity"] || "",
          wg: asArray(f["WG Geniuses"]),
          cs,
          sg,
          kt: f["Key Thread"] || "",
        });
      });

      offset = data.offset;
    } while (offset);

    people.sort((a, b) => a.n.localeCompare(b.n));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ people, fetched: new Date().toISOString() }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
