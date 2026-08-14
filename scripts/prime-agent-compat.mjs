// Purpose: Guard the Oracle extension's supported pi/Prime Agent host boundary.
// Responsibilities: Reject direct legacy-only host API access and verify Prime types, docs, config/archive conventions, and package resources.
// Scope: Static compatibility invariants only; behavioral browser and lifecycle coverage remains in the existing sanity and smoke suites.
// Usage: Run with `npm run check:prime-agent` from the repository root.
// Invariants/Assumptions: Host differences belong in extensions/oracle/lib/host.ts and the package continues using the inherited `pi` resource manifest.
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(root, "extensions", "oracle");
const hostPath = join(extensionRoot, "lib", "host.ts");
const indexPath = join(extensionRoot, "index.ts");
const archivePath = join(extensionRoot, "lib", "archive.ts");
const configPath = join(extensionRoot, "lib", "config.ts");
const pollerPath = join(extensionRoot, "lib", "poller.ts");
const runtimePath = join(extensionRoot, "lib", "runtime.ts");
const trustPath = join(extensionRoot, "lib", "trust.ts");
const packagePath = join(root, "package.json");
const readmePath = join(root, "README.md");
const primeGuidePath = join(root, "docs", "PRIME_AGENT.md");
const gitignorePath = join(root, ".gitignore");
const primeTsconfigPath = join(root, "tsconfig.prime-agent.json");

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTypeScriptFiles(path));
    else if (entry.isFile() && extname(entry.name) === ".ts") files.push(path);
  }
  return files;
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`Prime Agent compatibility check failed: ${label}`);
}

function assertExcludes(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`Prime Agent compatibility check failed: ${label}`);
}

