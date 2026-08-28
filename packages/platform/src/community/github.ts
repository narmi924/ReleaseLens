import {
  canonicalSha256,
  type CommunityEvidence,
  type CommunityIssue,
  type ProductProfile,
} from "@releaselens/core";
import { isoNow, type SourceContext } from "../sources/contracts";
import { requestJson } from "../sources/http";

type GitHubIssuePayload = {
  id: number;
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  labels: Array<{ name?: string } | string>;
  comments: number;
  author_association?: string;
  pull_request?: unknown;
};

type GitHubCommentPayload = {
  body: string | null;
  author_association?: string;
};

export type CommunityRefreshOptions = {
  profile: Pick<ProductProfile, "id" | "name" | "community">;
  releaseVersion?: string;
  context: SourceContext;
  maxIssues?: number;
  maxCommentLookups?: number;
};

const maintainerAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const acknowledgementPattern =
  /\b(?:acknowledged?|confirmed|investigating|reproduced|fixed|resolved|hotfix|workaround)\b/i;
const genericWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "after",
  "app",
  "cannot",
  "cli",
  "code",
  "does",
  "error",
  "fails",
  "for",
  "from",
  "help",
  "in",
  "is",
  "it",
  "latest",
  "not",
  "of",
  "on",
  "or",
  "release",
  "the",
  "to",
  "version",
  "when",
  "with",
]);

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v(?=\d)/i, "");
}

