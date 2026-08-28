import {
  canonicalSha256,
  compareQuadVersions,
  parsePackageMoniker,
  type Architecture,
  type ReleaseCandidate,
  type ResolvedArtifactRuntime,
  type SourceEvidence,
} from "@releaselens/core";
import {
  isoNow,
  type ReleaseSource,
  type SourceContext,
  type SourceSnapshot,
} from "../contracts";
import { requestJson } from "../http";
import {
  catalogEvidence,
  selectCatalogPackage,
  DisplayCatalogClient,
  type CatalogPackage,
  type DisplayCatalogState,
  type StoreProductRef,
  type StoreQueryLocale,
} from "./display-catalog";
import {
  ExperimentalFe3Resolver,
  type Fe3Resolver,
  type Fe3RuntimeResolution,
} from "./fe3-runtime";

export type CodexRolloutSignal = {
  buildVersion?: string;
  storeProductId?: string;
  packageIdentity?: string;
};

export type StoreArchitectureState = {
  architecture: "x64" | "arm64";
  status:
    | "downloadable"
    | "catalog-only"
    | "inconsistent"
    | "transient-failure"
    | "no-match";
  catalog?: CatalogPackage;
  packageMoniker?: string;
  packageVersion?: string;
  sourceHost?: string;
  diagnostics: string[];
};

export type CodexStoreState = {
  product: StoreProductRef;
  catalog: DisplayCatalogState;
  rolloutSignal?: CodexRolloutSignal;
  architectures: StoreArchitectureState[];
};

export type CodexStoreSnapshot = SourceSnapshot<CodexStoreState> & {
  runtimeArtifacts: Map<string, ResolvedArtifactRuntime>;
};

export type CodexStoreSourceConfig = {
  sourceId?: string;
  product: StoreProductRef;
  locale?: StoreQueryLocale;
  rolloutSignalUrl?: string;
  fe3?: Fe3Resolver;
  /** Extra x64 FE3 attempts when catalog and downloadability briefly diverge. */
  fe3RetryAttempts?: number;
  /** Delay between bounded x64 FE3 retries. Set to zero in deterministic tests. */
  fe3RetryDelayMs?: number;
};

