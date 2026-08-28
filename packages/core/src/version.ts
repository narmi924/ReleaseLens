import type { ProductProfile } from "./models";

export type QuadVersion = readonly [number, number, number, number];

export type PackageMoniker = {
  name: string;
  version: QuadVersion;
  architecture: string;
  resourceId: string;
  publisherId: string;
  raw: string;
};

function compareNumberParts(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

export function parseQuadVersion(value: string): QuadVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const values = match.slice(1).map(Number);
  if (values.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return undefined;
  }
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

export function compareQuadVersions(left: string, right: string): number {
  const parsedLeft = parseQuadVersion(left);
  const parsedRight = parseQuadVersion(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error(
      `Expected quad versions, received "${left}" and "${right}".`,
    );
  }
  return compareNumberParts(parsedLeft, parsedRight);
}

type ParsedSemver = {
  numeric: number[];
  prerelease: string[];
};

function parseSemver(value: string): ParsedSemver | undefined {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value.trim(),
    );
  if (!match) {
    return undefined;
  }
  const numeric = match.slice(1, 4).map(Number);
  if (numeric.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return undefined;
  }
  return { numeric, prerelease: match[4] ? match[4].split(".") : [] };
}

function comparePrerelease(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    }
    if (leftNumeric) {
      return -1;
    }
    if (rightNumeric) {
      return 1;
    }
    return leftPart.localeCompare(rightPart) > 0 ? 1 : -1;
  }
  return 0;
}

export function compareSemverVersions(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error(
      `Expected semantic versions, received "${left}" and "${right}".`,
    );
  }
  return (
    compareNumberParts(parsedLeft.numeric, parsedRight.numeric) ||
    comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
  );
}

export function compareVersions(
  left: string,
  right: string,
  scheme: ProductProfile["releaseModel"]["versionScheme"],
): number {
  switch (scheme) {
    case "quad":
      return compareQuadVersions(left, right);
    case "semver":
      return compareSemverVersions(left, right);
    case "opaque":
    case "custom":
      return left.localeCompare(right);
  }
}

export function parsePackageMoniker(
  moniker: string,
): PackageMoniker | undefined {
  const parts = moniker.split("_");
  if (parts.length < 5) {
    return undefined;
  }
  const publisherId = parts.at(-1);
  const resourceId = parts.at(-2);
  const architecture = parts.at(-3);
  const versionText = parts.at(-4);
  const name = parts.slice(0, -4).join("_");
  if (
    !publisherId ||
    resourceId === undefined ||
    !architecture ||
    !versionText ||
    !name
  ) {
    return undefined;
  }
  const version = parseQuadVersion(versionText);
  if (!version) {
    return undefined;
  }
  return {
    name,
    version,
    architecture: architecture.toLowerCase(),
    resourceId,
    publisherId,
    raw: moniker,
  };
}
