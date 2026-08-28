import { describe, expect, it } from "vitest";
import {
  persistedDiscoveryView,
  type ProductDiscovery,
} from "./discovery-service";

describe("persisted discovery view", () => {
  it("projects runtime artifact resolvers out before serializing discovery", () => {
    const discovery = {
      product: { id: "fixture", name: "Fixture" },
      observedAt: "2026-08-28T12:00:00.000Z",
      attempts: [
        {
          sourceId: "fixture-source",
          required: true,
          status: "pass",
          snapshot: {
            sourceId: "fixture-source",
            observedAt: "2026-08-28T12:00:00.000Z",
            fingerprint: "f".repeat(64),
            candidates: [],
            evidence: [],
            state: { version: "1.0.0" },
            runtimeArtifact: {
              temporaryUrl: new URL(
                "https://example.invalid/file?temporary=true",
              ),
            },
          },
        },
      ],
    } as unknown as ProductDiscovery;
    const view = JSON.stringify(persistedDiscoveryView(discovery));
    expect(view).toContain("fixture-source");
    expect(view).not.toContain("temporaryUrl");
    expect(view).not.toContain("temporary=true");
  });
});
