import { notFound } from "next/navigation";
import { PageIntro } from "../../../components/page-intro";
import { getIncidents, getObservation, getProduct } from "../../../lib/data";
import { dateTime } from "../../../lib/format";

export const dynamicParams = false;
export const dynamic = "force-static";
export const revalidate = 0;

export function generateStaticParams(): Array<{ incident: string }> {
  return getIncidents().map((incident) => ({ incident: incident.id }));
}

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ incident: string }>;
}): Promise<React.ReactElement> {
  const { incident: id } = await params;
  const incident = getIncidents().find((candidate) => candidate.id === id);
  if (!incident) notFound();
  const product = getProduct(incident.productId);
  return (
    <>
      <PageIntro eyebrow="Incident detail" title={incident.id}>
        <p>
          {product?.product.name ?? incident.productId} · {incident.status} ·
          affected from {incident.firstAffectedVersion}
        </p>
      </PageIntro>
      <section className="shell content-section">
        <div className="relationship-grid">
          <div className="relationship-card">
            <p className="eyebrow">Affected observations</p>
            <p>
              {incident.affectedObservations
                .map(
                  (observationId) =>
                    getObservation(incident.productId, observationId)?.release
                      .canonicalVersion ?? observationId,
                )
                .join(", ")}
            </p>
          </div>
          <div className="relationship-card">
            <p className="eyebrow">Resolution</p>
            <p>
              {incident.resolvedByVersion
                ? `Resolved by ${incident.resolvedByVersion}.`
                : "No resolved-by release is recorded."}
            </p>
          </div>
        </div>
      </section>
      <section className="shell content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence timeline</p>
            <h2>Lifecycle</h2>
          </div>
        </div>
        <div className="incident-timeline">
          {incident.events.map((event) => (
            <div className="incident-event" key={`${event.at}:${event.type}`}>
              <time>
                {dateTime(event.at)} UTC · {event.type}
              </time>
              <p>{event.summary}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="shell content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Regression signatures</p>
            <h2>Why this incident exists</h2>
          </div>
        </div>
        <div className="diff-grid">
          {incident.regressionSignatures.map((signature) => (
            <article className="diff-card" key={signature.id}>
              <h3>{signature.kind}</h3>
              <p>{signature.summary}</p>
              <p className="muted">
                Evidence: {signature.evidenceRefs.join(", ")}
              </p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
