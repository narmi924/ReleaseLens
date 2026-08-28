import Link from "next/link";
import { PageIntro } from "../../components/page-intro";
import { getIncidents, getProduct } from "../../lib/data";
import { dateTime } from "../../lib/format";

export default function IncidentsPage(): React.ReactElement {
  const incidents = getIncidents();
  return (
    <>
      <PageIntro
        eyebrow="Incident lifecycle"
        title="Regression claims require durable evidence."
      >
        <p>
          ReleaseLens opens an incident only for a suspected or confirmed
          regression, then preserves its evidence and resolution history. It
          does not create “demo incidents.”
        </p>
      </PageIntro>
      <section className="shell content-section">
        {incidents.length === 0 ? (
          <p className="empty-copy">
            No incidents have been opened from the currently published
            observations.
          </p>
        ) : (
          incidents.map((incident) => (
            <Link
              className="incident-card"
              href={`/incidents/${incident.id}/`}
              key={incident.id}
            >
              <div className="incident-card-top">
                <div>
                  <p className="eyebrow">
                    {getProduct(incident.productId)?.product.name ??
                      incident.productId}
                  </p>
                  <h2>{incident.id}</h2>
                </div>
                <span
                  className={`status-pill ${incident.status === "resolved" ? "status-good" : "status-warning"}`}
                >
                  {incident.status}
                </span>
              </div>
              <p>
                Affected from {incident.firstAffectedVersion}. Opened{" "}
                {dateTime(incident.openedAt)} UTC.
              </p>
            </Link>
          ))
        )}
      </section>
    </>
  );
}
