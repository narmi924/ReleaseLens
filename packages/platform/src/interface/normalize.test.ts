import { describe, expect, it } from "vitest";
import { fixture } from "../sources/test-helpers";
import {
  interfaceEvidenceFromSnapshot,
  normalizeCliHelp,
  normalizeCliVersion,
} from "./normalize";

describe("CLI normalization", () => {
  it("extracts commands, options, and stable environment/configuration keys", async () => {
    const snapshot = normalizeCliHelp(
      "gemini",
      await fixture("interfaces/gemini-help.txt"),
      "gemini 0.57.0\n",
    );
    expect(snapshot.reportedVersion).toBe("0.57.0");
    expect(snapshot.commands.map((command) => command.name)).toEqual([
      "auth",
      "config",
      "extensions",
    ]);
    expect(snapshot.globalOptions.flatMap((option) => option.names)).toContain(
      "--model",
    );
    expect(snapshot.environmentKeys).toEqual(["GEMINI_API_KEY"]);
    expect(snapshot.configKeys).toEqual(["GEMINI_MODEL"]);
    expect(
      interfaceEvidenceFromSnapshot(snapshot, "2026-08-28T00:00:00.000Z")
        .snapshotHash,
    ).toBe(snapshot.snapshotHash);
  });

  it("normalizes ANSI and version prefixes", () => {
    expect(normalizeCliVersion("\u001b[32mclaude v2.3.4\u001b[0m\n")).toBe(
      "2.3.4",
    );
  });
});
