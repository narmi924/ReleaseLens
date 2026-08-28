import type {
  ArtifactEvidence,
  EvidenceItem,
  ResolvedArtifactRuntime,
} from "@releaselens/core";
import type {
  CatalogPackage,
  StoreProductRef,
} from "../sources/microsoft-store/display-catalog";
import type { NpmRuntimeArtifact } from "../sources/npm/source";
import { inspectCodexElectronVersion } from "../inspectors/msix/codex-electron";
import { MsixInspector } from "../inspectors/msix/inspector";
import { NpmPackageInspector } from "../inspectors/npm-package/inspector";
import { msixArtifactEvidence, npmArtifactEvidence } from "./evidence";
import { downloadArtifact, type DownloadedArtifact } from "./downloader";
import { withArtifactLease } from "./lease";

function isMicrosoftDeliveryHost(host: string): boolean {
  return (
    host === "dl.delivery.mp.microsoft.com" ||
    host.endsWith(".dl.delivery.mp.microsoft.com")
  );
}

function normalizeCatalogSha256(
  hash: string | undefined,
  algorithm: string | undefined,
): string | undefined {
  if (!hash || !algorithm || algorithm.toLowerCase() !== "sha256") {
    return undefined;
  }
  if (/^[a-f0-9]{64}$/i.test(hash)) {
    return hash.toLowerCase();
  }
  try {
    const decoded = Buffer.from(hash, "base64");
    return decoded.length === 32 ? decoded.toString("hex") : undefined;
  } catch {
    return undefined;
  }
}

function catalogHashEvidence(
  catalog: CatalogPackage,
  downloaded: DownloadedArtifact,
  observedAt: string,
): EvidenceItem {
  const expected = normalizeCatalogSha256(catalog.hash, catalog.hashAlgorithm);
  if (!expected) {
    return {
      id: "catalog-hash",
      kind: "verification",
      status: "warning",
      summary:
        "DisplayCatalog did not expose a deterministically comparable SHA-256 value.",
      observedAt,
    };
  }
  return {
    id: "catalog-hash",
    kind: "verification",
    status: expected === downloaded.sha256 ? "pass" : "fail",
    summary:
      expected === downloaded.sha256
        ? "Downloaded MSIX matches the DisplayCatalog SHA-256."
        : "Downloaded MSIX differs from the DisplayCatalog SHA-256.",
    observedAt,
  };
}

export type InspectedCodexArtifact = {
  artifact: ArtifactEvidence;
  canExecute: boolean;
};

export async function acquireAndInspectCodexMsix(
  runtimeArtifact: ResolvedArtifactRuntime,
  product: StoreProductRef,
  architecture: "x64" | "arm64",
  catalog: CatalogPackage,
  observedAt: string,
): Promise<InspectedCodexArtifact> {
  const moniker = runtimeArtifact.expectedFileName.replace(/\.msix$/i, "");
  const packageVersion = moniker.split("_").at(-4);
  return withArtifactLease("releaselens-msix", async (lease) => {
    const catalogSha256 = normalizeCatalogSha256(
      catalog.hash,
      catalog.hashAlgorithm,
    );
    if (runtimeArtifact.temporaryUrl.protocol === "http:" && !catalogSha256) {
      throw new Error(
        "Microsoft Store FE3 returned HTTP transport without a DisplayCatalog SHA-256 verification anchor.",
      );
    }
    const downloaded = await downloadArtifact(lease, runtimeArtifact, {
      allowedHost: isMicrosoftDeliveryHost,
      ...(catalog.maxDownloadSizeBytes !== undefined
        ? { maxContentLength: catalog.maxDownloadSizeBytes }
        : {}),
      ...(catalogSha256 ? { expectedSha256: catalogSha256 } : {}),
      ...(runtimeArtifact.temporaryUrl.protocol === "http:"
        ? { allowInsecureTransportWithExpectedSha256: true }
        : {}),
    });
    const inspection = await new MsixInspector().inspect(downloaded.filePath, {
      packageIdentity: product.packageIdentity,
      architecture,
      ...(packageVersion ? { packageVersion } : {}),
      packageMoniker: moniker,
      requiredFiles: architecture === "x64" ? ["app/resources/codex.exe"] : [],
    });
    const baseArtifact = msixArtifactEvidence(
      downloaded,
      inspection,
      observedAt,
    );
    const catalogHash = catalogHashEvidence(catalog, downloaded, observedAt);
    const electron = inspection.validForExecution
      ? await inspectCodexElectronVersion(downloaded.filePath)
      : undefined;
    const artifact: ArtifactEvidence = {
      ...baseArtifact,
      verification: [...baseArtifact.verification, catalogHash],
      ...(electron
        ? {
            details: {
              ...(baseArtifact.details ?? {}),
              codexElectron: electron,
            },
          }
        : {}),
    };
    return {
      artifact,
      canExecute: inspection.validForExecution && catalogHash.status !== "fail",
    };
  });
}

export async function acquireAndInspectNpmPackage(
  runtime: NpmRuntimeArtifact,
  observedAt: string,
): Promise<ArtifactEvidence> {
  return withArtifactLease("releaselens-npm", async (lease) => {
    const downloaded = await downloadArtifact(lease, runtime.runtimeArtifact, {
      allowedHost: (host) => host === runtime.runtimeArtifact.sourceHost,
    });
    const inspection = await new NpmPackageInspector().inspect(
      downloaded.filePath,
      {
        packageName: runtime.packageName,
        packageVersion: runtime.version,
        integrity: runtime.integrity,
      },
    );
    return npmArtifactEvidence(downloaded, inspection, observedAt);
  });
}
