import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parsePackageMoniker,
  type Architecture,
  type ResolvedArtifactRuntime,
} from "@releaselens/core";
import type { SourceContext } from "../contracts";

const execFileAsync = promisify(execFile);

type ResolverJson = {
  schemaVersion: number;
  productId: string;
  packageIdentity: string;
  architecture: string;
  packageMoniker: string;
  packageVersion: string;
  updateId: string;
  revisionNumber: string;
  sourceHost: string;
  temporaryUrl: string;
};

export type Fe3RuntimeResolution = {
  productId: string;
  packageIdentity: string;
  architecture: Architecture;
  packageMoniker: string;
  packageVersion: string;
  updateId: string;
  revisionNumber: string;
  runtimeArtifact: ResolvedArtifactRuntime;
};

export type Fe3ResolverConfig = {
  projectPath?: string;
  market?: string;
};

export interface Fe3Resolver {
  resolve(
    context: SourceContext,
    productId: string,
    packageIdentity: string,
    architecture: Architecture,
  ): Promise<Fe3RuntimeResolution>;
}

function resultJson(stdout: string): ResolverJson {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("{") && item.endsWith("}"))
    .at(-1);
  if (!line) {
    throw new Error("The FE3 resolver did not produce a JSON result.");
  }
  const parsed = JSON.parse(line) as Partial<ResolverJson>;
  const required = [
    "productId",
    "packageIdentity",
    "architecture",
    "packageMoniker",
    "packageVersion",
    "updateId",
    "revisionNumber",
    "sourceHost",
    "temporaryUrl",
  ] as const;
  for (const key of required) {
    if (typeof parsed[key] !== "string" || parsed[key].trim().length === 0) {
      throw new Error(`The FE3 resolver omitted ${key}.`);
    }
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Unsupported FE3 resolver schema ${String(parsed.schemaVersion)}.`,
    );
  }
  return parsed as ResolverJson;
}

export function isMicrosoftDeliveryRuntimeUrl(url: URL): boolean {
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    (url.hostname === "dl.delivery.mp.microsoft.com" ||
      url.hostname.endsWith(".dl.delivery.mp.microsoft.com"))
  );
}

export class ExperimentalFe3Resolver implements Fe3Resolver {
  public constructor(private readonly config: Fe3ResolverConfig = {}) {}

  public async resolve(
    context: SourceContext,
    productId: string,
    packageIdentity: string,
    architecture: Architecture,
  ): Promise<Fe3RuntimeResolution> {
    if (architecture !== "x64" && architecture !== "arm64") {
      throw new Error(
        `Experimental FE3 resolver only supports x64 and arm64, not ${architecture}.`,
      );
    }
    const projectPath =
      this.config.projectPath ??
      `${context.workspaceRoot}/tools/store-resolver/ReleaseLens.StoreResolver.csproj`;
    const argumentsList = [
      "run",
      "--project",
      projectPath,
      "--configuration",
      "Release",
      "--",
      "--product-id",
      productId,
      "--package-identity",
      packageIdentity,
      "--architecture",
      architecture,
      "--market",
      this.config.market ?? "US",
    ];
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("dotnet", argumentsList, {
        timeout: Math.min(context.timeoutMs * 4, 120_000),
        windowsHide: true,
        maxBuffer: 1_024 * 1_024,
        env: {
          ...process.env,
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_NOLOGO: "1",
        },
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Experimental FE3 resolver failed for ${architecture}: ${detail}`,
      );
    }
    const result = resultJson(stdout);
    if (
      result.productId !== productId ||
      result.packageIdentity !== packageIdentity ||
      result.architecture !== architecture
    ) {
      throw new Error(
        "Experimental FE3 resolver returned an identity mismatch.",
      );
    }
    const moniker = parsePackageMoniker(result.packageMoniker);
    if (
      !moniker ||
      moniker.name !== packageIdentity ||
      moniker.architecture !== architecture ||
      moniker.version.join(".") !== result.packageVersion
    ) {
      throw new Error(
        "Experimental FE3 resolver returned a malformed or mismatched package moniker.",
      );
    }
    const temporaryUrl = new URL(result.temporaryUrl);
    if (!isMicrosoftDeliveryRuntimeUrl(temporaryUrl)) {
      throw new Error(
        "Experimental FE3 resolver returned a URL outside the Microsoft delivery allowlist.",
      );
    }
    return {
      productId,
      packageIdentity,
      architecture,
      packageMoniker: result.packageMoniker,
      packageVersion: result.packageVersion,
      updateId: result.updateId,
      revisionNumber: result.revisionNumber,
      runtimeArtifact: {
        temporaryUrl,
        expectedFileName: `${result.packageMoniker}.msix`,
        sourceHost: temporaryUrl.host,
      },
    };
  }
}
