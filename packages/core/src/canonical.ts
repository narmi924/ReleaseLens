import { createHash } from "node:crypto";
import type { ZodType } from "zod";

const forbiddenKey =
  /(?:temporary(?:url|path|file)?|downloadurl|authorization|authheaders?|cookie|process(?:handle|id)|temp(?:path|file))/i;
const signedMicrosoftDeliveryUrl =
  /^https?:\/\/[^/]*\.dl\.delivery\.mp\.microsoft\.com\/[^\s?]+\?/i;
const embeddedSignedMicrosoftDeliveryUrl =
  /https?:\/\/[^/]*\.dl\.delivery\.mp\.microsoft\.com\/[^\s?]+\?[^\s"']+/i;
const sensitiveUrlQuery =
  /[?&](?:access[_-]?token|api[_-]?key|authorization|auth|token|signature|sig|secret|cookie|key)=[^&#\s"']+/i;
// Persisted observations are portable public data.  Reject every absolute
// local path rather than trying to maintain a brittle list of temporary roots.
// The Windows alternative deliberately requires a non-letter boundary so it
// does not mistake the `s://` portion of an HTTPS URL for a drive designator.
const localFilesystemPath =
  /(?:^|[^A-Za-z])(?:[A-Za-z]:[\\/][^\s"']*|\\\\[^\\/\s]+[\\/][^\s"']*|\/(?:tmp|var\/folders|private\/var|home|Users)\/[^\s"']*)/i;

export class PersistedStateSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PersistedStateSafetyError";
  }
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): CanonicalValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string") {
      if (
        signedMicrosoftDeliveryUrl.test(value) ||
        embeddedSignedMicrosoftDeliveryUrl.test(value)
      ) {
        throw new PersistedStateSafetyError(
          `Signed Microsoft delivery URL cannot be persisted at ${path}.`,
        );
      }
      if (sensitiveUrlQuery.test(value)) {
        throw new PersistedStateSafetyError(
          `Credential-shaped URL query cannot be persisted at ${path}.`,
        );
      }
      if (localFilesystemPath.test(value)) {
        throw new PersistedStateSafetyError(
          `Local filesystem path cannot be persisted at ${path}.`,
        );
      }
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PersistedStateSafetyError(`Non-finite number at ${path}.`);
    }
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    throw new PersistedStateSafetyError(
      `Runtime URL object cannot be persisted at ${path}.`,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalize(item, `${path}[${index}]`, seen),
    );
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new PersistedStateSafetyError(`Circular structure at ${path}.`);
    }
    seen.add(value);
    const result: { [key: string]: CanonicalValue } = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (child === undefined) {
        continue;
      }
      if (forbiddenKey.test(key)) {
        throw new PersistedStateSafetyError(
          `Runtime or credential field "${key}" cannot be persisted at ${path}.`,
        );
      }
      result[key] = canonicalize(child, `${path}.${key}`, seen);
    }
    seen.delete(value);
    return result;
  }

  throw new PersistedStateSafetyError(`Unsupported value at ${path}.`);
}

export function canonicalizeForPersistence(value: unknown): CanonicalValue {
  return canonicalize(value, "$", new WeakSet<object>());
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalizeForPersistence(value), null, 2)}\n`;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function parseCanonicalJson<T>(source: string, schema: ZodType<T>): T {
  return schema.parse(JSON.parse(source) as unknown);
}
