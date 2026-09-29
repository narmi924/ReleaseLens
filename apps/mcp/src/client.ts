import {
  IncidentSchema,
  KnownGoodPointerSchema,
  LatestReleasePointerSchema,
  ReleaseDiffSchema,
  ReleaseObservationSchema,
  ReleaseVerdictSchema,
  type Incident,
  type ReleaseDiff,
  type ReleaseObservation,
} from "@releaselens/core";
import { z } from "zod";

/** The public ReleaseLens deployment this server reads when no other base URL is configured. */
export const DEFAULT_BASE_URL = "https://narmi924.github.io/ReleaseLens";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export const PublicIndexSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  products: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      latest: z.array(LatestReleasePointerSchema),
      knownGood: z.array(KnownGoodPointerSchema),
      releaseCount: z.number().int().nonnegative(),
    }),
  ),
  incidents: z.array(
    z.object({
      id: z.string().min(1),
      productId: z.string().min(1),
      status: z.string().min(1),
      openedAt: z.string().min(1),
    }),
  ),
});

export const ProductDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  channels: z.array(z.string().min(1)),
  latest: z.array(LatestReleasePointerSchema),
  knownGood: z.array(KnownGoodPointerSchema),
  releases: z.array(
    z.object({
      observationId: z.string().min(1),
      canonicalVersion: z.string().min(1),
      channel: z.string().min(1),
      platform: z.string().min(1).optional(),
      discoveredAt: z.string().min(1),
      verdict: ReleaseVerdictSchema,
      comparedWith: z.string().min(1).optional(),
      diffId: z.string().min(1).optional(),
    }),
  ),
});

const IncidentsDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  incidents: z.array(IncidentSchema),
});

export type PublicIndex = z.infer<typeof PublicIndexSchema>;
export type ProductDocument = z.infer<typeof ProductDocumentSchema>;

export class ReleaseLensApiError extends Error {
  public constructor(
    message: string,
    public readonly url: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ReleaseLensApiError";
  }
}

const segmentPattern = /^[A-Za-z0-9._-]+$/;

function safeSegment(value: string, label: string): string {
  if (!segmentPattern.test(value)) {
    throw new ReleaseLensApiError(
      `${label} may only contain letters, digits, dots, underscores, and hyphens.`,
      "",
    );
  }
  return value;
}

/**
 * Read-only client for the versioned JSON API a ReleaseLens deployment
 * publishes next to its site.  Every document is validated against the
 * canonical schemas before it is handed to a tool, so an agent never receives
 * a half-parsed or tampered record as if it were ReleaseLens evidence.
 */
export class ReleaseLensClient {
  public readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  public constructor(
    options: { baseUrl?: string; fetch?: FetchLike; timeoutMs?: number } = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetcher =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  public siteUrl(path = ""): string {
    const suffix = path.replace(/^\/+/, "");
    return suffix ? `${this.baseUrl}/${suffix}` : `${this.baseUrl}/`;
  }

  public releasePageUrl(productId: string, observationId: string): string {
    return this.siteUrl(
      `tools/${encodeURIComponent(productId)}/releases/${encodeURIComponent(observationId)}/`,
    );
  }

  public incidentPageUrl(incidentId: string): string {
    return this.siteUrl(`incidents/${encodeURIComponent(incidentId)}/`);
  }

  public index(): Promise<PublicIndex> {
    return this.json("index.json", PublicIndexSchema);
  }

  public product(productId: string): Promise<ProductDocument> {
    return this.json(
      `products/${safeSegment(productId, "The product id")}/index.json`,
      ProductDocumentSchema,
    );
  }

  public release(
    productId: string,
    observationId: string,
  ): Promise<ReleaseObservation> {
    return this.json(
      `products/${safeSegment(productId, "The product id")}/releases/${safeSegment(observationId, "The observation id")}.json`,
      ReleaseObservationSchema,
    );
  }

  public diff(diffId: string): Promise<ReleaseDiff> {
    return this.json(
      `diffs/${safeSegment(diffId, "The diff id")}.json`,
      ReleaseDiffSchema,
    );
  }

  public async incidents(productId?: string): Promise<Incident[]> {
    const path = productId
      ? `products/${safeSegment(productId, "The product id")}/incidents.json`
      : "incidents.json";
    return (await this.json(path, IncidentsDocumentSchema)).incidents;
  }

  private async json<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const url = this.siteUrl(`api/v1/${path}`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "ReleaseLens MCP/1.0 (+https://github.com/narmi924/ReleaseLens)",
        },
        signal: abort.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ReleaseLensApiError(`Could not reach ${url}: ${message}`, url);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) {
      throw new ReleaseLensApiError(
        `${url} is not published; the product, release, or incident id may be unknown to this ReleaseLens site.`,
        url,
        404,
      );
    }
    if (!response.ok) {
      throw new ReleaseLensApiError(
        `HTTP ${response.status} from ${url}.`,
        url,
        response.status,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw new ReleaseLensApiError(`${url} did not return JSON.`, url);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new ReleaseLensApiError(
        `${url} does not match the ReleaseLens data schema${issue ? ` (${issue.path.join(".") || "root"}: ${issue.message})` : ""}.`,
        url,
      );
    }
    return result.data;
  }
}
