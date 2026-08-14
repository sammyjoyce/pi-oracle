// Purpose: Lock Oracle background lifecycle behavior to Prime Agent's stale-context and daemon-theme contracts.
// Responsibilities: Prove pollers snapshot context synchronously, tolerate an uninitialized theme, and avoid context reads after shutdown.
// Scope: Prime host lifecycle adapter only; browser and durable job behavior stay in the Oracle sanity suites.
// Usage: Run through `npm run check:prime-agent` with tsx.
// Invariants/Assumptions: Prime invalidates ExtensionContext getters after shutdown/reload, while previously extracted plain values remain caller-owned.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const fixtureDir = mkdtempSync(join(tmpdir(), "pi-oracle-prime-lifecycle-"));
const previousJobsDir = process.env.PI_ORACLE_JOBS_DIR;
const previousStateDir = process.env.PI_ORACLE_STATE_DIR;
process.env.PI_ORACLE_JOBS_DIR = join(fixtureDir, "jobs");
process.env.PI_ORACLE_STATE_DIR = join(fixtureDir, "state");

const {
  startPoller,
  stopAllPollers,
  stopPoller,
  waitForAllPollersToQuiesce,
} = await import("../extensions/oracle/lib/poller.js");

let stale = false;
let staleContextReads = 0;
function assertContextActive(): void {
  if (!stale) return;
  staleContextReads += 1;
  throw new Error("This extension context is stale after session replacement or reload.");
}

const cwd = fixtureDir;
const sessionFile = join(fixtureDir, "session.jsonl");
const statuses: string[] = [];
const ui = {
  setStatus(_key: string, text: string | undefined) {
    if (text) statuses.push(text);
  },
  notify() {},
  get theme(): never {
    throw new Error("Theme not initialized. Call initTheme() first.");
  },
} as unknown as ExtensionContext["ui"];
const sessionManager = {
  getSessionFile() {
    assertContextActive();
    return sessionFile;
  },
} as ExtensionContext["sessionManager"];
const ctx = {
  get cwd() {
    assertContextActive();
    return cwd;
  },
  get hasUI() {
    assertContextActive();
    return true;
  },
  get ui() {
    assertContextActive();
    return ui;
  },
  get sessionManager() {
    assertContextActive();
    return sessionManager;
  },
} as unknown as ExtensionContext;
const pi = {
  sendMessage() {
    if (stale) throw new Error("Captured Prime API used after session shutdown.");
  },
} as unknown as ExtensionAPI;

try {
  startPoller(pi, ctx, 60_000, join(fixtureDir, "worker.mjs"), {
    hooks: { collectLiveWakeupTargets: async () => new Set<string>() },
  });
  assert.equal(statuses.at(-1), "oracle: loaded", "uninitialized Prime themes must fall back to plain footer text");

  stopPoller(ctx);
  stale = true;
  await waitForAllPollersToQuiesce();

  assert.equal(staleContextReads, 0, "late poller work must not touch an invalidated Prime ExtensionContext");
} finally {
  await stopAllPollers();
  rmSync(fixtureDir, { recursive: true, force: true });
  if (previousJobsDir === undefined) delete process.env.PI_ORACLE_JOBS_DIR;
  else process.env.PI_ORACLE_JOBS_DIR = previousJobsDir;
  if (previousStateDir === undefined) delete process.env.PI_ORACLE_STATE_DIR;
  else process.env.PI_ORACLE_STATE_DIR = previousStateDir;
}

console.log("Prime Agent Oracle lifecycle behavior passed");
