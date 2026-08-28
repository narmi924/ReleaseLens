import Link from "next/link";

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="site-footer">
      <div className="shell">
        <p className="eyebrow footer-eyebrow">
          Release intelligence, plainly evidenced
        </p>
        <h2>Know what actually changed before you upgrade.</h2>
        <div className="footer-grid">
          <div>
            <p className="footer-label">Explore</p>
            <Link href="/">Current state</Link>
            <Link href="/compare">Compare releases</Link>
            <Link href="/incidents">Incidents</Link>
          </div>
          <div>
            <p className="footer-label">Evidence</p>
            <Link href="/methodology">Methodology</Link>
            <Link href="/api/v1/index.json">Static API v1 ↗</Link>
            <Link href="/rss.xml">RSS ↗</Link>
          </div>
          <div>
            <p className="footer-label">Scope</p>
            <span>Codex</span>
            <span>Claude Code</span>
            <span>Gemini CLI</span>
          </div>
        </div>
        <div className="footer-bottom">
          ReleaseLens V1 · Static first-party evidence · No recommendation
          engine
        </div>
      </div>
    </footer>
  );
}
