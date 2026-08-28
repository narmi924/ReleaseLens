import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SignatureVerification = {
  status: "pass" | "fail" | "unsupported";
  summary: string;
  signer?: string;
};

export interface MsixSignatureVerifier {
  verify(filePath: string): Promise<SignatureVerification>;
}

type PowerShellSignature = {
  status?: string;
  statusMessage?: string;
  signer?: string;
};

const unavailableStatus = "ReleaseLensUnsupported";

export class WindowsAuthenticodeSignatureVerifier implements MsixSignatureVerifier {
  public async verify(filePath: string): Promise<SignatureVerification> {
    if (process.platform !== "win32") {
      return {
        status: "unsupported",
        summary:
          "Authenticode signature verification requires a Windows runner.",
      };
    }
    const command = [
      "$authenticode = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue;",
      `if ($null -eq $authenticode) { [pscustomobject]@{ status = '${unavailableStatus}'; statusMessage = 'Get-AuthenticodeSignature is unavailable on this runner.'; signer = $null } | ConvertTo-Json -Compress; exit 0 };`,
      "$signature = Get-AuthenticodeSignature -LiteralPath $env:RELEASELENS_MSIX_PATH;",
      "$signer = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject };",
      "[pscustomobject]@{ status = $signature.Status.ToString(); statusMessage = $signature.StatusMessage; signer = $signer } | ConvertTo-Json -Compress",
    ].join(" ");
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        {
          windowsHide: true,
          timeout: 30_000,
          env: { ...process.env, RELEASELENS_MSIX_PATH: filePath },
        },
      );
      const parsed = JSON.parse(stdout.trim()) as PowerShellSignature;
      if (parsed.status === unavailableStatus) {
        return {
          status: "unsupported",
          summary:
            parsed.statusMessage ??
            "Authenticode verification is unavailable on this Windows runner.",
        };
      }
      if (parsed.status === "Valid") {
        return {
          status: "pass",
          summary: "Windows reported a valid Authenticode signature.",
          ...(parsed.signer ? { signer: parsed.signer } : {}),
        };
      }
      return {
        status: "fail",
        summary: `Windows reported signature status ${parsed.status ?? "unknown"}: ${parsed.statusMessage ?? "no status message"}.`,
        ...(parsed.signer ? { signer: parsed.signer } : {}),
      };
    } catch (error) {
      return {
        status: "unsupported",
        summary: `Windows signature verification could not run: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
