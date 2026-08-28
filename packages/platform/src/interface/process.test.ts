import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { probeCliInterface } from "./probe";
import { runBoundedProcess, withIsolatedProcessEnvironment } from "./process";

describe("safe interface process probes", () => {
  it("uses an absolute executable and removes its isolated profile", async () => {
    let directory = "";
    await withIsolatedProcessEnvironment(
      "releaselens-process-test",
      async (isolated) => {
        directory = isolated.directory;
        const result = await runBoundedProcess({
          executable: process.execPath,
          args: ["-e", "process.stdout.write(process.env.HOME || '')"],
          env: isolated.environment,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(directory);
      },
    );
    await expect(access(directory)).rejects.toThrow();
  });

  it("captures only version and help for an interface probe", async () => {
    const script = [
      "const last = process.argv.at(-1);",
      "if (last === '--version') process.stdout.write('fixture 1.2.3\\n');",
      "else process.stdout.write('Commands:\\n  inspect    Inspect a fixture\\n\\nOptions:\\n  --json     JSON output\\n');",
    ].join(" ");
    const probe = await probeCliInterface(
      {
        cliName: "fixture",
        executable: process.execPath,
        versionArgs: ["-e", script, "--", "--version"],
        helpArgs: ["-e", script, "--", "--help"],
      },
      "2026-08-28T00:00:00.000Z",
    );
    expect(probe.results.map((result) => result.status)).toEqual([
      "pass",
      "pass",
    ]);
    expect(probe.interface?.commands.map((command) => command.name)).toEqual([
      "inspect",
    ]);
  });
});
