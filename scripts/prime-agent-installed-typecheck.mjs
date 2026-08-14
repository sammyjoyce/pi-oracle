// Purpose: Compile Oracle against the declarations shipped by an installed Prime Agent release.
// Responsibilities: Locate Prime Agent, pin the expected baseline, map its host/AI/typebox declarations, and typecheck the complete extension.
// Scope: Optional release/upgrade validation; the self-contained checked-in contract remains part of check:prime-agent.
// Usage: Run `npm run check:prime-agent:installed`; override PRIME_AGENT_PACKAGE_ROOT or PI_ORACLE_PRIME_AGENT_VERSION when testing another install.
// Invariants/Assumptions: Prime Agent's installed package contains its aliased pi-ai and typebox runtime dependencies.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = process.env.PI_ORACLE_PRIME_AGENT_VERSION?.trim() || "0.7.2";

async function findPrimeAgentRoot() {
  const configuredRoot = process.env.PRIME_AGENT_PACKAGE_ROOT?.trim();
  if (configuredRoot) return resolve(configuredRoot);

  const locator = process.platform === "win32" ? "where" : "which";
  const executable = execFileSync(locator, [process.env.PRIME_AGENT_BIN?.trim() || "prime-agent"], { encoding: "utf8" })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!executable) throw new Error("Prime Agent executable was not found on PATH");

  let candidate = dirname(await realpath(executable));
  for (;;) {
    try {
      const packageJson = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
      if (packageJson.name === "prime-agent") return candidate;
    } catch {
      // Keep walking from the resolved CLI path to its package root.
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate the prime-agent package root from ${executable}`);
}

const primeRoot = await findPrimeAgentRoot();
const primePackage = JSON.parse(await readFile(join(primeRoot, "package.json"), "utf8"));
if (primePackage.version !== expectedVersion) {
  throw new Error(`Expected Prime Agent ${expectedVersion}, found ${String(primePackage.version)} at ${primeRoot}`);
}

const declarationPaths = {
  "@earendil-works/pi-coding-agent": join(primeRoot, "dist", "index.d.ts"),
  "@earendil-works/pi-ai": join(primeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.d.ts"),
  typebox: join(primeRoot, "node_modules", "typebox", "build", "index.d.mts"),
};
for (const path of Object.values(declarationPaths)) await realpath(path);

const fixtureDir = await mkdtemp(join(tmpdir(), "pi-oracle-prime-types-"));
const configPath = join(fixtureDir, "tsconfig.json");
let typecheckStatus = 0;
try {
  await writeFile(configPath, `${JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: {
      paths: Object.fromEntries(Object.entries(declarationPaths).map(([specifier, path]) => [specifier, [path]])),
      typeRoots: [join(root, "node_modules", "@types")],
    },
    include: [
      join(root, "extensions", "**", "*.ts"),
      join(root, "extensions", "**", "*.d.mts"),
      join(root, "scripts", "prime-agent-types", "host-call-sites.ts"),
    ],
  }, null, 2)}\n`, "utf8");

  const require = createRequire(join(root, "package.json"));
  const tsc = require.resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tsc, "--noEmit", "-p", configPath], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  typecheckStatus = result.status ?? 1;
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

if (typecheckStatus !== 0) process.exit(typecheckStatus);
console.log(`Prime Agent ${expectedVersion} shipped declaration compatibility passed`);
