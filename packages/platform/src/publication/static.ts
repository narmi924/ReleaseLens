import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  canonicalJson,
  type Incident,
  type KnownGoodPointer,
  type LatestReleasePointer,
  type ProductProfile,
  type ReleaseDiff,
  type ReleaseObservation,
} from "@releaselens/core";
import type { ReleaseLensDataRepository } from "../orchestrator/data";

export type PublicReleaseReference = {
  observationId: string;
  canonicalVersion: string;
  channel: string;
  platform?: string;
  discoveredAt: string;
  verdict: ReleaseObservation["verdict"];
  comparedWith?: string;
  diffId?: string;
};

export type PublicProductDocument = {
  schemaVersion: 1;
  product: { id: string; name: string };
  channels: string[];
  latest: LatestReleasePointer[];
  knownGood: KnownGoodPointer[];
  releases: PublicReleaseReference[];
};

export type PublicApiIndex = {
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

export type StaticPublicationResult = {
  generatedAt: string;
  jsonFiles: number;
  feeds: string[];
};

export type StaticPublicationOptions = {
  repository: ReleaseLensDataRepository;
  profiles: ProductProfile[];
  publicDirectory: string;
  baseUrl?: string;
};

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value))
    throw new Error(
      `Unsafe publication path segment: ${JSON.stringify(value)}.`,
    );
  return value;
}

function releaseReference(
  observation: ReleaseObservation,
  diff?: ReleaseDiff,
): PublicReleaseReference {
  return {
    observationId: observation.observationId,
    canonicalVersion: observation.release.canonicalVersion,
    channel: observation.release.channel,
    ...(observation.release.platform
      ? { platform: observation.release.platform }
      : {}),
    discoveredAt: observation.release.discoveredAt,
    verdict: observation.verdict,
    ...(observation.comparedWith
      ? { comparedWith: observation.comparedWith }
      : {}),
    ...(diff ? { diffId: diff.diffId } : {}),
  };
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(value), "utf8");
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizedBaseUrl(value: string | undefined): string {
  return (
    value ??
    process.env.RELEASELENS_PUBLIC_BASE_URL ??
    "https://releaselens.local"
  ).replace(/\/$/, "");
}

function releaseUrl(baseUrl: string, pointer: LatestReleasePointer): string {
  return `${baseUrl}/tools/${encodeURIComponent(pointer.productId)}/releases/${encodeURIComponent(pointer.observationId)}/`;
}

function feedItems(index: PublicApiIndex): Array<{
  pointer: LatestReleasePointer;
  title: string;
  description: string;
}> {
  return index.products
    .flatMap((product) =>
      product.latest.map((pointer) => ({
        pointer,
        title: `${product.name} ${pointer.version} · ${pointer.channel}`,
        description: `${pointer.verdict.status.replace(/_/g, " ")} — ${pointer.verdict.reasons[0]?.message ?? "Structured observation available."}`,
      })),
    )
    .sort((left, right) =>
      right.pointer.discoveredAt.localeCompare(left.pointer.discoveredAt),
    );
}

function rss(index: PublicApiIndex, baseUrl: string): string {
  const items = feedItems(index)
    .map(
      ({ pointer, title, description }) =>
        `    <item>\n      <title>${xml(title)}</title>\n      <link>${xml(releaseUrl(baseUrl, pointer))}</link>\n      <guid isPermaLink="true">${xml(
          releaseUrl(baseUrl, pointer),
        )}</guid>\n      <pubDate>${new Date(pointer.discoveredAt).toUTCString()}</pubDate>\n      <description>${xml(description)}</description>\n    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>ReleaseLens</title>\n    <link>${xml(baseUrl)}</link>\n    <description>Verified upstream release intelligence for developer tools.</description>\n    <lastBuildDate>${new Date(index.generatedAt).toUTCString()}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

function atom(index: PublicApiIndex, baseUrl: string): string {
  const entries = feedItems(index)
    .map(
      ({ pointer, title, description }) =>
        `  <entry>\n    <title>${xml(title)}</title>\n    <id>${xml(releaseUrl(baseUrl, pointer))}</id>\n    <link href="${xml(
          releaseUrl(baseUrl, pointer),
        )}" />\n    <updated>${pointer.discoveredAt}</updated>\n    <summary>${xml(description)}</summary>\n  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>ReleaseLens</title>\n  <id>${xml(baseUrl)}</id>\n  <link href="${xml(baseUrl)}" />\n  <updated>${index.generatedAt}</updated>\n${entries}\n</feed>\n`;
}

