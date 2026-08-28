import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import {
  canonicalJson,
  IncidentSchema,
  KnownGoodIndexSchema,
  KnownGoodPointerSchema,
  LatestIndexSchema,
  LatestReleasePointerSchema,
  ProductIndexSchema,
  ReleaseDiffSchema,
  ReleaseObservationSchema,
  ReleaseVerdictSchema,
  type Incident,
  type KnownGoodPointer,
  type LatestReleasePointer,
  type ReleaseDiff,
  type ReleaseObservation,
  type ReleaseVerdict,
} from "@releaselens/core";

export class StaticPublicationValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StaticPublicationValidationError";
  }
}

export type StaticPublicationValidationSummary = {
  jsonFiles: number;
  products: number;
  observations: number;
  diffs: number;
  incidents: number;
  rssItems: number;
  atomEntries: number;
};

type PublicReleaseReference = {
  observationId: string;
  canonicalVersion: string;
  channel: string;
  platform?: string;
  discoveredAt: string;
  verdict: ReleaseVerdict;
  comparedWith?: string;
  diffId?: string;
};

type PublicProductDocument = {
  product: { id: string; name: string };
  channels: string[];
  latest: LatestReleasePointer[];
  knownGood: KnownGoodPointer[];
  releases: PublicReleaseReference[];
};

type PublicApiIndex = {
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

const signedUrlPattern =
  /https?:\/\/[^\s"'<>]*[?&](?:access_token|token|sig|se|sp|sv|st|ske|skt|sktid|skv|x-ms-[^=]+)=/i;
const sensitiveFieldPattern =
  /"(?:authorization|cookie|set-cookie|password|api[_-]?key)"\s*:/i;
const localTemporaryPathPattern =
  /(?:[a-z]:\\(?:users\\[^\\]+\\appdata\\local\\temp|temp)\\|\/(?:tmp|var\/folders)\/)/i;

function fail(message: string): never {
  throw new StaticPublicationValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${path} must be a JSON object.`);
}

function string(value: unknown, path: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail(`${path} must be a non-empty string.`);
}

function array(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${path} must be an array.`);
}

function schemaVersion(value: Record<string, unknown>, path: string): void {
  if (value.schemaVersion !== 1) fail(`${path} must have schemaVersion 1.`);
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  if (Number.isNaN(Date.parse(result)))
    fail(`${path} must be an ISO timestamp.`);
  return result;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    fail(`Unsafe public path segment ${JSON.stringify(value)}.`);
  }
  return value;
}

function scanForRuntimeSecrets(raw: string, path: string): void {
  if (signedUrlPattern.test(raw)) {
    fail(`${path} contains a signed or tokenized URL.`);
  }
  if (sensitiveFieldPattern.test(raw)) {
    fail(`${path} contains a sensitive runtime field.`);
  }
  if (localTemporaryPathPattern.test(raw)) {
    fail(`${path} contains a local temporary path.`);
  }
}

async function jsonFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail(`Static API directory does not exist: ${directory}`);
    }
    throw error;
  }
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return paths.flat().sort((left, right) => left.localeCompare(right));
}

