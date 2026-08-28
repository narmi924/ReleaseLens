import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "../components/site-footer";
import { SiteNav } from "../components/site-nav";
import { sitePath } from "../lib/site-path";

export const metadata: Metadata = {
  title: "ReleaseLens — Release intelligence with evidence",
  description:
    "First-party release intelligence and regression evidence for Codex, Claude Code, and Gemini CLI.",
  alternates: {
    types: {
      "application/rss+xml": sitePath("/rss.xml"),
      "application/atom+xml": sitePath("/atom.xml"),
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
