import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ProductProfileSchema, type ProductProfile } from "./models";

export class ProfileValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export function parseProductProfile(
  source: string,
  sourceName = "profile",
): ProductProfile {
  try {
    return ProductProfileSchema.parse(parseYaml(source) as unknown);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProfileValidationError(`Invalid ${sourceName}: ${detail}`);
  }
}

export async function loadProductProfile(
  filePath: string,
): Promise<ProductProfile> {
  return parseProductProfile(await readFile(filePath, "utf8"), filePath);
}

export async function loadProductProfiles(
  productsDirectory: string,
): Promise<ProductProfile[]> {
  const entries = await readdir(productsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const profiles = await Promise.all(
    files.map((file) => loadProductProfile(join(productsDirectory, file))),
  );
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new ProfileValidationError(
        `Duplicate product profile id: ${profile.id}.`,
      );
    }
    ids.add(profile.id);
  }
  return profiles;
}
