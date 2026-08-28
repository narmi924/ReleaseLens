import { describe, expect, it } from "vitest";
import {
  parseDisplayCatalog,
  selectCatalogPackage,
  type StoreProductRef,
} from "./display-catalog";
import { fixture } from "../test-helpers";

const product: StoreProductRef = {
  productId: "9PLM9XGG6VKS",
  packageIdentity: "OpenAI.Codex",
  packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
};

describe("DisplayCatalog parser", () => {
  it("finds the category id and structurally selects the highest package version", async () => {
    const state = parseDisplayCatalog(
      JSON.parse(
        await fixture("sources/display-catalog/catalog.json"),
      ) as unknown,
    );
    expect(
      selectCatalogPackage(state.packages, product, "x64")
        ?.maxDownloadSizeBytes,
    ).toBe(200);
    expect(state.wuCategoryId).toContain("catalog-fixture");
    expect(
      selectCatalogPackage(state.packages, product, "x64")?.packageFullName,
    ).toContain("26.100.0.0");
    expect(
      selectCatalogPackage(state.packages, product, "arm64")?.packageFullName,
    ).toContain("arm64");
  });

  it("rejects a malformed product payload", () => {
    expect(() => parseDisplayCatalog({ Product: {} })).toThrow(
      "Product.ProductId",
    );
  });
});
