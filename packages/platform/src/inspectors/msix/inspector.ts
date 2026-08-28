import { DOMParser } from "@xmldom/xmldom";
import { parsePackageMoniker, type Architecture } from "@releaselens/core";
import { verifyMsixBlockMap, type BlockMapVerification } from "./block-map";
import {
  WindowsAuthenticodeSignatureVerifier,
  type MsixSignatureVerifier,
  type SignatureVerification,
} from "./signature";
import { findZipEntry, openMsixArchive } from "./zip";

export type MsixExpectation = {
  packageIdentity: string;
  architecture: Architecture;
  packageVersion?: string;
  packageMoniker?: string;
  expectedExecutable?: string;
  requiredFiles?: string[];
  requireSignature?: boolean;
};

export type MsixIdentity = {
  name: string;
  publisher: string;
  version: string;
  architecture: string;
};

export type MsixApplication = {
  id: string;
  executable: string;
  entryPoint?: string;
};

export type InspectionCheck = {
  id: string;
  status: "pass" | "fail" | "unsupported";
  summary: string;
};

export type MsixInspection = {
  identity: MsixIdentity;
  application: MsixApplication;
  fileCount: number;
  topLevelDirectories: string[];
  importantFiles: string[];
  blockMap: BlockMapVerification;
  signature: SignatureVerification;
  checks: InspectionCheck[];
  validForExecution: boolean;
};

function localName(node: Node): string {
  const maybeLocalName = (node as Node & { localName?: string }).localName;
  return maybeLocalName || (node.nodeName.split(":").at(-1) ?? node.nodeName);
}

