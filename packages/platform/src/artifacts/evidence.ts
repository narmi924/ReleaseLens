import type { ArtifactEvidence, EvidenceItem } from "@releaselens/core";
import type { MsixInspection } from "../inspectors/msix/inspector";
import type { NpmPackageInspection } from "../inspectors/npm-package/inspector";
import type { DownloadedArtifact } from "./downloader";

function verificationItem(
  id: string,
  status: EvidenceItem["status"],
  summary: string,
  observedAt: string,
  details?: Record<string, unknown>,
): EvidenceItem {
  return {
    id,
    kind: "verification",
    status,
    summary,
    observedAt,
    ...(details ? { details } : {}),
  };
}

export function msixArtifactEvidence(
  downloaded: DownloadedArtifact,
  inspection: MsixInspection,
  observedAt: string,
): ArtifactEvidence {
  const verification: EvidenceItem[] = inspection.checks.map((entry) =>
    verificationItem(entry.id, entry.status, entry.summary, observedAt),
  );
  return {
    id: `artifact:msix:${inspection.identity.name}:${inspection.identity.version}:${inspection.identity.architecture}`,
    kind: "artifact",
    status: inspection.validForExecution ? "pass" : "fail",
    summary: `${inspection.identity.name} ${inspection.identity.version} MSIX ${inspection.validForExecution ? "passed" : "failed"} verification.`,
    observedAt,
    fileName: downloaded.fileName,
    format: "msix",
    sourceHost: downloaded.sourceHost,
    sizeBytes: downloaded.sizeBytes,
    sha256: downloaded.sha256,
    packageIdentity: inspection.identity.name,
    packageVersion: inspection.identity.version,
    architecture: inspection.identity
      .architecture as ArtifactEvidence["architecture"],
    verification,
    details: {
      application: inspection.application,
      fileCount: inspection.fileCount,
      topLevelDirectories: inspection.topLevelDirectories,
      importantFiles: inspection.importantFiles,
      blockMap: inspection.blockMap,
      signature: inspection.signature,
    },
  };
}

export function npmArtifactEvidence(
  downloaded: DownloadedArtifact,
  inspection: NpmPackageInspection,
  observedAt: string,
): ArtifactEvidence {
  const integrityStatus = inspection.integrity.valid ? "pass" : "fail";
  return {
    id: `artifact:npm:${inspection.packageName}:${inspection.packageVersion}`,
    kind: "artifact",
    status: integrityStatus,
    summary: `${inspection.packageName}@${inspection.packageVersion} tarball ${inspection.integrity.valid ? "passed" : "failed"} integrity verification.`,
    observedAt,
    fileName: downloaded.fileName,
    format: "npm-tgz",
    sourceHost: downloaded.sourceHost,
    sizeBytes: downloaded.sizeBytes,
    sha256: downloaded.sha256,
    packageIdentity: inspection.packageName,
    packageVersion: inspection.packageVersion,
    verification: [
      verificationItem(
        "npm-integrity",
        integrityStatus,
        `Verified npm ${inspection.integrity.algorithm} Subresource Integrity.`,
        observedAt,
        {
          expected: inspection.integrity.expected,
          actual: inspection.integrity.actual,
        },
      ),
    ],
    details: {
      bin: inspection.bin,
      engines: inspection.engines,
      dependencies: inspection.dependencies,
      fileCount: inspection.fileCount,
      topLevelDirectories: inspection.topLevelDirectories,
      cliEntry: inspection.cliEntry,
    },
  };
}
