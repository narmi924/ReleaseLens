import Link from "next/link";
import type { ReleaseObservation } from "@releaselens/core";
import type { ProductDocument } from "../lib/data";
import { dateTime } from "../lib/format";
import { Orbit } from "./orbit";
import { VerdictPill } from "./status-pill";

function primaryObservation(
  product: ProductDocument,
  observations: Map<string, ReleaseObservation>,
): ReleaseObservation | undefined {
  const pointer =
    product.latest.find((candidate) => candidate.channel === "stable") ??
    product.latest.find((candidate) => candidate.channel === "latest") ??
    product.latest[0];
  return pointer ? observations.get(pointer.observationId) : undefined;
}

function knownGood(product: ProductDocument): string {
  const pointer =
    product.knownGood.find((candidate) => candidate.channel === "stable") ??
    product.knownGood.find((candidate) => candidate.channel === "latest") ??
    product.knownGood[0];
  return pointer ? pointer.version : "Insufficient evidence";
}

export function ToolCard({
  product,
  observations,
}: {
  product: ProductDocument;
  observations: ReleaseObservation[];
}): React.ReactElement {
  const observationMap = new Map(
    observations.map((observation) => [observation.observationId, observation]),
  );
  const primary = primaryObservation(product, observationMap);
  const versionLines = product.latest.map(
    (pointer) => `${pointer.channel}: ${pointer.version}`,
  );
  const sourceLines =
    primary?.sources
      .slice(0, 3)
      .map(
        (source) => `${source.sourceId.replace(/-/g, " ")}: ${source.status}`,
      ) ?? [];
  return (
    <article className="tool-card">
      <div className="tool-card-top">
        <div>
          <p className="eyebrow">Current observation</p>
          <h3>{product.product.name}</h3>
        </div>
        {primary ? <VerdictPill verdict={primary.verdict} /> : null}
      </div>
      <Orbit label={product.product.name} />
      <div className="tool-card-details">
        <div className="metric">
          <span className="metric-label">Latest</span>
          <span className="metric-value">
            {versionLines.join(" · ") || "Not observed"}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Last Known Good</span>
          <span className="metric-value">{knownGood(product)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Observed</span>
          <span className="metric-value">
            {primary
              ? `${dateTime(primary.release.discoveredAt)} UTC`
              : "Not observed"}
          </span>
        </div>
        {sourceLines.length > 0 ? (
          <div className="metric">
            <span className="metric-label">Distribution</span>
            <span className="metric-value">{sourceLines.join(" / ")}</span>
          </div>
        ) : null}
      </div>
      <Link className="card-link" href={`/tools/${product.product.id}/`}>
        Inspect timeline →
      </Link>
    </article>
  );
}
