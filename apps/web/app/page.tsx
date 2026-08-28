import { PageIntro } from "../components/page-intro";
import { ToolCard } from "../components/tool-card";
import { getAllProducts, getApiIndex, getObservation } from "../lib/data";
import { dateTime } from "../lib/format";

export default function HomePage(): React.ReactElement {
  const index = getApiIndex();
  const products = getAllProducts();
  return (
    <>
      <PageIntro
        eyebrow="Current state"
        title="Release intelligence, with the evidence still attached."
      >
        <p>
          ReleaseLens observes what upstream channels actually expose, verifies
          temporary artifacts where possible, and separates a tested result from
          an unverified rollout.
        </p>
      </PageIntro>
      <section
        className="shell hero-observatory"
        aria-label="Observation scope"
      >
        <div className="hero-orbits">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">ReleaseLens observatory</p>
        <h2>
          Three tools. Their real distribution models. No black-box score.
        </h2>
        <p>
          Verdicts are deterministic: source provenance, artifact verification,
          interface and behavior checks, distribution alignment, and official
          issue evidence each remain independently visible.
        </p>
        <p className="hero-meta">
          Canonical data last generated from an observation at{" "}
          {dateTime(index.generatedAt)} UTC.
        </p>
      </section>
      <section className="shell dashboard-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Tool status</p>
            <h2>What is current right now?</h2>
          </div>
          <p>
            Latest and Last Known Good are separate facts. “No regression
            detected” only describes the declared test scope.
          </p>
        </div>
        <div className="dashboard-grid">
          {products.map((product) => {
            const observations = product.releases.flatMap((release) => {
              const observation = getObservation(
                product.product.id,
                release.observationId,
              );
              return observation ? [observation] : [];
            });
            return (
              <ToolCard
                key={product.product.id}
                product={product}
                observations={observations}
              />
            );
          })}
        </div>
      </section>
    </>
  );
}
