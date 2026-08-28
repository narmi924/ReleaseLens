import yauzl, { type Entry, type ZipFile } from "yauzl";
import { type Readable } from "node:stream";

export type OpenMsixArchive = {
  entries: Map<string, Entry>;
  read(entry: Entry, maxBytes?: number): Promise<Buffer>;
  stream(entry: Entry): Promise<Readable>;
  compressedStream(entry: Entry): Promise<Readable>;
  close(): void;
};

function normalizeZipName(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function assertSafeZipName(value: string): void {
  const normalized = normalizeZipName(value);
  if (!normalized || normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Unsafe ZIP entry path: ${value}.`);
  }
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
      },
      (error, zipfile) => {
        if (error || !zipfile) {
          reject(error ?? new Error("Unable to open ZIP archive."));
          return;
        }
        resolve(zipfile);
      },
    );
  });
}

function readEntryStream(zipfile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(
          error ?? new Error(`Unable to open ZIP entry ${entry.fileName}.`),
        );
        return;
      }
      resolve(stream);
    });
  });
}

function readCompressedEntryStream(
  zipfile: ZipFile,
  entry: Entry,
): Promise<Readable> {
  if (entry.compressionMethod === 0) {
    // Stored ZIP entries are already their exact archive byte stream.
    return readEntryStream(zipfile, entry);
  }
  return new Promise((resolve, reject) => {
    // yauzl 3.3 names this option decodeFileData; the installed type package
    // still models only the older option shape.
    const modernZipFile = zipfile as unknown as {
      openReadStream(
        target: Entry,
        options: { decodeFileData: boolean; start: null; end: null },
        callback: (error: Error | null, stream: Readable | undefined) => void,
      ): void;
    };
    modernZipFile.openReadStream(
      entry,
      { decodeFileData: false, start: null, end: null },
      (error, stream) => {
        if (error || !stream) {
          reject(
            error ??
              new Error(
                `Unable to open compressed ZIP entry ${entry.fileName}.`,
              ),
          );
          return;
        }
        resolve(stream);
      },
    );
  });
}

export async function openMsixArchive(
  filePath: string,
): Promise<OpenMsixArchive> {
  const zipfile = await openZip(filePath);
  const entries = await new Promise<Map<string, Entry>>((resolve, reject) => {
    const collected = new Map<string, Entry>();
    zipfile.on("error", reject);
    zipfile.on("entry", (entry: Entry) => {
      try {
        assertSafeZipName(entry.fileName);
        if (!entry.fileName.endsWith("/")) {
          collected.set(normalizeZipName(entry.fileName), entry);
        }
        zipfile.readEntry();
      } catch (error) {
        reject(error);
      }
    });
    zipfile.on("end", () => resolve(collected));
    zipfile.readEntry();
  });
  return {
    entries,
    async read(entry: Entry, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
      const stream = await readEntryStream(zipfile, entry);
      const chunks: Buffer[] = [];
      let size = 0;
      return new Promise<Buffer>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            stream.destroy(
              new Error(
                `ZIP entry ${entry.fileName} exceeded ${maxBytes} bytes while being read.`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
      });
    },
    stream: (entry) => readEntryStream(zipfile, entry),
    compressedStream: (entry) => readCompressedEntryStream(zipfile, entry),
    close: () => zipfile.close(),
  };
}

export function findZipEntry(
  archive: OpenMsixArchive,
  name: string,
): Entry | undefined {
  return archive.entries.get(normalizeZipName(name));
}
