"use client";
import { useState } from "react";

const EXAMPLES = [
  { city: "Kyiv", occasion: "Friday evening: dinner, then drinks", friends: [
    { name: "Vadym", tastes: "Radiohead, Blade Runner 2049, ramen" },
    { name: "Ira", tastes: "Taylor Swift, Pride and Prejudice, natural wine" },
    { name: "Max", tastes: "Interstellar, Daft Punk, craft beer" } ] },
  { city: "London", occasion: "Saturday: something for everyone", friends: [
    { name: "Ann", tastes: "jazz, sushi" },
    { name: "Bob", tastes: "museums, ramen" },
    { name: "Cat", tastes: "Wes Anderson films" } ] },
];

export default function Home() {
  const [city, setCity] = useState(EXAMPLES[0].city);
  const [occasion, setOccasion] = useState("");
  const [friends, setFriends] = useState(EXAMPLES[0].friends);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const planText = (r) => [`${r.title} (${r.city})`, r.summary, "", ...r.stops.map((s, i) => `${i + 1}. ${s.label}: ${s.venue.name}${s.venue.address ? ` (${s.venue.address})` : ""}\n   ${s.why}`), r.tip ? `\nTip: ${r.tip}` : "", "\nPlanned with Taste Concierge: https://qloo-taste-concierge-sigma.vercel.app"].filter((x) => x !== undefined).join("\n");
  const copyPlan = async (r) => { try { await navigator.clipboard.writeText(planText(r)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} };
  const sharePlan = async (r) => { if (navigator.share) { try { await navigator.share({ title: r.title, text: planText(r) }); return; } catch (e) { if (e?.name === "AbortError") return; } } copyPlan(r); };
  const load = (e) => { setCity(e.city); setOccasion(""); setFriends(e.friends); setResult(null); setSteps([]); setError(""); };
  const upd = (i, k, v) => setFriends(friends.map((f, j) => (j === i ? { ...f, [k]: v } : f)));

  async function run(ev) {
    ev.preventDefault();
    setBusy(true); setLogOpen(false); setSteps([]); setResult(null); setError("");
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city, occasion, friends }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Error ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let n; while ((n = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, n); buf = buf.slice(n + 1); if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.type === "step") setSteps((s) => [...s, m]);
          else if (m.type === "result") setResult(m);
          else if (m.type === "error") setError(m.message);
        }
      }
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  return (
    <main>
      <header className="hero">
        <div className="badge">Powered by Qloo Taste AI</div>
        <h1>Taste Concierge</h1>
        <p>Tell me the city and what each friend loves. An agent finds places that fit <b>everyone's</b> taste and explains why.</p>
      </header>

      <form className="card" onSubmit={run}>
        <div className="examples">Try: {EXAMPLES.map((e) => <button type="button" key={e.city} onClick={() => load(e)}>{e.city}</button>)}</div>
        <label>City<input value={city} onChange={(e) => { setCity(e.target.value); setOccasion(""); }} placeholder="e.g. Kyiv, London, New York" required /></label>
        <label>Occasion<input value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="optional, e.g. Friday dinner and drinks" /></label>
        <div className="friends">
          {friends.map((f, i) => (
            <div className="friend" key={i}>
              <input className="fname" value={f.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="Name" />
              <textarea value={f.tastes} onChange={(e) => upd(i, "tastes", e.target.value)} placeholder="Artists, movies, shows, books, foods…" rows={2} />
              {friends.length > 1 && <button type="button" className="x" onClick={() => setFriends(friends.filter((_, j) => j !== i))} aria-label="Remove">×</button>}
            </div>
          ))}
          {friends.length < 5 && <button type="button" className="ghost" onClick={() => setFriends([...friends, { name: "", tastes: "" }])}>+ Add friend</button>}
        </div>
        <button className="go" disabled={busy}>{busy ? "Agent is working…" : "Plan our outing"}</button>
      </form>

      {error && <div className="card err">{error}</div>}

      {result && (
        <section className="result">
          <div className="rhead">
            <div className="kicker">{result.city} · {result.stops.length} stops · for {result.friends.map((f) => f.name).join(", ")}</div>
            <h2>{result.title}</h2>
            {result.summary && <p className="summary">{result.summary}</p>}
            <div className="share">
              <button type="button" className="sbtn" onClick={() => sharePlan(result)}>{copied ? "✓ Copied" : "Share plan"}</button>
              <button type="button" className="sbtn ghost2" onClick={() => copyPlan(result)}>Copy as text</button>
            </div>
          </div>
          <ol className="timeline">
          {result.stops.map((s, i) => (
            <li className="stop" key={i}>
              <div className="rail"><div className="num">{i + 1}</div></div>
              <article className="scard">
                <div className="label">{s.label}{s.category ? <span> · {s.category}</span> : null}</div>
                <h3>{s.venue.name}</h3>
                {s.venue.address && <div className="addr">📍 {s.venue.address}</div>}
                <p className="why">{s.why}</p>
                <div className="meter"><span style={{ width: `${Math.round((s.venue.affinity || 0) * 100)}%` }} /><em>Qloo group affinity {Math.round((s.venue.affinity || 0) * 100)}%</em></div>
                <ul className="pf">{s.per_friend.filter((p) => p.reason || p.driver).map((p, j) => <li key={j} className={p.driver ? "drv" : ""}><div className="av">{p.name.slice(0, 1).toUpperCase()}</div><div><b>{p.name}</b>{p.driver && <span className="aff for">picked for {p.name}</span>}{p.match > 0 && <span className="aff">{p.match}% match</span>}<div className="rs">{p.reason}</div></div></li>)}</ul>
                <div className="chips">{s.venue.tags.filter((t) => t && t.length > 2 && !/^place$/i.test(t)).slice(0, 5).map((t) => <span key={t}>{t}</span>)}</div>
                <div className="links">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.venue.name + " " + (s.venue.address || result.city))}`} target="_blank" rel="noreferrer">Open in Maps ↗</a>
                  {s.venue.website && <a href={s.venue.website} target="_blank" rel="noreferrer">Website ↗</a>}
                </div>
                {s.alternatives.length > 0 && <div className="alt">Also good: {s.alternatives.map((a) => a.name).join(" · ")}</div>}
              </article>
            </li>
          ))}
          </ol>
          {result.tip && <div className="card tip">💡 {result.tip}</div>}
        </section>
      )}
      {(steps.length > 0 || busy) && (
        <section className="card log">
          {busy && <div className="progress"><div className="bar"><span style={{ width: `${Math.min(95, 8 + steps.length * 11)}%` }} /></div>
            <div className="now"><span className="dot" /> Step {steps.length + 1}: {steps.length ? steps[steps.length - 1].title : "Planning the outing"}…</div></div>}
          {!busy && <button type="button" className="logtoggle" onClick={() => setLogOpen(!logOpen)}>{logOpen ? "▾" : "▸"} How the agent worked ({steps.length} steps)</button>}
          {(busy || logOpen) && <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={s.kind}><span className="tag">{s.kind === "tool" ? "Qloo API" : "Reasoning"}</span><b>{s.title}</b><div>{s.detail}</div></li>
            ))}
          </ol>}
        </section>
      )}

      <footer>Built by Solar DePin Hub for the Qloo Agentic Hackathon · venue data from Qloo, fetched live</footer>
    </main>
  );
}