async function readPublicJson(
  root: string,
  path: string,
): Promise<{ raw: string; value: unknown }> {
  let raw: string;
  try {
    raw = await readFile(join(root, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail(`Missing static API resource ${path}.`);
    }
    throw error;
  }
  scanForRuntimeSecrets(raw, path);
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    fail(
      `${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (canonicalJson(value) !== raw) {
    fail(`${path} is not canonical JSON.`);
  }
  return { raw, value };
}

function parseReleaseReference(
  value: unknown,
  path: string,
): PublicReleaseReference {
  const candidate = record(value, path);
  const observationId = string(
    candidate.observationId,
    `${path}.observationId`,
  );
  const canonicalVersion = string(
    candidate.canonicalVersion,
    `${path}.canonicalVersion`,
  );
  const channel = string(candidate.channel, `${path}.channel`);
  const discoveredAt = timestamp(
    candidate.discoveredAt,
    `${path}.discoveredAt`,
  );
  const verdict = ReleaseVerdictSchema.parse(candidate.verdict);
  const platform =
    candidate.platform === undefined
      ? undefined
      : string(candidate.platform, `${path}.platform`);
  const comparedWith =
    candidate.comparedWith === undefined
      ? undefined
      : string(candidate.comparedWith, `${path}.comparedWith`);
  const diffId =
    candidate.diffId === undefined
      ? undefined
      : string(candidate.diffId, `${path}.diffId`);
  return {
    observationId,
    canonicalVersion,
    channel,
    ...(platform ? { platform } : {}),
    discoveredAt,
    verdict,
    ...(comparedWith ? { comparedWith } : {}),
    ...(diffId ? { diffId } : {}),
  };
}

function parseProductDocument(
  value: unknown,
  path: string,
): PublicProductDocument {
  const candidate = record(value, path);
  schemaVersion(candidate, path);
  const product = record(candidate.product, `${path}.product`);
  const releases = array(candidate.releases, `${path}.releases`).map(
    (release, index) =>
      parseReleaseReference(release, `${path}.releases[${index}]`),
  );
  return {
    product: {
      id: string(product.id, `${path}.product.id`),
      name: string(product.name, `${path}.product.name`),
    },
    channels: array(candidate.channels, `${path}.channels`).map(
      (channel, index) => string(channel, `${path}.channels[${index}]`),
    ),
    latest: LatestReleasePointerSchema.array().parse(candidate.latest),
    knownGood: KnownGoodPointerSchema.array().parse(candidate.knownGood),
    releases,
  };
}

function parsePublicIndex(value: unknown, path: string): PublicApiIndex {
  const candidate = record(value, path);
  schemaVersion(candidate, path);
  return {
    generatedAt: timestamp(candidate.generatedAt, `${path}.generatedAt`),
    products: array(candidate.products, `${path}.products`).map(
      (product, index) => {
        const item = record(product, `${path}.products[${index}]`);
        const releaseCount = item.releaseCount;
        if (
          typeof releaseCount !== "number" ||
          !Number.isSafeInteger(releaseCount) ||
          releaseCount < 0
        ) {
          fail(
            `${path}.products[${index}].releaseCount must be a non-negative integer.`,
          );
        }
        return {
          id: string(item.id, `${path}.products[${index}].id`),
          name: string(item.name, `${path}.products[${index}].name`),
          latest: LatestReleasePointerSchema.array().parse(item.latest),
          knownGood: KnownGoodPointerSchema.array().parse(item.knownGood),
          releaseCount,
        };
      },
    ),
    incidents: array(candidate.incidents, `${path}.incidents`).map(
      (incident, index) => {
        const item = record(incident, `${path}.incidents[${index}]`);
        const status = item.status;
        if (
          status !== "open" &&
          status !== "monitoring" &&
          status !== "resolved"
        ) {
          fail(`${path}.incidents[${index}].status is invalid.`);
        }
        return {
          id: string(item.id, `${path}.incidents[${index}].id`),
          productId: string(
            item.productId,
            `${path}.incidents[${index}].productId`,
          ),
          status,
          openedAt: timestamp(
            item.openedAt,
            `${path}.incidents[${index}].openedAt`,
          ),
        };
      },
    ),
  };
}

function childText(element: Element, name: string, path: string): string {
  const child = element.getElementsByTagName(name).item(0);
  const value = child?.textContent?.trim();
  return value ? value : fail(`${path} is missing ${name}.`);
}

async function validateRss(
  publicDirectory: string,
  expectedItems: number,
): Promise<number> {
  const path = join(publicDirectory, "rss.xml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("Missing static feed rss.xml.");
    }
    throw error;
  }
  scanForRuntimeSecrets(raw, "rss.xml");
  const document = new DOMParser().parseFromString(raw, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    fail("rss.xml is not well-formed XML.");
  }
  if (document.documentElement.nodeName !== "rss") {
    fail("rss.xml must have an rss root element.");
  }
  const channel = document.getElementsByTagName("channel").item(0);
  if (!channel) fail("rss.xml must contain a channel.");
  childText(channel, "title", "rss channel");
  childText(channel, "link", "rss channel");
  const items = Array.from(document.getElementsByTagName("item"));
  if (items.length !== expectedItems) {
    fail(`rss.xml has ${items.length} items; expected ${expectedItems}.`);
  }
  for (const [index, item] of items.entries()) {
    childText(item, "title", `rss item ${index}`);
    const link = childText(item, "link", `rss item ${index}`);
    if (!/^https?:\/\//i.test(link)) {
      fail(`rss item ${index} has a non-absolute link.`);
    }
    childText(item, "guid", `rss item ${index}`);
    timestamp(
      childText(item, "pubDate", `rss item ${index}`),
      `rss item ${index}.pubDate`,
    );
    childText(item, "description", `rss item ${index}`);
  }
  return items.length;
}

async function validateAtom(
  publicDirectory: string,
  expectedEntries: number,
): Promise<number> {
  const path = join(publicDirectory, "atom.xml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("Missing static feed atom.xml.");
    }
    throw error;
  }
  scanForRuntimeSecrets(raw, "atom.xml");
  const document = new DOMParser().parseFromString(raw, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    fail("atom.xml is not well-formed XML.");
  }
  if (document.documentElement.localName !== "feed") {
    fail("atom.xml must have a feed root element.");
  }
  childText(document.documentElement, "title", "atom feed");
  childText(document.documentElement, "id", "atom feed");
  timestamp(
    childText(document.documentElement, "updated", "atom feed"),
    "atom feed.updated",
  );
  const entries = Array.from(document.getElementsByTagName("entry"));
  if (entries.length !== expectedEntries) {
    fail(
      `atom.xml has ${entries.length} entries; expected ${expectedEntries}.`,
    );
  }
  for (const [index, entry] of entries.entries()) {
    childText(entry, "title", `atom entry ${index}`);
    const id = childText(entry, "id", `atom entry ${index}`);
    if (!/^https?:\/\//i.test(id)) {
      fail(`atom entry ${index} has a non-absolute id.`);
    }
    timestamp(
      childText(entry, "updated", `atom entry ${index}`),
      `atom entry ${index}.updated`,
    );
    childText(entry, "summary", `atom entry ${index}`);
    const link = entry
      .getElementsByTagName("link")
      .item(0)
      ?.getAttribute("href");
    if (!link || !/^https?:\/\//i.test(link)) {
      fail(`atom entry ${index} has a non-absolute link href.`);
    }
  }
  return entries.length;
}

/** Verifies static API shape, data relationships, feed XML, and public-runtime safety. */
export async function validateStaticPublication(options: {
  publicDirectory: string;
}): Promise<StaticPublicationValidationSummary> {
  const publicDirectory = resolve(options.publicDirectory);
  const apiRoot = join(publicDirectory, "api", "v1");
  const paths = await jsonFiles(apiRoot);
  const documents = new Map<string, unknown>();
  for (const absolutePath of paths) {
    const path = relative(apiRoot, absolutePath).replaceAll("\\", "/");
    documents.set(path, (await readPublicJson(apiRoot, path)).value);
  }
  const required = (path: string): unknown => {
    const value = documents.get(path);
    return value === undefined
      ? fail(`Missing static API resource ${path}.`)
      : value;
  };

  const index = parsePublicIndex(required("index.json"), "index.json");
  const productsIndex = ProductIndexSchema.parse(required("products.json"));
  const latestIndex = LatestIndexSchema.parse(required("latest.json"));
  const knownGoodIndex = KnownGoodIndexSchema.parse(
    required("known-good.json"),
  );
  const expectedPaths = new Set([
    "index.json",
    "products.json",
    "latest.json",
    "known-good.json",
    "incidents.json",
  ]);
  const productDocuments = new Map<string, PublicProductDocument>();

  for (const product of productsIndex.products) {
    const id = safeSegment(product.id);
    const flatPath = `products/${id}.json`;
    const nestedPath = `products/${id}/index.json`;
    const flat = required(flatPath);
    const nested = required(nestedPath);
    if (!sameJson(flat, nested)) {
      fail(
        `${flatPath} and ${nestedPath} must be identical product documents.`,
      );
    }
    const document = parseProductDocument(flat, flatPath);
    if (
      document.product.id !== product.id ||
      document.product.name !== product.name
    ) {
      fail(`${flatPath} does not match products.json identity.`);
    }
    if (!sameJson(document.channels, product.channels)) {
      fail(`${flatPath} channels do not match products.json.`);
    }
    if (!sameJson(document.latest, product.latest)) {
      fail(`${flatPath} latest pointers do not match products.json.`);
    }
    if (!sameJson(document.knownGood, product.knownGood)) {
      fail(`${flatPath} known-good pointers do not match products.json.`);
    }
    const latestPath = `products/${id}/latest.json`;
    const latest = record(required(latestPath), latestPath);
    schemaVersion(latest, latestPath);
    if (latest.productId !== product.id) {
      fail(`${latestPath} has the wrong productId.`);
    }
    if (
      !sameJson(
        LatestReleasePointerSchema.array().parse(latest.releases),
        document.latest,
      )
    ) {
      fail(`${latestPath} does not match the product document.`);
    }
    const knownGoodPath = `products/${id}/known-good.json`;
    const knownGood = record(required(knownGoodPath), knownGoodPath);
    schemaVersion(knownGood, knownGoodPath);
    if (knownGood.productId !== product.id) {
      fail(`${knownGoodPath} has the wrong productId.`);
    }
    if (
      !sameJson(
        KnownGoodPointerSchema.array().parse(knownGood.pointers),
        document.knownGood,
      )
    ) {
      fail(`${knownGoodPath} does not match the product document.`);
    }
    const releasesPath = `products/${id}/releases.json`;
    const releases = record(required(releasesPath), releasesPath);
    schemaVersion(releases, releasesPath);
    if (releases.productId !== product.id) {
      fail(`${releasesPath} has the wrong productId.`);
    }
    const releaseReferences = array(
      releases.releases,
      `${releasesPath}.releases`,
    ).map((release, releaseIndex) =>
      parseReleaseReference(
        release,
        `${releasesPath}.releases[${releaseIndex}]`,
      ),
    );
    if (!sameJson(releaseReferences, document.releases)) {
      fail(`${releasesPath} does not match the product document.`);
    }
    expectedPaths.add(flatPath);
    expectedPaths.add(nestedPath);
    expectedPaths.add(latestPath);
    expectedPaths.add(knownGoodPath);
    expectedPaths.add(releasesPath);
    expectedPaths.add(`products/${id}/incidents.json`);
    for (const release of document.releases) {
      expectedPaths.add(
        `products/${id}/releases/${safeSegment(release.observationId)}.json`,
      );
    }
    productDocuments.set(product.id, document);
  }

  const observations = new Map<string, ReleaseObservation>();
  for (const [path, value] of documents) {
    if (!path.startsWith("releases/") || !path.endsWith(".json")) continue;
    const observation = ReleaseObservationSchema.parse(value);
    const expectedPath = `releases/${safeSegment(observation.observationId)}.json`;
    if (path !== expectedPath)
      fail(`${path} has an unexpected observation filename.`);
    if (observations.has(observation.observationId)) {
      fail(`Duplicate public observation ${observation.observationId}.`);
    }
    observations.set(observation.observationId, observation);
    expectedPaths.add(path);
  }

  const referencedObservations = new Set<string>();
  for (const [productId, document] of productDocuments) {
    for (const release of document.releases) {
      const observation = observations.get(release.observationId);
      if (!observation) {
        fail(
          `Product ${productId} references missing observation ${release.observationId}.`,
        );
      }
      if (observation.product.id !== productId) {
        fail(
          `Observation ${release.observationId} belongs to the wrong product.`,
        );
      }
      if (
        observation.release.canonicalVersion !== release.canonicalVersion ||
        observation.release.channel !== release.channel ||
        observation.release.platform !== release.platform ||
        observation.release.discoveredAt !== release.discoveredAt ||
        !sameJson(observation.verdict, release.verdict) ||
        observation.comparedWith !== release.comparedWith
      ) {
        fail(
          `Release reference for ${release.observationId} does not match its observation.`,
        );
      }
      const nestedPath = `products/${safeSegment(productId)}/releases/${safeSegment(release.observationId)}.json`;
      if (!sameJson(required(nestedPath), observation)) {
        fail(`${nestedPath} does not match the global release document.`);
      }
      referencedObservations.add(release.observationId);
    }
  }
  if (referencedObservations.size !== observations.size) {
    fail(
      "Every public release document must be referenced by exactly one product document.",
    );
  }

  const latestFromProducts = productsIndex.products.flatMap(
    (product) => product.latest,
  );
  if (!sameJson(latestIndex.releases, latestFromProducts)) {
    fail("latest.json does not match the product latest pointers.");
  }
  const knownGoodFromProducts = productsIndex.products.flatMap(
    (product) => product.knownGood,
  );
  if (!sameJson(knownGoodIndex.pointers, knownGoodFromProducts)) {
    fail("known-good.json does not match the product known-good pointers.");
  }
  for (const pointer of [...latestIndex.releases, ...knownGoodIndex.pointers]) {
    if (!observations.has(pointer.observationId)) {
      fail(`Index references missing observation ${pointer.observationId}.`);
    }
  }

  const diffs = new Map<string, ReleaseDiff>();
  const diffByObservation = new Map<string, ReleaseDiff>();
  for (const [path, value] of documents) {
    if (!path.startsWith("diffs/") || !path.endsWith(".json")) continue;
    const diff = ReleaseDiffSchema.parse(value);
    const expectedPath = `diffs/${safeSegment(diff.diffId)}.json`;
    if (path !== expectedPath) fail(`${path} has an unexpected diff filename.`);
    if (
      !observations.has(diff.observationId) ||
      !observations.has(diff.comparedWith)
    ) {
      fail(`${path} references a missing observation.`);
    }
    diffs.set(diff.diffId, diff);
    diffByObservation.set(diff.observationId, diff);
    expectedPaths.add(path);
  }
  for (const observation of observations.values()) {
    if (
      observation.comparedWith &&
      !diffByObservation.has(observation.observationId)
    ) {
      fail(
        `Observation ${observation.observationId} is missing its public diff.`,
      );
    }
  }
  for (const document of productDocuments.values()) {
    for (const release of document.releases) {
      const diff = release.diffId ? diffs.get(release.diffId) : undefined;
      if (release.diffId && !diff) {
        fail(
          `Release ${release.observationId} references missing diff ${release.diffId}.`,
        );
      }
      if (diff && diff.observationId !== release.observationId) {
        fail(
          `Release ${release.observationId} references a diff for another observation.`,
        );
      }
    }
  }

  const incidents = new Map<string, Incident>();
  for (const [path, value] of documents) {
    if (
      !path.startsWith("incidents/") ||
      path === "incidents.json" ||
      !path.endsWith(".json")
    ) {
      continue;
    }
    const incident = IncidentSchema.parse(value);
    const expectedPath = `incidents/${safeSegment(incident.id)}.json`;
    if (path !== expectedPath)
      fail(`${path} has an unexpected incident filename.`);
    if (incident.affectedObservations.some((id) => !observations.has(id))) {
      fail(`${path} references a missing observation.`);
    }
    incidents.set(incident.id, incident);
    expectedPaths.add(path);
  }
  const incidentList = record(required("incidents.json"), "incidents.json");
  schemaVersion(incidentList, "incidents.json");
  const listedIncidents = IncidentSchema.array().parse(incidentList.incidents);
  if (!sameJson(listedIncidents, Array.from(incidents.values()))) {
    fail("incidents.json does not match the detailed incident documents.");
  }
  for (const product of productsIndex.products) {
    const path = `products/${safeSegment(product.id)}/incidents.json`;
    const document = record(required(path), path);
    schemaVersion(document, path);
    if (document.productId !== product.id)
      fail(`${path} has the wrong productId.`);
    const productIncidents = IncidentSchema.array().parse(document.incidents);
    const expectedIncidents = Array.from(incidents.values()).filter(
      (incident) => incident.productId === product.id,
    );
    if (!sameJson(productIncidents, expectedIncidents)) {
      fail(`${path} does not match the detailed incident documents.`);
    }
  }
  const expectedIndexProducts = productsIndex.products.map((product) => ({
    id: product.id,
    name: product.name,
    latest: product.latest,
    knownGood: product.knownGood,
    releaseCount: productDocuments.get(product.id)?.releases.length,
  }));
  if (!sameJson(index.products, expectedIndexProducts)) {
    fail("index.json does not match the product summary documents.");
  }
  const expectedIndexIncidents = Array.from(incidents.values()).map(
    (incident) => ({
      id: incident.id,
      productId: incident.productId,
      status: incident.status,
      openedAt: incident.openedAt,
    }),
  );
  if (!sameJson(index.incidents, expectedIndexIncidents)) {
    fail("index.json does not match the incident summary documents.");
  }

  const actualPaths = new Set(documents.keys());
  if (
    actualPaths.size !== expectedPaths.size ||
    Array.from(actualPaths).some((path) => !expectedPaths.has(path))
  ) {
    const unexpected = Array.from(actualPaths)
      .filter((path) => !expectedPaths.has(path))
      .sort()
      .join(", ");
    const missing = Array.from(expectedPaths)
      .filter((path) => !actualPaths.has(path))
      .sort()
      .join(", ");
    fail(
      `Static API path set is inconsistent. Unexpected: ${unexpected || "none"}; missing: ${missing || "none"}.`,
    );
  }

  const [rssItems, atomEntries] = await Promise.all([
    validateRss(publicDirectory, latestIndex.releases.length),
    validateAtom(publicDirectory, latestIndex.releases.length),
  ]);
  return {
    jsonFiles: documents.size,
    products: productsIndex.products.length,
    observations: observations.size,
    diffs: diffs.size,
    incidents: incidents.size,
    rssItems,
    atomEntries,
  };
}
