import type {
  ArtifactEvidence,
  BehaviorEvidence,
  CommunityEvidence,
  InterfaceEvidence,
  SourceEvidence,
} from "@releaselens/core";
import { bytes, dateTime } from "../lib/format";
import { EvidencePill } from "./status-pill";

type Evidence =
  | SourceEvidence
  | ArtifactEvidence
  | InterfaceEvidence
  | BehaviorEvidence
  | CommunityEvidence;

function evidenceMeta(item: Evidence): string[] {
  if (item.kind === "artifact") {
    return [
      item.fileName,
      item.format,
      item.architecture ?? "architecture not recorded",
      bytes(item.sizeBytes),
    ];
  }
  if (item.kind === "interface")
    return [
      item.cliName,
      item.reportedVersion
        ? `reported ${item.reportedVersion}`
        : "reported version not recorded",
      `${item.commands.length} commands`,
    ];
  if (item.kind === "behavior")
    return item.results.map((result) => `${result.testId}: ${result.status}`);
  if (item.kind === "community")
    return [
      item.repository,
      `${item.issues.length} matching issues`,
      `${item.clusters.length} clusters`,
    ];
  return [
    item.sourceType,
    item.fingerprint ? "fingerprint recorded" : "no fingerprint recorded",
  ];
}

export function EvidenceList({
  title,
  items,
}: {
  title: string;
  items: Evidence[];
}): React.ReactElement {
  return (
    <section className="evidence-section">
      <div className="section-heading">
        <p className="eyebrow">Evidence</p>
        <h2>{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="empty-copy">
          No {title.toLowerCase()} was recorded for this observation.
        </p>
      ) : (
        <div className="evidence-list">
          {items.map((item) => (
            <article className="evidence-item" key={item.id}>
              <div>
                <div className="evidence-title-row">
                  <h3>{item.summary}</h3>
                  <EvidencePill status={item.status} />
                </div>
                <p className="evidence-meta">
                  {evidenceMeta(item).join(" · ")}
                </p>
                <p className="evidence-time">
                  Observed {dateTime(item.observedAt)} UTC
                </p>
              </div>
              {item.details ||
              item.kind === "artifact" ||
              (item.kind === "source" &&
                (item.sourceUrl || item.fingerprint)) ||
              (item.kind === "interface" && item.snapshotHash) ||
              item.kind === "community" ? (
                <details className="raw-evidence">
                  <summary>Inspect provenance</summary>
                  {item.kind === "artifact" && item.verification.length > 0 ? (
                    <ul>
                      {item.verification.map((check) => (
                        <li key={check.id}>
                          {check.status}: {check.summary}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {item.kind === "artifact" ? (
                    <ul>
                      {item.packageIdentity ? (
                        <li>
                          Package identity: <code>{item.packageIdentity}</code>
                        </li>
                      ) : null}
                      {item.packageVersion ? (
                        <li>
                          Package version: <code>{item.packageVersion}</code>
                        </li>
                      ) : null}
                      {item.sha256 ? (
                        <li>
                          SHA-256: <code>{item.sha256}</code>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                  {item.kind === "source" ? (
                    <ul>
                      {item.sourceUrl ? (
                        <li>
                          <a className="inline-link" href={item.sourceUrl}>
                            First-party source URL ↗
                          </a>
                        </li>
                      ) : null}
                      {item.fingerprint ? (
                        <li>
                          Source fingerprint: <code>{item.fingerprint}</code>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                  {item.kind === "interface" && item.snapshotHash ? (
                    <p>
                      Normalized snapshot hash: <code>{item.snapshotHash}</code>
                    </p>
                  ) : null}
                  {item.kind === "community" && item.issues.length > 0 ? (
                    <ul>
                      {item.issues.map((issue) => (
                        <li key={issue.id}>
                          <a className="inline-link" href={issue.url}>
                            {issue.id} ↗
                          </a>{" "}
                          · {issue.title}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {item.details ? (
                    <pre>{JSON.stringify(item.details, null, 2)}</pre>
                  ) : null}
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
