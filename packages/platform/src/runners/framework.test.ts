import { describe, expect, it } from "vitest";
import {
  detectRunnerCapabilities,
  unsupportedForCapabilities,
} from "./capabilities";
import { runWithOneControlledRetry } from "./framework";

const observedAt = "2026-08-28T00:00:00.000Z";

describe("behavior runner framework", () => {
  it("returns unsupported for a missing capability instead of fabricating a pass", () => {
    const capabilities = {
      ...detectRunnerCapabilities(),
      interactiveGui: false,
    };
    expect(
      unsupportedForCapabilities(
        "desktop",
        ["interactiveGui"],
        capabilities,
        observedAt,
      ),
    ).toMatchObject({ status: "unsupported" });
  });

  it("allows exactly one controlled retry for a critical transient failure", async () => {
    let attempts = 0;
    const result = await runWithOneControlledRetry(
      "fixture",
      [],
      detectRunnerCapabilities(),
      async () => {
        attempts += 1;
        return {
          testId: "fixture",
          status: attempts === 1 ? "fail" : "pass",
          startedAt: observedAt,
          durationMs: 1,
          summary: "fixture",
        };
      },
      true,
      observedAt,
    );
    expect(attempts).toBe(2);
    expect(result.status).toBe("pass");
    expect(result.structuredDetails).toMatchObject({
      controlledRetry: { firstStatus: "fail", secondStatus: "pass" },
    });
  });
});
