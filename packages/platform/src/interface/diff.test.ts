import { describe, expect, it } from "vitest";
import { diffInterfaceEvidence } from "./diff";
import { interfaceEvidenceFromSnapshot, normalizeCliHelp } from "./normalize";

const observedAt = "2026-08-28T00:00:00.000Z";

describe("interface diff", () => {
  it("reports command and flag changes but not help-text wording changes", () => {
    const previous = interfaceEvidenceFromSnapshot(
      normalizeCliHelp(
        "fixture",
        "Commands:\n  run     Run work\n\nOptions:\n  --old     Old option\n",
        "1.0.0",
      ),
      observedAt,
    );
    const wordingOnly = interfaceEvidenceFromSnapshot(
      normalizeCliHelp(
        "fixture",
        "Commands:\n  run     Execute work in a new wording\n\nOptions:\n  --old     Different description\n",
        "1.0.0",
      ),
      observedAt,
    );
    const changed = interfaceEvidenceFromSnapshot(
      normalizeCliHelp(
        "fixture",
        "Commands:\n  inspect     Inspect work\n  run         Run work\n\nOptions:\n  --new <x>    New option\n",
        "1.1.0",
      ),
      observedAt,
    );
    expect(diffInterfaceEvidence(previous, wordingOnly)).toEqual([]);
    expect(
      diffInterfaceEvidence(previous, changed).map((change) => change.type),
    ).toEqual(["command-added", "flag-added", "flag-removed"]);
  });
});
