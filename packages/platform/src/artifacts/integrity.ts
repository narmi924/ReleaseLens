import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";

export type IntegrityResult = {
  algorithm: string;
  expected: string;
  actual: string;
  valid: boolean;
};

export async function hashFile(
  filePath: string,
  algorithm: "sha256" | "sha512" = "sha256",
): Promise<string> {
  const hash = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function verifyNpmIntegrity(
  filePath: string,
  integrity: string,
): Promise<IntegrityResult> {
  const token = integrity.trim().split(/\s+/)[0];
  const match = /^(sha(?:256|384|512))-(.+)$/i.exec(token ?? "");
  if (!match) {
    throw new Error(
      "Unsupported or malformed npm Subresource Integrity value.",
    );
  }
  const algorithm = match[1]!.toLowerCase();
  const expected = Buffer.from(match[2]!, "base64");
  const hash = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  const actual = hash.digest();
  return {
    algorithm,
    expected: expected.toString("base64"),
    actual: actual.toString("base64"),
    valid:
      expected.length === actual.length && timingSafeEqual(expected, actual),
  };
}
