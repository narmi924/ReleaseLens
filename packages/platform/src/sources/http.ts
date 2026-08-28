import type { FetchLike, SourceContext } from "./contracts";

export class SourceHttpError extends Error {
  public constructor(
    message: string,
    public readonly url: string,
    public readonly status?: number,
    public readonly transient = false,
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

export type RequestPolicy = {
  attempts?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function requestText(
  context: SourceContext,
  url: string,
  policy: RequestPolicy = {},
  fetcher: FetchLike = context.fetch,
): Promise<{ body: string; response: Response }> {
  const attempts = policy.attempts ?? 3;
  let lastError: SourceHttpError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const abort = new AbortController();
    const timeout = setTimeout(
      () => abort.abort(),
      policy.timeoutMs ?? context.timeoutMs,
    );
    try {
      const response = await fetcher(url, {
        headers: {
          Accept:
            "application/json, text/plain, text/yaml, application/xml, text/xml;q=0.9, */*;q=0.1",
          "User-Agent": context.userAgent,
          ...policy.headers,
        },
        redirect: "follow",
        signal: abort.signal,
      });
      const body = await response.text();
      if (response.ok) {
        return { body, response };
      }
      lastError = new SourceHttpError(
        // Response bodies are untrusted upstream data. They can contain a
        // runner's public IP, opaque request identifiers, or credentials, and
        // source failures may later become public evidence. Keep only the
        // status and public request URL in the transport error.
        `HTTP ${response.status} while reading ${url}.`,
        url,
        response.status,
        isTransientStatus(response.status),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = new SourceHttpError(
        `Network failure while reading ${url}: ${message}`,
        url,
        undefined,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!lastError.transient || attempt === attempts) {
      break;
    }
    await delay(120 * 2 ** (attempt - 1));
  }
  throw (
    lastError ??
    new SourceHttpError(
      `Unknown failure while reading ${url}.`,
      url,
      undefined,
      false,
    )
  );
}

export async function requestJson<T>(
  context: SourceContext,
  url: string,
  policy?: RequestPolicy,
): Promise<T> {
  const { body } = await requestText(context, url, policy);
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceHttpError(
      `Malformed JSON from ${url}: ${message}`,
      url,
      undefined,
      false,
    );
  }
}
