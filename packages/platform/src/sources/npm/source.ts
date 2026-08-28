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
import { requestJson } from "../http";

export type NpmVersionMetadata = {
  name: string;
  version: string;
  gitHead?: string;
  dist?: {
    integrity?: string;
    shasum?: string;
    tarball?: string;
    fileCount?: number;
    unpackedSize?: number;
  };
  bin?: string | Record<string, string>;
  engines?: Record<string, string>;
};

export type NpmRegistryMetadata = {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, NpmVersionMetadata>;
  time?: Record<string, string>;
};

export type NpmSourceConfig = {
  packageName: string;
  channels: string[];
  registryUrl?: string;
  sourceId?: string;
};

export type NpmChannelState = {
  channel: string;
  version: string;
  integrity?: string;
  shasum?: string;
  gitHead?: string;
  publishedAt?: string;
  tarballHost?: string;
};

export type NpmSourceState = {
  packageName: string;
  channels: NpmChannelState[];
};

export type NpmRuntimeArtifact = {
  channel: string;
  version: string;
  packageName: string;
  integrity: string;
  runtimeArtifact: ResolvedArtifactRuntime;
};

export type NpmSourceSnapshot = SourceSnapshot<NpmSourceState> & {
  runtimeArtifacts: Map<string, NpmRuntimeArtifact>;
};

function registryPackageUrl(registry: string, packageName: string): string {
  return `${registry.replace(/\/$/, "")}/${encodeURIComponent(packageName)}`;
}

function tarballHost(metadata: NpmVersionMetadata): string | undefined {
  const value = metadata.dist?.tarball;
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

export class NpmSource implements ReleaseSource<NpmSourceState> {
  public readonly id: string;

  public constructor(private readonly config: NpmSourceConfig) {
    this.id = config.sourceId ?? "npm-registry";
  }

  public async discover(context: SourceContext): Promise<NpmSourceSnapshot> {
    const observedAt = isoNow(context);
    const registry = this.config.registryUrl ?? "https://registry.npmjs.org";
    const metadata = await requestJson<NpmRegistryMetadata>(
      context,
      registryPackageUrl(registry, this.config.packageName),
    );
    if (metadata.name !== this.config.packageName) {
      throw new Error(
        `npm registry returned ${metadata.name} when ${this.config.packageName} was requested.`,
      );
    }
    const runtimeArtifacts = new Map<string, NpmRuntimeArtifact>();
    const states: NpmChannelState[] = this.config.channels.map((channel) => {
      const version = metadata["dist-tags"][channel];
      if (!version) {
        throw new Error(
          `npm dist-tag ${channel} is missing for ${this.config.packageName}.`,
        );
      }
      const versionMetadata = metadata.versions[version];
      if (
        !versionMetadata?.dist?.integrity ||
        !versionMetadata.dist.shasum ||
        !versionMetadata.dist.tarball
      ) {
        throw new Error(
          `npm metadata for ${this.config.packageName}@${version} lacks required dist integrity fields.`,
        );
      }
      const host = tarballHost(versionMetadata);
      const tarball = versionMetadata.dist.tarball;
      const runtimeUrl = new URL(tarball);
      const fileName =
        runtimeUrl.pathname.split("/").at(-1) ||
        `${metadata.name.replace("/", "-")}-${version}.tgz`;
      runtimeArtifacts.set(`${channel}:${version}`, {
        channel,
        version,
        packageName: metadata.name,
        integrity: versionMetadata.dist.integrity,
        runtimeArtifact: {
          temporaryUrl: runtimeUrl,
          expectedFileName: fileName,
          sourceHost: runtimeUrl.host,
        },
      });
      return {
        channel,
        version,
        integrity: versionMetadata.dist.integrity,
        shasum: versionMetadata.dist.shasum,
        ...(versionMetadata.gitHead
          ? { gitHead: versionMetadata.gitHead }
          : {}),
        ...(metadata.time?.[version]
          ? { publishedAt: metadata.time[version] }
          : {}),
        ...(host ? { tarballHost: host } : {}),
      };
    });
    const state: NpmSourceState = {
      packageName: metadata.name,
      channels: states,
    };
    const fingerprint = canonicalSha256(state);
    const evidence: SourceEvidence[] = [
      {
        id: `${this.id}:dist-tags`,
        kind: "source",
        sourceId: this.id,
        sourceType: "npm-registry",
        status: "pass",
        summary: `Observed ${states.length} npm channel tags for ${metadata.name}.`,
        sourceUrl: registryPackageUrl(registry, this.config.packageName),
        fingerprint,
        observedAt,
        details: { channels: states },
      },
    ];
    const candidates: ReleaseCandidate[] = states.map((channel) => ({
      productId: "unbound",
      sourceId: this.id,
      channel: channel.channel,
      sourceVersion: channel.version,
      sourceReleaseId: `${metadata.name}@${channel.version}`,
      ...(channel.publishedAt ? { publishedAt: channel.publishedAt } : {}),
      discoveredAt: observedAt,
      discoveryStatus: "downloadable",
      sourceEvidence: [
        {
          id: `${this.id}:${channel.channel}:${channel.version}`,
          kind: "source",
          sourceId: this.id,
          sourceType: "npm-registry",
          status: "pass",
          summary: `${channel.channel} points to ${channel.version}; integrity metadata is present.`,
          observedAt,
          details: channel,
        },
      ],
    }));
    return {
      sourceId: this.id,
      observedAt,
      fingerprint,
      candidates,
      evidence,
      state,
      runtimeArtifacts,
    };
  }
}
