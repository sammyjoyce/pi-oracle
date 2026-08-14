// Purpose: Register the oracle extension, wire commands/tools/workers, and manage per-session background maintenance.
// Responsibilities: Bootstrap oracle commands and tools, start or stop polling, and surface startup/config availability in the host session UI.
// Scope: Extension entrypoint only; lifecycle mutation lives in lib modules and browser execution lives in worker scripts.
// Usage: Loaded by pi or Prime Agent as the extension module declared in package.json.
// Invariants/Assumptions: Oracle only runs against persisted sessions, and startup maintenance should be best-effort without breaking session initialization.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadOracleConfig } from "./lib/config.js";
import { registerOracleCommands } from "./lib/commands.js";
import {
  createOracleSessionLifecycle,
  emitOracleUserOutput,
  setOracleStatusText,
  getOracleInputDelivery,
  isOracleInteractiveContext,
  shouldExposeOraclePromptPaths,
  shouldRunOraclePoller,
} from "./lib/host.js";
import { pruneTerminalOracleJobs, reconcileStaleOracleJobs } from "./lib/jobs.js";
import { isLockTimeoutError, withGlobalReconcileLock } from "./lib/locks.js";
import {
  refreshOracleStatusSnapshot,
  setOracleReadinessSnapshot,
  snapshotOraclePollerContext,
  startPoller,
  stopPoller,
  type OraclePollerContextSnapshot,
} from "./lib/poller.js";
import { promoteQueuedJobs } from "./lib/queue.js";
import { assertOracleSubmitPrerequisites, hasPersistedSessionFile } from "./lib/runtime.js";
import { isOracleProjectTrusted } from "./lib/trust.js";
import { registerOracleTools } from "./lib/tools.js";

function readPromptTemplate(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  } catch {
    return undefined;
  }
}

function oracleReadinessFromError(error: unknown): "auth_needed" | "config_error" {
  const message = error instanceof Error ? error.message : String(error);
  return /auth seed profile/i.test(message) ? "auth_needed" : "config_error";
}

function expandOraclePromptTemplate(source: string, args: string): string {
  return source.replaceAll("$@", args).replaceAll("$ARGUMENTS", args);
}

