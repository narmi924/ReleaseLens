import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const TimestampSchema = z.string().datetime({ offset: true });
export const EvidenceStatusSchema = z.enum([
  "pass",
  "fail",
  "warning",
  "info",
  "unsupported",
]);
export const BehaviorStatusSchema = z.enum([
  "pass",
  "fail",
  "warning",
  "unsupported",
  "not-applicable",
]);
export const DiscoveryStatusSchema = z.enum([
  "downloadable",
  "catalog-only",
  "inconsistent",
  "metadata-only",
  "transient-failure",
]);
export const VerdictStatusSchema = z.enum([
  "UNVERIFIED",
  "NO_REGRESSION_DETECTED",
  "CHANGED",
  "DISTRIBUTION_DRIFT",
  "SUSPECTED_REGRESSION",
  "CONFIRMED_REGRESSION",
]);
export const SeveritySchema = z.enum(["info", "minor", "major", "critical"]);
export const ArchitectureSchema = z.enum([
  "x64",
  "arm64",
  "x86",
  "arm",
  "universal",
]);

const StructuredDetailsSchema = z.record(z.unknown());

export const EvidenceItemSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: EvidenceStatusSchema,
  summary: z.string().min(1),
  details: StructuredDetailsSchema.optional(),
  observedAt: TimestampSchema,
});

export const SourceEvidenceSchema = EvidenceItemSchema.extend({
  kind: z.literal("source"),
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  fingerprint: z.string().min(1).optional(),
});

export const ArtifactEvidenceSchema = EvidenceItemSchema.extend({
  kind: z.literal("artifact"),
  fileName: z.string().min(1),
  format: z.string().min(1),
  sourceHost: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  packageIdentity: z.string().min(1).optional(),
  packageVersion: z.string().min(1).optional(),
  architecture: ArchitectureSchema.optional(),
  verification: z.array(EvidenceItemSchema).default([]),
});

export const CliOptionSchema = z.object({
  names: z.array(z.string().min(1)).min(1),
  valueHint: z.string().optional(),
  required: z.boolean().optional(),
});

export type CliCommand = {
  name: string;
  summary?: string | undefined;
  options: Array<{
    names: string[];
    valueHint?: string | undefined;
    required?: boolean | undefined;
  }>;
  subcommands: CliCommand[];
};

type CliCommandInput = {
  name: string;
  summary?: string | undefined;
  options?:
    | Array<{
        names: string[];
        valueHint?: string | undefined;
        required?: boolean | undefined;
      }>
    | undefined;
  subcommands?: CliCommandInput[] | undefined;
};

export const CliCommandSchema: z.ZodType<
  CliCommand,
  z.ZodTypeDef,
  CliCommandInput
> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    summary: z.string().optional(),
    options: z.array(CliOptionSchema).default([]),
    subcommands: z.array(CliCommandSchema).default([]),
  }),
);

export const InterfaceEvidenceSchema = EvidenceItemSchema.extend({
  kind: z.literal("interface"),
  cliName: z.string().min(1),
  reportedVersion: z.string().min(1).optional(),
  commands: z.array(CliCommandSchema).default([]),
  environmentKeys: z.array(z.string().min(1)).default([]),
  configKeys: z.array(z.string().min(1)).default([]),
  snapshotHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

export const BehaviorResultSchema = z.object({
  testId: z.string().min(1),
  status: BehaviorStatusSchema,
  startedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  summary: z.string().min(1),
  structuredDetails: StructuredDetailsSchema.optional(),
});

export const BehaviorEvidenceSchema = EvidenceItemSchema.extend({
  kind: z.literal("behavior"),
  results: z.array(BehaviorResultSchema).min(1),
});

export const CommunityIssueSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  createdAt: TimestampSchema,
  labels: z.array(z.string()).default([]),
  explicitVersion: z.string().optional(),
  platform: z.string().optional(),
  signature: z.string().optional(),
  maintainerAcknowledged: z.boolean().default(false),
  duplicateOf: z.string().optional(),
  resolutionReference: z.string().optional(),
});

