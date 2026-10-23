# Taste Concierge: group plans powered by Qloo

An AI agent that plans an outing that **everyone** in a group will enjoy.
You enter a city, an occasion and what each friend likes (artists, films, shows, books, food).
The agent finds real venues in that city that match the whole group's taste and explains, friend by friend, why each place fits.

Built by Vadym Bilobrovets (Solar DePin Hub) for the Qloo Agentic Hackathon.

## How the agent works

Every step is streamed to the UI, so you can see what the agent is doing.

1. **Plan (LLM).** Reads the free-text tastes, extracts named entities with a guessed type, and picks 2–3 stops that fit the occasion (e.g. dinner → wine bar).
2. **Resolve tastes (Qloo `/search`).** Each name becomes a Qloo entity ID. We search with and without the type and keep only results whose name really matches.
3. **Find venue types (Qloo `/v2/tags`).** Each stop ("ramen", "wine bar", "museum") is mapped to place tags (`filter.parents.types=urn:entity:place`).
4. **Find places (Qloo `/v2/insights`).** `filter.type=urn:entity:place`, `filter.location.query=<city>`, `filter.tags=<tag>`, `signal.interests.entities=<everyone's IDs>`. Tags that return nothing are skipped automatically.
5. **Check every friend (Qloo `/v2/insights` again).** One call per friend with only their entities. That gives a per-friend affinity for each venue, so we can prefer places that fit everybody, not just the loudest taste.
   Each friend's line on a venue shows where Qloo ranked it for that friend alone, for example "#3 of 50 for Anna", or "not in Olya's top 50". The rank comes straight from Qloo's ordering, not from the LLM.
6. **Write the plan (LLM).** Picks one venue per stop and writes a short reason for each friend, using only venues returned by Qloo.

Qloo is the core: without it there are no venues and no taste scores. The LLM only plans and writes text.

## Stack

- Next.js 14 (App Router), one API route (`app/api/plan/route.js`) that streams NDJSON steps
- Qloo Insights API (hackathon base URL), called server-side only; the key never reaches the browser
- LLM: Google Gemini (flash-lite) first and Featherless (Qwen2.5-14B-Instruct) as fallback (`LLM_ORDER`), then a plain parser/template if both fail. In our runs on 23 October this cut a three-friend London plan from about 22 s to about 8 s
- Deployed on Vercel

No Qloo response data is stored or committed. Everything is fetched live per request.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the keys
npm run dev                  # http://localhost:3000
```

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `QLOO_API_KEY` | yes | Qloo hackathon key |
| `QLOO_BASE_URL` | no | defaults to `https://hackathon.api.qloo.com` |
| `FEATHERLESS_API_KEY` | one of the two LLMs | primary LLM |
| `FEATHERLESS_MODEL` | no | default `Qwen/Qwen2.5-14B-Instruct` |
| `GEMINI_API_KEY` | one of the two LLMs | fallback LLM |
| `GEMINI_MODEL` | no | default `gemini-flash-lite-latest` |
| `LLM_ORDER` | no | default `gemini,featherless` |

## License

MIT
