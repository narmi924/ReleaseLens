import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as tar from "tar";
import { withArtifactLease } from "../../artifacts/lease";
import {
  verifyNpmIntegrity,
  type IntegrityResult,
} from "../../artifacts/integrity";

export type NpmPackageExpectation = {
  packageName: string;
  packageVersion: string;
  integrity: string;
};

export type NpmPackageInspection = {
  packageName: string;
  packageVersion: string;
  integrity: IntegrityResult;
  bin: Record<string, string>;
  engines: Record<string, string>;
  dependencies: string[];
  fileCount: number;
  topLevelDirectories: string[];
  cliEntry?: string;
};

type PackageJson = {
  name?: string;
  version?: string;
  bin?: string | Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
};

function isSafeTarPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return (
    Boolean(normalized) &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((part) => part === "..")
  );
}

function normalizeBin(
  value: PackageJson["bin"],
  packageName: string,
): Record<string, string> {
  if (typeof value === "string") {
    return { [packageName.split("/").at(-1) ?? packageName]: value };
  }
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === "string"),
  );
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === "string"),
  );
}

export class NpmPackageInspector {
  public async inspect(
    filePath: string,
    expectation: NpmPackageExpectation,
  ): Promise<NpmPackageInspection> {
    const integrity = await verifyNpmIntegrity(filePath, expectation.integrity);
    if (!integrity.valid) {
      throw new Error(
        `npm integrity verification failed for ${expectation.packageName}@${expectation.packageVersion}.`,
      );
    }
    const entries: string[] = [];
    await tar.t({
      file: filePath,
      onentry(entry) {
        if (!isSafeTarPath(entry.path)) {
          throw new Error(`Unsafe tar entry path: ${entry.path}.`);
        }
        entries.push(entry.path.replace(/\\/g, "/"));
      },
    });
    if (!entries.includes("package/package.json")) {
      throw new Error("npm tarball has no package/package.json entry.");
    }
    return withArtifactLease("releaselens-npm-inspect", async (lease) => {
      await tar.x({
        file: filePath,
        cwd: lease.directory,
        strict: true,
        preservePaths: false,
      });
      const parsed = JSON.parse(
        await readFile(
          join(lease.directory, "package", "package.json"),
          "utf8",
        ),
      ) as PackageJson;
      if (
        parsed.name !== expectation.packageName ||
        parsed.version !== expectation.packageVersion
      ) {
        throw new Error(
          `npm package identity mismatch: expected ${expectation.packageName}@${expectation.packageVersion}, received ${parsed.name ?? "unknown"}@${parsed.version ?? "unknown"}.`,
        );
      }
      const bin = normalizeBin(parsed.bin, expectation.packageName);
      const engines = stringRecord(parsed.engines);
      const dependencies = Object.keys(stringRecord(parsed.dependencies)).sort(
        (left, right) => left.localeCompare(right),
      );
      return {
        packageName: parsed.name,
        packageVersion: parsed.version,
        integrity,
        bin,
        engines,
        dependencies,
        fileCount: entries.length,
        topLevelDirectories: Array.from(
          new Set(
            entries
              .map((entry) => entry.split("/")[1])
              .filter(Boolean) as string[],
          ),
        )
          .sort((left, right) => left.localeCompare(right))
          .slice(0, 24),
        ...(Object.values(bin)[0] ? { cliEntry: Object.values(bin)[0] } : {}),
      };
    });
  }
}
