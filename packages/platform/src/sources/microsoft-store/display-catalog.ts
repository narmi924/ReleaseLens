import {
  canonicalSha256,
  compareQuadVersions,
  parsePackageMoniker,
  type Architecture,
  type ReleaseCandidate,
  type SourceEvidence,
} from "@releaselens/core";
import { isoNow, type SourceContext } from "../contracts";
import { requestJson } from "../http";

export type StoreProductRef = {
  productId: string;
  packageIdentity: string;
  packageFamilyName: string;
};

export type StoreQueryLocale = {
  market: string;
  languages: string[];
};

export type CatalogPackage = {
  packageFullName: string;
  packageId?: string;
  contentId?: string;
  packageFamilyName?: string;
  architectures: string[];
  hashAlgorithm?: string;
  hash?: string;
  /** DisplayCatalog's MaxDownloadSizeInBytes is an upper bound, not an exact Content-Length. */
  maxDownloadSizeBytes?: number;
};

export type DisplayCatalogState = {
  productId: string;
  wuCategoryId?: string;
  packages: CatalogPackage[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function asPackage(value: unknown): CatalogPackage | undefined {
  if (!isRecord(value) || typeof value.PackageFullName !== "string") {
    return undefined;
  }
  const packageFamilyName =
    typeof value.PackageFamilyName === "string"
      ? value.PackageFamilyName
      : undefined;
  const maxDownloadSizeBytes = numberOrUndefined(value.MaxDownloadSizeInBytes);
  return {
    packageFullName: value.PackageFullName,
    ...(typeof value.PackageId === "string"
      ? { packageId: value.PackageId }
      : {}),
    ...(typeof value.ContentId === "string"
      ? { contentId: value.ContentId }
      : {}),
    ...(packageFamilyName ? { packageFamilyName } : {}),
    architectures: strings(value.Architectures).map((architecture) =>
      architecture.toLowerCase(),
    ),
    ...(typeof value.HashAlgorithm === "string"
      ? { hashAlgorithm: value.HashAlgorithm }
      : {}),
    ...(typeof value.Hash === "string" ? { hash: value.Hash } : {}),
    ...(maxDownloadSizeBytes !== undefined ? { maxDownloadSizeBytes } : {}),
  };
}

function findStringProperty(
  value: unknown,
  expectedKey: string,
): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringProperty(item, expectedKey);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === expectedKey && typeof nested === "string" && nested.trim()) {
      return nested;
    }
    const found = findStringProperty(nested, expectedKey);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function displaySkuPackages(payload: unknown): unknown[] {
  if (
    !isRecord(payload) ||
    !isRecord(payload.Product) ||
    !Array.isArray(payload.Product.DisplaySkuAvailabilities)
  ) {
    return [];
  }
  return payload.Product.DisplaySkuAvailabilities.flatMap((availability) => {
    if (
      !isRecord(availability) ||
      !isRecord(availability.Sku) ||
      !isRecord(availability.Sku.Properties)
    ) {
      return [];
    }
    return Array.isArray(availability.Sku.Properties.Packages)
      ? availability.Sku.Properties.Packages
      : [];
  });
}

export function parseDisplayCatalog(payload: unknown): DisplayCatalogState {
  if (
    !isRecord(payload) ||
    !isRecord(payload.Product) ||
    typeof payload.Product.ProductId !== "string"
  ) {
    throw new Error(
      "DisplayCatalog payload does not contain Product.ProductId.",
    );
  }
  const packages = displaySkuPackages(payload)
    .map(asPackage)
    .filter((item): item is CatalogPackage => item !== undefined)
    .sort((left, right) =>
      left.packageFullName.localeCompare(right.packageFullName),
    );
  const wuCategoryId = findStringProperty(payload, "WuCategoryId");
  return {
    productId: payload.Product.ProductId,
    ...(wuCategoryId ? { wuCategoryId } : {}),
    packages,
  };
}

function compareCatalogPackages(
  left: CatalogPackage,
  right: CatalogPackage,
): number {
  const leftVersion = parsePackageMoniker(left.packageFullName)?.version.join(
    ".",
  );
  const rightVersion = parsePackageMoniker(right.packageFullName)?.version.join(
    ".",
  );
  if (leftVersion && rightVersion) {
    const comparison = compareQuadVersions(leftVersion, rightVersion);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return left.packageFullName.localeCompare(right.packageFullName);
}

export function selectCatalogPackage(
  packages: readonly CatalogPackage[],
  product: StoreProductRef,
  architecture: Architecture,
): CatalogPackage | undefined {
  const candidates = packages.filter(
    (item) =>
      item.packageFamilyName === product.packageFamilyName &&
      item.architectures.includes(architecture.toLowerCase()) &&
      parsePackageMoniker(item.packageFullName)?.name.toLowerCase() ===
        product.packageIdentity.toLowerCase(),
  );
  return candidates.sort(compareCatalogPackages).at(-1);
}

export class DisplayCatalogClient {
  public constructor(
    private readonly product: StoreProductRef,
    private readonly locale: StoreQueryLocale = {
      market: "US",
      languages: ["en-US", "en", "neutral"],
    },
  ) {}

  public async discover(context: SourceContext): Promise<DisplayCatalogState> {
    const parameters = new URLSearchParams({
      market: this.locale.market,
      languages: this.locale.languages.join(","),
    });
    const url = `https://displaycatalog.mp.microsoft.com/v7.0/products/${encodeURIComponent(this.product.productId)}?${parameters}`;
    const parsed = parseDisplayCatalog(
      await requestJson<unknown>(context, url),
    );
    if (parsed.productId !== this.product.productId) {
      throw new Error(
        `DisplayCatalog identity mismatch: expected ${this.product.productId}, received ${parsed.productId}.`,
      );
    }
    return parsed;
  }
}

export function catalogEvidence(
  sourceId: string,
  product: StoreProductRef,
  state: DisplayCatalogState,
  context: SourceContext,
): SourceEvidence {
  const observedAt = isoNow(context);
  const fingerprint = canonicalSha256(state);
  return {
    id: `${sourceId}:catalog:${product.productId}`,
    kind: "source",
    sourceId,
    sourceType: "microsoft-store-display-catalog",
    status: "pass",
    summary: `DisplayCatalog exposes ${state.packages.length} packages for Store product ${product.productId}.`,
    sourceUrl: `https://apps.microsoft.com/detail/${product.productId}`,
    fingerprint,
    observedAt,
    details: {
      productId: state.productId,
      wuCategoryIdPresent: Boolean(state.wuCategoryId),
      packageCount: state.packages.length,
    },
  };
}

export function catalogCandidate(
  productId: string,
  sourceId: string,
  architecture: Architecture,
  catalogPackage: CatalogPackage | undefined,
  evidence: SourceEvidence,
  discoveredAt: string,
): ReleaseCandidate | undefined {
  const moniker = catalogPackage
    ? parsePackageMoniker(catalogPackage.packageFullName)
    : undefined;
  if (!catalogPackage || !moniker) {
    return undefined;
  }
  return {
    productId,
    sourceId,
    channel: "stable",
    platform: `windows-${architecture}`,
    sourceVersion: moniker.version.join("."),
    sourceReleaseId: catalogPackage.packageFullName,
    discoveredAt,
    discoveryStatus: "catalog-only",
    sourceEvidence: [evidence],
  };
}
