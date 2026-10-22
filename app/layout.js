import "./globals.css";
export const metadata = {
  title: "Taste Concierge · group plans powered by Qloo",
  description: "An AI agent that plans a night out everyone in your group will enjoy, using Qloo's Taste AI.",
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0f0d1a" };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
