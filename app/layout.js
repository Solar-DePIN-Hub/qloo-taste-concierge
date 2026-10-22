import "./globals.css";
const desc = "Tell it the city and what each friend loves. An AI agent uses Qloo's Taste AI to build an outing with a stop for everyone, and explains why.";
export const metadata = {
  metadataBase: new URL("https://qloo-taste-concierge-sigma.vercel.app"),
  title: "Taste Concierge · group plans everyone will love",
  description: desc,
  openGraph: { title: "Taste Concierge", description: desc, url: "/", siteName: "Taste Concierge", type: "website" },
  twitter: { card: "summary_large_image", title: "Taste Concierge", description: desc },
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0f0d1a" };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
