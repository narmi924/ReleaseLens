import { describe, expect, it } from "vitest";
import { createSourceContext } from "./contracts";
import { requestText, SourceHttpError } from "./http";

describe("source HTTP transport", () => {
  it("does not retain an upstream error response body", async () => {
    const context = createSourceContext({
      fetch: async () =>
        new Response(
          JSON.stringify({
            message: "rate limit exceeded for 203.0.113.42",
            requestId: "private-request-identifier",
          }),
          { status: 403, statusText: "Forbidden" },
        ),
    });

    const error = await requestText(
      context,
      "https://api.example.invalid/releases?per_page=12",
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SourceHttpError);
    expect((error as Error).message).toBe(
      "HTTP 403 while reading https://api.example.invalid/releases?per_page=12.",
    );
    expect((error as Error).message).not.toContain("203.0.113.42");
    expect((error as Error).message).not.toContain(
      "private-request-identifier",
    );
  });
});
