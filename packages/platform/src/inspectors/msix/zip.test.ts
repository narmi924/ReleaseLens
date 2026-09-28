import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join, win32 } from "node:path";
import yazl from "yazl";
import { describe, expect, it } from "vitest";
import { withArtifactLease } from "../../artifacts/lease";
import { logicalPackagePath, openMsixArchive } from "./zip";

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe("MSIX ZIP access", () => {
  it("exposes compressed entry bytes for AppxBlockMap verification", async () => {
    await withArtifactLease("releaselens-msix-zip-test", async (lease) => {
      const path = join(lease.directory, "compressed.msix");
      const payload = Buffer.from("compressible payload ".repeat(2_000));
      const zip = new yazl.ZipFile();
      zip.addBuffer(payload, "payload.txt", { compress: true });
      const output = createWriteStream(path);
      zip.outputStream.pipe(output);
      zip.end();
      await once(output, "close");
      const archive = await openMsixArchive(path);
      try {
        const entry = archive.entries.get("payload.txt")!;
        const [decoded, compressed] = await Promise.all([
          readAll(await archive.stream(entry)),
          readAll(await archive.compressedStream(entry)),
        ]);
        expect(decoded).toEqual(payload);
        expect(compressed.length).toBe(entry.compressedSize);
        expect(
          createHash("sha256").update(compressed).digest("base64"),
        ).not.toBe(createHash("sha256").update(payload).digest("base64"));
      } finally {
        archive.close();
      }
    });
  });

  it("resolves OPC percent-encoded item names to their logical package paths", () => {
    expect(
      logicalPackagePath(
        win32.join("app", "node_modules", "%40img", "colour", "index.cjs"),
      ),
    ).toBe("app/node_modules/@img/colour/index.cjs");
    expect(logicalPackagePath("/Assets/Square150x150Logo.png")).toBe(
      "Assets/Square150x150Logo.png",
    );
    expect(logicalPackagePath("app/100%zz.txt")).toBe("app/100%zz.txt");
  });
});
