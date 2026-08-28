import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  ChannelHistorySnapshotSchema,
  compareVersions,
  type ChannelHistorySnapshot,
  type Incident,
  IncidentSchema,
  KnownGoodIndexSchema,
  type KnownGoodIndex,
  LatestIndexSchema,
  type LatestIndex,
  ProductIndexSchema,
  type ProductIndex,
  type ProductProfile,
  ReleaseDiffSchema,
  type ReleaseDiff,
  ReleaseObservationSchema,
  type ReleaseObservation,
} from "@releaselens/core";
import { selectLastKnownGood } from "../verdict/engine";

export class DataRepositoryError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export type DataValidationSummary = {
  observations: number;
  diffs: number;
  incidents: number;
  channelSnapshots: number;
};

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new DataRepositoryError(
      `Unsafe persisted data path segment: ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeCanonical(path: string, value: unknown): Promise<boolean> {
  const content = canonicalJson(value);
  const current = await tryRead(path);
  if (current === content) return false;
  await writeFile(await ensureParent(path), content, "utf8");
  return true;
}

async function ensureParent(path: string): Promise<string> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  return path;
}

function parseFile<T>(
  raw: string,
  path: string,
  parser: { parse(value: unknown): T },
): T {
  try {
    const value = parser.parse(JSON.parse(raw) as unknown);
    if (canonicalJson(value) !== raw) {
      throw new DataRepositoryError(`${path} is not canonical JSON.`);
    }
    return value;
  } catch (error) {
    if (error instanceof DataRepositoryError) throw error;
    throw new DataRepositoryError(
      `Invalid persisted data ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function compareObservations(
  left: ReleaseObservation,
  right: ReleaseObservation,
): number {
  return (
    left.release.discoveredAt.localeCompare(right.release.discoveredAt) ||
    left.observationId.localeCompare(right.observationId)
  );
}

function groupKey(observation: ReleaseObservation): string {
  return `${observation.product.id}\u0000${observation.release.channel}\u0000${observation.release.platform ?? ""}`;
}

function latestInGroup(
  profile: ProductProfile,
  observations: ReleaseObservation[],
): ReleaseObservation | undefined {
  return [...observations].sort((left, right) => {
    try {
      const version = compareVersions(
        right.release.canonicalVersion,
        left.release.canonicalVersion,
        profile.releaseModel.versionScheme,
      );
      if (version !== 0) return version;
    } catch {
      // An opaque upstream version is ordered by the meaningful observation time.
    }
    return compareObservations(right, left);
  })[0];
}

export class ReleaseLensDataRepository {
  public constructor(public readonly root: string) {}

  private observationsDirectory(productId: string): string {
    return join(this.root, "data", "observations", safeSegment(productId));
  }

  private diffsDirectory(productId: string): string {
    return join(this.root, "data", "diffs", safeSegment(productId));
  }

  private incidentsDirectory(): string {
    return join(this.root, "data", "incidents");
  }

  private indexesDirectory(): string {
    return join(this.root, "data", "indexes");
  }

  async observations(productId?: string): Promise<ReleaseObservation[]> {
    const directories = productId
      ? [this.observationsDirectory(productId)]
      : await this.productDataDirectories("observations");
    const records: ReleaseObservation[] = [];
    for (const directory of directories) {
      for (const path of await jsonFiles(directory)) {
        const raw = await tryRead(path);
        if (raw !== undefined)
          records.push(parseFile(raw, path, ReleaseObservationSchema));
      }
    }
    return records.sort(compareObservations);
  }

  async observation(
    productId: string,
    observationId: string,
  ): Promise<ReleaseObservation | undefined> {
    const path = join(
      this.observationsDirectory(productId),
      `${safeSegment(observationId)}.json`,
    );
    const raw = await tryRead(path);
    return raw === undefined
      ? undefined
      : parseFile(raw, path, ReleaseObservationSchema);
  }

  async writeObservation(observation: ReleaseObservation): Promise<boolean> {
    const path = join(
      this.observationsDirectory(observation.product.id),
      `${safeSegment(observation.observationId)}.json`,
    );
    return writeCanonical(path, ReleaseObservationSchema.parse(observation));
  }

  async diffs(productId?: string): Promise<ReleaseDiff[]> {
    const directories = productId
      ? [this.diffsDirectory(productId)]
      : await this.productDataDirectories("diffs");
    const records: ReleaseDiff[] = [];
    for (const directory of directories) {
      for (const path of await jsonFiles(directory)) {
        const raw = await tryRead(path);
        if (raw !== undefined)
          records.push(parseFile(raw, path, ReleaseDiffSchema));
      }
    }
    return records.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.diffId.localeCompare(right.diffId),
    );
  }

  async diff(
    productId: string,
    diffId: string,
  ): Promise<ReleaseDiff | undefined> {
    const path = join(
      this.diffsDirectory(productId),
      `${safeSegment(diffId)}.json`,
    );
    const raw = await tryRead(path);
    return raw === undefined
      ? undefined
      : parseFile(raw, path, ReleaseDiffSchema);
  }

  async writeDiff(diff: ReleaseDiff): Promise<boolean> {
    const path = join(
      this.diffsDirectory(diff.productId),
      `${safeSegment(diff.diffId)}.json`,
    );
    return writeCanonical(path, ReleaseDiffSchema.parse(diff));
  }

  async incidents(): Promise<Incident[]> {
    const records: Incident[] = [];
    for (const path of await jsonFiles(this.incidentsDirectory())) {
      const raw = await tryRead(path);
      if (raw !== undefined) records.push(parseFile(raw, path, IncidentSchema));
    }
    return records.sort((left, right) => left.id.localeCompare(right.id));
  }

  async writeIncident(incident: Incident): Promise<boolean> {
    return writeCanonical(
      join(this.incidentsDirectory(), `${safeSegment(incident.id)}.json`),
      IncidentSchema.parse(incident),
    );
  }

  async writeChannelHistory(
    snapshot: ChannelHistorySnapshot,
  ): Promise<boolean> {
    const path = join(
      this.root,
      "data",
      "channel-history",
      safeSegment(snapshot.productId),
      `${safeSegment(snapshot.sourceFingerprint)}.json`,
    );
    return writeCanonical(path, ChannelHistorySnapshotSchema.parse(snapshot));
  }

  async channelHistory(productId: string): Promise<ChannelHistorySnapshot[]> {
    const directory = join(
      this.root,
      "data",
      "channel-history",
      safeSegment(productId),
    );
    const records: ChannelHistorySnapshot[] = [];
    for (const path of await jsonFiles(directory)) {
      const raw = await tryRead(path);
      if (raw !== undefined)
        records.push(parseFile(raw, path, ChannelHistorySnapshotSchema));
    }
    return records.sort(
      (left, right) =>
        left.observedAt.localeCompare(right.observedAt) ||
        left.sourceFingerprint.localeCompare(right.sourceFingerprint),
    );
  }

  async indexes(): Promise<{
    products?: ProductIndex;
    latest?: LatestIndex;
    knownGood?: KnownGoodIndex;
  }> {
    const productsPath = join(this.indexesDirectory(), "products.json");
    const latestPath = join(this.indexesDirectory(), "latest.json");
    const knownGoodPath = join(this.indexesDirectory(), "known-good.json");
    const [products, latest, knownGood] = await Promise.all([
      tryRead(productsPath),
      tryRead(latestPath),
      tryRead(knownGoodPath),
    ]);
    return {
      ...(products
        ? { products: parseFile(products, productsPath, ProductIndexSchema) }
        : {}),
      ...(latest
        ? { latest: parseFile(latest, latestPath, LatestIndexSchema) }
        : {}),
      ...(knownGood
        ? {
            knownGood: parseFile(
              knownGood,
              knownGoodPath,
              KnownGoodIndexSchema,
            ),
          }
        : {}),
    };
  }

  async rebuildIndexes(profiles: ProductProfile[]): Promise<boolean> {
    const observations = await this.observations();
    const profileById = new Map(
      profiles.map((profile) => [profile.id, profile]),
    );
    const grouped = new Map<string, ReleaseObservation[]>();
    for (const observation of observations) {
      const current = grouped.get(groupKey(observation)) ?? [];
      current.push(observation);
      grouped.set(groupKey(observation), current);
    }
    const releases = Array.from(grouped.entries())
      .flatMap(([, group]) => {
        const profile = profileById.get(group[0]!.product.id);
        const latest = profile ? latestInGroup(profile, group) : undefined;
        return latest
          ? [
              {
                schemaVersion: 1 as const,
                productId: latest.product.id,
                channel: latest.release.channel,
                ...(latest.release.platform
                  ? { platform: latest.release.platform }
                  : {}),
                observationId: latest.observationId,
                version: latest.release.canonicalVersion,
                discoveredAt: latest.release.discoveredAt,
                verdict: latest.verdict,
              },
            ]
          : [];
      })
      .sort((left, right) =>
        `${left.productId}:${left.channel}:${left.platform ?? ""}`.localeCompare(
          `${right.productId}:${right.channel}:${right.platform ?? ""}`,
        ),
      );
    const pointers = profiles
      .flatMap((profile) => {
        const profileObservations = observations.filter(
          (observation) => observation.product.id === profile.id,
        );
        const keys = new Set(
          profileObservations.map(
            (observation) =>
              `${observation.release.channel}\u0000${observation.release.platform ?? ""}`,
          ),
        );
        return Array.from(keys).flatMap((key) => {
          const [channel, platform] = key.split("\u0000");
          const pointer = selectLastKnownGood(
            profile,
            profileObservations,
            channel!,
            platform || undefined,
          );
          return pointer ? [pointer] : [];
        });
      })
      .sort((left, right) =>
        `${left.productId}:${left.channel}:${left.platform ?? ""}`.localeCompare(
          `${right.productId}:${right.channel}:${right.platform ?? ""}`,
        ),
      );
    const products = profiles
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        channels: profile.releaseModel.channels,
        latest: releases.filter((release) => release.productId === profile.id),
        knownGood: pointers.filter(
          (pointer) => pointer.productId === profile.id,
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const writes = await Promise.all([
      writeCanonical(
        join(this.indexesDirectory(), "latest.json"),
        LatestIndexSchema.parse({ schemaVersion: 1, releases }),
      ),
      writeCanonical(
        join(this.indexesDirectory(), "known-good.json"),
        KnownGoodIndexSchema.parse({ schemaVersion: 1, pointers }),
      ),
      writeCanonical(
        join(this.indexesDirectory(), "products.json"),
        ProductIndexSchema.parse({ schemaVersion: 1, products }),
      ),
    ]);
    return writes.some(Boolean);
  }

  async validate(): Promise<DataValidationSummary> {
    const [observations, diffs, incidents] = await Promise.all([
      this.observations(),
      this.diffs(),
      this.incidents(),
    ]);
    const observationIds = new Set(
      observations.map((observation) => observation.observationId),
    );
    const diffIds = new Set(diffs.map((diff) => diff.observationId));
    for (const diff of diffs) {
      if (
        !observationIds.has(diff.observationId) ||
        !observationIds.has(diff.comparedWith)
      ) {
        throw new DataRepositoryError(
          `Diff ${diff.diffId} references a missing observation.`,
        );
      }
    }
    for (const incident of incidents) {
      if (incident.affectedObservations.some((id) => !observationIds.has(id))) {
        throw new DataRepositoryError(
          `Incident ${incident.id} references a missing observation.`,
        );
      }
    }
    for (const observation of observations) {
      if (observation.comparedWith && !diffIds.has(observation.observationId)) {
        throw new DataRepositoryError(
          `Observation ${observation.observationId} has comparedWith but no persisted diff.`,
        );
      }
    }
    const indexes = await this.indexes();
    if (!indexes.products || !indexes.latest || !indexes.knownGood) {
      throw new DataRepositoryError("Data indexes are incomplete.");
    }
    for (const release of indexes.latest.releases) {
      if (!observationIds.has(release.observationId))
        throw new DataRepositoryError(
          `Latest index references missing observation ${release.observationId}.`,
        );
    }
    for (const pointer of indexes.knownGood.pointers) {
      if (!observationIds.has(pointer.observationId))
        throw new DataRepositoryError(
          `Known-good index references missing observation ${pointer.observationId}.`,
        );
    }
    const histories = await Promise.all(
      indexes.products.products.map((product) =>
        this.channelHistory(product.id),
      ),
    );
    return {
      observations: observations.length,
      diffs: diffs.length,
      incidents: incidents.length,
      channelSnapshots: histories.flat().length,
    };
  }

  private async productDataDirectories(
    kind: "observations" | "diffs",
  ): Promise<string[]> {
    const root = join(this.root, "data", kind);
    try {
      const entries = await readdir(root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
