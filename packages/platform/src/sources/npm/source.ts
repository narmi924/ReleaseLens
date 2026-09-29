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
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
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
  /**
   * Optional dependency of the published package that carries the platform
   * binary ReleaseLens verifies and executes, for example
   * `@openai/codex-win32-x64`.  The wrapper manifest pins it either to an
   * exact version or to an `npm:<package>@<version>` alias.
   */
  platformDependency?: string;
};

export type NpmPlatformPackageState = {
  dependency: string;
  packageName: string;
  version: string;
  integrity: string;
  shasum: string;
  tarballHost?: string;
};

export type NpmPlatformRuntimeArtifact = {
  dependency: string;
  packageName: string;
  version: string;
  integrity: string;
  runtimeArtifact: ResolvedArtifactRuntime;
};

export type NpmChannelState = {
  channel: string;
  version: string;
  integrity?: string;
  shasum?: string;
  gitHead?: string;
  publishedAt?: string;
  tarballHost?: string;
  platformPackage?: NpmPlatformPackageState;
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
  platform?: NpmPlatformRuntimeArtifact;
};

export type NpmSourceSnapshot = SourceSnapshot<NpmSourceState> & {
  runtimeArtifacts: Map<string, NpmRuntimeArtifact>;
};

type DistVersionMetadata = NpmVersionMetadata & {
  dist: { integrity: string; shasum: string; tarball: string };
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

function distVersionMetadata(
  metadata: NpmRegistryMetadata,
  version: string,
  packageName: string,
): DistVersionMetadata {
  const versionMetadata = metadata.versions[version];
  if (
    !versionMetadata?.dist?.integrity ||
    !versionMetadata.dist.shasum ||
    !versionMetadata.dist.tarball
  ) {
    throw new Error(
      `npm metadata for ${packageName}@${version} lacks required dist integrity fields.`,
    );
  }
  return versionMetadata as DistVersionMetadata;
}

function runtimeArtifactFor(
  packageName: string,
  versionMetadata: DistVersionMetadata,
): ResolvedArtifactRuntime {
  const runtimeUrl = new URL(versionMetadata.dist.tarball);
  const fileName =
    runtimeUrl.pathname.split("/").at(-1) ||
    `${packageName.replace("/", "-")}-${versionMetadata.version}.tgz`;
  return {
    temporaryUrl: runtimeUrl,
    expectedFileName: fileName,
    sourceHost: runtimeUrl.host,
  };
}

/**
 * Resolves the manifest spec of a platform dependency to the exact package
 * and version it pins.  Only an exact pin is acceptable: a range would let the
 * observed binary drift away from what the wrapper actually published.
 */
export function parsePlatformDependencySpec(
  dependency: string,
  spec: string,
): { packageName: string; version: string } {
  const alias = /^npm:(@?[^@]+)@(.+)$/.exec(spec.trim());
  const target = alias
    ? { packageName: alias[1]!, version: alias[2]! }
    : { packageName: dependency, version: spec.trim() };
  if (!/^[0-9]/.test(target.version)) {
    throw new Error(
      `Platform dependency ${dependency} is not pinned to an exact version (${spec}).`,
    );
  }
  return target;
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
    const documents = new Map<string, NpmRegistryMetadata>([
      [metadata.name, metadata],
    ]);
    const states: NpmChannelState[] = [];
    for (const channel of this.config.channels) {
      const version = metadata["dist-tags"][channel];
      if (!version) {
        throw new Error(
          `npm dist-tag ${channel} is missing for ${this.config.packageName}.`,
        );
      }
      const versionMetadata = distVersionMetadata(
        metadata,
        version,
        this.config.packageName,
      );
      const host = tarballHost(versionMetadata);
      const platform = this.config.platformDependency
        ? await this.resolvePlatformPackage(
            context,
            registry,
            documents,
            versionMetadata,
            this.config.platformDependency,
          )
        : undefined;
      runtimeArtifacts.set(`${channel}:${version}`, {
        channel,
        version,
        packageName: metadata.name,
        integrity: versionMetadata.dist.integrity,
        runtimeArtifact: runtimeArtifactFor(metadata.name, versionMetadata),
        ...(platform ? { platform: platform.runtime } : {}),
      });
      states.push({
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
        ...(platform ? { platformPackage: platform.state } : {}),
      });
    }
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

  /**
   * Resolves the platform binary package a wrapper version pins through its
   * optional dependencies.  A same-package alias (`npm:@openai/codex@<v>-win32-x64`)
   * is served from the document already in hand; a separate package name is
   * fetched once per discovery and cached across channels.
   */
  private async resolvePlatformPackage(
    context: SourceContext,
    registry: string,
    documents: Map<string, NpmRegistryMetadata>,
    versionMetadata: DistVersionMetadata,
    dependency: string,
  ): Promise<{
    runtime: NpmPlatformRuntimeArtifact;
    state: NpmPlatformPackageState;
  }> {
    const spec =
      versionMetadata.optionalDependencies?.[dependency] ??
      versionMetadata.dependencies?.[dependency];
    if (!spec) {
      throw new Error(
        `${this.config.packageName}@${versionMetadata.version} does not declare the platform dependency ${dependency}.`,
      );
    }
    const target = parsePlatformDependencySpec(dependency, spec);
    let document = documents.get(target.packageName);
    if (!document) {
      document = await requestJson<NpmRegistryMetadata>(
        context,
        registryPackageUrl(registry, target.packageName),
      );
      if (document.name !== target.packageName) {
        throw new Error(
          `npm registry returned ${document.name} when ${target.packageName} was requested.`,
        );
      }
      documents.set(target.packageName, document);
    }
    const platformMetadata = distVersionMetadata(
      document,
      target.version,
      target.packageName,
    );
    const host = tarballHost(platformMetadata);
    return {
      runtime: {
        dependency,
        packageName: target.packageName,
        version: target.version,
        integrity: platformMetadata.dist.integrity,
        runtimeArtifact: runtimeArtifactFor(
          target.packageName,
          platformMetadata,
        ),
      },
      state: {
        dependency,
        packageName: target.packageName,
        version: target.version,
        integrity: platformMetadata.dist.integrity,
        shasum: platformMetadata.dist.shasum,
        ...(host ? { tarballHost: host } : {}),
      },
    };
  }
}
