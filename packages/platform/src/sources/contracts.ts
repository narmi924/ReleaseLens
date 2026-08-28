import type { ReleaseCandidate, SourceEvidence } from "@releaselens/core";

export type FetchLike = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export type SourceContext = {
  fetch: FetchLike;
  now: () => Date;
  workspaceRoot: string;
  userAgent: string;
  timeoutMs: number;
};

export type SourceSnapshot<TState = unknown> = {
  sourceId: string;
  observedAt: string;
  fingerprint: string;
  candidates: ReleaseCandidate[];
  evidence: SourceEvidence[];
  state: TState;
};

export interface ReleaseSource<TState = unknown> {
  readonly id: string;
  discover(context: SourceContext): Promise<SourceSnapshot<TState>>;
}

export function createSourceContext(
  overrides: Partial<SourceContext> = {},
): SourceContext {
  return {
    fetch: globalThis.fetch,
    now: () => new Date(),
    workspaceRoot: process.cwd(),
    userAgent: "ReleaseLens/1.0 (+https://github.com/releaselens/releaselens)",
    timeoutMs: 30_000,
    ...overrides,
  };
}

export function isoNow(context: SourceContext): string {
  return context.now().toISOString();
}
