import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, loadProductProfiles } from "@releaselens/core";
import { ReleaseLensDataRepository } from "../orchestrator/data";
import { buildStaticPublication } from "./static";
import { validateStaticPublication } from "./validate";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("static publication", () => {
  it("publishes canonical per-product API resources and safe feeds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "releaselens-publication-"));
    directories.push(directory);
    const profiles = await loadProductProfiles(
      resolve(process.cwd(), "products"),
    );
    const result = await buildStaticPublication({
      repository: new ReleaseLensDataRepository(process.cwd()),
      profiles,
      publicDirectory: directory,
      baseUrl: "https://example.test",
    });
    expect(result.jsonFiles).toBeGreaterThan(10);
    const index = await readFile(
      join(directory, "api", "v1", "index.json"),
      "utf8",
    );
    expect(canonicalJson(JSON.parse(index) as unknown)).toBe(index);
    expect(
      (JSON.parse(index) as { products: Array<{ id: string }> }).products.map(
        (product) => product.id,
      ),
    ).toContain("codex");
    const codexLatest = await readFile(
      join(directory, "api", "v1", "products", "codex", "latest.json"),
      "utf8",
    );
    expect((JSON.parse(codexLatest) as { productId: string }).productId).toBe(
      "codex",
    );
    const feed = await readFile(join(directory, "rss.xml"), "utf8");
    expect(feed).toContain('<rss version="2.0">');
    expect(feed).toContain("https://example.test/tools/");
    const publication = await readFile(
      join(directory, "api", "v1", "products", "codex", "index.json"),
      "utf8",
    );
    expect(publication).not.toMatch(
      /(?:[?&](?:token|sig|se|sp)=|dl\.delivery\.mp\.microsoft\.com)/i,
    );
    await expect(
      validateStaticPublication({ publicDirectory: directory }),
    ).resolves.toMatchObject({
      products: 3,
      observations: expect.any(Number),
      rssItems: expect.any(Number),
      atomEntries: expect.any(Number),
    });
    await writeFile(join(directory, "rss.xml"), "<feed />", "utf8");
    await expect(
      validateStaticPublication({ publicDirectory: directory }),
    ).rejects.toThrow("rss.xml");
  });
});
