import { describe, expect, it } from "vitest";
import { CodexStoreSource } from "./codex-store";
import type { Fe3Resolver } from "./fe3-runtime";
import { fixedContext, fixture } from "../test-helpers";

describe("Codex Store rollout policy", () => {
  it("retries a transient x64 FE3 absence without making optional ARM64 block discovery", async () => {
    let x64Attempts = 0;
    const resolver: Fe3Resolver = {
      async resolve(_context, _productId, _packageIdentity, architecture) {
        if (architecture === "arm64")
          throw new Error("ARM64 rollout is not yet downloadable.");
        x64Attempts += 1;
        if (x64Attempts === 1) throw new Error("FE3 has not converged yet.");
        return {
          productId: "9PLM9XGG6VKS",
          packageIdentity: "OpenAI.Codex",
          architecture: "x64",
          packageMoniker: "OpenAI.Codex_26.100.0.0_x64__2p2nqsd0c76g0",
          packageVersion: "26.100.0.0",
          updateId: "fixture-update",
          revisionNumber: "1",
          runtimeArtifact: {
            temporaryUrl: new URL(
              "https://fixture.dl.delivery.mp.microsoft.com/file.msix?ephemeral=fixture",
            ),
            expectedFileName: "fixture.msix",
            sourceHost: "fixture.dl.delivery.mp.microsoft.com",
          },
        };
      },
    };
    const catalogUrl =
      "https://displaycatalog.mp.microsoft.com/v7.0/products/9PLM9XGG6VKS?market=US&languages=en-US%2Cen%2Cneutral";
    const source = new CodexStoreSource({
      product: {
        productId: "9PLM9XGG6VKS",
        packageIdentity: "OpenAI.Codex",
        packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      },
      fe3: resolver,
      fe3RetryAttempts: 1,
      fe3RetryDelayMs: 0,
    });
    const snapshot = await source.discover(
      fixedContext({
        [catalogUrl]: await fixture("sources/display-catalog/catalog.json"),
      }),
    );
    expect(x64Attempts).toBe(2);
    expect(snapshot.state.architectures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          architecture: "x64",
          status: "downloadable",
          diagnostics: ["FE3 x64 became downloadable on retry 2."],
        }),
        expect.objectContaining({
          architecture: "arm64",
          status: "catalog-only",
        }),
      ]),
    );
    expect(snapshot.runtimeArtifacts.size).toBe(1);
  });

  it("redacts local resolver paths from persisted transient-rollout diagnostics", async () => {
    const resolver: Fe3Resolver = {
      async resolve() {
        throw new Error(
          "Command failed: dotnet run --project E:\\Projects\\ReleaseLens\\tools\\resolver.csproj Store resolver failed: no applicable update",
        );
      },
    };
    const catalogUrl =
      "https://displaycatalog.mp.microsoft.com/v7.0/products/9PLM9XGG6VKS?market=US&languages=en-US%2Cen%2Cneutral";
    const source = new CodexStoreSource({
      product: {
        productId: "9PLM9XGG6VKS",
        packageIdentity: "OpenAI.Codex",
        packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      },
      fe3: resolver,
      fe3RetryAttempts: 0,
    });
    const snapshot = await source.discover(
      fixedContext({
        [catalogUrl]: await fixture("sources/display-catalog/catalog.json"),
      }),
    );
    const diagnostic = snapshot.state.architectures
      .find((entry) => entry.architecture === "x64")!
      .diagnostics.join(" ");
    expect(diagnostic).not.toContain("E:\\Projects");
    expect(
      snapshot.evidence.map((entry) => JSON.stringify(entry)).join(" "),
    ).not.toContain("E:\\Projects");
  });

  it("vetoes a confirmed stale x64 FE3 state while treating ARM64 as catalog-only", async () => {
    const resolver: Fe3Resolver = {
      async resolve(_context, _productId, _packageIdentity, architecture) {
        if (architecture === "arm64") {
          throw new Error("No ARM64 update currently applicable.");
        }
        return {
          productId: "9PLM9XGG6VKS",
          packageIdentity: "OpenAI.Codex",
          architecture: "x64",
          packageMoniker: "OpenAI.Codex_26.99.999.0_x64__2p2nqsd0c76g0",
          packageVersion: "26.99.999.0",
          updateId: "fixture-update",
          revisionNumber: "1",
          runtimeArtifact: {
            temporaryUrl: new URL(
              "https://fixture.dl.delivery.mp.microsoft.com/file.msix?ephemeral=fixture",
            ),
            expectedFileName: "fixture.msix",
            sourceHost: "fixture.dl.delivery.mp.microsoft.com",
          },
        };
      },
    };
    const catalogUrl =
      "https://displaycatalog.mp.microsoft.com/v7.0/products/9PLM9XGG6VKS?market=US&languages=en-US%2Cen%2Cneutral";
    const source = new CodexStoreSource({
      product: {
        productId: "9PLM9XGG6VKS",
        packageIdentity: "OpenAI.Codex",
        packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      },
      rolloutSignalUrl: "https://signal.example/windows-store-update.json",
      fe3: resolver,
    });
    const snapshot = await source.discover(
      fixedContext({
        [catalogUrl]: await fixture("sources/display-catalog/catalog.json"),
        "https://signal.example/windows-store-update.json": JSON.stringify({
          buildVersion: "26.100.0.0",
        }),
      }),
    );
    expect(snapshot.state.architectures).toMatchObject([
      {
        architecture: "x64",
        status: "inconsistent",
        packageVersion: "26.99.999.0",
      },
      {
        architecture: "arm64",
        status: "catalog-only",
        packageVersion: "26.100.0.0",
      },
    ]);
    expect(snapshot.runtimeArtifacts.size).toBe(0);
    expect(
      snapshot.candidates.map((candidate) => candidate.discoveryStatus),
    ).toEqual(["inconsistent", "catalog-only"]);
  });

  it("vetoes an FE3-ahead x64 state until DisplayCatalog supplies the matching hash anchor", async () => {
    const resolver: Fe3Resolver = {
      async resolve(_context, _productId, _packageIdentity, architecture) {
        if (architecture === "arm64")
          throw new Error("ARM64 rollout is not yet downloadable.");
        return {
          productId: "9PLM9XGG6VKS",
          packageIdentity: "OpenAI.Codex",
          architecture: "x64",
          packageMoniker: "OpenAI.Codex_26.101.0.0_x64__2p2nqsd0c76g0",
          packageVersion: "26.101.0.0",
          updateId: "fixture-update",
          revisionNumber: "1",
          runtimeArtifact: {
            temporaryUrl: new URL(
              "https://fixture.dl.delivery.mp.microsoft.com/file.msix?ephemeral=fixture",
            ),
            expectedFileName: "fixture.msix",
            sourceHost: "fixture.dl.delivery.mp.microsoft.com",
          },
        };
      },
    };
    const catalogUrl =
      "https://displaycatalog.mp.microsoft.com/v7.0/products/9PLM9XGG6VKS?market=US&languages=en-US%2Cen%2Cneutral";
    const source = new CodexStoreSource({
      product: {
        productId: "9PLM9XGG6VKS",
        packageIdentity: "OpenAI.Codex",
        packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      },
      fe3: resolver,
    });
    const snapshot = await source.discover(
      fixedContext({
        [catalogUrl]: await fixture("sources/display-catalog/catalog.json"),
      }),
    );
    expect(snapshot.state.architectures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          architecture: "x64",
          status: "inconsistent",
          packageVersion: "26.101.0.0",
        }),
      ]),
    );
    expect(snapshot.runtimeArtifacts.size).toBe(0);
  });
});
