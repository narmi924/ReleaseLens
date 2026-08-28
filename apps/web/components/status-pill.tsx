import type { EvidenceStatus, ReleaseVerdict } from "@releaselens/core";
import { evidenceTone, verdictLabel, verdictTone } from "../lib/format";

export function VerdictPill({
  verdict,
}: {
  verdict: ReleaseVerdict;
}): React.ReactElement {
  const tone = verdictTone(verdict);
  return (
    <span className={`status-pill status-${tone}`}>
      {verdictLabel(verdict.status)}
    </span>
  );
}

export function EvidencePill({
  status,
}: {
  status: EvidenceStatus;
}): React.ReactElement {
  return (
    <span className={`status-pill status-${evidenceTone(status)}`}>
      {status.replace(/-/g, " ")}
    </span>
  );
}
