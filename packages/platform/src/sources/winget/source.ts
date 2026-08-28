import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  canonicalSha256,
  compareSemverVersions,
  type ReleaseCandidate,
  type SourceEvidence,
} from "@releaselens/core";
import { parse as parseYaml } from "yaml";
import {
  isoNow,
  type ReleaseSource,
  type SourceContext,
  type SourceSnapshot,
} from "../contracts";
import { requestJson, requestText, SourceHttpError } from "../http";

const execFileAsync = promisify(execFile);

type GitHubDirectoryEntry = {
  name: string;
  type: "dir" | "file";
  download_url?: string | null;
};

type WinGetInstaller = {
  Architecture?: string;
  InstallerUrl?: string;
  InstallerSha256?: string;
  InstallerType?: string;
};

type WinGetManifest = {
  PackageIdentifier?: string;
  PackageVersion?: string;
  Installers?: WinGetInstaller[];
};

export type WinGetSourceConfig = {
  packageId: string;
  sourceId?: string;
  repository?: string;
  branch?: string;
  /** Read-only `winget show` fallback for GitHub API rate limiting on Windows. */
  client?: WinGetClient;
};

export type WinGetClient = {
  show(packageId: string, timeoutMs: number): Promise<string>;
};

export type WinGetState = {
  packageId: string;
  version: string;
  manifestUrl: string;
  installers: Array<{
    architecture?: string;
    installerType?: string;
    sourceHost?: string;
    sha256?: string;
  }>;
  discoveryMethod: "github-api" | "winget-client";
};

class ShellWinGetClient implements WinGetClient {
  async show(packageId: string, timeoutMs: number): Promise<string> {
    const { stdout } = await execFileAsync(
      "winget.exe",
      [
        "show",
        "--id",
        packageId,
        "--exact",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--disable-interactivity",
      ],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1_024 * 1_024 },
    );
    return stdout;
  }
}

function manifestPathFor(packageId: string): string {
  const [publisher, name] = packageId.split(".");
  if (!publisher || !name) {
    throw new Error(
      `WinGet package id ${packageId} must have publisher and name components.`,
    );
  }
  return `manifests/${publisher[0]!.toLowerCase()}/${publisher}/${name}`;
}

function chooseLatestDirectory(entries: GitHubDirectoryEntry[]): string {
  const candidates = entries.filter(
    (entry) =>
      entry.type === "dir" &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.name),
  );
  if (candidates.length === 0) {
    throw new Error(
      "The WinGet manifest directory did not contain semantic-version directories.",
    );
  }
  return candidates
    .map((entry) => entry.name)
    .sort((left, right) => compareSemverVersions(right, left))[0]!;
}

