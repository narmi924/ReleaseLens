import {
  canonicalSha256,
  type ReleaseCandidate,
  type SourceEvidence,
} from "@releaselens/core";
import {
  isoNow,
  type ReleaseSource,
  type SourceContext,
  type SourceSnapshot,
} from "../contracts";
import { requestJson } from "../http";

export type GitHubRelease = {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  target_commitish: string;
  html_url: string;
};

export type GitHubReleaseSourceConfig = {
  repository: string;
  sourceId?: string;
  limit?: number;
};

export type GitHubReleaseState = {
  repository: string;
  releases: Array<{
    id: number;
    tag: string;
    publishedAt?: string;
    prerelease: boolean;
    targetCommitish: string;
  }>;
};

function canonicalVersion(tag: string): string {
  return tag.replace(/^v(?=\d)/i, "");
}

export class GitHubReleaseSource implements ReleaseSource<GitHubReleaseState> {
  public readonly id: string;

  public constructor(private readonly config: GitHubReleaseSourceConfig) {
    this.id = config.sourceId ?? "github-releases";
  }

  public async discover(
    context: SourceContext,
  ): Promise<SourceSnapshot<GitHubReleaseState>> {
    const observedAt = isoNow(context);
    const limit = this.config.limit ?? 12;
    const url = `https://api.github.com/repos/${this.config.repository}/releases?per_page=${limit}`;
    const releases = await requestJson<GitHubRelease[]>(context, url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const published = releases.filter(
      (release) => !release.draft && release.tag_name.trim().length > 0,
    );
    const state: GitHubReleaseState = {
      repository: this.config.repository,
      releases: published.map((release) => ({
        id: release.id,
        tag: release.tag_name,
        ...(release.published_at ? { publishedAt: release.published_at } : {}),
        prerelease: release.prerelease,
        targetCommitish: release.target_commitish,
      })),
    };
    const fingerprint = canonicalSha256(state);
    const evidence: SourceEvidence[] = [
      {
        id: `${this.id}:snapshot`,
        kind: "source",
        sourceId: this.id,
        sourceType: "github-release-api",
        status: "pass",
        summary: `${published.length} published GitHub releases observed for ${this.config.repository}.`,
        sourceUrl: `https://github.com/${this.config.repository}/releases`,
        fingerprint,
        observedAt,
        details: {
          repository: this.config.repository,
          releaseCount: published.length,
        },
      },
    ];
    const candidates: ReleaseCandidate[] = published.map((release) => ({
      productId: "unbound",
      sourceId: this.id,
      channel: release.prerelease ? "prerelease" : "stable",
      sourceVersion: canonicalVersion(release.tag_name),
      sourceReleaseId: String(release.id),
      ...(release.published_at ? { publishedAt: release.published_at } : {}),
      discoveredAt: observedAt,
      discoveryStatus: "metadata-only",
      sourceEvidence: [
        {
          id: `${this.id}:release:${release.id}`,
          kind: "source",
          sourceId: this.id,
          sourceType: "github-release-api",
          status: "info",
          summary: `GitHub release ${release.tag_name}.`,
          sourceUrl: release.html_url,
          observedAt,
          details: {
            targetCommitish: release.target_commitish,
            prerelease: release.prerelease,
          },
        },
      ],
    }));
    return {
      sourceId: this.id,
      observedAt,
      fingerprint,
      candidates,
      evidence,
      state,
    };
  }
}
