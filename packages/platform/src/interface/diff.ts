import type { Change, InterfaceEvidence, ReleaseDiff } from "@releaselens/core";

function commandNames(evidence: InterfaceEvidence): Set<string> {
  return new Set(evidence.commands.map((command) => command.name));
}

function optionNames(evidence: InterfaceEvidence): Set<string> {
  const globalOptions = evidence.details?.globalOptions;
  const options = Array.isArray(globalOptions)
    ? globalOptions.flatMap((option) => {
        if (!option || typeof option !== "object") {
          return [];
        }
        const names = (option as Record<string, unknown>).names;
        return Array.isArray(names)
          ? names.filter(
              (name: unknown): name is string => typeof name === "string",
            )
          : [];
      })
    : [];
  return new Set(options);
}

function changesForSet(
  type: string,
  label: string,
  previous: Set<string>,
  current: Set<string>,
): Change[] {
  const added = Array.from(current)
    .filter((value) => !previous.has(value))
    .sort((left, right) => left.localeCompare(right));
  const removed = Array.from(previous)
    .filter((value) => !current.has(value))
    .sort((left, right) => left.localeCompare(right));
  return [
    ...added.map((value) => ({
      type: `${type}-added`,
      summary: `${label} added: ${value}.`,
      after: value,
      material: true,
    })),
    ...removed.map((value) => ({
      type: `${type}-removed`,
      summary: `${label} removed: ${value}.`,
      before: value,
      material: true,
    })),
  ];
}

export function diffInterfaceEvidence(
  previous: InterfaceEvidence | undefined,
  current: InterfaceEvidence,
): Change[] {
  if (!previous) {
    return [];
  }
  return [
    ...changesForSet(
      "command",
      "Command",
      commandNames(previous),
      commandNames(current),
    ),
    ...changesForSet(
      "flag",
      "Flag",
      optionNames(previous),
      optionNames(current),
    ),
    ...changesForSet(
      "environment-key",
      "Environment key",
      new Set(previous.environmentKeys),
      new Set(current.environmentKeys),
    ),
    ...changesForSet(
      "config-key",
      "Config key",
      new Set(previous.configKeys),
      new Set(current.configKeys),
    ),
  ];
}

export function withInterfaceChanges(
  diff: ReleaseDiff,
  previous: InterfaceEvidence | undefined,
  current: InterfaceEvidence,
): ReleaseDiff {
  const interfaceChanges = diffInterfaceEvidence(previous, current);
  return {
    ...diff,
    interfaceChanges,
    materialChanges: [
      ...diff.materialChanges,
      ...interfaceChanges.filter((change) => change.material),
    ],
  };
}
