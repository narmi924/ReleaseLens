import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProductProfiles,
  ReleaseObservationSchema,
  type ReleaseObservation,
} from "@releaselens/core";
import { buildReleaseDiff } from "../diff/release";
import { ReleaseLensDataRepository } from "./data";

const roots: string[] = [];
const timestamp = "2026-08-28T12:00:00.000Z";

async function repository(): Promise<ReleaseLensDataRepository> {
  const root = await mkdtemp(join(tmpdir(), "releaselens-data-test-"));
  roots.push(root);
  return new ReleaseLensDataRepository(root);
}

function observation(
  version: string,
  id: string,
  comparedWith?: string,
): ReleaseObservation {
  return ReleaseObservationSchema.parse({
    schemaVersion: 1,
    observationId: id,
    product: { id: "gemini-cli", name: "Gemini CLI" },
    release: {
      canonicalVersion: version,
      sourceVersion: version,
      channel: "latest",
      platform: "node",
      discoveredAt: timestamp,
    },
    sources: [
      {
        id: "source:npm",
        kind: "source",
        sourceId: "npm-registry",
        sourceType: "npm-registry",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
      },
    ],
    artifacts: [
      {
        id: `artifact:${version}`,
        kind: "artifact",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
        fileName: "fixture.tgz",
        format: "npm-tgz",
        sourceHost: "registry.npmjs.org",
        sha256: "a".repeat(64),
        verification: [],
      },
    ],
    interfaces: [
      {
        id: `interface:${version}`,
        kind: "interface",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
        cliName: "gemini",
        commands: [],
        environmentKeys: [],
        configKeys: [],
      },
    ],
    behavior: [
      {
        id: `behavior:${version}`,
        kind: "behavior",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
        results: [
          {
            testId: "gemini-version",
            status: "pass",
            startedAt: timestamp,
            durationMs: 1,
            summary: "fixture",
          },
          {
            testId: "gemini-help",
            status: "pass",
            startedAt: timestamp,
            durationMs: 1,
            summary: "fixture",
          },
        ],
      },
    ],
    ...(comparedWith ? { comparedWith } : {}),
    verdict: {
      status: "NO_REGRESSION_DETECTED",
      severity: "info",
      reasons: [{ code: "fixture", message: "fixture", evidenceRefs: [] }],
    },
  });
}

function observationFor(
  productId: string,
  channel: string,
  platform: string,
  version: string,
  id: string,
): ReleaseObservation {
  const base = observation(version, id);
  return ReleaseObservationSchema.parse({
    ...base,
    product: { id: productId, name: productId },
    release: { ...base.release, channel, platform },
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("canonical data repository", () => {
  it("writes idempotent typed observations, diffs, history, and indexes", async () => {
    const data = await repository();
    const first = observation("1.0.0", "gemini-latest-node-first");
    const second = observation(
      "1.1.0",
      "gemini-latest-node-second",
      first.observationId,
    );
    expect(await data.writeObservation(first)).toBe(true);
    expect(await data.writeObservation(first)).toBe(false);
    expect(await data.writeObservation(second)).toBe(true);
    const diff = buildReleaseDiff(first, second)!;
    expect(await data.writeDiff(diff)).toBe(true);
    expect(
      await data.writeChannelHistory({
        schemaVersion: 1,
        productId: "gemini-cli",
        observedAt: timestamp,
        sourceFingerprint: "b".repeat(64),
        channels: [
          { channel: "latest", version: "1.1.0", integrity: "sha512-fixture" },
        ],
      }),
    ).toBe(true);
    const profile = (
      await loadProductProfiles(resolve(process.cwd(), "products"))
    ).find((candidate) => candidate.id === "gemini-cli")!;
    expect(await data.rebuildIndexes([profile])).toBe(true);
    await expect(data.validate()).resolves.toMatchObject({
      observations: 2,
      diffs: 1,
      incidents: 0,
      channelSnapshots: 1,
    });
    const indexes = await data.indexes();
    expect(indexes.latest?.releases).toMatchObject([{ version: "1.1.0" }]);
    expect(indexes.knownGood?.pointers).toMatchObject([{ version: "1.1.0" }]);
  });

  it("orders index pointers by product before channel so they match the product documents", async () => {
    const data = await repository();
    const profiles = (
      await loadProductProfiles(resolve(process.cwd(), "products"))
    ).filter((candidate) => ["codex", "codex-cli"].includes(candidate.id));
    for (const entry of [
      observationFor(
        "codex-cli",
        "alpha",
        "windows-x64",
        "1.1.0-alpha.1",
        "codex-cli-alpha",
      ),
      observationFor(
        "codex-cli",
        "latest",
        "windows-x64",
        "1.0.0",
        "codex-cli-latest",
      ),
      observationFor(
        "codex",
        "stable",
        "windows-x64",
        "26.1.0.0",
        "codex-stable",
      ),
    ]) {
      expect(await data.writeObservation(entry)).toBe(true);
    }
    expect(await data.rebuildIndexes(profiles)).toBe(true);
    const indexes = await data.indexes();
    const fromProducts = indexes.products!.products.flatMap(
      (product) => product.latest,
    );
    expect(indexes.latest?.releases).toEqual(fromProducts);
    expect(
      indexes.latest?.releases.map(
        (release) => `${release.productId}:${release.channel}`,
      ),
    ).toEqual(["codex:stable", "codex-cli:alpha", "codex-cli:latest"]);
  });

  it("refuses unsafe runtime strings before writing data", async () => {
    const data = await repository();
    const unsafe = observation("1.0.0", "gemini-latest-node-unsafe");
    unsafe.sources[0]!.summary =
      "downloaded from https://x.dl.delivery.mp.microsoft.com/file.msix?token=secret";
    await expect(data.writeObservation(unsafe)).rejects.toThrow(
      "Signed Microsoft delivery URL",
    );
  });
});
