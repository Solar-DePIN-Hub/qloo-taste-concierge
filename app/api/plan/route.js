import { searchEntity, findPlaceTags, placeInsights, ENTITY_TYPES } from "../../../lib/qloo";
import { askJson } from "../../../lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PLANNER = `You are the planning step of a group-outing agent. Given a city, an occasion and each friend's free-text tastes, output JSON only:
{"friends":[{"name":"...","interests":[{"query":"exact name of an artist/movie/show/book/brand/place/game","type":"urn:entity:artist|urn:entity:person (directors, actors)|urn:entity:movie|urn:entity:tv_show|urn:entity:book|urn:entity:brand|urn:entity:place|urn:entity:videogame|urn:entity:podcast"}],"food":["generic food or drink words like ramen, natural wine"]}],
"stops":[{"label":"short human label e.g. Dinner","tag_query":"one or two words describing a venue type, e.g. ramen, wine bar, coffee, museum, jazz club, italian"}],
"reasoning":"one sentence on why these stops"}
Rules: 2-3 stops that fit the occasion and the group's food/drink words. Max 4 interests per friend. Only real named entities go in interests; generic words go in food. Keep names as written.`;

const WRITER = `You are the final step of a group-outing agent. You receive candidate venues found by the Qloo Taste AI API, with per-friend affinity scores (0-1, higher = closer to that friend's tastes; null = not in that friend's top results). Pick ONE venue per stop (prefer high group affinity AND coverage of every friend), and output JSON only:
{"title":"short catchy plan title","summary":"2 sentences","stops":[{"label":"...","venue_id":"...","why":"1 sentence","per_friend":[{"name":"friend","reason":"short reason linking the venue to THIS friend's tastes"}]}],"tip":"one practical tip"}
Only use venue_ids from the candidates. Ground reasons mainly in what each friend said (\"said\") and the venue tags; do not invent facts like prices or opening hours.`;