function sourceHost(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function isGitHubRateLimit(error: unknown): boolean {
  return (
    error instanceof SourceHttpError &&
    error.status === 403 &&
    error.url.startsWith("https://api.github.com/")
  );
}

export function parseWinGetShowOutput(output: string): {
  version: string;
  installer?: WinGetInstaller;
} {
  const version =
    /^(?:Version|版本)\s*:\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/im.exec(
      output,
    )?.[1];
  if (!version) {
    throw new Error("winget show did not report a parseable package version.");
  }
  const installerUrl =
    /^(?:Installer URL|安装程序 URL)\s*:\s*(https?:\/\/\S+)\s*$/im.exec(
      output,
    )?.[1];
  const installerSha256 =
    /^(?:Installer SHA256|安装程序 SHA256)\s*:\s*([a-f0-9]{64})\s*$/im.exec(
      output,
    )?.[1];
  const installerType =
    /^(?:Installer Type|安装程序类型)\s*:\s*(\S+)\s*$/im.exec(output)?.[1];
  return {
    version,
    ...(installerUrl || installerSha256 || installerType
      ? {
          installer: {
            ...(installerUrl ? { InstallerUrl: installerUrl } : {}),
            ...(installerSha256 ? { InstallerSha256: installerSha256 } : {}),
            ...(installerType ? { InstallerType: installerType } : {}),
          },
        }
      : {}),
  };
}

function normalizedInstallers(
  installers: WinGetInstaller[],
): WinGetState["installers"] {
  return installers.map((installer) => {
    const host = sourceHost(installer.InstallerUrl);
    return {
      ...(installer.Architecture
        ? { architecture: installer.Architecture.toLowerCase() }
        : {}),
      ...(installer.InstallerType
        ? { installerType: installer.InstallerType }
        : {}),
      ...(host ? { sourceHost: host } : {}),
      ...(installer.InstallerSha256
        ? { sha256: installer.InstallerSha256.toLowerCase() }
        : {}),
    };
  });
}

export class WinGetSource implements ReleaseSource<WinGetState> {
  public readonly id: string;

  public constructor(private readonly config: WinGetSourceConfig) {
    this.id = config.sourceId ?? "winget";
  }

  private snapshot(
    state: WinGetState,
    observedAt: string,
  ): SourceSnapshot<WinGetState> {
    const fingerprint = canonicalSha256(state);
    const sourceUrl = state.manifestUrl;
    const evidence: SourceEvidence[] = [
      {
        id: `${this.id}:manifest:${state.version}`,
        kind: "source",
        sourceId: this.id,
        sourceType:
          state.discoveryMethod === "github-api"
            ? "winget-manifest"
            : "winget-client-index",
        status: "pass",
        summary:
          state.discoveryMethod === "github-api"
            ? `WinGet ${state.packageId} exposes ${state.version} with ${state.installers.length} installer entries.`
            : `Read-only WinGet client reports ${state.packageId} at ${state.version} after the GitHub API rate limit was reached.`,
        sourceUrl,
        fingerprint,
        observedAt,
        details: {
          packageId: state.packageId,
          version: state.version,
          installers: state.installers,
          discoveryMethod: state.discoveryMethod,
        },
      },
    ];
    const candidates: ReleaseCandidate[] = [
      {
        productId: "unbound",
        sourceId: this.id,
        channel: "winget",
        platform: "windows",
        sourceVersion: state.version,
        sourceReleaseId: `${state.packageId}@${state.version}`,
        discoveredAt: observedAt,
        discoveryStatus: "metadata-only",
        sourceEvidence: evidence,
      },
    ];
    return {
      sourceId: this.id,
      observedAt,
      fingerprint,
      candidates,
      evidence,
      state,
    };
  }

  private async discoverFromGitHub(
    context: SourceContext,
    repository: string,
    branch: string,
    path: string,
  ): Promise<WinGetState> {
    const entries = await requestJson<GitHubDirectoryEntry[]>(
      context,
      `https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const version = chooseLatestDirectory(entries);
    const directory = `${path}/${version}`;
    const manifestEntries = await requestJson<GitHubDirectoryEntry[]>(
      context,
      `https://api.github.com/repos/${repository}/contents/${directory}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const installerEntry = manifestEntries.find(
      (entry) =>
        entry.type === "file" &&
        entry.name.toLowerCase().endsWith(".installer.yaml"),
    );
    if (!installerEntry?.download_url) {
      throw new Error(
        `No installer manifest was available for ${this.config.packageId}@${version}.`,
      );
    }
    const { body } = await requestText(context, installerEntry.download_url, {
      headers: { Accept: "text/yaml" },
    });
    const manifest = parseYaml(body) as WinGetManifest;
    if (
      manifest.PackageIdentifier !== this.config.packageId ||
      manifest.PackageVersion !== version
    ) {
      throw new Error(
        `WinGet installer manifest identity mismatch for ${this.config.packageId}@${version}.`,
      );
    }
    const installers = normalizedInstallers(manifest.Installers ?? []);
    if (installers.length === 0) {
      throw new Error(
        `WinGet installer manifest has no installers for ${this.config.packageId}@${version}.`,
      );
    }
    return {
      packageId: this.config.packageId,
      version,
      manifestUrl: installerEntry.download_url,
      installers,
      discoveryMethod: "github-api",
    };
  }

  private async discoverFromClient(
    context: SourceContext,
    repository: string,
    branch: string,
    path: string,
  ): Promise<WinGetState> {
    const parsed = parseWinGetShowOutput(
      await (this.config.client ?? new ShellWinGetClient()).show(
        this.config.packageId,
        context.timeoutMs,
      ),
    );
    const installers = normalizedInstallers(
      parsed.installer ? [parsed.installer] : [],
    );
    return {
      packageId: this.config.packageId,
      version: parsed.version,
      manifestUrl: `https://github.com/${repository}/tree/${encodeURIComponent(branch)}/${path}`,
      installers,
      discoveryMethod: "winget-client",
    };
  }

  public async discover(
    context: SourceContext,
  ): Promise<SourceSnapshot<WinGetState>> {
    const observedAt = isoNow(context);
    const repository = this.config.repository ?? "microsoft/winget-pkgs";
    const branch = this.config.branch ?? "master";
    const path = manifestPathFor(this.config.packageId);
    try {
      return this.snapshot(
        await this.discoverFromGitHub(context, repository, branch, path),
        observedAt,
      );
    } catch (error) {
      if (!isGitHubRateLimit(error)) throw error;
      return this.snapshot(
        await this.discoverFromClient(context, repository, branch, path),
        observedAt,
      );
    }
  }
}
