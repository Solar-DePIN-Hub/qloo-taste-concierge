import { ImageResponse } from "next/og";
export const runtime = "edge";
export const alt = "Taste Concierge: group plans powered by Qloo Taste AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OG() {
  const stops = [["1", "Culture", "a museum for Bob"], ["2", "Dinner", "ramen for everyone"], ["3", "Film night", "Wes Anderson for Cat"]];
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, color: "#fff",
      background: "radial-gradient(800px 500px at 0% 0%, #3b1d6e, transparent), radial-gradient(700px 500px at 100% 20%, #7a2a4d, transparent), #0f0d1a" }}>
      <div style={{ fontSize: 26, color: "#ffd27a", letterSpacing: 4, textTransform: "uppercase" }}>Powered by Qloo Taste AI</div>
      <div style={{ fontSize: 92, fontWeight: 800, marginTop: 14, backgroundImage: "linear-gradient(90deg,#ffd27a,#ff7ab6,#9d8bff)", backgroundClip: "text", color: "transparent" }}>Taste Concierge</div>
      <div style={{ fontSize: 34, color: "#e4def2", marginTop: 8 }}>An AI agent that plans an outing with a stop for every friend.</div>
      <div style={{ display: "flex", gap: 20, marginTop: 50 }}>
        {stops.map(([n, l, d]) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 26px", borderRadius: 22, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)" }}>
            <div style={{ width: 46, height: 46, borderRadius: 23, background: "#ff7ab6", color: "#1a1026", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800 }}>{n}</div>
            <div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: 26, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 20, color: "#c8c2d8" }}>{d}</div></div>
          </div>))}
      </div>
    </div>, size);
}
