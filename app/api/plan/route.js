import { searchEntity, findPlaceTags, placeInsights, ENTITY_TYPES } from "../../../lib/qloo";
import { askJson } from "../../../lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PLANNER = `You are the planning step of a group-outing agent. Given a city, an occasion and each friend's free-text tastes, output JSON only:
{"friends":[{"name":"...","interests":[{"query":"exact name of a SPECIFIC artist/movie/show/book/brand/game/person","type":"urn:entity:artist|urn:entity:person (directors, actors)|urn:entity:movie|urn:entity:tv_show|urn:entity:book|urn:entity:brand|urn:entity:videogame|urn:entity:podcast"}],"genres":["generic likes: jazz, museums, films, sushi, ramen, natural wine"]}],
"stops":[{"label":"short human label e.g. Dinner","tag_query":"one or two words for a venue type, e.g. ramen, sushi, wine bar, coffee, museum, jazz club, cinema","for":["names of friends whose tastes drive this stop"]}],
"reasoning":"one sentence on why these stops"}
Rules: 2-3 stops, each ONE venue type (never combine two types in one stop). EVERY friend must appear in the "for" list of at least one stop, driven by their own tastes (e.g. a jazz lover -> jazz club, a film lover -> cinema). Combine friends into one stop when tastes overlap. Only real, specific named works/people go in interests; generic words (genres, cuisines, "films", "museums", "jazz") go in genres, never in interests. Max 4 interests per friend. Keep names as written.`;

const WRITER = `You are the final step of a group-outing agent. You receive candidate venues found by the Qloo Taste AI API for each stop. Each stop lists "for": the friends whose tastes drive it. per_friend scores are 0-100 (relative match within that friend's Qloo results; null = not ranked). Pick ONE venue per stop that fits the stop's category and its "for" friends, and output JSON only:
{"title":"short catchy plan title","summary":"2 sentences","stops":[{"label":"...","venue_id":"...","why":"1 sentence","per_friend":[{"name":"friend","reason":"short reason linking the venue to THIS friend's tastes, or honest note if it's mainly for someone else"}]}],"tip":"one practical tip"}
Only use venue_ids from the candidates. Ground reasons in what each friend said ("said") and the venue tags; do not invent facts like prices or opening hours.`;

// Generic words are matched to Qloo place tags, never to entities (avoids "jazz" -> album "Jazz").
const GENERIC = new Set("jazz rock pop blues classical techno house hiphop hip-hop rap metal indie punk folk soul funk disco electronic music concerts gigs live music films film movies movie cinema museums museum art galleries gallery theatre theater books reading anime games gaming sushi ramen pizza burgers tacos coffee tea matcha wine beer cocktails food vegan vegetarian brunch dessert bakery craft beer natural wine specialty coffee italian japanese thai indian mexican french korean chinese georgian ukrainian seafood steak dancing clubbing karaoke comedy history architecture parks nature hiking".split(" "));
const isGeneric = (q) => { const n = String(q).toLowerCase().trim(); return GENERIC.has(n) || n.split(/\s+/).every((w) => GENERIC.has(w)); };
const TAG_ALIAS = { cinema: "urn:tag:category:place:movie_theater", cinemas: "urn:tag:category:place:movie_theater", film: "urn:tag:category:place:movie_theater", films: "urn:tag:category:place:movie_theater", movies: "urn:tag:category:place:movie_theater", "movie theater": "urn:tag:category:place:movie_theater", museum: "urn:tag:category:place:museum", museums: "urn:tag:category:place:museum" };
const STOP_FOR = (g) => { const n = g.toLowerCase(); if (/film|movie|cinema/.test(n)) return ["Film night", "cinema"]; if (/museum|art|galler|history/.test(n)) return ["Culture", "museum"]; if (/jazz|music|gig|concert|blues/.test(n)) return ["Live music", /jazz/.test(n) ? "jazz club" : "live music"]; if (/coffee|matcha|tea/.test(n)) return ["Coffee", n]; if (/wine|beer|cocktail/.test(n)) return ["Drinks", n.includes("wine") ? "wine bar" : n.includes("beer") ? "craft beer" : "cocktail bar"]; return ["Food", n]; };

function tagRank(id) {
  if (/hotel|nearby_attraction|equipment|decor|ambience|supplier|production|library|setting/.test(id)) return 99;
  if (id.startsWith("urn:tag:category:place:")) return 0;
  if (/^urn:tag:genre:place:[a-z_]+$/.test(id)) return 1;
  if (/^urn:tag:genre:place:restaurant:/.test(id)) return 2;
  if (/specialty_dish|cuisine/.test(id)) return 3;
  return 5;
}
const JUNK = /near me|\bbest\b.*\b(in|near)\b|\btop \d+|^(the )?place$|^\W*$|\bdelivery\b|\bfor sale\b|\bmarketing\b|\.(com|net|ua|org|io)\b|https?:|\s[-–|]\s\S+\s\S+\s\S+|\b(cheap|best|top)\s+\w+\s+(in|near)\b/i;

function naivePlan(friends, occasion) {
  return {
    friends: friends.map((f) => {
      const parts = f.tastes.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      return { name: f.name, interests: parts.filter((q) => !isGeneric(q)).slice(0, 4).map((q) => ({ query: q })), genres: parts.filter(isGeneric) };
    }),
    stops: [],
    reasoning: `Default plan for: ${occasion || "an evening out"}`,
  };
}

// Make sure every friend drives at least one stop (max 3 stops).
function ensureCoverage(plan, friends) {
  const stops = (plan.stops || []).filter((s) => s?.tag_query).map((s) => ({ label: String(s.label || s.tag_query), tag_query: String(s.tag_query), for: (Array.isArray(s.for) ? s.for : []).filter((n) => plan.friends.some((f) => f.name === n)) }));
  for (const f of plan.friends) {
    const said = friends.find((x) => x.name === f.name)?.tastes || "";
    const genres = [...new Set([...(f.genres || []), ...(f.food || []), ...said.split(/[,;\n]/).map((x) => x.trim()).filter(isGeneric)].map((g) => String(g).toLowerCase()))];
    const stem = (w) => w.replace(/s$/, "");
    const related = (s) => { const t = s.tag_query.toLowerCase(); return genres.some((g) => g.split(/\s+/).some((w) => t.includes(stem(w)) || STOP_FOR(g)[1] === t)); };
    // a friend is covered only if a stop's venue type actually comes from their tastes
    for (const s of stops) if (s.for.includes(f.name) && genres.length && !related(s)) s.for = s.for.filter((n) => n !== f.name);
    if (stops.some((s) => s.for.includes(f.name))) continue;
    const rel = stops.find(related); if (rel) { rel.for.push(f.name); continue; }
    const g = genres.find((x) => !/sushi|ramen|pizza|food|coffee|tea|matcha|wine|beer/.test(x)) || genres[0] || (f.interests?.some((i) => /movie|tv_show|person/.test(i.type || "")) ? "films" : "");
    const [label, tq] = g ? STOP_FOR(g) : ["Hangout", "bar"];
    const same = stops.find((s) => s.tag_query.toLowerCase() === tq.toLowerCase());
    if (same) { same.for.push(f.name); continue; }
    if (stops.length < 3) { stops.push({ label, tag_query: tq, for: [f.name] }); continue; }
    // all 3 slots taken: replace a stop whose drivers are covered elsewhere, else share the first stop
    const idx = stops.findIndex((x) => x.for.every((n) => stops.some((y) => y !== x && y.for.includes(n))));
    if (idx >= 0) stops[idx] = { label, tag_query: tq, for: [f.name] }; else stops[0].for.push(f.name);
  }
  for (const s of stops) if (/&| and /i.test(s.label)) s.label = STOP_FOR(s.tag_query)[0];
  plan.stops = stops.filter((s) => s.for.length).slice(0, 3);
  if (!plan.stops.length) plan.stops = [{ label: "Dinner", tag_query: "restaurant", for: plan.friends.map((f) => f.name) }];
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
        plan.friends = (plan.friends || []).filter((f) => f?.name && friends.some((x) => x.name === f.name)).slice(0, 5);
        for (const f of friends) if (!plan.friends.some((x) => x.name === f.name)) plan.friends.push(naivePlan([f]).friends[0]);
        ensureCoverage(plan, friends);
        step("think", `Plan ready (${planner})`, `${plan.reasoning || ""} Stops: ${plan.stops.map((s) => `${s.label} (for ${s.for.join(", ")})`).join(" → ")}`);

        // 2. Resolve specific tastes to Qloo entities (generic words become place tags instead)
        const resolved = await Promise.all(plan.friends.map(async (f) => {
          const items = await Promise.all((f.interests || []).slice(0, 4).filter((it) => it?.query && !isGeneric(it.query)).map(async (it) => {
            try { return await searchEntity(String(it.query), ENTITY_TYPES.includes(it.type) ? it.type : undefined); } catch { return null; }
          }));
          return { name: f.name, genres: [...(f.genres || []), ...(f.food || [])], entities: items.filter(Boolean) };
        }));
        for (const f of resolved) {
          step("tool", `Qloo search · ${f.name}`, [f.entities.length ? `Matched: ${f.entities.map((e) => `${e.name} (${e.type.replace("urn:entity:", "").replace("_", " ")})`).join(", ")}` : "", f.genres.length ? `Used as venue types: ${f.genres.join(", ")}` : ""].filter(Boolean).join(" · ") || "No strong matches");
        }
        const people = resolved;
        const allIds = [...new Set(people.flatMap((f) => f.entities.map((e) => e.id)))];

        // 3+4. For every stop: pick the best place tag, then ask Qloo for the group and for each friend
        const stops = [];
        for (const s of plan.stops) {
          const tq = s.tag_query.toLowerCase().trim();
          let tags = TAG_ALIAS[tq] ? [{ id: TAG_ALIAS[tq], name: s.tag_query }] : [];
          if (!tags.length) { try { tags = (await findPlaceTags(s.tag_query)).filter((t) => tagRank(t.id) < 99).sort((a, b) => tagRank(a.id) - tagRank(b.id)); } catch {} }
          const drivers = people.filter((p) => s.for.includes(p.name));
          const driverIds = [...new Set(drivers.flatMap((p) => p.entities.map((e) => e.id)))];
          const sig = driverIds.length ? driverIds : allIds;
          let tag = null, group = [];
          for (const t of tags.slice(0, 3)) {
            group = await placeInsights({ city, entityIds: sig, tagId: t.id, take: 20 }).catch((e) => { console.error("insights", e.message); return []; });
            group = group.filter((g) => !JUNK.test(g.name.trim()));
            if (group.length >= 3) { tag = t; break; }
          }
          if (!tag) { stops.push({ ...s, tag: null, candidates: [] }); continue; }
          const per = await Promise.all(people.filter((p) => p.entities.length).map(async (p) => {
            const list = await placeInsights({ city, entityIds: p.entities.map((e) => e.id), tagId: tag.id, take: 50 }).catch(() => []);
            const max = Math.max(1e-9, ...list.map((x) => x.affinity || 0));
            // relative match: venue's affinity vs. this friend's top venue in the category
            return [p.name, new Map(list.map((x) => [x.id, Math.round(100 * (x.affinity || 0) / max)]))];
          }));
          const pm = new Map(per);
          const cands = group.map((g) => {
            const pf = Object.fromEntries(people.map((p) => [p.name, pm.get(p.name)?.get(g.id) ?? null]));
            const drv = drivers.map((p) => pf[p.name]).filter((v) => v != null);
            const quality = g.rating ? Math.min(1, g.rating / 5) : 0.6;
            return { ...g, per_friend: pf, score: (g.affinity || 0) + (drv.length ? drv.reduce((a, b) => a + b, 0) / drv.length / 100 : 0) * 0.5 + 0.2 * quality };
          }).sort((a, b) => b.score - a.score)
            .filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i).slice(0, 6);
          stops.push({ ...s, tag, candidates: cands });
        }
        for (const s of stops) {
          step("tool", `Qloo insights · ${s.label}`, s.tag ? `${s.candidates.length} ${s.tag.name.toLowerCase()} venues in ${city}, ranked for ${s.for.join(", ")}` : `No good "${s.tag_query}" venues in ${city}, skipped`);
        }
        if (!stops.some((s) => s.candidates.length)) throw new Error(`Qloo returned no places for "${city}". Try a bigger city or a different spelling.`);

        // 5. Write the plan
        step("think", "Choosing venues everyone will like", "Comparing group affinity with each friend's own affinity");
        const brief = {
          city, occasion,
          friends: people.map((p) => ({ name: p.name, said: friends.find((f) => f.name === p.name)?.tastes || "", tastes: p.entities.map((e) => `${e.name}: ${e.tags.slice(0, 3).join("/")}`), genres: p.genres })),
          stops: stops.filter((s) => s.candidates.length).map((s) => ({ label: s.label, category: s.tag.name, for: s.for,
            candidates: s.candidates.map((c) => ({ venue_id: c.id, name: c.name, group_affinity: +(c.affinity || 0).toFixed(3), per_friend: c.per_friend, tags: c.tags })) })),
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
            label: s.label, venue, why: o?.why || `Top match for ${s.label.toLowerCase()} in ${city}.`,
            for: s.for, category: s.tag.name,
            per_friend: people.map((p) => ({ name: p.name, driver: s.for.includes(p.name), match: venue.per_friend?.[p.name] ?? null,
              reason: o?.per_friend?.find((x) => x?.name === p.name)?.reason || (s.for.includes(p.name) ? `Picked for ${p.name}'s taste: ${friends.find((f) => f.name === p.name)?.tastes}` : "") })),
            alternatives: s.candidates.filter((c) => c.id !== venue.id && !used.has(c.id)).slice(0, 2),
          };
        });
        step("think", `Plan written (${writer})`, `${finalStops.length} stops`);
        send({ type: "result", city, title: out?.title || `Taste plan for ${city}`, summary: out?.summary || "", tip: out?.tip || "",
          friends: people.map((p) => ({ name: p.name, entities: p.entities, genres: p.genres })), stops: finalStops });
      } catch (e) {
        send({ type: "error", message: String(e.message || e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
