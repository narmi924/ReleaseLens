import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  parsePackageMoniker,
  type ArtifactEvidence,
  type BehaviorResult,
  type InterfaceEvidence,
  type ResolvedArtifactRuntime,
} from "@releaselens/core";
import { downloadArtifact } from "../artifacts/downloader";
import { msixArtifactEvidence } from "../artifacts/evidence";
import { withArtifactLease } from "../artifacts/lease";
import { inspectCodexElectronVersion } from "../inspectors/msix/codex-electron";
import {
  MsixInspector,
  type MsixInspection,
} from "../inspectors/msix/inspector";
import { openMsixArchive } from "../inspectors/msix/zip";
import type {
  CatalogPackage,
  StoreProductRef,
} from "../sources/microsoft-store/display-catalog";
import type { RunnerCapabilities } from "./capabilities";
import { unsupportedForCapabilities } from "./capabilities";
import { runVerifiedCliSmoke } from "./cli-smoke";
import { behaviorEvidence } from "./framework";
import { issueExecutionPermit } from "./permit";

const execFileAsync = promisify(execFile);

export type CodexSmokeOutcome = {
  artifact: ArtifactEvidence;
  behavior: ReturnType<typeof behaviorEvidence>;
  interface?: InterfaceEvidence;
  results: BehaviorResult[];
};

function isMicrosoftDeliveryHost(host: string): boolean {
  return (
    host === "dl.delivery.mp.microsoft.com" ||
    host.endsWith(".dl.delivery.mp.microsoft.com")
  );
}

function catalogSha256(catalog: CatalogPackage): string | undefined {
  if (catalog.hashAlgorithm?.toLowerCase() !== "sha256" || !catalog.hash) {
    return undefined;
  }
  if (/^[a-f0-9]{64}$/i.test(catalog.hash)) {
    return catalog.hash.toLowerCase();
  }
  const decoded = Buffer.from(catalog.hash, "base64");
  return decoded.length === 32 ? decoded.toString("hex") : undefined;
}

function safePath(root: string, relative: string): string {
  const destination = resolve(root, relative.replace(/\\/g, "/"));
  if (!destination.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error("MSIX extraction path escaped its isolated lease.");
  }
  return destination;
}

async function extractMsixEntry(
  msixPath: string,
  entryName: string,
  destination: string,
): Promise<void> {
  const archive = await openMsixArchive(msixPath);
  try {
    const target = Array.from(archive.entries.entries()).find(
      ([name]) => name.toLowerCase() === entryName.toLowerCase(),
    );
    if (!target) {
      throw new Error(`Verified MSIX does not contain ${entryName}.`);
    }
    await mkdir(resolve(destination, ".."), { recursive: true });
    await pipeline(
      await archive.stream(target[1]),
      createWriteStream(destination, { flags: "wx" }),
    );
  } finally {
    archive.close();
  }
}

async function extractWholeMsix(msixPath: string, root: string): Promise<void> {
  const archive = await openMsixArchive(msixPath);
  try {
    for (const [name, entry] of archive.entries) {
      const destination = safePath(root, name);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await pipeline(
        await archive.stream(entry),
        createWriteStream(destination, { flags: "wx" }),
      );
    }
  } finally {
    archive.close();
  }
}