export const CommunityEvidenceSchema = EvidenceItemSchema.extend({
  kind: z.literal("community"),
  repository: z.string().min(1),
  issues: z.array(CommunityIssueSchema).default([]),
  clusters: z
    .array(
      z.object({
        signature: z.string().min(1),
        issueIds: z.array(z.string().min(1)).min(1),
        strength: z.enum(["weak", "moderate", "strong"]),
      }),
    )
    .default([]),
});

export const ReleaseCandidateSchema = z.object({
  productId: z.string().min(1),
  sourceId: z.string().min(1),
  channel: z.string().min(1),
  platform: z.string().min(1).optional(),
  sourceVersion: z.string().min(1),
  sourceReleaseId: z.string().min(1),
  publishedAt: TimestampSchema.optional(),
  discoveredAt: TimestampSchema,
  discoveryStatus: DiscoveryStatusSchema,
  sourceEvidence: z.array(SourceEvidenceSchema).min(1),
});

export const VerdictReasonSchema = z.object({
  code: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  message: z.string().min(1),
});

export const ReleaseVerdictSchema = z.object({
  status: VerdictStatusSchema,
  severity: SeveritySchema,
  reasons: z.array(VerdictReasonSchema).min(1),
});

export const ReleaseObservationSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  observationId: z.string().min(1),
  product: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  release: z.object({
    canonicalVersion: z.string().min(1),
    sourceVersion: z.string().min(1),
    channel: z.string().min(1),
    platform: z.string().min(1).optional(),
    publishedAt: TimestampSchema.optional(),
    discoveredAt: TimestampSchema,
  }),
  sources: z.array(SourceEvidenceSchema).min(1),
  artifacts: z.array(ArtifactEvidenceSchema).default([]),
  interfaces: z.array(InterfaceEvidenceSchema).default([]),
  behavior: z.array(BehaviorEvidenceSchema).default([]),
  community: CommunityEvidenceSchema.optional(),
  comparedWith: z.string().min(1).optional(),
  verdict: ReleaseVerdictSchema,
});

export const ChangeSchema = z.object({
  type: z.string().min(1),
  summary: z.string().min(1),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  material: z.boolean(),
});

export const ReleaseDiffSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  diffId: z.string().min(1),
  productId: z.string().min(1),
  observationId: z.string().min(1),
  comparedWith: z.string().min(1),
  createdAt: TimestampSchema,
  artifactChanges: z.array(ChangeSchema).default([]),
  interfaceChanges: z.array(ChangeSchema).default([]),
  behaviorChanges: z.array(ChangeSchema).default([]),
  distributionChanges: z.array(ChangeSchema).default([]),
  materialChanges: z.array(ChangeSchema).default([]),
});

export const KnownGoodPointerSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  productId: z.string().min(1),
  channel: z.string().min(1),
  platform: z.string().min(1).optional(),
  observationId: z.string().min(1),
  version: z.string().min(1),
  selectedAt: TimestampSchema,
  requirementsSatisfied: z.array(z.string().min(1)).min(1),
});

export const LatestReleasePointerSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  productId: z.string().min(1),
  channel: z.string().min(1),
  platform: z.string().min(1).optional(),
  observationId: z.string().min(1),
  version: z.string().min(1),
  discoveredAt: TimestampSchema,
  verdict: ReleaseVerdictSchema,
});

export const LatestIndexSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  releases: z.array(LatestReleasePointerSchema),
});

export const KnownGoodIndexSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  pointers: z.array(KnownGoodPointerSchema),
});

export const ProductIndexSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  products: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      channels: z.array(z.string().min(1)).min(1),
      latest: z.array(LatestReleasePointerSchema),
      knownGood: z.array(KnownGoodPointerSchema),
    }),
  ),
});

export const ChannelHistorySnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  productId: z.string().min(1),
  observedAt: TimestampSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  channels: z.array(
    z.object({
      channel: z.string().min(1),
      version: z.string().min(1),
      integrity: z.string().min(1).optional(),
      gitHead: z.string().min(1).optional(),
      publishedAt: TimestampSchema.optional(),
    }),
  ),
});

export const RegressionSignatureSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["behavior", "community", "interface", "maintainer"]),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
});

