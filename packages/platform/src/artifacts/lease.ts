import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export type ArtifactLease = {
  directory: string;
  pathFor(fileName: string): string;
};

function safeLeasePath(directory: string, fileName: string): string {
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..")
  ) {
    throw new Error(`Unsafe artifact file name: ${fileName}.`);
  }
  const target = resolve(directory, fileName);
  const root = `${resolve(directory)}${sep}`;
  if (!target.startsWith(root)) {
    throw new Error("Artifact target escaped its temporary lease.");
  }
  return target;
}

/**
 * Creates a single-use artifact lease. Callers may inspect and run verified
 * content only inside the callback; the directory is removed in finally.
 */
export async function withArtifactLease<T>(
  prefix: string,
  operation: (lease: ArtifactLease) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(
    join(tmpdir(), `${prefix.replace(/[^a-z0-9-]/gi, "-")}-`),
  );
  const lease: ArtifactLease = {
    directory,
    pathFor: (fileName) => safeLeasePath(directory, fileName),
  };
  try {
    return await operation(lease);
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 100,
    });
  }
}