async function desktopStartup(
  msixPath: string,
  inspection: MsixInspection,
  leaseDirectory: string,
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<BehaviorResult> {
  const unsupported = unsupportedForCapabilities(
    "codex-desktop-start",
    ["windows", "interactiveGui", "adminPackageInstall"],
    capabilities,
    observedAt,
  );
  if (unsupported) {
    return unsupported;
  }
  const extracted = join(leaseDirectory, "desktop");
  const executable = safePath(extracted, inspection.application.executable);
  const startedAt = Date.now();
  try {
    await extractWholeMsix(msixPath, extracted);
    const child = spawn(executable, [], {
      cwd: extracted,
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
      shell: false,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const wasRunning = child.exitCode === null;
    if (child.pid) {
      await execFileAsync(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
      ).catch(() => undefined);
    }
    return {
      testId: "codex-desktop-start",
      status: wasRunning || child.exitCode === 0 ? "pass" : "fail",
      startedAt: observedAt,
      durationMs: Date.now() - startedAt,
      ...(child.exitCode !== null ? { exitCode: child.exitCode } : {}),
      summary: wasRunning
        ? "Verified temporary Codex desktop process remained running for the startup observation window."
        : "Verified temporary Codex desktop process exited during startup.",
    };
  } catch (error) {
    return {
      testId: "codex-desktop-start",
      status: "fail",
      startedAt: observedAt,
      durationMs: Date.now() - startedAt,
      summary: `Verified temporary Codex desktop startup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function verificationFailure(
  observedAt: string,
  summary: string,
): BehaviorResult {
  return {
    testId: "codex-msix-identity",
    status: "fail",
    startedAt: observedAt,
    durationMs: 0,
    summary,
  };
}

export async function runCodexMsixSmoke(
  runtimeArtifact: ResolvedArtifactRuntime,
  product: StoreProductRef,
  catalog: CatalogPackage,
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<CodexSmokeOutcome> {
  const moniker = runtimeArtifact.expectedFileName.replace(/\.msix$/i, "");
  const parsedMoniker = parsePackageMoniker(moniker);
  if (
    !parsedMoniker ||
    (parsedMoniker.architecture !== "x64" &&
      parsedMoniker.architecture !== "arm64")
  ) {
    throw new Error(
      "Codex runtime artifact does not carry a valid x64 or ARM64 MSIX moniker.",
    );
  }
  const architecture = parsedMoniker.architecture as "x64" | "arm64";
  return withArtifactLease("releaselens-codex", async (lease) => {
    const expectedHash = catalogSha256(catalog);
    if (runtimeArtifact.temporaryUrl.protocol === "http:" && !expectedHash) {
      throw new Error(
        "Microsoft Store FE3 returned HTTP transport without a DisplayCatalog SHA-256 verification anchor.",
      );
    }
    const downloaded = await downloadArtifact(lease, runtimeArtifact, {
      allowedHost: isMicrosoftDeliveryHost,
      ...(catalog.maxDownloadSizeBytes !== undefined
        ? { maxContentLength: catalog.maxDownloadSizeBytes }
        : {}),
      ...(expectedHash ? { expectedSha256: expectedHash } : {}),
      ...(runtimeArtifact.temporaryUrl.protocol === "http:"
        ? { allowInsecureTransportWithExpectedSha256: true }
        : {}),
    });
    const inspection = await new MsixInspector().inspect(downloaded.filePath, {
      packageIdentity: product.packageIdentity,
      architecture,
      packageVersion: parsedMoniker.version.join("."),
      packageMoniker: moniker,
      requiredFiles: architecture === "x64" ? ["app/resources/codex.exe"] : [],
    });
    const electron = inspection.validForExecution
      ? await inspectCodexElectronVersion(downloaded.filePath)
      : undefined;
    const baseArtifact = msixArtifactEvidence(
      downloaded,
      inspection,
      observedAt,
    );
    const artifact: ArtifactEvidence = {
      ...baseArtifact,
      ...(electron
        ? {
            details: {
              ...(baseArtifact.details ?? {}),
              codexElectron: electron,
            },
          }
        : {}),
    };
    if (!inspection.validForExecution) {
      const failed = verificationFailure(
        observedAt,
        "Codex backend was not executed because MSIX verification did not pass.",
      );
      const desktop: BehaviorResult = {
        testId: "codex-desktop-start",
        status: "not-applicable",
        startedAt: observedAt,
        durationMs: 0,
        summary:
          "Codex desktop startup was not attempted because MSIX verification did not pass.",
      };
      const results = [failed, desktop];
      return {
        artifact,
        behavior: behaviorEvidence("codex", results, observedAt),
        results,
      };
    }
    const backend = join(lease.directory, "codex.exe");
    await extractMsixEntry(
      downloaded.filePath,
      "app/resources/codex.exe",
      backend,
    );
    const permit = issueExecutionPermit(
      true,
      "MSIX identity, block map, manifest, and available signature verification gate passed",
    );
    const cli = await runVerifiedCliSmoke({
      permit,
      productId: "codex",
      cliName: "codex",
      executable: backend,
      observedAt,
    });
    const renamed = cli.results.map((result) => ({
      ...result,
      testId:
        result.testId === "codex-version"
          ? "codex-backend-version"
          : result.testId === "codex-help"
            ? "codex-backend-help"
            : result.testId,
    }));
    const verification: BehaviorResult = {
      testId: "codex-msix-identity",
      status: "pass",
      startedAt: observedAt,
      durationMs: 0,
      summary:
        "Codex backend execution was authorized only after MSIX verification passed.",
    };
    const desktop = await desktopStartup(
      downloaded.filePath,
      inspection,
      lease.directory,
      observedAt,
      capabilities,
    );
    const results = [verification, ...renamed, desktop];
    return {
      artifact,
      behavior: behaviorEvidence("codex", results, observedAt),
      ...(cli.interface ? { interface: cli.interface } : {}),
      results,
    };
  });
}
