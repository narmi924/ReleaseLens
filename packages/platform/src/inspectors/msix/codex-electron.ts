import { extractFile } from "@electron/asar";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { withArtifactLease } from "../../artifacts/lease";
import { openMsixArchive } from "./zip";

export type CodexElectronInspection = {
  status: "found" | "unavailable";
  appVersion?: string;
  asarPath?: string;
  reason?: string;
};

type ElectronPackageJson = { version?: string };

export async function inspectCodexElectronVersion(
  msixPath: string,
): Promise<CodexElectronInspection> {
  const archive = await openMsixArchive(msixPath);
  try {
    const asarEntry = Array.from(archive.entries.entries()).find(
      ([name]) => name.toLowerCase() === "app/resources/app.asar",
    );
    if (!asarEntry) {
      return {
        status: "unavailable",
        reason: "The expected Electron app.asar file is absent.",
      };
    }
    return withArtifactLease("releaselens-codex-asar", async (lease) => {
      const asarPath = lease.pathFor("app.asar");
      const stream = await archive.stream(asarEntry[1]);
      await pipeline(stream, createWriteStream(asarPath, { flags: "wx" }));
      try {
        const packageJson = JSON.parse(
          extractFile(asarPath, "package.json").toString("utf8"),
        ) as ElectronPackageJson;
        if (!packageJson.version || typeof packageJson.version !== "string") {
          return {
            status: "unavailable",
            reason: "Electron package.json does not declare a version.",
          };
        }
        return {
          status: "found",
          appVersion: packageJson.version,
          asarPath: "app/resources/app.asar",
        };
      } catch (error) {
        return {
          status: "unavailable",
          reason: `Unable to inspect Electron package metadata: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });
  } finally {
    archive.close();
  }
}
