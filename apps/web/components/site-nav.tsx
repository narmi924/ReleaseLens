import Link from "next/link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/compare", label: "Compare" },
  { href: "/incidents", label: "Incidents" },
  { href: "/methodology", label: "Methodology" },
  { href: "/api/v1/index.json", label: "API v1" },
];

export function SiteNav(): React.ReactElement {
  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="wordmark" href="/" aria-label="ReleaseLens home">
          <span className="wordmark-orbit" aria-hidden="true" />
          ReleaseLens
        </Link>
        <div className="nav-links">
          {links.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        <details className="nav-menu">
          <summary aria-label="Open navigation">Menu</summary>
          <div className="nav-menu-panel">
            {links.map((link) => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </div>
        </details>
      </nav>
    </header>
  );
}