export const IncidentEventSchema = z.object({
  at: TimestampSchema,
  type: z.enum(["opened", "affected", "monitoring", "resolved"]),
  observationId: z.string().min(1),
  summary: z.string().min(1),
});

export const IncidentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  productId: z.string().min(1),
  status: z.enum(["open", "monitoring", "resolved"]),
  openedAt: TimestampSchema,
  resolvedAt: TimestampSchema.optional(),
  affectedObservations: z.array(z.string().min(1)).min(1),
  firstAffectedVersion: z.string().min(1),
  resolvedByVersion: z.string().min(1).optional(),
  regressionSignatures: z.array(RegressionSignatureSchema).min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  events: z.array(IncidentEventSchema).default([]),
});

export const SourceProfileSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

export const PlatformProfileSchema = z.object({
  id: z.string().min(1),
  os: z.string().min(1),
  architecture: ArchitectureSchema.optional(),
  required: z.boolean().default(true),
});

export const InspectorProfileSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

export const TestProfileSchema = z.object({
  id: z.string().min(1),
  level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
  requiredForKnownGood: z.boolean().default(false),
  requiredCapabilities: z.array(z.string()).default([]),
  config: z.record(z.unknown()).default({}),
});

export const KnownGoodPolicySchema = z.object({
  requiredEvidenceKinds: z
    .array(z.enum(["source", "artifact", "interface", "behavior", "community"]))
    .min(1),
  requiredBehaviorTests: z.array(z.string()).default([]),
  acceptedVerdicts: z.array(VerdictStatusSchema).min(1),
});

export const ProductProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  releaseModel: z.object({
    versionScheme: z.enum(["semver", "quad", "opaque", "custom"]),
    channels: z.array(z.string().min(1)).min(1),
  }),
  sources: z.array(SourceProfileSchema).min(1),
  platforms: z.array(PlatformProfileSchema).min(1),
  inspectors: z.array(InspectorProfileSchema).min(1),
  tests: z.array(TestProfileSchema).min(1),
  knownGoodPolicy: KnownGoodPolicySchema,
  community: z
    .object({
      repository: z.string().min(1),
      lookbackHours: z.number().int().positive().default(72),
    })
    .optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export type BehaviorStatus = z.infer<typeof BehaviorStatusSchema>;
export type DiscoveryStatus = z.infer<typeof DiscoveryStatusSchema>;
export type VerdictStatus = z.infer<typeof VerdictStatusSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Architecture = z.infer<typeof ArchitectureSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export type ArtifactEvidence = z.infer<typeof ArtifactEvidenceSchema>;
export type CliOption = z.infer<typeof CliOptionSchema>;
export type InterfaceEvidence = z.infer<typeof InterfaceEvidenceSchema>;
export type BehaviorResult = z.infer<typeof BehaviorResultSchema>;
export type BehaviorEvidence = z.infer<typeof BehaviorEvidenceSchema>;
export type CommunityIssue = z.infer<typeof CommunityIssueSchema>;
export type CommunityEvidence = z.infer<typeof CommunityEvidenceSchema>;
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>;
export type ReleaseVerdict = z.infer<typeof ReleaseVerdictSchema>;
export type ReleaseObservation = z.infer<typeof ReleaseObservationSchema>;
export type ReleaseDiff = z.infer<typeof ReleaseDiffSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type KnownGoodPointer = z.infer<typeof KnownGoodPointerSchema>;
export type LatestReleasePointer = z.infer<typeof LatestReleasePointerSchema>;
export type LatestIndex = z.infer<typeof LatestIndexSchema>;
export type KnownGoodIndex = z.infer<typeof KnownGoodIndexSchema>;
export type ProductIndex = z.infer<typeof ProductIndexSchema>;
export type ChannelHistorySnapshot = z.infer<
  typeof ChannelHistorySnapshotSchema
>;
export type RegressionSignature = z.infer<typeof RegressionSignatureSchema>;
export type Incident = z.infer<typeof IncidentSchema>;
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

export type ResolvedArtifactRuntime = {
  temporaryUrl: URL;
  expectedFileName: string;
  sourceHost: string;
  expiresAt?: Date;
};
