import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { Entry } from "yauzl";
import type { OpenMsixArchive } from "./zip";

export type BlockMapVerification = {
  status: "pass" | "fail" | "unsupported";
  verifiedFiles: number;
  totalFiles: number;
  errors: string[];
};

type ExpectedBlock = {
  hash: string;
  compressedSize: number;
};

type BlockMapFile = {
  name: string;
  size: number;
  blocks: ExpectedBlock[];
};

function localName(node: Node): string {
  const maybeLocalName = (node as Node & { localName?: string }).localName;
  return maybeLocalName || (node.nodeName.split(":").at(-1) ?? node.nodeName);
}

function childElements(node: Node, expected: string): Element[] {
  const result: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (
      child.nodeType === child.ELEMENT_NODE &&
      localName(child) === expected
    ) {
      result.push(child as Element);
    }
  }
  return result;
}

function packagePathKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLocaleLowerCase("en-US");
}

function parseBlockMap(xml: string): BlockMapFile[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("AppxBlockMap.xml is not valid XML.");
  }
  const root = document.documentElement;
  if (!root || localName(root) !== "BlockMap") {
    throw new Error(
      "AppxBlockMap.xml does not contain a BlockMap root element.",
    );
  }
  const hashMethod = root.getAttribute("HashMethod");
  if (hashMethod && !/sha256/i.test(hashMethod)) {
    throw new Error(`Unsupported MSIX block-map hash method: ${hashMethod}.`);
  }
  return childElements(root, "File").map((file) => {
    const name = file.getAttribute("Name");
    if (!name) {
      throw new Error("AppxBlockMap.xml contains a File without Name.");
    }
    const rawFileSize = file.getAttribute("Size");
    const size = rawFileSize ? Number(rawFileSize) : undefined;
    if (size === undefined || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid file size in AppxBlockMap.xml for ${name}.`);
    }
    const blocks = childElements(file, "Block").map((block) => {
      const hash = block.getAttribute("Hash");
      const rawSize = block.getAttribute("Size");
      const compressedSize = rawSize ? Number(rawSize) : 65_536;
      if (
        !hash ||
        !Number.isSafeInteger(compressedSize) ||
        compressedSize <= 0
      ) {
        throw new Error(`Invalid block-map entry for ${name}.`);
      }
      return { hash, compressedSize };
    });
    // Zero-byte files are valid MSIX payload entries and intentionally carry no
    // 64 KiB block.  Real Store packages contain generated empty declaration
    // files; requiring a block here incorrectly rejects an otherwise verified
    // package.
    if (blocks.length === 0 && size !== 0) {
      throw new Error(`AppxBlockMap.xml has no blocks for ${name}.`);
    }
    return { name: name.replace(/\\/g, "/"), size, blocks };
  });
}

async function verifyFileBlocks(
  archive: OpenMsixArchive,
  entry: Entry,
  fileSize: number,
  expected: ExpectedBlock[],
): Promise<string | undefined> {
  if (expected.length === 0) {
    return entry.uncompressedSize === 0
      ? undefined
      : `Block-map declared an empty file but ${entry.fileName} has ${entry.uncompressedSize} bytes.`;
  }
  const expectedBlockCount = Math.ceil(fileSize / 65_536);
  if (expected.length !== expectedBlockCount) {
    return `Block-map block count did not match the uncompressed size for ${entry.fileName}.`;
  }
  // For uncompressed ZIP entries the per-block stored sizes must reconstruct
  // the logical file size.  For DEFLATE entries, Appx's per-block stored sizes
  // are metadata for range retrieval; a third-party ZIP reader exposes only a
  // whole-entry compressed span, so it is not a sound basis for rejecting an
  // otherwise hash-valid package.
  if (
    entry.compressionMethod === 0 &&
    expected.reduce((total, block) => total + block.compressedSize, 0) !==
      fileSize
  ) {
    return `Block-map stored size did not match for uncompressed file ${entry.fileName}.`;
  }
  // The Block Hash is over uncompressed 64 KiB file data.  Its optional Size
  // attribute records the corresponding stored/compressed byte count; it is
  // not a hash chunk boundary.  This distinction is required by the MSIX
  // BlockMap schema and is particularly visible in Store-delivered packages.
  const stream = await archive.stream(entry);
  let pending = Buffer.alloc(0);
  let blockIndex = 0;
  let uncompressedOffset = 0;
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, Buffer.from(chunk as Uint8Array)]);
    while (blockIndex < expected.length) {
      const block = expected[blockIndex]!;
      const uncompressedBlockSize = Math.min(
        65_536,
        fileSize - uncompressedOffset,
      );
      if (pending.length < uncompressedBlockSize) {
        break;
      }
      const bytes = pending.subarray(0, uncompressedBlockSize);
      pending = pending.subarray(uncompressedBlockSize);
      const actual = createHash("sha256").update(bytes).digest("base64");
      if (actual !== block.hash) {
        return `Block ${blockIndex} did not match for ${entry.fileName}.`;
      }
      blockIndex += 1;
      uncompressedOffset += uncompressedBlockSize;
    }
  }
  if (
    pending.length !== 0 ||
    blockIndex !== expected.length ||
    uncompressedOffset !== fileSize
  ) {
    return `Block count or final block size did not match for ${entry.fileName}.`;
  }
  return undefined;
}

export async function verifyMsixBlockMap(
  archive: OpenMsixArchive,
  blockMapXml: string,
): Promise<BlockMapVerification> {
  let files: BlockMapFile[];
  try {
    files = parseBlockMap(blockMapXml);
  } catch (error) {
    return {
      status: "fail",
      verifiedFiles: 0,
      totalFiles: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const errors: string[] = [];
  let omittedErrors = 0;
  const appendError = (message: string) => {
    if (errors.length < 24) {
      errors.push(message);
    } else {
      omittedErrors += 1;
    }
  };
  let verifiedFiles = 0;
  // App package paths are interpreted with Windows' case-insensitive file
  // semantics.  Preserve original entry names for reporting, but resolve the
  // BlockMap's logical name through a normalized lookup.
  const entriesByPackagePath = new Map<string, Entry>();
  for (const [name, entry] of archive.entries) {
    const key = packagePathKey(name);
    if (entriesByPackagePath.has(key)) {
      appendError(
        `Archive has an ambiguous case-insensitive package path: ${name}.`,
      );
    } else {
      entriesByPackagePath.set(key, entry);
    }
  }
  for (const file of files) {
    const entry = entriesByPackagePath.get(packagePathKey(file.name));
    if (!entry) {
      appendError(`Block-map file is missing from archive: ${file.name}.`);
      continue;
    }
    if (entry.uncompressedSize !== file.size) {
      appendError(
        `Block-map uncompressed size did not match for ${entry.fileName}.`,
      );
      continue;
    }
    const error = await verifyFileBlocks(
      archive,
      entry,
      file.size,
      file.blocks,
    );
    if (error) {
      appendError(error);
    } else {
      verifiedFiles += 1;
    }
  }
  if (omittedErrors > 0) {
    errors.push(
      `${omittedErrors} additional block-map failure(s) omitted from persisted evidence.`,
    );
  }
  return {
    status: errors.length === 0 ? "pass" : "fail",
    verifiedFiles,
    totalFiles: files.length,
    errors,
  };
}
