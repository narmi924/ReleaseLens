import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, type ResolvedArtifactRuntime } from "@releaselens/core";
import { downloadArtifact } from "./downloader";
import { withArtifactLease } from "./lease";

const body = Buffer.from("verified artifact fixture");
const fixtureSha256 = createHash("sha256").update(body).digest("hex");
let server: ReturnType<typeof createServer>;
let origin: string;
let flakyHits = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/redirect") {
      response.writeHead(302, { Location: "/artifact" }).end();
      return;
    }
    if (pathname === "/flaky") {
      flakyHits += 1;
      if (flakyHits === 1) {
        response.writeHead(503).end("try again");
        return;
      }
    }
    if (pathname === "/truncated") {
      response.writeHead(200, { "Content-Length": String(body.length + 10) });
      response.write(body);
      response.destroy();
      return;
    }
    response.writeHead(200, { "Content-Length": String(body.length) });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not allocate a TCP port.");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function artifact(path: string): ResolvedArtifactRuntime {
  return {
    temporaryUrl: new URL(`${origin}${path}?short-lived=fixture`),
    expectedFileName: "fixture.bin",
    sourceHost: "127.0.0.1",
  };
}

const localHttpExpectation = {
  expectedSha256: fixtureSha256,
  allowInsecureTransportWithExpectedSha256: true,
  allowedHost: (host: string) => host.startsWith("127.0.0.1:"),
};

describe("artifact downloader", () => {
  it("removes the complete lease after inspection work finishes", async () => {
    let directory = "";
    await withArtifactLease("releaselens-download-test", async (lease) => {
      directory = lease.directory;
      const downloaded = await downloadArtifact(
        lease,
        artifact("/artifact"),
        localHttpExpectation,
      );
      await access(downloaded.filePath);
    });
    await expect(access(directory)).rejects.toThrow();
  });

  it("downloads atomically after redirects and exposes no temporary URL in persisted output", async () => {
    await withArtifactLease("releaselens-download-test", async (lease) => {
      const downloaded = await downloadArtifact(lease, artifact("/redirect"), {
        ...localHttpExpectation,
        expectedContentLength: body.length,
      });
      expect(downloaded.sizeBytes).toBe(body.length);
      expect(downloaded.filePath).toContain(lease.directory);
      expect(() => canonicalJson(downloaded)).toThrow("Local filesystem path");
      expect(
        canonicalJson({
          fileName: downloaded.fileName,
          sourceHost: downloaded.sourceHost,
          sizeBytes: downloaded.sizeBytes,
        }),
      ).not.toContain("short-lived");
    });
  });

  it("treats an upstream maximum download size as a bound rather than an exact length", async () => {
    await withArtifactLease("releaselens-download-test", async (lease) => {
      await expect(
        downloadArtifact(lease, artifact("/artifact"), {
          ...localHttpExpectation,
          maxContentLength: body.length - 1,
          attempts: 1,
        }),
      ).rejects.toThrow("exceeds the source maximum length");
      const downloaded = await downloadArtifact(lease, artifact("/artifact"), {
        ...localHttpExpectation,
        maxContentLength: body.length + 1,
        attempts: 1,
      });
      expect(downloaded.sizeBytes).toBe(body.length);
    });
  });

  it("retries a transient response but removes truncated partial files", async () => {
    await withArtifactLease("releaselens-download-test", async (lease) => {
      const recovered = await downloadArtifact(lease, artifact("/flaky"), {
        ...localHttpExpectation,
        attempts: 2,
      });
      expect(recovered.sizeBytes).toBe(body.length);
      await expect(
        downloadArtifact(lease, artifact("/truncated"), {
          ...localHttpExpectation,
          attempts: 1,
        }),
      ).rejects.toThrow("Artifact download");
      await expect(
        access(lease.pathFor("fixture.bin.partial")),
      ).rejects.toThrow();
      await expect(access(lease.pathFor("fixture.bin"))).rejects.toThrow();
    });
  });

  it("bounds a stalled CDN response and cleans the partial lease", async () => {
    const stalledFetcher: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("Expected downloader to provide an abort signal."));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(new Error("stalled response aborted")),
          { once: true },
        );
      });
    await withArtifactLease("releaselens-download-test", async (lease) => {
      await expect(
        downloadArtifact(
          lease,
          artifact("/artifact"),
          { ...localHttpExpectation, attempts: 1, timeoutMs: 20 },
          stalledFetcher,
        ),
      ).rejects.toThrow("timed out after 20ms");
      await expect(
        access(lease.pathFor("fixture.bin.partial")),
      ).rejects.toThrow();
      await expect(access(lease.pathFor("fixture.bin"))).rejects.toThrow();
    });
  });

  it("refuses non-TLS artifacts unless the caller provides an allowlisted SHA-256 gate", async () => {
    await withArtifactLease("releaselens-download-test", async (lease) => {
      await expect(
        downloadArtifact(lease, artifact("/artifact")),
      ).rejects.toThrow("Non-TLS artifact transport");
    });
  });
});