type RetriedFe3Resolution = {
  resolution: Fe3RuntimeResolution;
  attempts: number;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function signalVersion(
  signal: CodexRolloutSignal | undefined,
): string | undefined {
  return signal?.buildVersion &&
    /^\d+\.\d+\.\d+\.\d+$/.test(signal.buildVersion)
    ? signal.buildVersion
    : undefined;
}

function catalogVersion(
  catalog: CatalogPackage | undefined,
): string | undefined {
  return catalog
    ? parsePackageMoniker(catalog.packageFullName)?.version.join(".")
    : undefined;
}

function safeFe3Diagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .replace(/Command failed:.*?(?:Store resolver failed:\s*)/i, "")
    .replace(/(^|[^A-Za-z])[A-Za-z]:[\\/][^\s"']+/g, "$1<local-path>")
    .trim()
    .slice(0, 480);
}

function toStoreEvidence(
  sourceId: string,
  architecture: Architecture,
  resolution: Fe3RuntimeResolution,
  status: SourceEvidence["status"],
  summary: string,
  observedAt: string,
): SourceEvidence {
  return {
    id: `${sourceId}:fe3:${architecture}:${resolution.packageMoniker}`,
    kind: "source",
    sourceId,
    sourceType: "microsoft-store-fe3-experimental",
    status,
    summary,
    observedAt,
    details: {
      architecture,
      packageMoniker: resolution.packageMoniker,
      packageVersion: resolution.packageVersion,
      sourceHost: resolution.runtimeArtifact.sourceHost,
      updateId: resolution.updateId,
      revisionNumber: resolution.revisionNumber,
    },
  };
}

function createCandidate(
  productId: string,
  sourceId: string,
  architecture: "x64" | "arm64",
  version: string,
  moniker: string,
  status: ReleaseCandidate["discoveryStatus"],
  evidence: SourceEvidence[],
  discoveredAt: string,
): ReleaseCandidate {
  return {
    productId,
    sourceId,
    channel: "stable",
    platform: `windows-${architecture}`,
    sourceVersion: version,
    sourceReleaseId: moniker,
    discoveredAt,
    discoveryStatus: status,
    sourceEvidence: evidence,
  };
}

export class CodexStoreSource implements ReleaseSource<CodexStoreState> {
  public readonly id: string;
  private readonly catalogClient: DisplayCatalogClient;
  private readonly resolver: Fe3Resolver;

  public constructor(private readonly config: CodexStoreSourceConfig) {
    this.id = config.sourceId ?? "microsoft-store";
    this.catalogClient = new DisplayCatalogClient(
      config.product,
      config.locale,
    );
    this.resolver = config.fe3 ?? new ExperimentalFe3Resolver();
  }

  private async resolveFe3WithRolloutRetry(
    context: SourceContext,
    architecture: "x64" | "arm64",
    retryable: boolean,
  ): Promise<RetriedFe3Resolution> {
    const retries = retryable ? (this.config.fe3RetryAttempts ?? 2) : 0;
    const retryDelayMs = Math.max(0, this.config.fe3RetryDelayMs ?? 750);
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      try {
        return {
          resolution: await this.resolver.resolve(
            context,
            this.config.product.productId,
            this.config.product.packageIdentity,
            architecture,
          ),
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;
        if (attempt <= retries && retryDelayMs > 0) {
          await delay(retryDelayMs);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  public async discover(context: SourceContext): Promise<CodexStoreSnapshot> {
    const observedAt = isoNow(context);
    const catalog = await this.catalogClient.discover(context);
    const catalogSourceEvidence = catalogEvidence(
      this.id,
      this.config.product,
      catalog,
      context,
    );
    let rolloutSignal: CodexRolloutSignal | undefined;
    const supplementaryEvidence: SourceEvidence[] = [catalogSourceEvidence];
    if (this.config.rolloutSignalUrl) {
      try {
        const signal = await requestJson<CodexRolloutSignal>(
          context,
          this.config.rolloutSignalUrl,
        );
        rolloutSignal = signal;
        supplementaryEvidence.push({
          id: `${this.id}:rollout-signal`,
          kind: "source",
          sourceId: `${this.id}-rollout-signal`,
          sourceType: "official-rollout-signal",
          status: "info",
          summary:
            "Observed OpenAI's supplementary Windows rollout signal; FE3 remains the downloadability authority.",
          sourceUrl: this.config.rolloutSignalUrl,
          observedAt,
          details: {
            buildVersion: signal.buildVersion,
            storeProductId: signal.storeProductId,
            packageIdentity: signal.packageIdentity,
          },
        });
      } catch (error) {
        supplementaryEvidence.push({
          id: `${this.id}:rollout-signal`,
          kind: "source",
          sourceId: `${this.id}-rollout-signal`,
          sourceType: "official-rollout-signal",
          status: "warning",
          summary:
            "The optional OpenAI rollout signal could not be read; FE3 discovery continues.",
          observedAt,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    const states: StoreArchitectureState[] = [];
    const candidates: ReleaseCandidate[] = [];
    const runtimeArtifacts = new Map<string, ResolvedArtifactRuntime>();
    for (const architecture of ["x64", "arm64"] as const) {
      const catalogPackage = selectCatalogPackage(
        catalog.packages,
        this.config.product,
        architecture,
      );
      const catalogPackageVersion = catalogVersion(catalogPackage);
      try {
        const { resolution: fe3, attempts } =
          await this.resolveFe3WithRolloutRetry(
            context,
            architecture,
            architecture === "x64" && Boolean(catalogPackage),
          );
        const comparison = catalogPackageVersion
          ? compareQuadVersions(fe3.packageVersion, catalogPackageVersion)
          : 0;
        // FE3 returns a temporary delivery URL, but DisplayCatalog supplies the
        // package identity/hash anchor.  Either side may lead during phased
        // rollout, so any x64 version disagreement is an acquisition veto.
        const isInconsistent = architecture === "x64" && comparison !== 0;
        const direction = comparison < 0 ? "behind" : "ahead of";
        const rolloutVersion = signalVersion(rolloutSignal);
        const corroboration = rolloutVersion
          ? ` Official rollout signal reports ${rolloutVersion}.`
          : "";
        const status = isInconsistent ? "inconsistent" : "downloadable";
        const explanation = isInconsistent
          ? `FE3 x64 package ${fe3.packageVersion} is ${direction} DisplayCatalog ${catalogPackageVersion}; acquisition is vetoed pending metadata convergence.${corroboration}`
          : `FE3 resolves ${architecture} package ${fe3.packageVersion} from the Microsoft delivery host.`;
        const fe3Evidence = toStoreEvidence(
          this.id,
          architecture,
          fe3,
          isInconsistent ? "warning" : "pass",
          explanation,
          observedAt,
        );
        states.push({
          architecture,
          status,
          ...(catalogPackage ? { catalog: catalogPackage } : {}),
          packageMoniker: fe3.packageMoniker,
          packageVersion: fe3.packageVersion,
          sourceHost: fe3.runtimeArtifact.sourceHost,
          diagnostics: [
            ...(comparison !== 0 && catalogPackageVersion
              ? [`catalog=${catalogPackageVersion}; fe3=${fe3.packageVersion}`]
              : []),
            ...(attempts > 1
              ? [`FE3 x64 became downloadable on retry ${attempts}.`]
              : []),
          ],
        });
        candidates.push(
          createCandidate(
            "codex",
            this.id,
            architecture,
            fe3.packageVersion,
            fe3.packageMoniker,
            isInconsistent ? "inconsistent" : "downloadable",
            [catalogSourceEvidence, fe3Evidence],
            observedAt,
          ),
        );
        if (!isInconsistent) {
          runtimeArtifacts.set(fe3.packageMoniker, fe3.runtimeArtifact);
        }
      } catch (error) {
        const message = safeFe3Diagnostic(error);
        const status = catalogPackage
          ? architecture === "arm64"
            ? "catalog-only"
            : "transient-failure"
          : "no-match";
        states.push({
          architecture,
          status,
          ...(catalogPackage ? { catalog: catalogPackage } : {}),
          ...(catalogPackageVersion
            ? {
                packageMoniker: catalogPackage!.packageFullName,
                packageVersion: catalogPackageVersion,
              }
            : {}),
          diagnostics: [message],
        });
        supplementaryEvidence.push({
          id: `${this.id}:fe3:${architecture}:unavailable`,
          kind: "source",
          sourceId: this.id,
          sourceType: "microsoft-store-fe3-experimental",
          status: architecture === "arm64" ? "warning" : "fail",
          summary:
            architecture === "arm64"
              ? "ARM64 remains catalog-only because the optional experimental FE3 resolver did not return a package."
              : "The required x64 experimental FE3 resolver did not return a package.",
          observedAt,
          details: { architecture, error: message },
        });
        if (catalogPackage && catalogPackageVersion) {
          candidates.push(
            createCandidate(
              "codex",
              this.id,
              architecture,
              catalogPackageVersion,
              catalogPackage.packageFullName,
              architecture === "arm64" ? "catalog-only" : "transient-failure",
              [catalogSourceEvidence],
              observedAt,
            ),
          );
        }
      }
    }
    const state: CodexStoreState = {
      product: this.config.product,
      catalog,
      ...(rolloutSignal ? { rolloutSignal } : {}),
      architectures: states,
    };
    const fingerprint = canonicalSha256(state);
    return {
      sourceId: this.id,
      observedAt,
      fingerprint,
      candidates,
      evidence: supplementaryEvidence,
      state,
      runtimeArtifacts,
    };
  }
}