function naivePlan(friends, occasion) {
  return {
    friends: friends.map((f) => ({
      name: f.name,
      interests: f.tastes.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 4).map((q) => ({ query: q })),
      food: [],
    })),
    stops: [{ label: "Dinner", tag_query: "restaurant" }, { label: "Drinks", tag_query: "bar" }],
    reasoning: `Default plan for: ${occasion || "an evening out"}`,
  };
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const city = String(body.city || "").slice(0, 80).trim();
  const occasion = String(body.occasion || "").slice(0, 200).trim();
  const friends = (Array.isArray(body.friends) ? body.friends : [])
    .map((f) => ({ name: String(f.name || "").slice(0, 40).trim(), tastes: String(f.tastes || "").slice(0, 300).trim() }))
    .filter((f) => f.name && f.tastes).slice(0, 5);
  if (!city || friends.length < 1) return Response.json({ error: "Add a city and at least one friend with tastes." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const t0 = Date.now();
      const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const step = (kind, title, detail) => send({ type: "step", kind, title, detail, ms: Date.now() - t0 });
      try {
        // 1. Plan
        step("think", "Planning the outing", "Reading everyone's tastes and deciding which stops to look for");
        let plan, planner;
        try {
          const r = await askJson(PLANNER, JSON.stringify({ city, occasion, friends }));
          plan = r.data; planner = r.provider;
        } catch (e) { plan = naivePlan(friends, occasion); planner = "fallback parser"; }
        plan.friends = (plan.friends || []).filter((f) => f?.name).slice(0, 5);
        if (!plan.friends.length) plan = naivePlan(friends, occasion);
        plan.stops = (plan.stops || []).filter((s) => s?.tag_query).slice(0, 3);
        if (!plan.stops.length) plan.stops = naivePlan(friends, occasion).stops;
        step("think", `Plan ready (${planner})`, `${plan.reasoning || ""} Stops: ${plan.stops.map((s) => s.label).join(" → ")}`);

        // 2. Resolve tastes to Qloo entities
        const resolved = await Promise.all(plan.friends.map(async (f) => {
          const items = await Promise.all((f.interests || []).slice(0, 4).map(async (it) => {
            try { return await searchEntity(String(it.query), ENTITY_TYPES.includes(it.type) ? it.type : undefined); } catch { return null; }
          }));
          return { name: f.name, food: f.food || [], entities: items.filter(Boolean) };
        }));
        for (const f of resolved) {
          step("tool", `Qloo /search · ${f.name}`, f.entities.length ? f.entities.map((e) => `${e.name} (${e.type.replace("urn:entity:", "")})`).join(", ") : "No matching entities found");
        }
        const people = resolved.filter((f) => f.entities.length);
        if (!people.length) throw new Error("Qloo could not match any of the tastes. Try well-known artists, films, shows or brands.");
        const allIds = [...new Set(people.flatMap((f) => f.entities.map((e) => e.id)))];

        // 3+4. For every stop: find a place tag, then ask Qloo for the group and for each friend
        const stops = await Promise.all(plan.stops.map(async (s) => {
          let tags = [];
          try { tags = await findPlaceTags(s.tag_query); } catch {}
          let tag = null, group = [];
          for (const t of tags.slice(0, 5)) {
            group = await placeInsights({ city, entityIds: allIds, tagId: t.id, take: 12 }).catch((e) => { console.error("insights", e.message); return []; });
            if (group.length >= 3) { tag = t; break; }
          }
          if (!tag) group = await placeInsights({ city, entityIds: allIds, take: 12 }).catch((e) => { console.error("insights", e.message); return []; });
          const per = await Promise.all(people.map(async (p) => {
            const list = await placeInsights({ city, entityIds: p.entities.map((e) => e.id), tagId: tag?.id, take: 50 }).catch((e) => { console.error("insights", e.message); return []; });
            return [p.name, new Map(list.map((x) => [x.id, x.affinity]))];
          }));
          const cands = group.map((g) => {
            const pf = Object.fromEntries(per.map(([n, m]) => [n, m.has(g.id) ? +m.get(g.id).toFixed(3) : null]));
            const covered = Object.values(pf).filter((v) => v !== null).length;
            return { ...g, per_friend: pf, score: g.affinity + 0.15 * (covered / people.length) };
          }).sort((a, b) => b.score - a.score)
            .filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i).slice(0, 6);
          return { label: s.label, tag_query: s.tag_query, tag, candidates: cands };
        }));
        for (const s of stops) {
          step("tool", `Qloo /v2/tags + /v2/insights · ${s.label}`,
            `${s.tag ? `tag ${s.tag.id}` : `no exact tag for "${s.tag_query}", using all places`} · ${s.candidates.length} venues in ${city}, scored for ${people.length} friends`);
        }
        if (!stops.some((s) => s.candidates.length)) throw new Error(`Qloo returned no places for "${city}". Try a bigger city or a different spelling.`);

        // 5. Write the plan
        step("think", "Choosing venues everyone will like", "Comparing group affinity with each friend's own affinity");
        const brief = {
          city, occasion,
          friends: people.map((p) => ({ name: p.name, said: friends.find((f) => f.name === p.name)?.tastes || "", tastes: p.entities.map((e) => `${e.name}: ${e.tags.slice(0, 3).join("/")}`), food: p.food })),
          stops: stops.filter((s) => s.candidates.length).map((s) => ({ label: s.label,
            candidates: s.candidates.map((c) => ({ venue_id: c.id, name: c.name, group_affinity: +c.affinity.toFixed(3), per_friend: c.per_friend, tags: c.tags })) })),
        };
        let out, writer;
        try { const r = await askJson(WRITER, JSON.stringify(brief)); out = r.data; writer = r.provider; }
        catch { out = null; writer = "template"; }
        const byId = new Map(stops.flatMap((s) => s.candidates.map((c) => [c.id, c])));
        const used = new Set();
        const outStops = out?.stops || [];
        const finalStops = stops.filter((s) => s.candidates.length).map((s, i) => {
          const inStop = (x) => x && s.candidates.some((c) => c.id === x.venue_id) && !used.has(x.venue_id);
          const o = [outStops[i], outStops.find((x) => x?.label === s.label), ...outStops].find(inStop) || null;
          const venue = (o && s.candidates.find((c) => c.id === o.venue_id)) || s.candidates.find((c) => !used.has(c.id)) || s.candidates[0];
          used.add(venue.id);
          return {
            label: s.label, venue, why: o?.why || `Top group affinity for ${s.label.toLowerCase()} in ${city}.`,
            per_friend: o?.per_friend?.length ? o.per_friend : people.map((p) => ({ name: p.name, reason: `Fits tastes like ${p.entities[0].name}` })),
            alternatives: s.candidates.filter((c) => c.id !== venue.id && !used.has(c.id)).slice(0, 2),
          };
        });
        step("think", `Plan written (${writer})`, `${finalStops.length} stops`);
        send({ type: "result", city, title: out?.title || `Taste plan for ${city}`, summary: out?.summary || "", tip: out?.tip || "",
          friends: people.map((p) => ({ name: p.name, entities: p.entities })), stops: finalStops });
      } catch (e) {
        send({ type: "error", message: String(e.message || e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
