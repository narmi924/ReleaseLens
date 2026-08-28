import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "apps/web/out");
const port = Number(process.argv[3] ?? "3100");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function pathFor(requestUrl: string | undefined): string | undefined {
  const pathname = decodeURIComponent(
    new URL(requestUrl ?? "/", "http://localhost").pathname,
  );
  const relativePath =
    pathname === "/"
      ? "index.html"
      : pathname.endsWith("/")
        ? `${pathname.slice(1)}index.html`
        : pathname.slice(1);
  const candidate = resolve(root, relativePath);
  const outsideRoot = relative(root, candidate).split(sep).includes("..");
  return outsideRoot ? undefined : candidate;
}

function contentType(path: string): string {
  const extension = path.includes(".") ? `.${path.split(".").at(-1)}` : "";
  return mimeTypes[extension] ?? "application/octet-stream";
}

const server = createServer(async (request, response) => {
  const path = pathFor(request.url);
  if (!path) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid path");
    return;
  }
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      "content-type": contentType(path),
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `ReleaseLens static server listening on http://127.0.0.1:${port}`,
  );
});

function close(): void {
  server.close(() => process.exit(0));
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
