import {
  canonicalizeForPersistence,
  type ProductProfile,
  type ReleaseCandidate,
  type SourceEvidence,
} from "@releaselens/core";
import { ClaudeNativeSource } from "./claude/source";
import { type SourceContext, type SourceSnapshot } from "./contracts";
import { GitHubReleaseSource } from "./github/source";
import { CodexStoreSource } from "./microsoft-store/codex-store";
import { NpmSource } from "./npm/source";
import { WinGetSource } from "./winget/source";

export type SourceAttempt = {
  sourceId: string;
  required: boolean;
  status: "pass" | "fail";
  snapshot?: SourceSnapshot;
  error?: string;
};

export type ProductDiscovery = {
  product: { id: string; name: string };
  observedAt: string;
  attempts: SourceAttempt[];
};

function sourceConfig(
  profile: ProductProfile,
  id: string,
): Record<string, unknown> {
  const source = profile.sources.find((candidate) => candidate.id === id);
  if (!source) {
    throw new Error(`Profile ${profile.id} is missing source ${id}.`);
  }
  return source.config;
}

function required(profile: ProductProfile, id: string): boolean {
  const source = profile.sources.find((candidate) => candidate.id === id);
  if (!source) {
    throw new Error(`Profile ${profile.id} is missing source ${id}.`);
  }
  return source.required;
}

function stringConfig(config: Record<string, unknown>, field: string): string {
  const value = config[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Source profile field ${field} must be a non-empty string.`,
    );
  }
  return value;
}

function stringArrayConfig(
  config: Record<string, unknown>,
  field: string,
): string[] {
  const value = config[field];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Source profile field ${field} must be a string array.`);
  }
  return value;
}

function bindSnapshot(
  snapshot: SourceSnapshot,
  productId: string,
): SourceSnapshot {
  const bindCandidate = (candidate: ReleaseCandidate): ReleaseCandidate => ({
    ...candidate,
    productId,
  });
  const bindEvidence = (evidence: SourceEvidence): SourceEvidence => ({
    ...evidence,
  });
  return {
    ...snapshot,
    candidates: snapshot.candidates.map(bindCandidate),
    evidence: snapshot.evidence.map(bindEvidence),
  };
}

async function attempt(
  sourceId: string,
  isRequired: boolean,
  action: () => Promise<SourceSnapshot>,
  productId: string,
): Promise<SourceAttempt> {
  try {
    return {
      sourceId,
      required: isRequired,
      status: "pass",
      snapshot: bindSnapshot(await action(), productId),
    };
  } catch (error) {
    return {
      sourceId,
      required: isRequired,
      status: "fail",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function discoverProfile(
  profile: ProductProfile,
  context: SourceContext,
): Promise<ProductDiscovery> {
  const observedAt = context.now().toISOString();
  switch (profile.id) {
    case "codex": {
      const catalog = sourceConfig(profile, "microsoft-store-display-catalog");
      const fe3 = sourceConfig(profile, "microsoft-store-fe3");
      if (
        stringConfig(fe3, "primaryArchitecture") !== "x64" ||
        stringConfig(fe3, "secondaryArchitecture") !== "arm64"
      ) {
        throw new Error(
          "Codex's V1 profile must retain x64 as primary and ARM64 as secondary evidence.",
        );
      }
      const rollout = profile.sources.find(
        (source) => source.id === "codex-rollout-signal",
      );
      const source = new CodexStoreSource({
        sourceId: "microsoft-store",
        product: {
          productId: stringConfig(catalog, "productId"),
          packageIdentity: stringConfig(catalog, "packageIdentity"),
          packageFamilyName: stringConfig(catalog, "packageFamilyName"),
        },
        locale: {
          market: stringConfig(catalog, "market"),
          languages: stringArrayConfig(catalog, "languages"),
        },
        ...(rollout && typeof rollout.config.url === "string"
          ? { rolloutSignalUrl: rollout.config.url }
          : {}),
      });
      return {
        product: { id: profile.id, name: profile.name },
        observedAt,
        attempts: [
          await attempt(
            source.id,
            required(profile, "microsoft-store-fe3"),
            () => source.discover(context),
            profile.id,
          ),
        ],
      };
    }
    case "claude-code": {
      const official = sourceConfig(profile, "claude-official-release");
      const winget = sourceConfig(profile, "winget");
      const repository = sourceConfig(profile, "github-repository");
      const nativeSource = new ClaudeNativeSource({
        sourceId: "claude-native",
        installScriptUrl: stringConfig(official, "installerUrl"),
        ...(typeof official.releaseBaseUrl === "string"
          ? { releaseBaseUrl: official.releaseBaseUrl }
          : {}),
      });
      const wingetSource = new WinGetSource({
        sourceId: "winget",
        packageId: stringConfig(winget, "packageId"),
      });
      const githubSource = new GitHubReleaseSource({
        sourceId: "github-repository",
        repository: stringConfig(repository, "repository"),
      });
      return {
        product: { id: profile.id, name: profile.name },
        observedAt,
        attempts: await Promise.all([
          attempt(
            nativeSource.id,
            required(profile, "claude-official-release"),
            () => nativeSource.discover(context),
            profile.id,
          ),
          attempt(
            wingetSource.id,
            required(profile, "winget"),
            () => wingetSource.discover(context),
            profile.id,
          ),
          attempt(
            githubSource.id,
            required(profile, "github-repository"),
            () => githubSource.discover(context),
            profile.id,
          ),
        ]),
      };
    }
    case "gemini-cli": {
      const npm = sourceConfig(profile, "npm-registry");
      const repository = sourceConfig(profile, "github-repository");
      const npmSource = new NpmSource({
        sourceId: "npm-registry",
        packageName: stringConfig(npm, "packageName"),
        channels: profile.releaseModel.channels,
        ...(typeof npm.registryUrl === "string"
          ? { registryUrl: npm.registryUrl }
          : {}),
      });
      const githubSource = new GitHubReleaseSource({
        sourceId: "github-repository",
        repository: stringConfig(repository, "repository"),
      });
      return {
        product: { id: profile.id, name: profile.name },
        observedAt,
        attempts: await Promise.all([
          attempt(
            npmSource.id,
            required(profile, "npm-registry"),
            () => npmSource.discover(context),
            profile.id,
          ),
          attempt(
            githubSource.id,
            required(profile, "github-repository"),
            () => githubSource.discover(context),
            profile.id,
          ),
        ]),
      };
    }
    default:
      throw new Error(
        `No source adapter composition exists for product profile ${profile.id}.`,
      );
  }
}

export function persistedDiscoveryView(discovery: ProductDiscovery): unknown {
  // Source snapshots intentionally carry runtime-only artifact resolvers for
  // the next in-memory pipeline step.  Discovery output is safe to print only
  // after projecting those resolver fields away.
  return canonicalizeForPersistence({
    ...discovery,
    attempts: discovery.attempts.map((attempt) => ({
      sourceId: attempt.sourceId,
      required: attempt.required,
      status: attempt.status,
      ...(attempt.error ? { error: attempt.error } : {}),
      ...(attempt.snapshot
        ? {
            snapshot: {
              sourceId: attempt.snapshot.sourceId,
              observedAt: attempt.snapshot.observedAt,
              fingerprint: attempt.snapshot.fingerprint,
              candidates: attempt.snapshot.candidates,
              evidence: attempt.snapshot.evidence,
              state: attempt.snapshot.state,
            },
          }
        : {}),
    })),
  });
}
