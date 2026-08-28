import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ResolvedArtifactRuntime } from "@releaselens/core";
import type { ArtifactLease } from "./lease";

export class ArtifactDownloadError extends Error {
  public constructor(
    message: string,
    public readonly transient: boolean,
  ) {
    super(message);
    this.name = "ArtifactDownloadError";
  }
}

export type DownloadExpectation = {
  expectedContentLength?: number;
  /** Maximum permitted body length when upstream exposes an upper bound rather than an exact length. */
  maxContentLength?: number;
  expectedSha256?: string;
  allowedHost?: (host: string) => boolean;
  /**
   * Escape hatch for a first-party origin that demonstrably serves HTTP only.
   * It is valid solely together with an exact expected SHA-256 and a host
   * allowlist; callers must still verify the resulting artifact before use.
   */
  allowInsecureTransportWithExpectedSha256?: boolean;
  attempts?: number;
  /** Hard deadline for one response-and-body attempt; prevents a stalled CDN lease from hanging an observation. */
  timeoutMs?: number;
};

export type DownloadedArtifact = {
  filePath: string;
  fileName: string;
  sourceHost: string;
  sizeBytes: number;
  sha256: string;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redactedLocation(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function contentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function boundedTimeout(value: number | undefined): number {
  const timeoutMs = value ?? 45_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ArtifactDownloadError(
      "Artifact download timeout must be a positive integer.",
      false,
    );
  }
  return timeoutMs;
}

async function removeIfPresent(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function downloadArtifact(
  lease: ArtifactLease,
  artifact: ResolvedArtifactRuntime,
  expectation: DownloadExpectation = {},
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DownloadedArtifact> {
  const fileName = basename(artifact.expectedFileName);
  const destination = lease.pathFor(fileName);
  const partial = lease.pathFor(`${fileName}.partial`);
  const attempts = expectation.attempts ?? 2;
  const timeoutMs = boundedTimeout(expectation.timeoutMs);
  const expectedSha = expectation.expectedSha256?.toLowerCase();
  if (
    expectation.allowedHost &&
    !expectation.allowedHost(artifact.temporaryUrl.host)
  ) {
    throw new ArtifactDownloadError(
      `Artifact host ${artifact.temporaryUrl.host} is outside the configured allowlist.`,
      false,
    );
  }
  if (artifact.temporaryUrl.protocol !== "https:") {
    if (
      !expectation.allowInsecureTransportWithExpectedSha256 ||
      !expectedSha ||
      !expectation.allowedHost
    ) {
      throw new ArtifactDownloadError(
        "Non-TLS artifact transport requires an allowlisted host and an exact expected SHA-256.",
        false,
      );
    }
  }
  let lastError: ArtifactDownloadError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await removeIfPresent(partial);
    await removeIfPresent(destination);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetcher(artifact.temporaryUrl, {
        redirect: "follow",
        signal: controller.signal,
      });
      const finalUrl = new URL(response.url || artifact.temporaryUrl.href);
      if (expectation.allowedHost && !expectation.allowedHost(finalUrl.host)) {
        throw new ArtifactDownloadError(
          `Redirected artifact host ${finalUrl.host} is outside the configured allowlist.`,
          false,
        );
      }
      if (!response.ok || !response.body) {
        throw new ArtifactDownloadError(
          `Artifact download failed with HTTP ${response.status} from ${redactedLocation(finalUrl)}.`,
          response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        );
      }
      const declaredLength = contentLength(
        response.headers.get("content-length"),
      );
      if (
        expectation.expectedContentLength !== undefined &&
        declaredLength !== undefined &&
        declaredLength !== expectation.expectedContentLength
      ) {
        throw new ArtifactDownloadError(
          "Artifact Content-Length header does not match the expected source length.",
          false,
        );
      }
      if (
        expectation.maxContentLength !== undefined &&
        declaredLength !== undefined &&
        declaredLength > expectation.maxContentLength
      ) {
        throw new ArtifactDownloadError(
          "Artifact Content-Length header exceeds the source maximum length.",
          false,
        );
      }
      const digest = createHash("sha256");
      let sizeBytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          if (
            expectation.maxContentLength !== undefined &&
            sizeBytes > expectation.maxContentLength
          ) {
            callback(
              new ArtifactDownloadError(
                "Artifact body exceeds the source maximum length.",
                false,
              ),
            );
            return;
          }
          digest.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(partial, { flags: "wx" }),
        { signal: controller.signal },
      );
      if (declaredLength !== undefined && sizeBytes !== declaredLength) {
        throw new ArtifactDownloadError(
          "Artifact body length does not match its Content-Length header.",
          true,
        );
      }
      if (
        expectation.expectedContentLength !== undefined &&
        sizeBytes !== expectation.expectedContentLength
      ) {
        throw new ArtifactDownloadError(
          "Artifact body length does not match the expected source length.",
          false,
        );
      }
      const sha256 = digest.digest("hex");
      if (expectedSha && sha256 !== expectedSha) {
        throw new ArtifactDownloadError(
          "Artifact SHA-256 does not match the expected source digest.",
          false,
        );
      }
      await rename(partial, destination);
      return {
        filePath: destination,
        fileName,
        sourceHost: finalUrl.host,
        sizeBytes,
        sha256,
      };
    } catch (error) {
      await removeIfPresent(partial);
      await removeIfPresent(destination);
      lastError = timedOut
        ? new ArtifactDownloadError(
            `Artifact download timed out after ${timeoutMs}ms without retaining the temporary URL.`,
            true,
          )
        : error instanceof ArtifactDownloadError
          ? error
          : new ArtifactDownloadError(
              `Artifact download failed without retaining the temporary URL: ${error instanceof Error ? error.message : String(error)}`,
              true,
            );
      if (!lastError.transient || attempt === attempts) {
        break;
      }
      await delay(150 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw (
    lastError ?? new ArtifactDownloadError("Artifact download failed.", false)
  );
}