function labels(issue: GitHubIssuePayload): string[] {
  return issue.labels
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .map((label) => label.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function extractExplicitVersion(
  text: string,
  releaseVersion?: string,
): string | undefined {
  const normalizedRelease = releaseVersion
    ? normalizeVersion(releaseVersion)
    : undefined;
  if (
    normalizedRelease &&
    new RegExp(
      `(?:^|[^0-9])v?${normalizedRelease.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^0-9])`,
      "i",
    ).test(text)
  ) {
    return normalizedRelease;
  }
  const found = text.match(
    /\bv?(\d+\.\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)\b/,
  );
  return found ? normalizeVersion(found[1]!) : undefined;
}

function extractPlatform(text: string): string | undefined {
  const normalized = text.toLowerCase();
  if (/\b(?:windows|win32|winget|powershell)\b/.test(normalized))
    return "windows";
  if (/\barm64\b|\baarch64\b/.test(normalized)) return "arm64";
  if (/\bx64\b|\bamd64\b/.test(normalized)) return "x64";
  if (/\b(?:macos|darwin|osx)\b/.test(normalized)) return "macos";
  if (/\blinux\b/.test(normalized)) return "linux";
  return undefined;
}

function errorCode(text: string): string | undefined {
  const found = text.match(
    /\b(?:0x[0-9a-f]{4,}|[A-Z][A-Z0-9_]{2,}(?:[-_:][A-Z0-9_]+)+|E[A-Z0-9_-]{2,})\b/i,
  );
  return found?.[0]?.toLowerCase();
}

function titleKeywords(title: string): string {
  return title
    .toLowerCase()
    .replace(/v?\d+\.\d+(?:\.\d+){0,2}(?:[-+][0-9a-z.-]+)?/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2 && !genericWords.has(word))
    .slice(0, 6)
    .join("-");
}

function signatureFor(
  issue: GitHubIssuePayload,
  explicitVersion?: string,
  platform?: string,
): string {
  const code = errorCode(`${issue.title}\n${issue.body ?? ""}`);
  const components = [
    code ? `code:${code}` : undefined,
    titleKeywords(issue.title)
      ? `title:${titleKeywords(issue.title)}`
      : undefined,
    explicitVersion ? `version:${explicitVersion}` : undefined,
    platform ? `platform:${platform}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return components.join("|") || `issue:${issue.number}`;
}

function duplicateOf(
  issue: GitHubIssuePayload,
  issueLabels: string[],
): string | undefined {
  const body = issue.body ?? "";
  const duplicate = body.match(/\bduplicat(?:e|ed)\s+(?:of|by)\s+#(\d+)\b/i);
  if (duplicate) return `#${duplicate[1]}`;
  if (issueLabels.some((label) => /duplicate/i.test(label)))
    return "labelled-duplicate";
  return undefined;
}

function resolutionReference(
  issue: GitHubIssuePayload,
  issueLabels: string[],
): string | undefined {
  const body = issue.body ?? "";
  if (
    issue.state === "closed" ||
    issueLabels.some((label) => /fixed|resolved|hotfix/i.test(label)) ||
    /\b(?:fixed|resolved|hotfix)\b/i.test(body)
  ) {
    return issue.html_url;
  }
  return undefined;
}

async function maintainerAcknowledged(
  context: SourceContext,
  repository: string,
  issue: GitHubIssuePayload,
): Promise<boolean> {
  if (maintainerAssociations.has(issue.author_association ?? "")) return true;
  if (issue.comments === 0) return false;
  try {
    const comments = await requestJson<GitHubCommentPayload[]>(
      context,
      `https://api.github.com/repos/${repository}/issues/${issue.number}/comments?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        attempts: 1,
      },
    );
    return comments.some(
      (comment) =>
        maintainerAssociations.has(comment.author_association ?? "") &&
        acknowledgementPattern.test(comment.body ?? ""),
    );
  } catch {
    // Community metadata remains useful when a bounded enrichment request is
    // rate-limited; do not claim acknowledgement we could not verify.
    return false;
  }
}

function cluster(issues: CommunityIssue[]): CommunityEvidence["clusters"] {
  const groups = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.signature) continue;
    groups.set(issue.signature, [
      ...(groups.get(issue.signature) ?? []),
      issue.id,
    ]);
  }
  return Array.from(groups.entries())
    .map(([signature, issueIds]) => {
      const strength: "weak" | "moderate" | "strong" =
        issueIds.length >= 3
          ? "strong"
          : issueIds.length === 2
            ? "moderate"
            : "weak";
      return {
        signature,
        issueIds: issueIds.sort((left, right) => left.localeCompare(right)),
        strength,
      };
    })
    .sort((left, right) => left.signature.localeCompare(right.signature));
}

/**
 * Reads only public, official GitHub Issue metadata.  Bodies and comments are
 * examined transiently to normalize a signature, then deliberately discarded.
 */
export async function refreshOfficialGitHubCommunity(
  options: CommunityRefreshOptions,
): Promise<CommunityEvidence | undefined> {
  const community = options.profile.community;
  if (!community) return undefined;
  const observedAt = isoNow(options.context);
  const since = new Date(
    options.context.now().getTime() - community.lookbackHours * 60 * 60 * 1000,
  ).toISOString();
  const maxIssues = options.maxIssues ?? 20;
  const url = `https://api.github.com/repos/${community.repository}/issues?state=all&since=${encodeURIComponent(since)}&per_page=${maxIssues}&sort=created&direction=desc`;
  const payload = await requestJson<GitHubIssuePayload[]>(
    options.context,
    url,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  const issues = payload
    .filter((issue) => !issue.pull_request)
    .slice(0, maxIssues);
  const commentBudget = options.maxCommentLookups ?? 8;
  let commentLookups = 0;
  const normalized: CommunityIssue[] = [];
  for (const issue of issues) {
    const issueLabels = labels(issue);
    const searchable = `${issue.title}\n${issue.body ?? ""}`;
    const explicitVersion = extractExplicitVersion(
      searchable,
      options.releaseVersion,
    );
    const platform = extractPlatform(searchable);
    const canLookUpComments =
      commentLookups < commentBudget && issue.comments > 0;
    if (canLookUpComments) commentLookups += 1;
    normalized.push({
      id: `github-issue:${community.repository}:${issue.number}`,
      url: issue.html_url,
      title: issue.title.trim(),
      createdAt: issue.created_at,
      labels: issueLabels,
      ...(explicitVersion ? { explicitVersion } : {}),
      ...(platform ? { platform } : {}),
      signature: signatureFor(issue, explicitVersion, platform),
      maintainerAcknowledged: canLookUpComments
        ? await maintainerAcknowledged(
            options.context,
            community.repository,
            issue,
          )
        : maintainerAssociations.has(issue.author_association ?? ""),
      ...(duplicateOf(issue, issueLabels)
        ? { duplicateOf: duplicateOf(issue, issueLabels) }
        : {}),
      ...(resolutionReference(issue, issueLabels)
        ? { resolutionReference: resolutionReference(issue, issueLabels) }
        : {}),
    });
  }
  normalized.sort((left, right) => left.id.localeCompare(right.id));
  const clusters = cluster(normalized);
  const fingerprint = canonicalSha256({
    repository: community.repository,
    releaseVersion: options.releaseVersion,
    issues: normalized,
    clusters,
  });
  const strongClusters = clusters.filter(
    (entry) => entry.strength === "strong",
  ).length;
  return {
    id: `community:${options.profile.id}:official-github`,
    kind: "community",
    status: strongClusters > 0 ? "warning" : "pass",
    summary: `${normalized.length} recent official GitHub issues observed for ${community.repository}${strongClusters > 0 ? `; ${strongClusters} strong cluster(s)` : ""}.`,
    observedAt,
    repository: community.repository,
    issues: normalized,
    clusters,
    details: {
      lookbackHours: community.lookbackHours,
      ...(options.releaseVersion
        ? { releaseVersion: normalizeVersion(options.releaseVersion) }
        : {}),
      fingerprint,
      source: "official-github-issues",
    },
  };
}
