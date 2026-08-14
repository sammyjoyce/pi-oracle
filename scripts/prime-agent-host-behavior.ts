// Purpose: Lock the observable host-adapter behavior shared by legacy pi and Prime Agent.
// Responsibilities: Verify mode handling, prompt discovery, poller policy, lifecycle invalidation, safe status styling, output routing, and input delivery.
// Scope: Host adapter only; browser, archive, and durable job behavior remain in the existing Oracle sanity suites.
// Usage: Run through `npm run check:prime-agent` with tsx.
// Invariants/Assumptions: Legacy pi supplies mode/streamingBehavior; Prime intentionally supplies neither and may expose UI before theme initialization.
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildOraclePrimeCommandOutput,
  createOracleSessionLifecycle,
  emitOracleUserOutput,
  formatOracleStatusText,
  setOracleStatusText,
  getOracleInputDelivery,
  isOracleInteractiveContext,
  isOraclePrimeContext,
  isOraclePrintContext,
  shouldExposeOraclePromptPaths,
  shouldRunOraclePoller,
} from "../extensions/oracle/lib/host.js";
import { isOracleProjectTrusted } from "../extensions/oracle/lib/trust.js";

type HostContextShape = {
  mode?: "tui" | "rpc" | "print" | "json";
  hasUI: boolean;
  isIdle(): boolean;
  ui?: {
    notify(message: string, level?: string): void;
    setStatus(key: string, text: string | undefined): void;
    readonly theme: { fg(color: string, text: string): string };
  };
};

function context(shape: HostContextShape): ExtensionContext {
  return shape as unknown as ExtensionContext;
}

const noOpUi = {
  notify() {},
  setStatus() {},
  theme: { fg: (_color: string, text: string) => text },
};
const legacyTui = context({ mode: "tui", hasUI: true, isIdle: () => false, ui: noOpUi });
const legacyPrint = context({ mode: "print", hasUI: false, isIdle: () => true, ui: noOpUi });
const legacyRpc = context({ mode: "rpc", hasUI: false, isIdle: () => true, ui: noOpUi });
const primeIdle = context({ hasUI: true, isIdle: () => true, ui: noOpUi });
const primeStreaming = context({ hasUI: true, isIdle: () => false, ui: noOpUi });

assert.equal(isOracleInteractiveContext(legacyTui), true);
assert.equal(isOraclePrimeContext(legacyTui), false);
assert.equal(isOraclePrintContext(legacyPrint), true);
assert.equal(shouldRunOraclePoller(legacyPrint), false);
assert.equal(shouldExposeOraclePromptPaths(legacyRpc), true);
assert.deepEqual(getOracleInputDelivery({ streamingBehavior: "steer" }, legacyTui), { deliverAs: "steer" });
assert.equal(getOracleInputDelivery({}, legacyTui), undefined, "legacy pi must preserve its original no-hint delivery behavior");

assert.equal(isOracleInteractiveContext(primeIdle), true);
assert.equal(isOraclePrimeContext(primeIdle), true);
assert.equal(isOraclePrintContext(primeIdle), false);
assert.equal(shouldRunOraclePoller(primeIdle), true);
assert.equal(shouldExposeOraclePromptPaths(primeIdle), false);
assert.equal(getOracleInputDelivery({ type: "input", text: "/oracle test", source: "interactive" }, primeIdle), undefined);
assert.deepEqual(
  getOracleInputDelivery({ type: "input", text: "/oracle test", source: "interactive" }, primeStreaming),
  { deliverAs: "followUp" },
);

assert.equal(isOracleProjectTrusted(primeIdle), true, "Prime contexts without legacy project trust default to trusted");
const legacyDistrusted = context({ mode: "tui", hasUI: true, isIdle: () => true, ui: noOpUi }) as ExtensionContext & {
  isProjectTrusted(): boolean;
};
legacyDistrusted.isProjectTrusted = () => false;
assert.equal(isOracleProjectTrusted(legacyDistrusted), false, "legacy pi distrust remains authoritative");

const lifecycle = createOracleSessionLifecycle();
const firstLifecycle = lifecycle.begin();
assert.equal(firstLifecycle(), true);
const secondLifecycle = lifecycle.begin();
assert.equal(firstLifecycle(), false, "starting a replacement lifecycle must invalidate older async callbacks");
assert.equal(secondLifecycle(), true);
lifecycle.invalidate();
assert.equal(secondLifecycle(), false, "session shutdown must invalidate pending async callbacks");

const uninitializedThemeUi = {
  notify() {},
  setStatus() {},
  get theme() {
    return {
      get fg(): never {
        throw new Error("Theme not initialized. Call initTheme() first.");
      },
    };
  },
};
assert.equal(
  formatOracleStatusText(uninitializedThemeUi as unknown as ExtensionContext["ui"], "error", "oracle: auth needed"),
  "oracle: auth needed",
  "Prime daemon status rendering must fall back to plain text before theme initialization",
);

assert.doesNotThrow(
  () => setOracleStatusText({
    ...noOpUi,
    setStatus() {
      throw new Error("Daemon worker socket closed");
    },
  } as unknown as ExtensionContext["ui"], "oracle: ready", "success"),
  "a detached Prime UI bridge must not crash asynchronous status refresh",
);

const sentMessages: unknown[] = [];
const notifications: unknown[] = [];
const primeOutputContext = context({
  hasUI: true,
  isIdle: () => true,
  ui: {
    ...noOpUi,
    notify(message, level) {
      notifications.push({ message, level });
    },
  },
});
const outputPi = {
  sendMessage(message: unknown, options?: unknown) {
    sentMessages.push({ message, options });
  },
} as unknown as ExtensionAPI;
const primeCommandOutput = buildOraclePrimeCommandOutput("No oracle jobs found.");
assert.deepEqual(primeCommandOutput, {
  customType: "session_slash_command_result",
  content: "No oracle jobs found.",
  display: false,
  details: {
    command: {
      name: "goal",
      args: "oracle-command-output",
      text: "/goal oracle-command-output",
    },
    success: true,
    severity: "info",
    oracleCommandOutput: true,
  },
});
emitOracleUserOutput(outputPi, primeOutputContext, "No oracle jobs found.");
assert.deepEqual(sentMessages, [{ message: primeCommandOutput, options: undefined }], "Prime command output must use its headless-client result envelope");
assert.deepEqual(notifications, [{ message: "No oracle jobs found.", level: "info" }], "attached Prime UI must still receive interactive command feedback");

console.log("Prime Agent and legacy pi host behavior passed");