const directModePattern = /\bctx\.mode\b/;
const directStreamingBehaviorPattern = /\bevent\.streamingBehavior\b/;
const legacyNamedImportPattern = /import\s*\{[^}]*\b(?:CONFIG_DIR_NAME|ProjectTrustStore|hasTrustRequiringProjectResources)\b[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/s;
for (const [pattern, forbiddenExample, label] of [
  [directModePattern, "ctx.mode", "direct ctx.mode guard"],
  [directStreamingBehaviorPattern, "event.streamingBehavior", "direct streamingBehavior guard"],
  [legacyNamedImportPattern, 'import { ProjectTrustStore } from "@earendil-works/pi-coding-agent"', "legacy named-import guard"],
]) {
  if (!pattern.test(forbiddenExample)) {
    throw new Error(`Prime Agent compatibility check failed: ${label} does not match its forbidden example`);
  }
}

const typeScriptFiles = await listTypeScriptFiles(extensionRoot);
for (const path of typeScriptFiles) {
  if (path === hostPath) continue;
  const source = await readFile(path, "utf8");
  const label = relative(root, path);
  assertExcludes(source, directModePattern, `${label} reaches into legacy ctx.mode instead of lib/host.ts`);
  assertExcludes(source, directStreamingBehaviorPattern, `${label} reaches into legacy input delivery instead of lib/host.ts`);
  assertExcludes(source, /\.theme\.fg\(/, `${label} styles status text directly instead of using the daemon-safe host formatter`);
  assertExcludes(
    source,
    legacyNamedImportPattern,
    `${label} imports legacy-only coding-agent exports instead of lib/host.ts`,
  );
}

const hostSource = await readFile(hostPath, "utf8");
assertIncludes(hostSource, "CodingAgentHost.getAgentDir()", "host adapter must use the shared public getAgentDir export");
assertIncludes(hostSource, "PRIME_AGENT_CODING_AGENT_DIR", "host adapter must recognize Prime Agent's custom agent directory");
assertIncludes(hostSource, 'join(".prime", "agent")', "host adapter must preserve Prime Agent's project config convention");
assertIncludes(hostSource, "getOracleInputDelivery", "host adapter must normalize input delivery");
assertIncludes(hostSource, "createOracleSessionLifecycle", "host adapter must invalidate stale async session work");
assertIncludes(hostSource, "formatOracleStatusText", "host adapter must tolerate unavailable daemon themes");
assertIncludes(hostSource, "setOracleStatusText", "host adapter must tolerate detached daemon UI status bridges");
assertIncludes(hostSource, "isOraclePrimeContext", "host adapter must identify mode-free Prime output contexts");
assertIncludes(hostSource, "session_slash_command_result", "host adapter must use Prime's headless-client command result envelope");
assertIncludes(hostSource, "buildOraclePrimeCommandOutput", "host adapter must centralize Prime headless command output");

const indexSource = await readFile(indexPath, "utf8");
assertIncludes(indexSource, "sessionLifecycle.invalidate()", "extension shutdown must invalidate stale async callbacks");
assertIncludes(indexSource, "snapshotOraclePollerContext(ctx)", "async startup must snapshot host state before awaiting");

const configSource = await readFile(configPath, "utf8");
assertIncludes(configSource, "getOracleProjectConfigDirName(agentDir)", "project config must resolve through the host adapter");

const pollerSource = await readFile(pollerPath, "utf8");
assertIncludes(pollerSource, "setOracleStatusText", "poller status must use the daemon-safe status bridge");

const trustSource = await readFile(trustPath, "utf8");
assertIncludes(trustSource, "ctx: ExtensionContext", "project trust must accept the shared public ExtensionContext shape");

const runtimeSource = await readFile(runtimePath, "utf8");
assertIncludes(runtimeSource, "getOracleHostDisplayName()", "persisted-session diagnostics must name the active host");

const archiveSource = await readFile(archivePath, "utf8");
assertIncludes(archiveSource, '  ".prime",', "whole-project archives must exclude Prime Agent state");

const readme = await readFile(readmePath, "utf8");
assertIncludes(readme, "prime-agent package install git:github.com/fitchmultz/pi-oracle", "main README must document a canonical Prime install command");
assertIncludes(readme, "~/.prime/agent/extensions/oracle.json", "main README must document Prime agent-level config");
assertIncludes(readme, "npm run check:prime-agent", "main README must document the Prime validation gate");

const primeGuide = await readFile(primeGuidePath, "utf8");
assertIncludes(primeGuide, "prime-agent package install", "Prime Agent installation must be documented");
assertIncludes(primeGuide, ".prime/agent/extensions/oracle.json", "Prime Agent project config must be documented");

const gitignore = await readFile(gitignorePath, "utf8");
if (!gitignore.split(/\r?\n/u).includes(".prime/")) {
  throw new Error("Prime Agent compatibility check failed: .gitignore must contain an exact .prime/ local-state rule");
}

const primeTsconfig = JSON.parse(await readFile(primeTsconfigPath, "utf8"));
if ("baseUrl" in (primeTsconfig.compilerOptions ?? {})) {
  throw new Error("Prime Agent compatibility check failed: Prime typecheck config must not use deprecated baseUrl");
}
if (!primeTsconfig.include?.includes("extensions/**/*.ts") || !primeTsconfig.include?.includes("extensions/**/*.d.mts")) {
  throw new Error("Prime Agent compatibility check failed: Prime typecheck must compile the complete Oracle extension surface");
}

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
if (!String(packageJson.scripts?.["check:prime-agent"] ?? "").includes("scripts/prime-agent-lifecycle-behavior.ts")) {
  throw new Error("Prime Agent compatibility check failed: Prime gate must execute stale-context lifecycle behavior");
}
if (packageJson.scripts?.["check:prime-agent:installed"] !== "node scripts/prime-agent-installed-typecheck.mjs") {
  throw new Error("Prime Agent compatibility check failed: installed Prime declaration validation must remain available");
}
if (!packageJson.pi?.extensions?.includes("./extensions/oracle/index.ts")) {
  throw new Error("Prime Agent compatibility check failed: package must expose the Oracle extension through the inherited pi manifest");
}
if (!packageJson.pi?.prompts?.includes("./prompts")) {
  throw new Error("Prime Agent compatibility check failed: package must expose Oracle prompts through the inherited pi manifest");
}

console.log("Prime Agent compatibility invariants passed");
