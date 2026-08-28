import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Incident,
  KnownGoodPointer,
  LatestReleasePointer,
  ReleaseDiff,
  ReleaseObservation,
} from "@releaselens/core";

export type ProductDocument = {
  schemaVersion: 1;
  product: { id: string; name: string };
  channels: string[];
  latest: LatestReleasePointer[];
  knownGood: KnownGoodPointer[];
  releases: Array<{
    observationId: string;
    canonicalVersion: string;
    channel: string;
    platform?: string;
    discoveredAt: string;
    verdict: ReleaseObservation["verdict"];
    comparedWith?: string;
    diffId?: string;
  }>;
};

export type ApiIndex = {
  schemaVersion: 1;
  generatedAt: string;
  products: Array<{
    id: string;
    name: string;
    latest: LatestReleasePointer[];
    knownGood: KnownGoodPointer[];
    releaseCount: number;
  }>;
  incidents: Array<{
    id: string;
    productId: string;
    status: Incident["status"];
    openedAt: string;
  }>;
};

function apiDirectory(): string {
  const packageDirectory = resolve(process.cwd(), "public", "api", "v1");
  if (existsSync(packageDirectory)) return packageDirectory;
  const workspaceDirectory = resolve(
    process.cwd(),
    "apps",
    "web",
    "public",
    "api",
    "v1",
  );
  if (existsSync(workspaceDirectory)) return workspaceDirectory;
  throw new Error(
    "ReleaseLens public data is missing. Run `pnpm rl build-public` before building the web application.",
  );
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value))
    throw new Error(`Unsafe static data segment: ${JSON.stringify(value)}.`);
  return value;
}

function readJson<T>(...segments: string[]): T {
  const path = resolve(apiDirectory(), ...segments.map(safeSegment));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function getApiIndex(): ApiIndex {
  return readJson<ApiIndex>("index.json");
}

export function getProductIds(): string[] {
  return getApiIndex().products.map((product) => product.id);
}

export function getProduct(productId: string): ProductDocument | undefined {
  if (!getProductIds().includes(productId)) return undefined;
  return readJson<ProductDocument>("products", productId, "index.json");
}

export function getObservation(
  productId: string,
  observationId: string,
): ReleaseObservation | undefined {
  const product = getProduct(productId);
  if (
    !product?.releases.some(
      (release) => release.observationId === observationId,
    )
  )
    return undefined;
  return readJson<ReleaseObservation>(
    "products",
    productId,
    "releases",
    `${observationId}.json`,
  );
}

export function getDiff(
  productId: string,
  diffId: string | undefined,
): ReleaseDiff | undefined {
  if (!diffId || !getProduct(productId)) return undefined;
  return readJson<ReleaseDiff>("diffs", `${diffId}.json`);
}

export function getIncidents(productId?: string): Incident[] {
  if (productId) {
    if (!getProduct(productId)) return [];
    return readJson<{
      schemaVersion: 1;
      productId: string;
      incidents: Incident[];
    }>("products", productId, "incidents.json").incidents;
  }
  return readJson<{ schemaVersion: 1; incidents: Incident[] }>("incidents.json")
    .incidents;
}

export function getAllProducts(): ProductDocument[] {
  return getProductIds().flatMap((id) => {
    const product = getProduct(id);
    return product ? [product] : [];
  });
}
