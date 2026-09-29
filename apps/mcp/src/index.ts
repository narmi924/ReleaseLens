#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BASE_URL, ReleaseLensClient } from "./client";
import { createReleaseLensServer } from "./server";

export function resolveBaseUrl(
  argv: string[],
  environment: Record<string, string | undefined>,
): string {
  const index = argv.indexOf("--base-url");
  const fromArguments = index >= 0 ? argv[index + 1] : undefined;
  const candidate =
    fromArguments ?? environment.RELEASELENS_BASE_URL ?? DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`ReleaseLens base URL is not a valid URL: ${candidate}`);
  }
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new Error(
      "ReleaseLens base URL must use https unless it points at a local server.",
    );
  }
  return candidate;
}

async function main(): Promise<void> {
  const client = new ReleaseLensClient({
    baseUrl: resolveBaseUrl(process.argv.slice(2), process.env),
  });
  const server = createReleaseLensServer({ client });
  // stdout carries the protocol; anything human-readable goes to stderr.
  await server.connect(new StdioServerTransport());
  console.error(`ReleaseLens MCP server reading ${client.siteUrl()}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  /(?:^|[\\/])index\.(?:ts|js|mjs)$/.test(process.argv[1]) &&
  process.argv[1].includes("mcp");

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
