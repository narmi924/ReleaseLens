import Link from "next/link";
import { notFound } from "next/navigation";
import { PageIntro } from "../../../components/page-intro";
import { VerdictPill } from "../../../components/status-pill";
import {
  getDiff,
  getIncidents,
  getObservation,
  getProduct,
  getProductIds,
} from "../../../lib/data";
import { dateTime, shortDate } from "../../../lib/format";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ product: string }> {
  return getProductIds().map((product) => ({ product }));
}

export default async function ToolTimelinePage({
  params,
}: {
  params: Promise<{ product: string }>;
}): Promise<React.ReactElement> {
  const { product: productId } = await params;
  const product = getProduct(productId);
  if (!product) notFound();
  const incidents = getIncidents(productId);
  const releaseRows = product.releases.map((release) => ({
    release,
    observation: getObservation(productId, release.observationId),
    diff: getDiff(productId, release.diffId),
  }));
  const primary =
    product.latest.find((pointer) => pointer.channel === "stable") ??
    product.latest.find((pointer) => pointer.channel === "latest") ??
    product.latest[0];
  const knownGood =
    product.knownGood.find((pointer) => pointer.channel === primary?.channel) ??
    product.knownGood[0];
  return (
    <>
      <PageIntro eyebrow="Tool timeline" title={product.product.name}>
        <p>
          {product.channels.join(", ")} channel
          {product.channels.length === 1 ? "" : "s"} tracked through their
          native upstream distribution model. Releases appear only after a real
          observation.
        </p>
      </PageIntro>
      <section className="shell content-section timeline-layout">
        <div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Observed releases</p>
              <h2>
                {product.releases.length} recorded observation
                {product.releases.length === 1 ? "" : "s"}
              </h2>
            </div>
            <p>
              Ordered by actual observation time, not by a reconstructed
              marketing changelog.
            </p>
          </div>
          <div className="timeline-list">
            {releaseRows.map(({ release, observation, diff }) => (
              <Link
                className="release-row"
                href={`/tools/${productId}/releases/${release.observationId}/`}
                key={release.observationId}
              >
                <div>
                  <p className="eyebrow">
                    {release.channel}
                    {release.platform ? ` · ${release.platform}` : ""}
                  </p>
                  <h3>{release.canonicalVersion}</h3>
                  <p>
                    Observed {dateTime(release.discoveredAt)} UTC
                    {diff
                      ? ` · ${diff.materialChanges.length} material change${diff.materialChanges.length === 1 ? "" : "s"}`
                      : " · baseline observation"}
                  </p>
                </div>
                <div className="release-row-side">
                  {observation ? (
                    <VerdictPill verdict={observation.verdict} />
                  ) : (
                    <span className="status-pill status-muted">
                      Data unavailable
                    </span>
                  )}
                  <span className="muted">
                    {shortDate(release.discoveredAt)} →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
        <aside className="side-panel">
          <h2>Current pointers</h2>
          <dl>
            <dt>Latest</dt>
            <dd>
              {primary
                ? `${primary.version} (${primary.channel})`
                : "Not observed"}
            </dd>
            <dt>Last Known Good</dt>
            <dd>
              {knownGood
                ? `${knownGood.version} (${knownGood.channel})`
                : "Insufficient evidence"}
            </dd>
            <dt>Open incidents</dt>
            <dd>
              {incidents.filter((incident) => incident.status !== "resolved")
                .length || "None"}
            </dd>
            <dt>Tracking model</dt>
            <dd>{product.channels.join(" / ")}</dd>
          </dl>
        </aside>
      </section>
    </>
  );
}
