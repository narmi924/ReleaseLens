import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { withArtifactLease } from "../../artifacts/lease";
import { NpmPackageInspector } from "./inspector";

async function makePackageTarball(
  root: string,
): Promise<{ filePath: string; integrity: string }> {
  const packageDirectory = join(root, "package");
  await mkdir(join(packageDirectory, "bin"), { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@fixture/gemini",
      version: "1.2.3",
      bin: { gemini: "bin/gemini.js" },
      engines: { node: ">=22" },
      dependencies: { zod: "^3.0.0" },
    }),
  );
  await writeFile(
    join(packageDirectory, "bin", "gemini.js"),
    "#!/usr/bin/env node\nconsole.log('fixture');\n",
  );
  const filePath = join(root, "fixture.tgz");
  await tar.c({ gzip: true, cwd: root, file: filePath }, ["package"]);
  const contents = await readFile(filePath);
  return {
    filePath,
    integrity: `sha512-${createHash("sha512").update(contents).digest("base64")}`,
  };
}

describe("npm package inspector", () => {
  it("verifies SRI then inspects a package manifest without executing package code", async () => {
    await withArtifactLease("releaselens-npm-test", async (lease) => {
      const fixture = await makePackageTarball(lease.directory);
      const inspection = await new NpmPackageInspector().inspect(
        fixture.filePath,
        {
          packageName: "@fixture/gemini",
          packageVersion: "1.2.3",
          integrity: fixture.integrity,
        },
      );
      expect(inspection.integrity.valid).toBe(true);
      expect(inspection.bin).toEqual({ gemini: "bin/gemini.js" });
      expect(inspection.dependencies).toEqual(["zod"]);
    });
  });

  it("rejects a tarball when its registry integrity does not match", async () => {
    await withArtifactLease("releaselens-npm-test", async (lease) => {
      const fixture = await makePackageTarball(lease.directory);
      await expect(
        new NpmPackageInspector().inspect(fixture.filePath, {
          packageName: "@fixture/gemini",
          packageVersion: "1.2.3",
          integrity: "sha512-ZmFrZQ==",
        }),
      ).rejects.toThrow("integrity verification failed");
    });
  });
});
