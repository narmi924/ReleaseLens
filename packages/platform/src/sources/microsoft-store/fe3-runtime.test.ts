import { describe, expect, it } from "vitest";
import { isMicrosoftDeliveryRuntimeUrl } from "./fe3-runtime";

describe("experimental FE3 runtime URL policy", () => {
  it("accepts only Microsoft delivery hosts, including the observed HTTP FE3 origin", () => {
    expect(
      isMicrosoftDeliveryRuntimeUrl(
        new URL(
          "http://tlu.dl.delivery.mp.microsoft.com/file.msix?ephemeral=fixture",
        ),
      ),
    ).toBe(true);
    expect(
      isMicrosoftDeliveryRuntimeUrl(
        new URL(
          "https://tlu.dl.delivery.mp.microsoft.com/file.msix?ephemeral=fixture",
        ),
      ),
    ).toBe(true);
    expect(
      isMicrosoftDeliveryRuntimeUrl(
        new URL("https://example.invalid/file.msix"),
      ),
    ).toBe(false);
    expect(
      isMicrosoftDeliveryRuntimeUrl(
        new URL("ftp://tlu.dl.delivery.mp.microsoft.com/file.msix"),
      ),
    ).toBe(false);
  });
});
