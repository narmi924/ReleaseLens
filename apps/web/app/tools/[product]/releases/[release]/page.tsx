import Link from "next/link";
import { notFound } from "next/navigation";
import type { Change } from "@releaselens/core";
import { EvidenceList } from "../../../../../components/evidence";
import { VerdictPill } from "../../../../../components/status-pill";
import {
  getDiff,
  getObservation,
  getProduct,
  getProductIds,
} from "../../../../../lib/data";
import { dateTime } from "../../../../../lib/format";

export const dynamicParams = false;

function ChangeGroup({
  title,
  changes,
}: {
  title: string;
  changes: Change[];
}): React.ReactElement {
  return (
    <article className="diff-card">
      <h3>{title}</h3>
      {changes.length === 0 ? (
        <p className="muted">No persisted changes in this dimension.</p>
      ) : (
        <ul>
          {changes.map((change) => (
            <li key={`${change.type}:${change.summary}`}>
              {change.material ? (
                <span className="change-material">Material · </span>
              ) : null}
              {change.summary}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function generateStaticParams(): Array<{
  product: string;
  release: string;
}> {
  return getProductIds().flatMap((productId) => {
    const product = getProduct(productId);
    return (
      product?.releases.map((release) => ({
        product: productId,
        release: release.observationId,
      })) ?? []
    );
  });
}

export default async function ReleaseDetailPage({
  params,
}: {
  params: Promise<{ product: string; release: string }>;
}): Promise<React.ReactElement> {
  const { product: productId, release: releaseId } = await params;
  const product = getProduct(productId);
  const observation = getObservation(productId, releaseId);
  if (!product || !observation) notFound();
  const releaseReference = product.releases.find(
    (release) => release.observationId === releaseId,
  );
  const diff = getDiff(productId, releaseReference?.diffId);
  const latest = product.latest.find(
    (pointer) =>
      pointer.channel === observation.release.channel &&
      pointer.platform === observation.release.platform,
  );
  const knownGood = product.knownGood.find(
    (pointer) =>
      pointer.channel === observation.release.channel &&
      pointer.platform === observation.release.platform,
  );
  const compared = observation.comparedWith
    ? getObservation(productId, observation.comparedWith)
    : undefined;
  return (
    <>
      <section className="shell page-intro release-hero">
        <p className="eyebrow">
          {product.product.name} · {observation.release.channel}
        </p>
        <div className="release-heading">
          <div>
            <h1>{observation.release.canonicalVersion}</h1>
            <p className="muted">
              Observed {dateTime(observation.release.discoveredAt)} UTC
              {observation.release.platform
                ? ` · ${observation.release.platform}`
                : ""}
            </p>
          </div>
          <VerdictPill verdict={observation.verdict} />
        </div>
        <div className="verdict-panel">
          <div>
            <p className="eyebrow">Deterministic verdict</p>
            <h2>{observation.verdict.status.replace(/_/g, " ")}</h2>
            <p>
              This is a declared-evidence result, not an upgrade recommendation
              or a guarantee.
            </p>
          </div>
          <ul>
            {observation.verdict.reasons.map((reason) => (
              <li key={`${reason.code}:${reason.message}`}>{reason.message}</li>
            ))}
          </ul>
        </div>
        <div className="relationship-grid">
          <div className="relationship-card">
            <p className="eyebrow">Latest relation</p>
            <p>
              {latest?.observationId === observation.observationId
                ? "This is the current latest pointer for its channel/platform."
                : `Current latest is ${latest?.version ?? "not recorded"}.`}
            </p>
          </div>
          <div className="relationship-card">
            <p className="eyebrow">Last Known Good relation</p>
            <p>
              {knownGood?.observationId === observation.observationId
                ? "This observation is the current Last Known Good."
                : knownGood
                  ? `Current Last Known Good is ${knownGood.version}.`
                  : "No Last Known Good is eligible within the declared scope."}
            </p>
          </div>
        </div>
      </section>
      <section className="shell content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">What changed</p>
            <h2>Persisted comparison</h2>
          </div>
          <p>
            {compared ? (
              <>
                <Link
                  className="inline-link"
                  href={`/tools/${productId}/releases/${compared.observationId}/`}
                >
                  Compared with {compared.release.canonicalVersion}
                </Link>{" "}
                using canonical evidence snapshots.
              </>
            ) : (
              "This is a baseline observation, so no prior observation is attached."
            )}
          </p>
        </div>
        {diff ? (
          <div className="diff-grid">
            <ChangeGroup title="Artifact" changes={diff.artifactChanges} />
            <ChangeGroup title="Interface" changes={diff.interfaceChanges} />
            <ChangeGroup title="Behavior" changes={diff.behaviorChanges} />
            <ChangeGroup
              title="Distribution"
              changes={diff.distributionChanges}
            />
          </div>
        ) : (
          <p className="empty-copy">
            No direct persisted comparison is available for this baseline or
            unchanged observation.
          </p>
        )}
      </section>
      <section className="shell content-section">
        <EvidenceList title="Behavior checks" items={observation.behavior} />
        <EvidenceList
          title="Interface snapshot"
          items={observation.interfaces}
        />
        <EvidenceList
          title="Artifact verification"
          items={observation.artifacts}
        />
        <EvidenceList
          title="Distribution and source provenance"
          items={observation.sources}
        />
        <EvidenceList
          title="Official community evidence"
          items={observation.community ? [observation.community] : []}
        />
      </section>
    </>
  );
}
