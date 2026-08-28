import { describe, expect, it } from "vitest";
import {
  parseFe3DownloadUrl,
  parseFe3SyncCandidates,
  selectFe3Candidate,
} from "./fe3-contract";
import { fixture } from "../test-helpers";

describe("FE3 SOAP contract parsing", () => {
  it("extracts HTML-encoded package fragments and chooses the requested architecture", async () => {
    const candidates = parseFe3SyncCandidates(
      await fixture("sources/fe3/sync-updates.xml"),
    );
    expect(candidates).toHaveLength(3);
    expect(
      selectFe3Candidate(candidates, "OpenAI.Codex", "x64")?.updateId,
    ).toBe("x64-new");
    expect(
      selectFe3Candidate(candidates, "OpenAI.Codex", "arm64")?.updateId,
    ).toBe("arm-catalog-only");
  });

  it("allowlists only Microsoft delivery hosts and ignores malformed package fragments", async () => {
    expect(
      parseFe3DownloadUrl(await fixture("sources/fe3/extended-info.xml"))?.host,
    ).toBe("fixture.dl.delivery.mp.microsoft.com");
    expect(
      parseFe3SyncCandidates(await fixture("sources/fe3/malformed.xml")),
    ).toEqual([]);
  });
});
