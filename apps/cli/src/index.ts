import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, loadProductProfiles } from "@releaselens/core";
import {
  createSourceContext,
  buildStaticPublication,
  discoverProfile,
  observeProfiles,
  persistedDiscoveryView,
  refreshCommunityEvidence,
  ReleaseLensDataRepository,
  validateStaticPublication,
} from "@releaselens/platform";

const usage = `ReleaseLens CLI

Usage:
  pnpm rl doctor
  pnpm rl discover --all | --product <id>
  pnpm rl observe --all | --product <id>
  pnpm rl observe --product <id> --force
  pnpm rl refresh-community --recent <hours>
  pnpm rl validate-data
  pnpm rl build-public
  pnpm rl validate-public
  pnpm rl bootstrap
`;

function hasFlag(argumentsList: string[], flag: string): boolean {
  return argumentsList.includes(flag);
}

function flagValue(argumentsList: string[], flag: string): string | undefined {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

async function selectedProfiles(argumentsList: string[]) {
  const profiles = await loadProductProfiles(
    resolve(process.cwd(), "products"),
  );
  const productId = flagValue(argumentsList, "--product");
  if (hasFlag(argumentsList, "--all")) {
    return profiles;
  }
  if (productId) {
    const profile = profiles.find((candidate) => candidate.id === productId);
    if (!profile) {
      throw new Error(`Unknown product profile: ${productId}.`);
    }
    return [profile];
  }
  throw new Error("Choose --all or --product <id>.");
}

function recentHours(argumentsList: string[]): number | undefined {
  const value = flagValue(argumentsList, "--recent");
  if (!value) return undefined;
  const match = /^(\d+)(?:h)?$/i.exec(value);
  if (!match || Number(match[1]) <= 0)
    throw new Error(
      `Expected --recent <positive-hours>, received ${JSON.stringify(value)}.`,
    );
  return Number(match[1]);
}

async function runDoctor(): Promise<void> {
  const profilesDirectory = resolve(process.cwd(), "products");
  await access(profilesDirectory);
  const profiles = await loadProductProfiles(profilesDirectory);
  console.log(
    `ReleaseLens doctor: ${profiles.length} validated product profiles.`,
  );
  console.log(
    `Node ${process.versions.node}; platform ${process.platform}/${process.arch}.`,
  );
}

async function runDiscover(argumentsList: string[]): Promise<void> {
  const profiles = await selectedProfiles(argumentsList);
  const context = createSourceContext({ workspaceRoot: process.cwd() });
  const discoveries = [];
  for (const profile of profiles) {
    discoveries.push(await discoverProfile(profile, context));
  }
  console.log(canonicalJson(discoveries.map(persistedDiscoveryView)));
  const requiredFailures = discoveries.flatMap((discovery) =>
    discovery.attempts.filter(
      (attempt) => attempt.required && attempt.status === "fail",
    ),
  );
  if (requiredFailures.length > 0) {
    process.exitCode = 1;
  }
}

async function runObserve(
  argumentsList: string[],
  bootstrap = false,
): Promise<void> {
  const allProfiles = await loadProductProfiles(
    resolve(process.cwd(), "products"),
  );
  const profiles =
    bootstrap &&
    !hasFlag(argumentsList, "--all") &&
    !flagValue(argumentsList, "--product")
      ? allProfiles
      : await selectedProfiles(argumentsList);
  const result = await observeProfiles({
    repository: new ReleaseLensDataRepository(process.cwd()),
    profiles,
    allProfiles,
    context: createSourceContext({ workspaceRoot: process.cwd() }),
    ...(hasFlag(argumentsList, "--force") ? { force: true } : {}),
  });
  console.log(canonicalJson(result));
  if (result.products.some((product) => product.sourceFailures.length > 0))
    process.exitCode = 1;
}

async function runRefreshCommunity(argumentsList: string[]): Promise<void> {
  const allProfiles = await loadProductProfiles(
    resolve(process.cwd(), "products"),
  );
  const profiles =
    hasFlag(argumentsList, "--all") || flagValue(argumentsList, "--product")
      ? await selectedProfiles(argumentsList)
      : allProfiles;
  const lookbackHours = recentHours(argumentsList);
  const result = await refreshCommunityEvidence({
    repository: new ReleaseLensDataRepository(process.cwd()),
    profiles,
    allProfiles,
    context: createSourceContext({ workspaceRoot: process.cwd() }),
    ...(lookbackHours !== undefined ? { lookbackHours } : {}),
  });
  console.log(canonicalJson(result));
}

async function runValidateData(): Promise<void> {
  const result = await new ReleaseLensDataRepository(process.cwd()).validate();
  console.log(canonicalJson(result));
}

async function runBuildPublic(): Promise<void> {
  const root = process.cwd();
  const profiles = await loadProductProfiles(resolve(root, "products"));
  const repository = new ReleaseLensDataRepository(root);
  await repository.validate();
  const result = await buildStaticPublication({
    repository,
    profiles,
    publicDirectory: resolve(root, "apps", "web", "public"),
  });
  console.log(canonicalJson(result));
}

async function runValidatePublic(): Promise<void> {
  const result = await validateStaticPublication({
    publicDirectory: resolve(process.cwd(), "apps", "web", "public"),
  });
  console.log(canonicalJson(result));
}

async function main(): Promise<void> {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (!command || hasFlag(argumentsList, "--help") || command === "help") {
    console.log(usage);
    return;
  }
  if (command === "doctor") {
    await runDoctor();
    return;
  }
  if (command === "discover") {
    await runDiscover(argumentsList);
    return;
  }
  if (command === "observe") {
    await runObserve(argumentsList);
    return;
  }
  if (command === "bootstrap") {
    await runObserve(argumentsList, true);
    return;
  }
  if (command === "refresh-community") {
    await runRefreshCommunity(argumentsList);
    return;
  }
  if (command === "validate-data") {
    await runValidateData();
    return;
  }
  if (command === "build-public") {
    await runBuildPublic();
    return;
  }
  if (command === "validate-public") {
    await runValidatePublic();
    return;
  }
  console.error(`Unknown ReleaseLens command: ${command}`);
  console.error(usage);
  process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
