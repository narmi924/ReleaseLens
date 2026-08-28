import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { withArtifactLease } from "../artifacts/lease";
import { NpmPackageInspector } from "../inspectors/npm-package/inspector";
import { detectRunnerCapabilities } from "./capabilities";
import { smokeExtractedGemini } from "./gemini";

async function createGeminiFixture(
  root: string,
): Promise<{ tarball: string; integrity: string }> {
  const packageDirectory = join(root, "package");
  await mkdir(join(packageDirectory, "bin"), { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@fixture/gemini",
      version: "1.2.3",
      bin: { gemini: "bin/gemini.js" },
    }),
  );
  await writeFile(
    join(packageDirectory, "bin", "gemini.js"),
    [
      "const argument = process.argv.at(-1);",
      "if (argument === '--version') console.log('gemini 1.2.3');",
      "else console.log('Commands:\\n  inspect    Inspect\\n\\nOptions:\\n  --json     JSON');",
    ].join(" "),
  );
  const tarball = join(root, "gemini.tgz");
  await tar.c({ gzip: true, cwd: root, file: tarball }, ["package"]);
  const bytes = await readFile(tarball);
  return {
    tarball,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

describe("Gemini isolated smoke", () => {
  it("executes only a verified tarball entry through node, without an npm install", async () => {
    await withArtifactLease("releaselens-gemini-test", async (lease) => {
      const fixture = await createGeminiFixture(lease.directory);
      const inspection = await new NpmPackageInspector().inspect(
        fixture.tarball,
        {
          packageName: "@fixture/gemini",
          packageVersion: "1.2.3",
          integrity: fixture.integrity,
        },
      );
      const outcome = await smokeExtractedGemini(
        fixture.tarball,
        inspection,
        "2026-08-28T00:00:00.000Z",
        detectRunnerCapabilities(),
      );
      expect(outcome.results.map((result) => result.status)).toEqual([
        "pass",
        "pass",
      ]);
      expect(
        outcome.interface?.commands.map((command) => command.name),
      ).toEqual(["inspect"]);
    });
  });
});
