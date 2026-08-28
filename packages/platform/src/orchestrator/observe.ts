import {
  canonicalSha256,
  compareVersions,
  type ArtifactEvidence,
  type BehaviorEvidence,
  type BehaviorResult,
  type CommunityEvidence,
  type InterfaceEvidence,
  type ProductProfile,
  ReleaseObservationSchema,
  type ReleaseCandidate,
  type ReleaseObservation,
  type SourceEvidence,
  type ResolvedArtifactRuntime,
} from "@releaselens/core";
import { refreshOfficialGitHubCommunity } from "../community/github";
import { buildReleaseDiff } from "../diff/release";
import { reconcileIncidents } from "../incidents/reconcile";
import { runClaudeNativeSmoke } from "../runners/claude";
import { detectRunnerCapabilities } from "../runners/capabilities";
import { behaviorEvidence } from "../runners/framework";
import { runCodexMsixSmoke } from "../runners/codex";
import { runGeminiSmoke } from "../runners/gemini";
import type { SourceContext } from "../sources/contracts";
import {
  discoverProfile,
  type ProductDiscovery,
} from "../sources/discovery-service";
import type { ClaudeNativeSourceSnapshot } from "../sources/claude/source";
import type { CodexStoreSnapshot } from "../sources/microsoft-store/codex-store";
import type { CatalogPackage } from "../sources/microsoft-store/display-catalog";
import type {
  NpmRuntimeArtifact,
  NpmSourceSnapshot,
} from "../sources/npm/source";
import { evaluateVerdict } from "../verdict/engine";
import type { ReleaseLensDataRepository } from "./data";

export type ProductObservationResult = {
  productId: string;
  analyzedObservationIds: string[];
  updatedObservationIds: string[];
  skippedObservationIds: string[];
  sourceFailures: string[];
  communityWarnings: string[];
};

export type ObservationRunResult = {
  products: ProductObservationResult[];
  incidentChanges: number;
  indexesChanged: boolean;
};

type CandidateWork = {
  candidate: ReleaseCandidate;
  runtime?: unknown;
  catalog?: unknown;
  sourceSnapshot: unknown;
};

type EvidenceBundle = {
  artifact: ArtifactEvidence;
  behavior: BehaviorEvidence;
  interface?: InterfaceEvidence;
};

