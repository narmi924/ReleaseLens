import {
  canonicalSha256,
  type CliCommand,
  type CliOption,
  type InterfaceEvidence,
} from "@releaselens/core";

export type CliSnapshot = {
  cliName: string;
  reportedVersion?: string;
  commands: CliCommand[];
  globalOptions: CliOption[];
  environmentKeys: string[];
  configKeys: string[];
  snapshotHash: string;
};

function stripAnsi(value: string): string {
  return value.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"),
    "",
  );
}

function cleanLine(value: string): string {
  return stripAnsi(value).replace(/\r/g, "").replace(/\s+$/g, "");
}

function sectionBounds(
  lines: string[],
  section: RegExp,
): [number, number] | undefined {
  const start = lines.findIndex((line) => section.test(line.trim()));
  if (start === -1) {
    return undefined;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z][A-Za-z /-]{1,32}:\s*$/.test(lines[index]!.trim())) {
      end = index;
      break;
    }
  }
  return [start + 1, end];
}

function parseOption(line: string): CliOption | undefined {
  const names = Array.from(
    line.matchAll(/(?<![A-Za-z0-9_])(--?[A-Za-z0-9][A-Za-z0-9_-]*)/g),
    (match) => match[1]!,
  );
  if (names.length === 0) {
    return undefined;
  }
  const valueHint =
    /(?:--?[A-Za-z0-9][A-Za-z0-9_-]*)(?:[=\s]+(<[^>]+>|\[[^\]]+\]|[A-Z][A-Z0-9_-]*))/.exec(
      line,
    )?.[1];
  return {
    names: Array.from(new Set(names)).sort((left, right) =>
      left.localeCompare(right),
    ),
    ...(valueHint ? { valueHint } : {}),
  };
}

function parseOptions(lines: string[]): CliOption[] {
  const values = lines
    .map((line) => parseOption(line))
    .filter((option): option is CliOption => option !== undefined)
    .filter(
      (option, index, all) =>
        index ===
        all.findIndex(
          (candidate) => candidate.names.join("|") === option.names.join("|"),
        ),
    );
  return values.sort((left, right) =>
    left.names.join("|").localeCompare(right.names.join("|")),
  );
}

function parseCommands(lines: string[]): CliCommand[] {
  const commands: CliCommand[] = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("-")) {
      continue;
    }
    const match =
      /^\s*([A-Za-z][A-Za-z0-9:_-]*)(?:\s+(?:<[^>]+>|\[[^\]]+\]))?(?:\s{2,}(.+))?$/.exec(
        line,
      );
    if (!match) {
      continue;
    }
    const name = match[1]!;
    if (
      ["usage", "options", "commands", "examples"].includes(name.toLowerCase())
    ) {
      continue;
    }
    commands.push({
      name,
      ...(match[2] ? { summary: match[2].trim() } : {}),
      options: [],
      subcommands: [],
    });
  }
  return commands
    .filter(
      (command, index, all) =>
        index === all.findIndex((candidate) => candidate.name === command.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function discoverStableKeys(
  lines: string[],
  kind: "environment" | "config",
): string[] {
  const context =
    kind === "environment" ? /(environment|env\b)/i : /(config|setting)/i;
  const keys = new Set<string>();
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[A-Za-z][A-Za-z /-]{1,32}:\s*$/.test(trimmed)) {
      inSection = context.test(trimmed);
      continue;
    }
    if (!inSection && !context.test(line)) {
      continue;
    }
    for (const match of line.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) {
      keys.add(match[0]);
    }
  }
  return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

export function normalizeCliVersion(output: string): string | undefined {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const version = lines
    .map((line) => /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(line)?.[0])
    .find(Boolean);
  return version?.replace(/^v/, "");
}

export function normalizeCliHelp(
  cliName: string,
  helpOutput: string,
  versionOutput = "",
): CliSnapshot {
  const lines = helpOutput.split(/\n/).map(cleanLine);
  const commandSection = sectionBounds(
    lines,
    /^commands?(?:\s+and\s+subcommands?)?:?$/i,
  );
  const optionSection = sectionBounds(lines, /^(options?|flags?):?$/i);
  const commands = commandSection
    ? parseCommands(lines.slice(commandSection[0], commandSection[1]))
    : [];
  const globalOptions = optionSection
    ? parseOptions(lines.slice(optionSection[0], optionSection[1]))
    : parseOptions(lines);
  const reportedVersion = normalizeCliVersion(versionOutput);
  const environmentKeys = discoverStableKeys(lines, "environment");
  const configKeys = discoverStableKeys(lines, "config");
  const state = {
    cliName,
    ...(reportedVersion ? { reportedVersion } : {}),
    commands,
    globalOptions,
    environmentKeys,
    configKeys,
  };
  return { ...state, snapshotHash: canonicalSha256(state) };
}

export function interfaceEvidenceFromSnapshot(
  snapshot: CliSnapshot,
  observedAt: string,
  status: InterfaceEvidence["status"] = "pass",
): InterfaceEvidence {
  return {
    id: `interface:${snapshot.cliName}:${snapshot.snapshotHash.slice(0, 12)}`,
    kind: "interface",
    status,
    summary: `Normalized ${snapshot.cliName} CLI interface with ${snapshot.commands.length} top-level commands and ${snapshot.globalOptions.length} global options.`,
    observedAt,
    cliName: snapshot.cliName,
    ...(snapshot.reportedVersion
      ? { reportedVersion: snapshot.reportedVersion }
      : {}),
    commands: snapshot.commands,
    environmentKeys: snapshot.environmentKeys,
    configKeys: snapshot.configKeys,
    snapshotHash: snapshot.snapshotHash,
    details: { globalOptions: snapshot.globalOptions },
  };
}