/** Publishes only canonical, runtime-safe data into a static web public directory. */
export async function buildStaticPublication(
  options: StaticPublicationOptions,
): Promise<StaticPublicationResult> {
  const publicDirectory = resolve(options.publicDirectory);
  const apiDirectory = join(publicDirectory, "api", "v1");
  await rm(apiDirectory, { recursive: true, force: true });
  const [observations, diffs, incidents, indexes] = await Promise.all([
    options.repository.observations(),
    options.repository.diffs(),
    options.repository.incidents(),
    options.repository.indexes(),
  ]);
  if (!indexes.latest || !indexes.knownGood || !indexes.products) {
    throw new Error(
      "Cannot publish static API before the canonical indexes have been built.",
    );
  }
  const diffByObservation = new Map(
    diffs.map((diff) => [diff.observationId, diff]),
  );
  const generatedAt =
    observations
      .map((observation) => observation.release.discoveredAt)
      .concat(incidents.map((incident) => incident.openedAt))
      .sort((left, right) => right.localeCompare(left))[0] ??
    "1970-01-01T00:00:00.000Z";
  const productDocuments: PublicProductDocument[] = options.profiles
    .map((profile) => {
      const productIndex = indexes.products!.products.find(
        (product) => product.id === profile.id,
      );
      const releases = observations
        .filter((observation) => observation.product.id === profile.id)
        .sort(
          (left, right) =>
            right.release.discoveredAt.localeCompare(
              left.release.discoveredAt,
            ) || right.observationId.localeCompare(left.observationId),
        )
        .map((observation) =>
          releaseReference(
            observation,
            diffByObservation.get(observation.observationId),
          ),
        );
      return {
        schemaVersion: 1 as const,
        product: { id: profile.id, name: profile.name },
        channels: profile.releaseModel.channels,
        latest: productIndex?.latest ?? [],
        knownGood: productIndex?.knownGood ?? [],
        releases,
      };
    })
    .sort((left, right) => left.product.id.localeCompare(right.product.id));
  const index: PublicApiIndex = {
    schemaVersion: 1 as const,
    generatedAt,
    products: productDocuments.map((document) => ({
      id: document.product.id,
      name: document.product.name,
      latest: document.latest,
      knownGood: document.knownGood,
      releaseCount: document.releases.length,
    })),
    incidents: incidents
      .map((incident) => ({
        id: incident.id,
        productId: incident.productId,
        status: incident.status,
        openedAt: incident.openedAt,
      }))
      .sort(
        (left, right) =>
          right.openedAt.localeCompare(left.openedAt) ||
          left.id.localeCompare(right.id),
      ),
  };
  let jsonFiles = 0;
  await writeCanonical(join(apiDirectory, "index.json"), index);
  jsonFiles += 1;
  await writeCanonical(join(apiDirectory, "latest.json"), indexes.latest);
  await writeCanonical(
    join(apiDirectory, "known-good.json"),
    indexes.knownGood,
  );
  await writeCanonical(join(apiDirectory, "products.json"), indexes.products);
  jsonFiles += 3;
  for (const document of productDocuments) {
    const productDirectory = join(
      apiDirectory,
      "products",
      safeSegment(document.product.id),
    );
    await writeCanonical(
      join(
        apiDirectory,
        "products",
        `${safeSegment(document.product.id)}.json`,
      ),
      document,
    );
    await writeCanonical(join(productDirectory, "index.json"), document);
    await writeCanonical(join(productDirectory, "latest.json"), {
      schemaVersion: 1,
      productId: document.product.id,
      releases: document.latest,
    });
    await writeCanonical(join(productDirectory, "known-good.json"), {
      schemaVersion: 1,
      productId: document.product.id,
      pointers: document.knownGood,
    });
    await writeCanonical(join(productDirectory, "releases.json"), {
      schemaVersion: 1,
      productId: document.product.id,
      releases: document.releases,
    });
    const productIncidents = incidents.filter(
      (incident) => incident.productId === document.product.id,
    );
    await writeCanonical(join(productDirectory, "incidents.json"), {
      schemaVersion: 1,
      productId: document.product.id,
      incidents: productIncidents,
    });
    for (const release of document.releases) {
      const observation = observations.find(
        (candidate) => candidate.observationId === release.observationId,
      );
      if (observation) {
        await writeCanonical(
          join(
            productDirectory,
            "releases",
            `${safeSegment(release.observationId)}.json`,
          ),
          observation,
        );
      }
    }
    jsonFiles += 6 + document.releases.length;
  }
  for (const observation of observations) {
    await writeCanonical(
      join(
        apiDirectory,
        "releases",
        `${safeSegment(observation.observationId)}.json`,
      ),
      observation,
    );
    jsonFiles += 1;
  }
  for (const diff of diffs) {
    await writeCanonical(
      join(apiDirectory, "diffs", `${safeSegment(diff.diffId)}.json`),
      diff,
    );
    jsonFiles += 1;
  }
  for (const incident of incidents) {
    await writeCanonical(
      join(apiDirectory, "incidents", `${safeSegment(incident.id)}.json`),
      incident,
    );
    jsonFiles += 1;
  }
  await writeCanonical(join(apiDirectory, "incidents.json"), {
    schemaVersion: 1,
    incidents,
  });
  jsonFiles += 1;
  const baseUrl = normalizedBaseUrl(options.baseUrl);
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(
    join(publicDirectory, "rss.xml"),
    rss(index, baseUrl),
    "utf8",
  );
  await writeFile(
    join(publicDirectory, "atom.xml"),
    atom(index, baseUrl),
    "utf8",
  );
  return { generatedAt, jsonFiles, feeds: ["rss.xml", "atom.xml"] };
}