/** Converts arbitrary transport/runtime failures into text safe for canonical public evidence. */
export function redactPersistableErrorMessage(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(
    /\s+/g,
    " ",
  );
  return raw
    .replace(
      /https?:\/\/[^/]*\.dl\.delivery\.mp\.microsoft\.com\/[^\s?]+\?[^\s"']+/gi,
      "<redacted-microsoft-delivery-url>",
    )
    .replace(
      /([?&](?:access[_-]?token|api[_-]?key|authorization|auth|token|signature|sig|secret|cookie|key)=)[^&#\s"']+/gi,
      "$1<redacted>",
    )
    .replace(
      /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b/gi,
      "<redacted-credential>",
    )
    .replace(
      /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
      "<redacted-ip-address>",
    )
    .replace(/(^|[^A-Za-z])[A-Za-z]:[\\/][^\s"']+/g, "$1<local-path>")
    .replace(
      /(?:^|\s)\/(?:tmp|var\/folders|private\/var|home|Users)\/[^\s"']*/gi,
      " <temporary-path>",
    )
    .slice(0, 480);
}

function withoutObservedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutObservedAt);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "observedAt" && key !== "discoveredAt")
      .map(([key, entry]) => [key, withoutObservedAt(entry)]),
  );
}

function dedupeEvidence(evidence: SourceEvidence[]): SourceEvidence[] {
  const records = new Map<string, SourceEvidence>();
  for (const entry of evidence) records.set(entry.id, entry);
  return Array.from(records.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function attemptEvidence(
  discovery: ProductDiscovery,
  candidate: ReleaseCandidate,
): SourceEvidence[] {
  const evidence: SourceEvidence[] = [];
  for (const attempt of discovery.attempts) {
    if (attempt.snapshot) evidence.push(...attempt.snapshot.evidence);
    if (attempt.status === "fail") {
      evidence.push({
        id: `source:${candidate.productId}:${attempt.sourceId}:failure`,
        kind: "source",
        sourceId: attempt.sourceId,
        sourceType: "first-party-source-adapter",
        status: "fail",
        summary: `First-party source ${attempt.sourceId} could not be observed: ${redactPersistableErrorMessage(attempt.error ?? "unknown failure")}`,
        observedAt: candidate.discoveredAt,
        details: { required: attempt.required },
      });
    }
  }
  evidence.push(...candidate.sourceEvidence);
  return dedupeEvidence(evidence);
}

function observationFingerprint(
  candidate: ReleaseCandidate,
  sources: SourceEvidence[],
): string {
  return canonicalSha256({
    candidate: withoutObservedAt(candidate),
    sources: withoutObservedAt(sources),
  });
}

function observationId(
  profile: ProductProfile,
  candidate: ReleaseCandidate,
  fingerprint: string,
): string {
  const platform = candidate.platform ?? "all";
  const channel = candidate.channel.replace(/[^A-Za-z0-9.-]/g, "-");
  const safePlatform = platform.replace(/[^A-Za-z0-9.-]/g, "-");
  return `${profile.id}-${channel}-${safePlatform}-${fingerprint.slice(0, 16)}`;
}

function firstSnapshot<T>(
  discovery: ProductDiscovery,
  sourceId: string,
): T | undefined {
  return discovery.attempts.find((attempt) => attempt.sourceId === sourceId)
    ?.snapshot as T | undefined;
}

function sourceFailures(discovery: ProductDiscovery): string[] {
  // Optional provenance feeds are preserved as SourceEvidence warnings but do
  // not make an otherwise verified release observation fail its automation.
  return discovery.attempts
    .filter((attempt) => attempt.required && attempt.status === "fail")
    .map(
      (attempt) =>
        `${attempt.sourceId}: ${redactPersistableErrorMessage(attempt.error ?? "unknown failure")}`,
    );
}

function candidateVersionSort(
  profile: ProductProfile,
  candidates: ReleaseCandidate[],
): ReleaseCandidate[] {
  return [...candidates].sort((left, right) => {
    const quality = (candidate: ReleaseCandidate) =>
      candidate.discoveryStatus === "downloadable"
        ? 2
        : candidate.discoveryStatus === "catalog-only"
          ? 1
          : 0;
    const qualityDifference = quality(right) - quality(left);
    if (qualityDifference !== 0) return qualityDifference;
    try {
      const versionDifference = compareVersions(
        right.sourceVersion,
        left.sourceVersion,
        profile.releaseModel.versionScheme,
      );
      if (versionDifference !== 0) return versionDifference;
    } catch {
      // Fall through to the upstream release identity for malformed opaque data.
    }
    return right.sourceReleaseId.localeCompare(left.sourceReleaseId);
  });
}

function withoutVerdict(
  observation: ReleaseObservation,
): Omit<ReleaseObservation, "verdict"> {
  const draft: Partial<ReleaseObservation> = { ...observation };
  delete draft.verdict;
  return draft as Omit<ReleaseObservation, "verdict">;
}

function candidateWork(
  profile: ProductProfile,
  discovery: ProductDiscovery,
): CandidateWork[] {
  if (profile.id === "gemini-cli") {
    const snapshot = firstSnapshot<NpmSourceSnapshot>(
      discovery,
      "npm-registry",
    );
    if (!snapshot) return [];
    return snapshot.candidates.map((candidate) => ({
      candidate: { ...candidate, platform: "node" },
      runtime: snapshot.runtimeArtifacts.get(
        `${candidate.channel}:${candidate.sourceVersion}`,
      ),
      sourceSnapshot: snapshot,
    }));
  }
  if (profile.id === "claude-code") {
    const snapshot = firstSnapshot<ClaudeNativeSourceSnapshot>(
      discovery,
      "claude-native",
    );
    const candidate = snapshot?.candidates[0];
    return candidate && snapshot
      ? [
          {
            candidate: {
              ...candidate,
              channel: "stable",
              platform: "windows-x64",
            },
            runtime: snapshot,
            sourceSnapshot: snapshot,
          },
        ]
      : [];
  }
  if (profile.id === "codex") {
    const snapshot = firstSnapshot<CodexStoreSnapshot>(
      discovery,
      "microsoft-store",
    );
    if (!snapshot) return [];
    const candidate = candidateVersionSort(
      profile,
      snapshot.candidates.filter((entry) => entry.platform === "windows-x64"),
    )[0];
    const architecture = snapshot.state.architectures.find(
      (entry) => entry.architecture === "x64",
    );
    return candidate
      ? [
          {
            candidate,
            runtime: snapshot.runtimeArtifacts.get(candidate.sourceReleaseId),
            catalog: architecture?.catalog,
            sourceSnapshot: snapshot,
          },
        ]
      : [];
  }
  return [];
}

function failedBundle(
  profile: ProductProfile,
  candidate: ReleaseCandidate,
  observedAt: string,
  failure: unknown,
): EvidenceBundle {
  const message = redactPersistableErrorMessage(failure);
  const artifact: ArtifactEvidence = {
    id: `artifact:${profile.id}:unavailable:${candidate.sourceVersion}`,
    kind: "artifact",
    status: "fail",
    summary: `Required artifact acquisition or verification did not complete: ${message}`,
    observedAt,
    fileName: "unavailable",
    format: "unavailable",
    sourceHost: "unavailable",
    packageVersion: candidate.sourceVersion,
    verification: [],
  };
  const results: BehaviorResult[] = profile.tests.map((test) => ({
    testId: test.id,
    status: test.requiredForKnownGood ? "fail" : "not-applicable",
    startedAt: observedAt,
    durationMs: 0,
    summary: `Not executed because required artifact acquisition or verification failed: ${message}`,
  }));
  return {
    artifact,
    behavior: behaviorEvidence(profile.id, results, observedAt),
  };
}

function unavailableBundle(
  profile: ProductProfile,
  candidate: ReleaseCandidate,
  observedAt: string,
  reason: string,
): EvidenceBundle {
  const artifact: ArtifactEvidence = {
    id: `artifact:${profile.id}:unavailable:${candidate.sourceVersion}`,
    kind: "artifact",
    status: "unsupported",
    summary: reason,
    observedAt,
    fileName: "unavailable",
    format: "unavailable",
    sourceHost: "unavailable",
    packageVersion: candidate.sourceVersion,
    verification: [],
  };
  const results: BehaviorResult[] = profile.tests.map((test) => ({
    testId: test.id,
    status: test.requiredForKnownGood ? "unsupported" : "not-applicable",
    startedAt: observedAt,
    durationMs: 0,
    summary: reason,
  }));
  return {
    artifact,
    behavior: behaviorEvidence(profile.id, results, observedAt),
  };
}

async function runWork(
  profile: ProductProfile,
  work: CandidateWork,
  observedAt: string,
): Promise<EvidenceBundle> {
  const capabilities = detectRunnerCapabilities();
  try {
    if (profile.id === "gemini-cli") {
      if (!work.runtime)
        return unavailableBundle(
          profile,
          work.candidate,
          observedAt,
          "npm registry metadata did not supply a temporary runtime artifact.",
        );
      const outcome = await runGeminiSmoke(
        work.runtime as NpmRuntimeArtifact,
        observedAt,
        capabilities,
      );
      return {
        artifact: outcome.artifact,
        behavior: outcome.behavior,
        ...(outcome.interface ? { interface: outcome.interface } : {}),
      };
    }
    if (profile.id === "claude-code") {
      if (!work.runtime)
        return unavailableBundle(
          profile,
          work.candidate,
          observedAt,
          "Anthropic native release metadata did not supply a temporary runtime artifact.",
        );
      const outcome = await runClaudeNativeSmoke(
        work.runtime as ClaudeNativeSourceSnapshot,
        observedAt,
        capabilities,
      );
      return {
        artifact: outcome.artifact,
        behavior: outcome.behavior,
        ...(outcome.interface ? { interface: outcome.interface } : {}),
      };
    }
    if (profile.id === "codex") {
      const snapshot = work.sourceSnapshot as CodexStoreSnapshot;
      if (!work.runtime || !work.catalog) {
        return unavailableBundle(
          profile,
          work.candidate,
          observedAt,
          "Codex x64 is catalog-only or inconsistent; no verified FE3 artifact may be acquired.",
        );
      }
      const outcome = await runCodexMsixSmoke(
        work.runtime as ResolvedArtifactRuntime,
        snapshot.state.product,
        work.catalog as CatalogPackage,
        observedAt,
        capabilities,
      );
      return {
        artifact: outcome.artifact,
        behavior: outcome.behavior,
        ...(outcome.interface ? { interface: outcome.interface } : {}),
      };
    }
    return unavailableBundle(
      profile,
      work.candidate,
      observedAt,
      "No behavior runner is registered for this product profile.",
    );
  } catch (error) {
    return failedBundle(profile, work.candidate, observedAt, error);
  }
}

function communityFingerprint(
  evidence: CommunityEvidence | undefined,
): string | undefined {
  const fingerprint = evidence?.details?.fingerprint;
  return typeof fingerprint === "string" ? fingerprint : undefined;
}

async function refreshCommunity(
  profile: ProductProfile,
  candidate: ReleaseCandidate,
  context: SourceContext,
  warnings: string[],
  lookbackHours?: number,
): Promise<CommunityEvidence | undefined> {
  if (profile.id === "gemini-cli" && candidate.channel !== "latest")
    return undefined;
  try {
    const communityProfile =
      lookbackHours && profile.community
        ? { ...profile, community: { ...profile.community, lookbackHours } }
        : profile;
    return await refreshOfficialGitHubCommunity({
      profile: communityProfile,
      releaseVersion: candidate.sourceVersion,
      context,
    });
  } catch (error) {
    warnings.push(`${profile.id}: ${redactPersistableErrorMessage(error)}`);
    return undefined;
  }
}

function priorObservation(
  observations: ReleaseObservation[],
  candidate: ReleaseCandidate,
  excludeObservationId?: string,
): ReleaseObservation | undefined {
  return observations
    .filter(
      (observation) =>
        observation.observationId !== excludeObservationId &&
        observation.release.channel === candidate.channel &&
        (observation.release.platform ?? "") === (candidate.platform ?? ""),
    )
    .sort(
      (left, right) =>
        right.release.discoveredAt.localeCompare(left.release.discoveredAt) ||
        right.observationId.localeCompare(left.observationId),
    )[0];
}

function profileChannelHistory(
  profile: ProductProfile,
  discovery: ProductDiscovery,
):
  | { sourceFingerprint: string; channels: unknown[]; observedAt: string }
  | undefined {
  if (profile.id !== "gemini-cli") return undefined;
  const snapshot = firstSnapshot<NpmSourceSnapshot>(discovery, "npm-registry");
  if (!snapshot) return undefined;
  return {
    sourceFingerprint: snapshot.fingerprint,
    channels: snapshot.state.channels,
    observedAt: snapshot.observedAt,
  };
}

async function updateCommunityOnly(
  repository: ReleaseLensDataRepository,
  profile: ProductProfile,
  existing: ReleaseObservation,
  candidate: ReleaseCandidate,
  context: SourceContext,
  warnings: string[],
  lookbackHours?: number,
): Promise<boolean> {
  const community = await refreshCommunity(
    profile,
    candidate,
    context,
    warnings,
    lookbackHours,
  );
  if (
    !community ||
    communityFingerprint(community) === communityFingerprint(existing.community)
  )
    return false;
  const all = await repository.observations(profile.id);
  const previous = existing.comparedWith
    ? all.find(
        (observation) => observation.observationId === existing.comparedWith,
      )
    : undefined;
  const draft = {
    ...existing,
    community,
    ...(previous ? { comparedWith: previous.observationId } : {}),
  };
  const diff = previous
    ? buildReleaseDiff(previous, ReleaseObservationSchema.parse(draft))
    : undefined;
  const currentWithoutVerdict = withoutVerdict(
    ReleaseObservationSchema.parse(draft),
  );
  const updated = ReleaseObservationSchema.parse({
    ...currentWithoutVerdict,
    verdict: evaluateVerdict({
      profile,
      observation: currentWithoutVerdict,
      ...(diff ? { diff } : {}),
    }),
  });
  return repository.writeObservation(updated);
}

async function observeProduct(
  repository: ReleaseLensDataRepository,
  profile: ProductProfile,
  context: SourceContext,
  force = false,
): Promise<ProductObservationResult> {
  const discovery = await discoverProfile(profile, context);
  const result: ProductObservationResult = {
    productId: profile.id,
    analyzedObservationIds: [],
    updatedObservationIds: [],
    skippedObservationIds: [],
    sourceFailures: sourceFailures(discovery),
    communityWarnings: [],
  };
  const works = candidateWork(profile, discovery);
  const existingProductObservations = await repository.observations(profile.id);
  for (const work of works) {
    const sources = attemptEvidence(discovery, work.candidate);
    const fingerprint = observationFingerprint(work.candidate, sources);
    const id = observationId(profile, work.candidate, fingerprint);
    const existing = existingProductObservations.find(
      (observation) => observation.observationId === id,
    );
    if (existing && !force) {
      const communityChanged = await updateCommunityOnly(
        repository,
        profile,
        existing,
        work.candidate,
        context,
        result.communityWarnings,
      );
      (communityChanged
        ? result.updatedObservationIds
        : result.skippedObservationIds
      ).push(existing.observationId);
      continue;
    }
    const observedAt = work.candidate.discoveredAt;
    const evidence = await runWork(profile, work, observedAt);
    const community = await refreshCommunity(
      profile,
      work.candidate,
      context,
      result.communityWarnings,
    );
    const previous = priorObservation(
      existingProductObservations,
      work.candidate,
      existing?.observationId,
    );
    const provisional = ReleaseObservationSchema.parse({
      schemaVersion: 1,
      observationId: id,
      product: { id: profile.id, name: profile.name },
      release: {
        canonicalVersion: work.candidate.sourceVersion,
        sourceVersion: work.candidate.sourceVersion,
        channel: work.candidate.channel,
        ...(work.candidate.platform
          ? { platform: work.candidate.platform }
          : {}),
        ...(work.candidate.publishedAt
          ? { publishedAt: work.candidate.publishedAt }
          : {}),
        discoveredAt: observedAt,
      },
      sources,
      artifacts: [evidence.artifact],
      interfaces: evidence.interface ? [evidence.interface] : [],
      behavior: [evidence.behavior],
      ...(community ? { community } : {}),
      ...(previous ? { comparedWith: previous.observationId } : {}),
      verdict: {
        status: "UNVERIFIED",
        severity: "major",
        reasons: [
          {
            code: "PENDING_EVALUATION",
            message: "Deterministic verdict pending evaluation.",
            evidenceRefs: [],
          },
        ],
      },
    });
    const diff = previous ? buildReleaseDiff(previous, provisional) : undefined;
    const currentWithoutVerdict = withoutVerdict(provisional);
    const observation = ReleaseObservationSchema.parse({
      ...currentWithoutVerdict,
      verdict: evaluateVerdict({
        profile,
        observation: currentWithoutVerdict,
        ...(diff ? { diff } : {}),
      }),
    });
    if (diff) await repository.writeDiff(diff);
    if (await repository.writeObservation(observation))
      result.analyzedObservationIds.push(observation.observationId);
  }
  const history = profileChannelHistory(profile, discovery);
  if (history) {
    await repository.writeChannelHistory({
      schemaVersion: 1,
      productId: profile.id,
      observedAt: history.observedAt,
      sourceFingerprint: history.sourceFingerprint,
      channels: history.channels as Array<{
        channel: string;
        version: string;
        integrity?: string;
        gitHead?: string;
        publishedAt?: string;
      }>,
    });
  }
  return result;
}

/** Runs the complete observation transaction while keeping source, runtime, and persistence boundaries separate. */
export async function observeProfiles(options: {
  repository: ReleaseLensDataRepository;
  profiles: ProductProfile[];
  allProfiles?: ProductProfile[];
  context: SourceContext;
  force?: boolean;
}): Promise<ObservationRunResult> {
  const productResults: ProductObservationResult[] = [];
  for (const profile of options.profiles) {
    productResults.push(
      await observeProduct(
        options.repository,
        profile,
        options.context,
        options.force,
      ),
    );
  }
  const allObservations = await options.repository.observations();
  const priorIncidents = await options.repository.incidents();
  const reconciled = reconcileIncidents(priorIncidents, allObservations);
  let incidentChanges = 0;
  for (const incident of reconciled) {
    if (await options.repository.writeIncident(incident)) incidentChanges += 1;
  }
  const indexesChanged = await options.repository.rebuildIndexes(
    options.allProfiles ?? options.profiles,
  );
  return { products: productResults, incidentChanges, indexesChanged };
}

function currentObservations(
  observations: ReleaseObservation[],
  profile: ProductProfile,
): ReleaseObservation[] {
  const grouped = new Map<string, ReleaseObservation>();
  for (const observation of observations.filter(
    (candidate) => candidate.product.id === profile.id,
  )) {
    if (profile.id === "gemini-cli" && observation.release.channel !== "latest")
      continue;
    const key = `${observation.release.channel}\u0000${observation.release.platform ?? ""}`;
    const current = grouped.get(key);
    if (
      !current ||
      observation.release.discoveredAt > current.release.discoveredAt ||
      (observation.release.discoveredAt === current.release.discoveredAt &&
        observation.observationId > current.observationId)
    ) {
      grouped.set(key, observation);
    }
  }
  return Array.from(grouped.values()).sort((left, right) =>
    left.observationId.localeCompare(right.observationId),
  );
}

/** Refreshes only official GitHub Issue evidence; it never invokes an artifact runner. */
export async function refreshCommunityEvidence(options: {
  repository: ReleaseLensDataRepository;
  profiles: ProductProfile[];
  allProfiles?: ProductProfile[];
  context: SourceContext;
  lookbackHours?: number;
}): Promise<{
  updatedObservationIds: string[];
  warnings: string[];
  incidentChanges: number;
  indexesChanged: boolean;
}> {
  const updatedObservationIds: string[] = [];
  const warnings: string[] = [];
  for (const profile of options.profiles) {
    const current = currentObservations(
      await options.repository.observations(profile.id),
      profile,
    );
    for (const existing of current) {
      const candidate: ReleaseCandidate = {
        productId: existing.product.id,
        sourceId: "persisted-observation",
        channel: existing.release.channel,
        ...(existing.release.platform
          ? { platform: existing.release.platform }
          : {}),
        sourceVersion: existing.release.sourceVersion,
        sourceReleaseId: existing.observationId,
        ...(existing.release.publishedAt
          ? { publishedAt: existing.release.publishedAt }
          : {}),
        discoveredAt: existing.release.discoveredAt,
        discoveryStatus: "metadata-only",
        sourceEvidence: [],
      };
      if (
        await updateCommunityOnly(
          options.repository,
          profile,
          existing,
          candidate,
          options.context,
          warnings,
          options.lookbackHours,
        )
      ) {
        updatedObservationIds.push(existing.observationId);
      }
    }
  }
  const allObservations = await options.repository.observations();
  const priorIncidents = await options.repository.incidents();
  const reconciled = reconcileIncidents(priorIncidents, allObservations);
  let incidentChanges = 0;
  for (const incident of reconciled) {
    if (await options.repository.writeIncident(incident)) incidentChanges += 1;
  }
  const indexesChanged = await options.repository.rebuildIndexes(
    options.allProfiles ?? options.profiles,
  );
  return { updatedObservationIds, warnings, incidentChanges, indexesChanged };
}
