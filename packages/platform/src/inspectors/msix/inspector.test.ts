import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import yazl from "yazl";
import { describe, expect, it } from "vitest";
import { withArtifactLease } from "../../artifacts/lease";
import { MsixInspector } from "./inspector";
import type { MsixSignatureVerifier } from "./signature";

type FixtureOptions = {
  architecture?: string;
  includeExecutable?: boolean;
  corruptBlockMap?: boolean;
  corruptStoredBlockSize?: boolean;
  caseMismatchedBlockMapNames?: boolean;
  includeEmptyFile?: boolean;
};

function block(
  name: string,
  data: Buffer,
  corrupt = false,
  corruptStoredSize = false,
): string {
  const hash = corrupt
    ? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    : createHash("sha256").update(data).digest("base64");
  const storedSize = corruptStoredSize ? data.length + 1 : data.length;
  return `<File Name="${name}" Size="${data.length}"><Block Hash="${hash}" Size="${storedSize}" /></File>`;
}

async function writeMsix(
  path: string,
  options: FixtureOptions = {},
): Promise<void> {
  const architecture = options.architecture ?? "x64";
  const executable = "App.exe";
  const manifest = Buffer.from(
    `<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Name="Fixture.App" Publisher="CN=Fixture" Version="1.2.3.4" ProcessorArchitecture="${architecture}" /><Applications><Application Id="App" Executable="${executable}" EntryPoint="Fixture.App" /></Applications></Package>`,
  );
  const executableData = Buffer.from("fixture executable bytes");
  const manifestBlockName = options.caseMismatchedBlockMapNames
    ? "appxmanifest.xml"
    : "AppxManifest.xml";
  const executableBlockName = options.caseMismatchedBlockMapNames
    ? executable.toLowerCase()
    : executable;
  const blockMap = Buffer.from(
    `<BlockMap xmlns="http://schemas.microsoft.com/appx/2010/blockmap" HashMethod="http://www.w3.org/2001/04/xmlenc#sha256">${block(
      manifestBlockName,
      manifest,
      options.corruptBlockMap,
      options.corruptStoredBlockSize,
    )}${
      options.includeExecutable === false
        ? ""
        : block(executableBlockName, executableData)
    }${options.includeEmptyFile ? '<File Name="empty.d.ts" Size="0" />' : ""}</BlockMap>`,
  );
  const zip = new yazl.ZipFile();
  zip.addBuffer(manifest, "AppxManifest.xml", { compress: false });
  zip.addBuffer(blockMap, "AppxBlockMap.xml", { compress: false });
  zip.addBuffer(Buffer.from("fixture signature"), "AppxSignature.p7x", {
    compress: false,
  });
  if (options.includeExecutable !== false) {
    zip.addBuffer(executableData, executable, { compress: false });
  }
  if (options.includeEmptyFile) {
    zip.addBuffer(Buffer.alloc(0), "empty.d.ts", { compress: false });
  }
  const output = createWriteStream(path);
  zip.outputStream.pipe(output);
  zip.end();
  await once(output, "close");
}

const signatureVerifier: MsixSignatureVerifier = {
  async verify() {
    return {
      status: "pass",
      summary: "Fixture signature verifier accepted the package.",
      signer: "CN=Fixture",
    };
  },
};

describe("MSIX inspector", () => {
  it("validates manifest identity, architecture, block map, signature plumbing, and entrypoint", async () => {
    await withArtifactLease("releaselens-msix-test", async (lease) => {
      const msix = join(lease.directory, "fixture.msix");
      await writeMsix(msix, {
        includeEmptyFile: true,
        caseMismatchedBlockMapNames: true,
      });
      const inspection = await new MsixInspector(signatureVerifier).inspect(
        msix,
        {
          packageIdentity: "Fixture.App",
          architecture: "x64",
          packageVersion: "1.2.3.4",
          packageMoniker: "Fixture.App_1.2.3.4_x64__fixturepublisher",
          requiredFiles: ["App.exe"],
        },
      );
      expect(inspection.validForExecution).toBe(true);
      expect(inspection.blockMap).toMatchObject({
        status: "pass",
        verifiedFiles: 3,
      });
      expect(inspection.signature.status).toBe("pass");
    });
  });

  it("makes wrong architecture, a bad block map, invalid stored block metadata, or a missing executable execution-blocking", async () => {
    await withArtifactLease("releaselens-msix-test", async (lease) => {
      const wrongArchitecture = join(
        lease.directory,
        "wrong-architecture.msix",
      );
      const missingExecutable = join(
        lease.directory,
        "missing-executable.msix",
      );
      const corruptBlockMap = join(lease.directory, "corrupt-block-map.msix");
      const corruptStoredBlockSize = join(
        lease.directory,
        "corrupt-stored-block-size.msix",
      );
      await Promise.all([
        writeMsix(wrongArchitecture, { architecture: "arm64" }),
        writeMsix(missingExecutable, { includeExecutable: false }),
        writeMsix(corruptBlockMap, { corruptBlockMap: true }),
        writeMsix(corruptStoredBlockSize, { corruptStoredBlockSize: true }),
      ]);
      const inspector = new MsixInspector(signatureVerifier);
      await expect(
        inspector.inspect(wrongArchitecture, {
          packageIdentity: "Fixture.App",
          architecture: "x64",
        }),
      ).resolves.toMatchObject({
        validForExecution: false,
      });
      await expect(
        inspector.inspect(missingExecutable, {
          packageIdentity: "Fixture.App",
          architecture: "x64",
        }),
      ).resolves.toMatchObject({
        validForExecution: false,
      });
      await expect(
        inspector.inspect(corruptBlockMap, {
          packageIdentity: "Fixture.App",
          architecture: "x64",
        }),
      ).resolves.toMatchObject({
        validForExecution: false,
      });
      await expect(
        inspector.inspect(corruptStoredBlockSize, {
          packageIdentity: "Fixture.App",
          architecture: "x64",
        }),
      ).resolves.toMatchObject({
        validForExecution: false,
      });
    });
  });
});