function parseOracleInput(text: string): { command: "oracle" | "oracle-followup"; args: string } | undefined {
  const match = text.match(/^\/(oracle(?:-followup)?)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;
  return { command: match[1] as "oracle" | "oracle-followup", args: (match[2] ?? "").trim() };
}

function formatOracleUserCommand(command: "oracle" | "oracle-followup", args: string): string {
  return `/${command} ${args}`;
}

function oracleDispatchMessage(command: "oracle" | "oracle-followup", args: string, template: string) {
  return {
    customType: "oracle-dispatch-request",
    content: expandOraclePromptTemplate(template, args),
    display: false,
    details: { command, userRequest: args },
  };
}

export default function oracleExtension(pi: ExtensionAPI) {
  const extensionDir = dirname(fileURLToPath(import.meta.url));
  const workerPath = join(extensionDir, "worker", "run-job.mjs");
  const authWorkerPath = join(extensionDir, "worker", "auth-bootstrap.mjs");
  const promptDir = join(extensionDir, "..", "..", "prompts");
  const sessionLifecycle = createOracleSessionLifecycle();

  const oraclePrompt = readPromptTemplate(join(promptDir, "oracle.md"));
  const oracleFollowupPrompt = readPromptTemplate(join(promptDir, "oracle-followup.md"));

  registerOracleCommands(pi, authWorkerPath, workerPath);
  registerOracleTools(pi, workerPath, authWorkerPath);

  async function runStartupMaintenance(cwd: string): Promise<void> {
    try {
      await withGlobalReconcileLock({ processPid: process.pid, source: "oracle_session_start", cwd }, async () => {
        await reconcileStaleOracleJobs();
        await pruneTerminalOracleJobs();
      }, { timeoutMs: 250 });
    } catch (error) {
      if (!isLockTimeoutError(error, "reconcile", "global")) throw error;
    }

    await promoteQueuedJobs({ workerPath, source: "oracle_session_start" });
  }

  function updateReadinessIfCurrent(
    snapshot: OraclePollerContextSnapshot,
    isCurrentLifecycle: () => boolean,
    readiness: "loaded" | "ready" | "auth_needed" | "config_error",
  ): void {
    if (!isCurrentLifecycle()) return;
    try {
      setOracleReadinessSnapshot(snapshot, readiness);
    } catch (error) {
      console.error(`Oracle readiness update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function startPollerForContext(ctx: ExtensionContext): void {
    const isCurrentLifecycle = sessionLifecycle.begin();
    const snapshot = snapshotOraclePollerContext(ctx);
    try {
      if (!shouldRunOraclePoller(ctx)) {
        stopPoller(ctx);
        return;
      }
      if (!hasPersistedSessionFile(snapshot.sessionFile)) {
        stopPoller(ctx);
        if (snapshot.hasUI) {
          setOracleStatusText(snapshot.ui, "oracle: unavailable", "accent");
        }
        return;
      }

      const config = loadOracleConfig(snapshot.cwd, { projectConfigTrusted: isOracleProjectTrusted(ctx) });
      updateReadinessIfCurrent(snapshot, isCurrentLifecycle, "loaded");
      void assertOracleSubmitPrerequisites(config).then(
        () => updateReadinessIfCurrent(snapshot, isCurrentLifecycle, "ready"),
        (error) => updateReadinessIfCurrent(snapshot, isCurrentLifecycle, oracleReadinessFromError(error)),
      );
      void runStartupMaintenance(snapshot.cwd).catch((error) => {
        if (!isCurrentLifecycle()) return;
        const message = `Oracle startup maintenance failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        if (snapshot.hasUI) {
          try {
            snapshot.ui.notify(message, "warning");
          } catch {
            // The host may have detached while maintenance was finishing.
          }
        }
      });
      startPoller(pi, ctx, config.poller.intervalMs, workerPath);
      refreshOracleStatusSnapshot(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopPoller(ctx);
      updateReadinessIfCurrent(snapshot, isCurrentLifecycle, "config_error");
      console.error(message);
      if (snapshot.hasUI) {
        try {
          snapshot.ui.notify(message, "warning");
        } catch {
          // Startup errors must not crash a daemon worker whose UI detached.
        }
      }
    }
  }

  pi.on("resources_discover", async (_event, ctx) => {
    return shouldExposeOraclePromptPaths(ctx) ? { promptPaths: [promptDir] } : undefined;
  });

  pi.on("before_agent_start", async (event) => {
    const parsed = parseOracleInput(event.prompt);
    if (!parsed?.args || (parsed.command === "oracle-followup" && !/^\S+\s+\S/.test(parsed.args))) return;
    const template = parsed.command === "oracle" ? oraclePrompt : oracleFollowupPrompt;
    if (!template?.trim()) return;
    return { message: oracleDispatchMessage(parsed.command, parsed.args, template) };
  });

  pi.on("input", (event, ctx) => {
    if (!isOracleInteractiveContext(ctx) || event.source !== "interactive") return { action: "continue" };
    const parsed = parseOracleInput(event.text);
    if (!parsed) return { action: "continue" };
    if (!parsed.args || (parsed.command === "oracle-followup" && !/^\S+\s+\S/.test(parsed.args))) {
      emitOracleUserOutput(
        pi,
        ctx,
        parsed.command === "oracle" ? "Usage: /oracle <request>" : "Usage: /oracle-followup <job-id> <request>",
        "warning",
      );
      return { action: "handled" };
    }
    const template = parsed.command === "oracle" ? oraclePrompt : oracleFollowupPrompt;
    if (!template?.trim()) {
      emitOracleUserOutput(pi, ctx, `/${parsed.command} is unavailable because its internal dispatch prompt could not be loaded.`, "warning");
      return { action: "handled" };
    }
    ctx.ui.notify("Preparing oracle job… running preflight", "info");
    pi.sendUserMessage(formatOracleUserCommand(parsed.command, parsed.args), getOracleInputDelivery(event, ctx));
    return { action: "handled" };
  });

  pi.on("session_start", async (_event, ctx) => {
    startPollerForContext(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionLifecycle.invalidate();
    stopPoller(ctx);
  });
}
