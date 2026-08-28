import { describe, expect, it } from "vitest";
import { sitePath } from "./site-path";

describe("sitePath", () => {
  it("keeps root deployments at the root", () => {
    expect(sitePath("/rss.xml", "")).toBe("/rss.xml");
    expect(sitePath("/rss.xml", "/")).toBe("/rss.xml");
  });

  it("prefixes project Pages paths exactly once", () => {
    expect(sitePath("/rss.xml", "/ReleaseLens/")).toBe("/ReleaseLens/rss.xml");
  });
});
