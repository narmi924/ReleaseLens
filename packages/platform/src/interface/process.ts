import { execFile, type ExecFileException } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BoundedProcessRequest = {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type BoundedProcessResult = {
  exitCode?: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
};

function output(value: unknown): string {
  return typeof value === "string"
    ? value
    : Buffer.isBuffer(value)
      ? value.toString("utf8")
      : "";
}

export async function runBoundedProcess(
  request: BoundedProcessRequest,
): Promise<BoundedProcessResult> {
  if (!isAbsolute(request.executable)) {
    throw new Error("Safe process probes require an absolute executable path.");
  }
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      request.executable,
      request.args,
      {
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(request.env ? { env: request.env } : {}),
        windowsHide: true,
        timeout: request.timeoutMs ?? 20_000,
        maxBuffer: request.maxOutputBytes ?? 512 * 1024,
        shell: false,
      },
    );
    return {
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      stdout,
      stderr,
    };
  } catch (error) {
    const execution = error as ExecFileException & {
      stdout?: unknown;
      stderr?: unknown;
      code?: number | string;
      killed?: boolean;
    };
    const numericExitCode =
      typeof execution.code === "number" ? execution.code : undefined;
    return {
      ...(numericExitCode !== undefined ? { exitCode: numericExitCode } : {}),
      timedOut: Boolean(execution.killed),
      durationMs: Date.now() - startedAt,
      stdout: output(execution.stdout),
      stderr:
        output(execution.stderr) ||
        (error instanceof Error ? error.message : String(error)),
    };
  }
}

export type IsolatedProcessEnvironment = {
  directory: string;
  environment: NodeJS.ProcessEnv;
};

/** Creates an isolated HOME/config/npm cache and removes it after the probe. */
export async function withIsolatedProcessEnvironment<T>(
  prefix: string,
  operation: (environment: IsolatedProcessEnvironment) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(
    join(tmpdir(), `${prefix.replace(/[^a-z0-9-]/gi, "-")}-`),
  );
  const home = join(directory, "home");
  const config = join(directory, "config");
  const cache = join(directory, "npm-cache");
  const npmPrefix = join(directory, "npm-prefix");
  await Promise.all([
    mkdir(home),
    mkdir(config),
    mkdir(cache),
    mkdir(npmPrefix),
  ]);
  try {
    return await operation({
      directory,
      environment: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        APPDATA: config,
        LOCALAPPDATA: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: cache,
        npm_config_cache: cache,
        npm_config_prefix: npmPrefix,
        NO_COLOR: "1",
        CI: "1",
      },
    });
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 100,
    });
  }
}
