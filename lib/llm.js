// Featherless (primary) with Gemini fallback, same pattern as our earlier projects.
const FEATHERLESS_MODEL = process.env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-14B-Instruct";

async function featherless(system, user) {
  const key = process.env.FEATHERLESS_API_KEY;
  if (!key) throw new Error("no featherless key");
  const ctrl = AbortSignal.timeout(+(process.env.FEATHERLESS_TIMEOUT_MS || 10000));
  const res = await fetch("https://api.featherless.ai/v1/chat/completions", {
    method: "POST", signal: ctrl,
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: FEATHERLESS_MODEL, temperature: 0.3, max_tokens: 1400,
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`featherless ${res.status}`);
  const d = await res.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("featherless empty");
  return { text, provider: `Featherless · ${FEATHERLESS_MODEL}` };
}

async function gemini(system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no gemini key");
  const models = [process.env.GEMINI_MODEL || "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
  let last; const start = Date.now();
  for (const m of [...new Set(models)]) {
    if (Date.now() - start > 20000) break;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(25000),
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, responseMimeType: "application/json" } }),
      });
      if (!res.ok) { last = new Error(`gemini ${res.status}`); continue; }
      const d = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("");
      if (text) return { text, provider: `Gemini · ${m}` };
    } catch (e) { last = e; }
  }
  throw last || new Error("gemini failed");
}

function parseJson(text) {
  const s = text.replace(/```json|```/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  return JSON.parse(s.slice(a, b + 1));
}

export async function askJson(system, user) {
  const errors = [];
  for (const fn of [featherless, gemini]) {
    try {
      const r = await fn(system, user);
      return { data: parseJson(r.text), provider: r.provider };
    } catch (e) { errors.push(String(e.message || e)); }
  }
  throw new Error("LLM unavailable: " + errors.join("; "));
}
