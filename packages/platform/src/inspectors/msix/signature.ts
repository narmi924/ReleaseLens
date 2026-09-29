import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

export type HostEnvironment = Record<string, string | undefined>;

export type PowerShellHost = {
  label: string;
  executable: string;
  args: string[];
  environment: HostEnvironment;
};

type PowerShellSignature = {
  status?: string;
  statusMessage?: string;
  signer?: string;
  psVersion?: string;
};

type HostOutcome = { result: SignatureVerification } | { reason: string };

const unavailableStatus = "ReleaseLensUnsupported";

const signatureScript = [
  "Import-Module Microsoft.PowerShell.Security -ErrorAction SilentlyContinue;",
  "$psVersion = $PSVersionTable.PSVersion.ToString();",
  "$authenticode = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue;",
  `if ($null -eq $authenticode) { [pscustomobject]@{ status = '${unavailableStatus}'; statusMessage = 'Get-AuthenticodeSignature is unavailable in this PowerShell host'; signer = $null; psVersion = $psVersion } | ConvertTo-Json -Compress; exit 0 };`,
  "$signature = Get-AuthenticodeSignature -LiteralPath $env:RELEASELENS_MSIX_PATH;",
  "$signer = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject };",
  "[pscustomobject]@{ status = $signature.Status.ToString(); statusMessage = $signature.StatusMessage; signer = $signer; psVersion = $psVersion } | ConvertTo-Json -Compress",
].join(" ");

const powerShellArguments = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  signatureScript,
];

function withoutModulePath(environment: HostEnvironment): HostEnvironment {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => key.toLowerCase() !== "psmodulepath",
    ),
  );
}

/**
 * Get-AuthenticodeSignature ships in Microsoft.PowerShell.Security, which each
 * PowerShell edition discovers through PSModulePath.  When the observer is
 * launched from PowerShell 7 (as a GitHub Actions `pwsh` step does), Windows
 * PowerShell inherits a module path assembled for the other edition and can
 * report the cmdlet as missing although the module is installed.  Every host
 * therefore receives its own edition's default module path instead of the
 * inherited value, and PowerShell 7 stays available as a second host.
 */
export function defaultPowerShellHosts(
  environment: HostEnvironment = process.env,
): PowerShellHost[] {
  const hosts: PowerShellHost[] = [];
  const systemRoot = environment.SystemRoot ?? environment.windir;
  if (systemRoot) {
    const executable = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (existsSync(executable)) {
      const programFiles =
        environment.ProgramFiles ?? join("C:", "Program Files");
      hosts.push({
        label: "Windows PowerShell",
        executable,
        args: powerShellArguments,
        environment: {
          ...withoutModulePath(environment),
          PSModulePath: [
            join(programFiles, "WindowsPowerShell", "Modules"),
            join(
              systemRoot,
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "Modules",
            ),
          ].join(";"),
        },
      });
    }
  }
  hosts.push({
    label: "PowerShell 7",
    executable: "pwsh.exe",
    args: powerShellArguments,
    // pwsh rebuilds its own default module path, including its $PSHOME module
    // directory, when none is inherited.
    environment: withoutModulePath(environment),
  });
  return hosts;
}

function failureCode(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, killed } = error as { code?: unknown; killed?: unknown };
    if (killed === true) {
      return "timeout";
    }
    if (typeof code === "string" || typeof code === "number") {
      return String(code);
    }
  }
  return "unknown";
}

async function runHost(
  host: PowerShellHost,
  filePath: string,
): Promise<HostOutcome> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(host.executable, host.args, {
      windowsHide: true,
      timeout: 30_000,
      env: {
        ...(host.environment as NodeJS.ProcessEnv),
        RELEASELENS_MSIX_PATH: filePath,
      },
    }));
  } catch (error) {
    // Only the failure class is persisted; spawn errors would otherwise echo
    // the local executable path into public evidence.
    return { reason: `could not run (${failureCode(error)})` };
  }
  let parsed: PowerShellSignature;
  try {
    parsed = JSON.parse(stdout.trim()) as PowerShellSignature;
  } catch {
    return { reason: "produced unparseable output" };
  }
  const edition = parsed.psVersion ? ` (PowerShell ${parsed.psVersion})` : "";
  if (parsed.status === unavailableStatus) {
    return {
      reason: `${parsed.statusMessage ?? "Get-AuthenticodeSignature is unavailable"}${edition}`,
    };
  }
  if (parsed.status === "Valid") {
    return {
      result: {
        status: "pass",
        summary: "Windows reported a valid Authenticode signature.",
        ...(parsed.signer ? { signer: parsed.signer } : {}),
      },
    };
  }
  return {
    result: {
      status: "fail",
      summary: `Windows reported signature status ${parsed.status ?? "unknown"}: ${parsed.statusMessage ?? "no status message"}.`,
      ...(parsed.signer ? { signer: parsed.signer } : {}),
    },
  };
}

export class WindowsAuthenticodeSignatureVerifier implements MsixSignatureVerifier {
  private readonly hosts: () => PowerShellHost[];
  private readonly platform: NodeJS.Platform;

  public constructor(
    options: {
      hosts?: () => PowerShellHost[];
      platform?: NodeJS.Platform;
    } = {},
  ) {
    this.hosts = options.hosts ?? defaultPowerShellHosts;
    this.platform = options.platform ?? process.platform;
  }

  public async verify(filePath: string): Promise<SignatureVerification> {
    if (this.platform !== "win32") {
      return {
        status: "unsupported",
        summary:
          "Authenticode signature verification requires a Windows runner.",
      };
    }
    const reasons: string[] = [];
    for (const host of this.hosts()) {
      const outcome = await runHost(host, filePath);
      if ("result" in outcome) {
        return outcome.result;
      }
      reasons.push(`${host.label}: ${outcome.reason}`);
    }
    return {
      status: "unsupported",
      summary: `Authenticode verification is unavailable on this Windows runner (${reasons.join("; ")}).`,
    };
  }
}
