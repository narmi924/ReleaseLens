import { createHash } from "node:crypto";
import {
  canonicalSha256,
  type ReleaseCandidate,
  type ResolvedArtifactRuntime,
  type SourceEvidence,
} from "@releaselens/core";
import {
  isoNow,
  type ReleaseSource,
  type SourceContext,
  type SourceSnapshot,
} from "../contracts";
import { requestJson, requestText } from "../http";

type ClaudeReleaseManifest = {
  platforms?: Record<
    string,
    {
      checksum?: string;
    }
  >;
};

export type ClaudeNativeSourceConfig = {
  sourceId?: string;
  installScriptUrl?: string;
  releaseBaseUrl?: string;
  platform?: "win32-x64" | "win32-arm64";
};

export type ClaudeNativeState = {
  version: string;
  platform: string;
  checksum: string;
  releaseManifestUrl: string;
  installScriptUrl: string;
  installScriptSha256: string;
};

export type ClaudeNativeSourceSnapshot = SourceSnapshot<ClaudeNativeState> & {
  runtimeArtifact: ResolvedArtifactRuntime;
};

function scriptSha256(script: string): string {
  return createHash("sha256").update(script).digest("hex");
}

function validateVersion(value: string): string {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Claude native release endpoint returned an invalid version: ${JSON.stringify(version)}.`,
    );
  }
  return version;
}

export class ClaudeNativeSource implements ReleaseSource<ClaudeNativeState> {
  public readonly id: string;

  public constructor(private readonly config: ClaudeNativeSourceConfig = {}) {
    this.id = config.sourceId ?? "claude-native";
  }

  public async discover(
    context: SourceContext,
  ): Promise<ClaudeNativeSourceSnapshot> {
    const observedAt = isoNow(context);
    const installScriptUrl =
      this.config.installScriptUrl ?? "https://claude.ai/install.ps1";
    const releaseBaseUrl = (
      this.config.releaseBaseUrl ??
      "https://downloads.claude.ai/claude-code-releases"
    ).replace(/\/$/, "");
    const platform = this.config.platform ?? "win32-x64";
    const [{ body: installScript }, { body: latestBody }] = await Promise.all([
      requestText(context, installScriptUrl, {
        headers: { Accept: "text/plain" },
      }),
      requestText(context, `${releaseBaseUrl}/latest`, {
        headers: { Accept: "text/plain" },
      }),
    ]);
    const version = validateVersion(latestBody);
    const releaseManifestUrl = `${releaseBaseUrl}/${encodeURIComponent(version)}/manifest.json`;
    const manifest = await requestJson<ClaudeReleaseManifest>(
      context,
      releaseManifestUrl,
    );
    const checksum = manifest.platforms?.[platform]?.checksum?.toLowerCase();
    if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error(
        `Claude native manifest does not provide a SHA-256 checksum for ${platform}.`,
      );
    }
    const state: ClaudeNativeState = {
      version,
      platform,
      checksum,
      releaseManifestUrl,
      installScriptUrl,
      installScriptSha256: scriptSha256(installScript),
    };
    const fingerprint = canonicalSha256(state);
    const evidence: SourceEvidence[] = [
      {
        id: `${this.id}:release:${version}`,
        kind: "source",
        sourceId: this.id,
        sourceType: "claude-native-release",
        status: "pass",
        summary: `Anthropic's native Windows ${platform} release is ${version} with a manifest SHA-256.`,
        sourceUrl: releaseManifestUrl,
        fingerprint,
        observedAt,
        details: {
          platform,
          version,
          checksum,
          installScriptSha256: state.installScriptSha256,
        },
      },
    ];
    const candidates: ReleaseCandidate[] = [
      {
        productId: "unbound",
        sourceId: this.id,
        channel: "latest",
        platform: "windows-x64",
        sourceVersion: version,
        sourceReleaseId: `claude-native@${version}:${platform}`,
        discoveredAt: observedAt,
        discoveryStatus: "downloadable",
        sourceEvidence: evidence,
      },
    ];
    const runtimeArtifact: ResolvedArtifactRuntime = {
      temporaryUrl: new URL(
        `${releaseBaseUrl}/${encodeURIComponent(version)}/${platform}/claude.exe`,
      ),
      expectedFileName: `claude-${version}-${platform}.exe`,
      sourceHost: "downloads.claude.ai",
    };
    return {
      sourceId: this.id,
      observedAt,
      fingerprint,
      candidates,
      evidence,
      state,
      runtimeArtifact,
    };
  }
}
