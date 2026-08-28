import { describe, expect, it } from "vitest";
import { redactPersistableErrorMessage } from "./observe";

describe("persisted observation error text", () => {
  it("redacts credentials, addresses, delivery URLs, and local paths", () => {
    const message = redactPersistableErrorMessage(
      "HTTP 403 from https://api.example.invalid/releases?access_token=secret for 203.0.113.42; " +
        "Bearer abcdefghijklmnop; C:\\Users\\operator\\Temp\\artifact.msix; " +
        "https://tlu.dl.delivery.mp.microsoft.com/file.msix?sig=short-lived",
    );

    expect(message).not.toContain("secret");
    expect(message).not.toContain("203.0.113.42");
    expect(message).not.toContain("abcdefghijklmnop");
    expect(message).not.toContain("C:\\Users");
    expect(message).toContain("<redacted-ip-address>");
    expect(message).toContain("<redacted-microsoft-delivery-url>");
  });
});
