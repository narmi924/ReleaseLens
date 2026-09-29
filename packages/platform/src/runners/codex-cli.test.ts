import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { withArtifactLease } from "../artifacts/lease";
import { NpmPackageInspector } from "../inspectors/npm-package/inspector";
import { detectRunnerCapabilities } from "./capabilities";
import { runCodexCliSmoke, smokeExtractedCodexCli } from "./codex-cli";

const observedAt = "2026-09-28T00:00:00.000Z";
const windows = process.platform === "win32";
const systemRoot = process.env.SystemRoot ?? join("C:", "Windows");
// A small signed system executable that answers both --version and --help.
const standInBinary = join(systemRoot, "System32", "curl.exe");

type Fixture = { tarball: string; integrity: string };

async function pack(root: string, name: string): Promise<Fixture> {
  const tarball = join(root, `${name}.tgz`);
  await tar.c({ gzip: true, cwd: join(root, name), file: tarball }, [
    "package",
  ]);
  const bytes = await readFile(tarball);
  return {
    tarball,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

async function createWrapperFixture(root: string): Promise<Fixture> {
  const packageDirectory = join(root, "wrapper", "package");
  await mkdir(join(packageDirectory, "bin"), { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@fixture/codex",
      version: "1.2.3",
      bin: { codex: "bin/codex.js" },
      optionalDependencies: {
        "@fixture/codex-win32-x64": "npm:@fixture/codex@1.2.3-win32-x64",
      },
    }),
  );
  // Mirrors the published launcher: resolve the platform package through
  // node's own module lookup, then hand every argument to the binary.
  await writeFile(
    join(packageDirectory, "bin", "codex.js"),
    [
      'const { spawnSync } = require("node:child_process");',
      'const path = require("node:path");',
      'const manifest = require.resolve("@fixture/codex-win32-x64/package.json");',
      'const binary = path.join(path.dirname(manifest), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");',
      'const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });',
      "process.exit(result.status === null ? 1 : result.status);",
    ].join("\n"),
  );
  return pack(root, "wrapper");
}

async function createPlatformFixture(root: string): Promise<Fixture> {
  const packageDirectory = join(root, "platform", "package");
  const binaryDirectory = join(
    packageDirectory,
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
  );
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@fixture/codex",
      version: "1.2.3-win32-x64",
      os: ["win32"],
      cpu: ["x64"],
    }),
  );
  await copyFile(standInBinary, join(binaryDirectory, "codex.exe"));
  return pack(root, "platform");
}

describe("Codex CLI isolated smoke", () => {
  it("does not download a platform binary when the runner cannot execute it", async () => {
    const outcome = await runCodexCliSmoke(
      {
        channel: "latest",
        version: "0.158.0",
        packageName: "@openai/codex",
        integrity: "sha512-fixture",
        runtimeArtifact: {
          temporaryUrl: new URL(
            "https://registry.npmjs.org/@openai/codex/-/codex-0.158.0.tgz",
          ),
          expectedFileName: "codex-0.158.0.tgz",
          sourceHost: "registry.npmjs.org",
        },
      },
      observedAt,
      { ...detectRunnerCapabilities(), windows: false },
    );
    expect(outcome.results[0]?.status).toBe("unsupported");
    expect(outcome.artifacts).toHaveLength(1);
    expect(outcome.artifacts[0]?.status).toBe("unsupported");
  });

  it.runIf(windows && existsSync(standInBinary))(
    "lays the verified wrapper and platform package out like npm and runs the published launcher",
    async () => {
      await withArtifactLease("releaselens-codex-cli-test", async (lease) => {
        const [wrapper, platform] = await Promise.all([
          createWrapperFixture(lease.directory),
          createPlatformFixture(lease.directory),
        ]);
        const inspector = new NpmPackageInspector();
        const wrapperInspection = await inspector.inspect(wrapper.tarball, {
          packageName: "@fixture/codex",
          packageVersion: "1.2.3",
          integrity: wrapper.integrity,
        });
        const platformInspection = await inspector.inspect(platform.tarball, {
          packageName: "@fixture/codex",
          packageVersion: "1.2.3-win32-x64",
          integrity: platform.integrity,
        });
        const outcome = await smokeExtractedCodexCli(
          { tarballPath: wrapper.tarball, inspection: wrapperInspection },
          {
            tarballPath: platform.tarball,
            inspection: platformInspection,
            dependency: "@fixture/codex-win32-x64",
          },
          observedAt,
          detectRunnerCapabilities(),
        );
        expect(outcome.results.map((result) => result.testId)).toEqual([
          "codex-version",
          "codex-help",
        ]);
        expect(outcome.results.map((result) => result.status)).toEqual([
          "pass",
          "pass",
        ]);
        expect(outcome.interface?.cliName).toBe("codex");
      });
    },
  );

  it("refuses to execute when either package failed integrity verification", async () => {
    const inspection = {
      packageName: "@fixture/codex",
      packageVersion: "1.2.3",
      integrity: {
        algorithm: "sha512",
        expected: "a",
        actual: "b",
        valid: false,
      },
      bin: { codex: "bin/codex.js" },
      engines: {},
      dependencies: [],
      fileCount: 3,
      topLevelDirectories: ["bin"],
    };
    const outcome = await smokeExtractedCodexCli(
      { tarballPath: "wrapper.tgz", inspection },
      {
        tarballPath: "platform.tgz",
        inspection,
        dependency: "@fixture/codex-win32-x64",
      },
      observedAt,
      { ...detectRunnerCapabilities(), windows: true },
    );
    expect(outcome.results[0]).toMatchObject({
      testId: "codex-version",
      status: "fail",
    });
    expect(outcome.results[0]?.summary).toContain("integrity");
  });
});
