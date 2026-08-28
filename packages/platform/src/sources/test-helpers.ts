import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FetchLike, SourceContext } from "./contracts";

export async function fixture(relativePath: string): Promise<string> {
  return readFile(resolve(process.cwd(), "fixtures", relativePath), "utf8");
}

export function fixedContext(
  routes: Record<string, string>,
  additional: Partial<SourceContext> = {},
): SourceContext {
  const fetch: FetchLike = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const body = routes[url];
    if (body === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    fetch,
    now: () => new Date("2026-08-28T12:00:00.000Z"),
    workspaceRoot: process.cwd(),
    userAgent: "ReleaseLens test",
    timeoutMs: 1_000,
    ...additional,
  };
}
