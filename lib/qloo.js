
const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";

export const ENTITY_TYPES = [
  "urn:entity:artist", "urn:entity:movie", "urn:entity:tv_show", "urn:entity:book",
  "urn:entity:brand", "urn:entity:place", "urn:entity:podcast", "urn:entity:videogame",
  "urn:entity:person", "urn:entity:author", "urn:entity:album", "urn:entity:destination",
];

// Small limiter: the hackathon key returns 429 on bursts.
let active = 0; const queue = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function slot() { if (active >= 4) await new Promise((r) => queue.push(r)); active++; }
function release() { active--; const n = queue.shift(); if (n) n(); }

async function qloo(path, params) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    try { return await qlooOnce(path, params); }
    catch (e) { if (!e.retry || attempt >= 4) throw e; }
    finally { release(); }
    await sleep(400 * (attempt + 1) + Math.random() * 300);
  }
}

async function qlooOnce(path, params) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new Error("QLOO_API_KEY is not set");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, { headers: { "X-Api-Key": key, accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`Qloo ${path} ${res.status}`), { retry: res.status === 429 || res.status >= 500 });
  return res.json();
}

const norm = (x) => String(x).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

// Qloo search is fuzzy, so we query with and without the guessed type and keep a result whose name really matches.
export async function searchEntity(query, type) {
  const q = norm(query);
  const typed = type && ENTITY_TYPES.includes(type) ? qloo("/search", { query, types: type, take: 5 }).catch(() => ({})) : Promise.resolve({});
  const [t, u] = await Promise.all([typed, qloo("/search", { query, take: 5 })]);
  const pool = [...(t.results || []), ...(u.results || [])]
    .filter((r) => !(r.types || []).some((x) => x === "urn:entity:place" || x === "urn:entity:locality") || type === "urn:entity:place");
  const words = q.split(" ");
  const hit = pool.find((r) => norm(r.name) === q) || pool.find((r) => words.every((w) => norm(r.name).split(" ").includes(w)));
  if (!hit) return null;
  return {
    id: hit.entity_id,
    name: hit.name,
    type: (hit.types || [])[0] || "",
    description: hit.properties?.short_description || hit.disambiguation || "",
    tags: (hit.tags || []).slice(0, 6).map((t) => t.name),
  };
}

export async function findPlaceTags(text) {
  const data = await qloo("/v2/tags", { "filter.query": text, "filter.parents.types": "urn:entity:place", take: 6 });
  return (data.results?.tags || []).map((t) => ({ id: t.id, name: t.name }));
}

export async function placeInsights({ city, entityIds, tagId, take = 15 }) {
  const params = {
    "filter.type": "urn:entity:place",
    "filter.location.query": city,
    "signal.interests.entities": entityIds.join(","),
    take,
  };
  if (tagId) params["filter.tags"] = tagId;
  const data = await qloo("/v2/insights", params);
  return (data.results?.entities || []).map((e) => ({
    id: e.entity_id,
    name: e.name,
    affinity: e.query?.affinity ?? 0,
    address: e.properties?.address || "",
    website: e.properties?.website || "",
    rating: e.properties?.business_rating ?? null,
    price: e.properties?.price_level ?? null,
    tags: (e.tags || []).slice(0, 8).map((t) => t.name),
    lat: e.location?.lat, lon: e.location?.lon,
  }));
}
