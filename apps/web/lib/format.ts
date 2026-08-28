import type {
  EvidenceStatus,
  ReleaseVerdict,
  VerdictStatus,
} from "@releaselens/core";

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function verdictLabel(status: VerdictStatus): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function verdictTone(
  verdict: ReleaseVerdict,
): "good" | "attention" | "warning" | "critical" {
  switch (verdict.status) {
    case "NO_REGRESSION_DETECTED":
      return "good";
    case "CHANGED":
    case "DISTRIBUTION_DRIFT":
      return "attention";
    case "SUSPECTED_REGRESSION":
      return "warning";
    case "CONFIRMED_REGRESSION":
    case "UNVERIFIED":
      return "critical";
  }
}

export function evidenceTone(
  status: EvidenceStatus,
): "good" | "attention" | "warning" | "critical" | "muted" {
  if (status === "pass") return "good";
  if (status === "warning") return "attention";
  if (status === "fail") return "critical";
  if (status === "unsupported") return "muted";
  return "muted";
}

export function bytes(value: number | undefined): string {
  if (value === undefined) return "Not recorded";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function sentence(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
