import { describe, expect, it } from "vitest";
import { createSourceContext } from "../sources/contracts";
import { refreshOfficialGitHubCommunity } from "./github";

const now = new Date("2026-08-28T12:00:00.000Z");
const repository = "example/tool";

describe("official GitHub community refresh", () => {
  it("keeps a minimal deterministic issue signal and discards issue bodies", async () => {
    const issueUrl = `https://api.github.com/repos/${repository}/issues?state=all&since=${encodeURIComponent("2026-08-25T12:00:00.000Z")}&per_page=20&sort=created&direction=desc`;
    const issuePayload = [1, 2, 3].map((number) => ({
      id: number,
      number,
      html_url: `https://github.com/${repository}/issues/${number}`,
      title: "Windows 1.2.3 fails with E_RELEASE_BROKEN",
      body: "private-looking body detail that must never be copied verbatim",
      created_at: `2026-08-${25 + number}T12:00:00.000Z`,
      updated_at: `2026-08-${25 + number}T12:00:00.000Z`,
      closed_at: null,
      state: "open",
      labels: [{ name: "bug" }],
      comments: number === 1 ? 1 : 0,
    }));
    const context = createSourceContext({
      now: () => now,
      timeoutMs: 1_000,
      fetch: async (input) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url === issueUrl)
          return new Response(JSON.stringify(issuePayload), { status: 200 });
        if (url.endsWith("/issues/1/comments?per_page=100")) {
          return new Response(
            JSON.stringify([
              {
                body: "We have reproduced this and are investigating.",
                author_association: "MEMBER",
              },
            ]),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    const evidence = await refreshOfficialGitHubCommunity({
      profile: {
        id: "fixture",
        name: "Fixture",
        community: { repository, lookbackHours: 72 },
      },
      releaseVersion: "1.2.3",
      context,
    });
    expect(evidence).toMatchObject({ status: "warning", repository });
    expect(evidence?.issues[0]).toMatchObject({
      explicitVersion: "1.2.3",
      platform: "windows",
      maintainerAcknowledged: true,
    });
    expect(evidence?.clusters).toEqual([
      expect.objectContaining({ strength: "strong" }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain(
      "private-looking body detail",
    );
    expect(evidence?.details?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
