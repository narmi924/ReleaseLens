import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultPowerShellHosts,
  WindowsAuthenticodeSignatureVerifier,
  type PowerShellHost,
} from "./signature";

const windows = process.platform === "win32";
const systemRoot = process.env.SystemRoot ?? join("C:", "Windows");
const signedSystemBinary = [
  join(systemRoot, "System32", "notepad.exe"),
  join(systemRoot, "System32", "kernel32.dll"),
].find((candidate) => existsSync(candidate));

function fakeHost(
  label: string,
  payload: Record<string, unknown>,
): PowerShellHost {
  return {
    label,
    executable: process.execPath,
    args: [
      "-e",
      `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`,
    ],
    environment: { ...process.env },
  };
}

describe("Windows Authenticode signature verifier", () => {
  it.runIf(windows)(
    "reports a real verdict for a signed Windows binary instead of an unavailable host",
    async () => {
      expect(signedSystemBinary).toBeDefined();
      const result = await new WindowsAuthenticodeSignatureVerifier().verify(
        signedSystemBinary!,
      );
      expect(result.status).toBe("pass");
      expect(result.signer).toContain("Microsoft");
    },
  );

  it.runIf(windows)(
    "hands each PowerShell edition its own module path instead of the inherited one",
    () => {
      const hosts = defaultPowerShellHosts({
        SystemRoot: systemRoot,
        ProgramFiles: join("C:", "Program Files"),
        PSMODULEPATH: "C:/pwsh/Modules;C:/Modules",
        PATH: process.env.PATH ?? "",
      });
      const windowsPowerShell = hosts.find(
        (host) => host.label === "Windows PowerShell",
      );
      const pwsh = hosts.find((host) => host.label === "PowerShell 7");
      expect(windowsPowerShell?.environment.PSModulePath).toContain(
        join("WindowsPowerShell", "v1.0", "Modules"),
      );
      expect(windowsPowerShell?.environment.PSModulePath).not.toContain("pwsh");
      expect(windowsPowerShell?.environment.PSMODULEPATH).toBeUndefined();
      expect(pwsh?.environment.PSModulePath).toBeUndefined();
      expect(pwsh?.environment.PSMODULEPATH).toBeUndefined();
    },
  );

  it("falls through to the next host when one reports the cmdlet missing", async () => {
    const verifier = new WindowsAuthenticodeSignatureVerifier({
      platform: "win32",
      hosts: () => [
        fakeHost("first", {
          status: "ReleaseLensUnsupported",
          statusMessage:
            "Get-AuthenticodeSignature is unavailable in this PowerShell host",
          psVersion: "5.1.0",
        }),
        fakeHost("second", {
          status: "Valid",
          statusMessage: "Signature verified.",
          signer: "CN=Fixture Publisher",
          psVersion: "7.4.0",
        }),
      ],
    });
    const result = await verifier.verify("fixture.msix");
    expect(result).toEqual({
      status: "pass",
      summary: "Windows reported a valid Authenticode signature.",
      signer: "CN=Fixture Publisher",
    });
  });

  it("explains every host that could not verify without echoing local paths", async () => {
    const verifier = new WindowsAuthenticodeSignatureVerifier({
      platform: "win32",
      hosts: () => [
        fakeHost("first", {
          status: "ReleaseLensUnsupported",
          statusMessage:
            "Get-AuthenticodeSignature is unavailable in this PowerShell host",
          psVersion: "5.1.0",
        }),
        {
          label: "second",
          executable: join(systemRoot, "definitely-missing-host.exe"),
          args: [],
          environment: { ...process.env },
        },
      ],
    });
    const result = await verifier.verify("fixture.msix");
    expect(result.status).toBe("unsupported");
    expect(result.summary).toContain(
      "first: Get-AuthenticodeSignature is unavailable in this PowerShell host (PowerShell 5.1.0)",
    );
    expect(result.summary).toContain("second: could not run (ENOENT)");
    expect(result.summary).not.toContain("definitely-missing-host");
  });

  it("is unsupported off Windows", async () => {
    const verifier = new WindowsAuthenticodeSignatureVerifier({
      platform: "linux",
      hosts: () => [fakeHost("never", { status: "Valid" })],
    });
    const result = await verifier.verify("fixture.msix");
    expect(result.status).toBe("unsupported");
  });
});
