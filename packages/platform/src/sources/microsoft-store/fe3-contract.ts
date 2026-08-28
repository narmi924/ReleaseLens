import {
  compareQuadVersions,
  parsePackageMoniker,
  type Architecture,
} from "@releaselens/core";

export type Fe3Candidate = {
  packageMoniker: string;
  packageType: string;
  updateId: string;
  revisionNumber: string;
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function attributeOrChild(
  fragment: string,
  elementName: string,
  property: string,
): string | undefined {
  const elementMatch = new RegExp(
    `<${elementName}\\b([^>]*)>([\\s\\S]*?)</${elementName}>|<${elementName}\\b([^>]*)/>`,
    "i",
  ).exec(fragment);
  if (!elementMatch) {
    return undefined;
  }
  const attributes = `${elementMatch[1] ?? ""} ${elementMatch[3] ?? ""}`;
  const attribute = new RegExp(
    `\\b${property}\\s*=\\s*["']([^"']+)["']`,
    "i",
  ).exec(attributes)?.[1];
  if (attribute) {
    return decodeXmlEntities(attribute).trim();
  }
  const child = new RegExp(
    `<${property}\\b[^>]*>([\\s\\S]*?)</${property}>`,
    "i",
  ).exec(elementMatch[2] ?? "")?.[1];
  return child ? decodeXmlEntities(child).trim() : undefined;
}

function xmlFragments(soap: string): string[] {
  const matches = soap.matchAll(
    /<(?:(?:\w+):)?Xml\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Xml>/gi,
  );
  return Array.from(matches, (match) => decodeXmlEntities(match[1] ?? ""));
}

export function parseFe3SyncCandidates(soap: string): Fe3Candidate[] {
  const parsed: Fe3Candidate[] = [];
  for (const fragment of xmlFragments(soap)) {
    if (
      !/<AppxMetadata\b/i.test(fragment) ||
      !/<SecuredFragment\b/i.test(fragment)
    ) {
      continue;
    }
    const packageMoniker = attributeOrChild(
      fragment,
      "AppxMetadata",
      "PackageMoniker",
    );
    const packageType = attributeOrChild(
      fragment,
      "AppxMetadata",
      "PackageType",
    );
    const updateId = attributeOrChild(fragment, "UpdateIdentity", "UpdateID");
    const revisionNumber = attributeOrChild(
      fragment,
      "UpdateIdentity",
      "RevisionNumber",
    );
    if (packageMoniker && packageType && updateId && revisionNumber) {
      parsed.push({ packageMoniker, packageType, updateId, revisionNumber });
    }
  }
  return parsed;
}

export function selectFe3Candidate(
  candidates: readonly Fe3Candidate[],
  packageIdentity: string,
  architecture: Architecture,
): Fe3Candidate | undefined {
  return candidates
    .filter((candidate) => {
      const moniker = parsePackageMoniker(candidate.packageMoniker);
      return (
        moniker?.name.toLowerCase() === packageIdentity.toLowerCase() &&
        moniker.architecture === architecture
      );
    })
    .sort((left, right) => {
      const leftVersion = parsePackageMoniker(
        left.packageMoniker,
      )?.version.join(".");
      const rightVersion = parsePackageMoniker(
        right.packageMoniker,
      )?.version.join(".");
      if (!leftVersion || !rightVersion) {
        return left.packageMoniker.localeCompare(right.packageMoniker);
      }
      return compareQuadVersions(leftVersion, rightVersion);
    })
    .at(-1);
}

export function isAllowedMicrosoftDeliveryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "dl.delivery.mp.microsoft.com" ||
        url.hostname.endsWith(".dl.delivery.mp.microsoft.com"))
    );
  } catch {
    return false;
  }
}

export function parseFe3DownloadUrl(soap: string): URL | undefined {
  const values = Array.from(
    soap.matchAll(/<(?:(?:\w+):)?Url\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Url>/gi),
    (match) => decodeXmlEntities(match[1] ?? "").trim(),
  ).filter(isAllowedMicrosoftDeliveryUrl);
  return values
    .sort((left, right) => right.length - left.length)
    .map((value) => new URL(value))[0];
}