function firstDescendant(node: Node, expected: string): Element | undefined {
  if (node.nodeType === node.ELEMENT_NODE && localName(node) === expected) {
    return node as Element;
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const found = firstDescendant(child, expected);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function parseManifest(xml: string): {
  identity: MsixIdentity;
  application: MsixApplication;
} {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("AppxManifest.xml is not valid XML.");
  }
  const root = document.documentElement;
  if (!root || localName(root) !== "Package") {
    throw new Error("AppxManifest.xml does not have a Package root element.");
  }
  const identityElement = firstDescendant(root, "Identity");
  const applicationElement = firstDescendant(root, "Application");
  const identity: MsixIdentity = {
    name: identityElement?.getAttribute("Name") ?? "",
    publisher: identityElement?.getAttribute("Publisher") ?? "",
    version: identityElement?.getAttribute("Version") ?? "",
    architecture: (
      identityElement?.getAttribute("ProcessorArchitecture") ?? ""
    ).toLowerCase(),
  };
  if (
    !identity.name ||
    !identity.publisher ||
    !identity.version ||
    !identity.architecture
  ) {
    throw new Error("AppxManifest.xml Identity is incomplete.");
  }
  const application: MsixApplication = {
    id: applicationElement?.getAttribute("Id") ?? "",
    executable: applicationElement?.getAttribute("Executable") ?? "",
    ...(applicationElement?.getAttribute("EntryPoint")
      ? { entryPoint: applicationElement.getAttribute("EntryPoint")! }
      : {}),
  };
  if (!application.id || !application.executable) {
    throw new Error("AppxManifest.xml has no complete Application entrypoint.");
  }
  return { identity, application };
}

function normalizedEntry(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function check(
  status: InspectionCheck["status"],
  id: string,
  summary: string,
): InspectionCheck {
  return { id, status, summary };
}

export class MsixInspector {
  public constructor(
    private readonly signatureVerifier: MsixSignatureVerifier = new WindowsAuthenticodeSignatureVerifier(),
  ) {}

  public async inspect(
    filePath: string,
    expectation: MsixExpectation,
  ): Promise<MsixInspection> {
    const archive = await openMsixArchive(filePath);
    try {
      const manifestEntry = findZipEntry(archive, "AppxManifest.xml");
      const blockMapEntry = findZipEntry(archive, "AppxBlockMap.xml");
      const signatureEntry = findZipEntry(archive, "AppxSignature.p7x");
      if (!manifestEntry || !blockMapEntry) {
        throw new Error(
          "MSIX is missing AppxManifest.xml or AppxBlockMap.xml.",
        );
      }
      const { identity, application } = parseManifest(
        (await archive.read(manifestEntry)).toString("utf8"),
      );
      const checks: InspectionCheck[] = [];
      checks.push(
        identity.name === expectation.packageIdentity
          ? check(
              "pass",
              "msix-identity",
              "MSIX package identity matches the profile.",
            )
          : check(
              "fail",
              "msix-identity",
              `Expected package identity ${expectation.packageIdentity}, received ${identity.name}.`,
            ),
      );
      for (const requiredFile of expectation.requiredFiles ?? []) {
        const exists = Array.from(archive.entries.keys()).some(
          (name) => normalizedEntry(name) === normalizedEntry(requiredFile),
        );
        checks.push(
          exists
            ? check(
                "pass",
                `msix-required-file:${requiredFile}`,
                `Required MSIX file ${requiredFile} exists.`,
              )
            : check(
                "fail",
                `msix-required-file:${requiredFile}`,
                `Required MSIX file ${requiredFile} is missing.`,
              ),
        );
      }
      checks.push(
        identity.architecture === expectation.architecture
          ? check(
              "pass",
              "msix-architecture",
              "MSIX processor architecture matches the profile.",
            )
          : check(
              "fail",
              "msix-architecture",
              `Expected ${expectation.architecture}, received ${identity.architecture}.`,
            ),
      );
      if (expectation.packageVersion) {
        checks.push(
          identity.version === expectation.packageVersion
            ? check(
                "pass",
                "msix-version",
                "MSIX package version matches the resolved moniker.",
              )
            : check(
                "fail",
                "msix-version",
                `Expected package version ${expectation.packageVersion}, received ${identity.version}.`,
              ),
        );
      }
      if (expectation.packageMoniker) {
        const moniker = parsePackageMoniker(expectation.packageMoniker);
        checks.push(
          moniker?.name === identity.name &&
            moniker.version.join(".") === identity.version &&
            moniker.architecture === identity.architecture
            ? check(
                "pass",
                "msix-moniker",
                "MSIX manifest agrees with the resolved package moniker.",
              )
            : check(
                "fail",
                "msix-moniker",
                "MSIX manifest does not agree with the resolved package moniker.",
              ),
        );
      }
      const executable =
        expectation.expectedExecutable ?? application.executable;
      const executableExists = Array.from(archive.entries.keys()).some(
        (name) => normalizedEntry(name) === normalizedEntry(executable),
      );
      checks.push(
        executableExists
          ? check(
              "pass",
              "msix-entrypoint",
              `MSIX application executable ${executable} exists in the package.`,
            )
          : check(
              "fail",
              "msix-entrypoint",
              `MSIX application executable ${executable} is missing from the package.`,
            ),
      );
      checks.push(
        signatureEntry
          ? check(
              "pass",
              "msix-signature-file",
              "MSIX includes AppxSignature.p7x.",
            )
          : check(
              "fail",
              "msix-signature-file",
              "MSIX is missing AppxSignature.p7x.",
            ),
      );
      const blockMap = await verifyMsixBlockMap(
        archive,
        (await archive.read(blockMapEntry)).toString("utf8"),
      );
      checks.push(
        blockMap.status === "pass"
          ? check(
              "pass",
              "msix-block-map",
              `Validated AppxBlockMap.xml for ${blockMap.verifiedFiles} files.`,
            )
          : check(
              "fail",
              "msix-block-map",
              blockMap.errors.join(" ") ||
                "AppxBlockMap.xml validation failed.",
            ),
      );
      const signature = await this.signatureVerifier.verify(filePath);
      checks.push(check(signature.status, "msix-signature", signature.summary));
      const importantFiles = [
        "AppxManifest.xml",
        "AppxBlockMap.xml",
        ...(signatureEntry ? ["AppxSignature.p7x"] : []),
        application.executable,
      ].filter((name, index, all) => all.indexOf(name) === index);
      const topLevelDirectories = Array.from(
        new Set(
          Array.from(archive.entries.keys())
            .map((entry) => entry.split("/")[0]!)
            .filter(Boolean),
        ),
      )
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 24);
      const signatureIsBlocking =
        expectation.requireSignature !== false && signature.status === "fail";
      return {
        identity,
        application,
        fileCount: archive.entries.size,
        topLevelDirectories,
        importantFiles,
        blockMap,
        signature,
        checks,
        validForExecution:
          checks.every((entry) => entry.status !== "fail") &&
          !signatureIsBlocking,
      };
    } finally {
      archive.close();
    }
  }
}
