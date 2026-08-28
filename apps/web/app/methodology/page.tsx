import { PageIntro } from "../../components/page-intro";

export default function MethodologyPage(): React.ReactElement {
  return (
    <>
      <PageIntro
        eyebrow="Methodology"
        title="A verdict is a traceable decision, not a prediction."
      >
        <p>
          ReleaseLens publishes the evidence that led to each result. It does
          not use an LLM to classify releases, and it never calls a release safe
          or bug-free.
        </p>
      </PageIntro>
      <section className="shell content-section method-grid">
        <article className="method-card">
          <p className="eyebrow">1 · Discover</p>
          <h2>First-party sources only</h2>
          <p>
            Codex begins with Microsoft Store DisplayCatalog and compares it
            with the experimental FE3 downloadable state. Claude Code uses its
            official native distribution plus current Windows distribution
            evidence. Gemini CLI comes from the npm registry’s actual channel
            tags.
          </p>
        </article>
        <article className="method-card">
          <p className="eyebrow">2 · Verify</p>
          <h2>Temporary artifacts, no mirror</h2>
          <p>
            Artifacts are acquired into a temporary lease, integrity-checked and
            inspected before any execution. The lease is removed after the
            observation. Signed temporary Microsoft CDN URLs are never persisted
            or published.
          </p>
        </article>
        <article className="method-card">
          <p className="eyebrow">3 · Observe</p>
          <h2>Interface and behavior have scope</h2>
          <p>
            Version and help probes run in isolated temporary profiles without
            personal model credentials. Desktop startup is capability-gated: a
            runner that cannot legitimately test it reports{" "}
            <code>unsupported</code>, never a synthetic pass.
          </p>
        </article>
        <article className="method-card">
          <p className="eyebrow">4 · Compare</p>
          <h2>Four independent deltas</h2>
          <p>
            Artifact, interface, behavior and distribution differences are
            persisted separately. A comparison is direct only when the canonical
            observation chain contains that pair.
          </p>
        </article>
        <article className="method-card">
          <p className="eyebrow">5 · Classify</p>
          <h2>Deterministic precedence</h2>
          <ul>
            <li>
              <strong>UNVERIFIED</strong> when required evidence is missing or
              invalid.
            </li>
            <li>
              <strong>DISTRIBUTION DRIFT</strong> when relevant official
              channels disagree.
            </li>
            <li>
              <strong>SUSPECTED / CONFIRMED REGRESSION</strong> require
              behavior, interface, maintainer or official issue evidence under
              documented rules.
            </li>
          </ul>
        </article>
        <article className="method-card">
          <p className="eyebrow">6 · Last Known Good</p>
          <h2>Separate from latest</h2>
          <p>
            Last Known Good requires each profile’s mandatory provenance,
            artifact and behavior checks. It may be absent when the declared
            evidence scope is insufficient. “No regression detected” is not a
            safety guarantee.
          </p>
        </article>
        <article className="method-card">
          <p className="eyebrow">Microsoft Store caveat</p>
          <h2>FE3 is experimental</h2>
          <p>
            DisplayCatalog is the public Microsoft Store catalog endpoint used
            for visibility evidence. The FE3 SOAP/update service sequence is an
            undocumented compatibility surface used only as an isolated
            experimental resolver. Its short-lived delivery URLs are treated as
            runtime-only data and may change or fail independently during staged
            rollout.
          </p>
        </article>
        <article className="method-card">
          <p className="eyebrow">Community evidence</p>
          <h2>Official GitHub Issues, minimally stored</h2>
          <p>
            Recent official issue metadata is normalized into deterministic
            signatures. ReleaseLens keeps structured evidence rather than
            mirroring issue bodies. Issue count alone never confirms a
            regression.
          </p>
        </article>
      </section>
    </>
  );
}
