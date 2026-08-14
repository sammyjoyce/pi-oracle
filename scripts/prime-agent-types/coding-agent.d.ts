// Purpose: Model the Prime Agent host surface that Oracle is allowed to depend on.
// Responsibilities: Compile the complete extension against Prime's mode-free contexts, input events, commands, tools, and messaging API.
// Scope: Typechecking fixture only; this file is never loaded by Oracle at runtime.
// Usage: Resolved through tsconfig.prime-agent.json in place of the installed legacy pi coding-agent declarations.
// Invariants/Assumptions: Legacy-only mode, streamingBehavior, CONFIG_DIR_NAME, project trust exports, and ctx.isProjectTrusted stay absent.
import type { Static, TSchema } from "typebox";

export interface ExtensionTheme {
  fg(color: string, text: string): string;
}

export interface ExtensionUIContext {
  readonly theme: ExtensionTheme;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
}

export interface ReadonlySessionManager {
  getSessionFile(): string | undefined;
}

export interface ExtensionContext {
  ui: ExtensionUIContext;
  hasUI: boolean;
  cwd: string;
  sessionManager: ReadonlySessionManager;
  isIdle(): boolean;
}

export interface ExtensionCommandContext extends ExtensionContext {
  waitForIdle(): Promise<void>;
}

export type InputSource = "interactive" | "rpc" | "extension";

export interface InputEvent {
  type: "input";
  text: string;
  source: InputSource;
}

export type InputEventResult =
  | { action: "continue" }
  | { action: "transform"; text: string }
  | { action: "handled" };

export interface ResourcesDiscoverEvent {
  type: "resources_discover";
  cwd: string;
  reason: "startup" | "reload";
}

export interface ResourcesDiscoverResult {
  promptPaths?: string[];
  skillPaths?: string[];
  themePaths?: string[];
}

export interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
}

export interface BeforeAgentStartEventResult {
  message?: {
    customType: string;
    content: string;
    display: boolean;
    details?: unknown;
  };
}

export interface ToolResultEvent {
  type: "tool_result";
  toolName: string;
  isError: boolean;
  details: unknown;
}

export interface SessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
}

export interface SessionShutdownEvent {
  type: "session_shutdown";
  reason: "quit" | "reload" | "new" | "resume" | "fork";
}

export interface ToolDefinition<TParams extends TSchema = TSchema> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  prepareArguments?: (args: unknown) => Static<TParams>;
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<unknown>;
}

export interface ExtensionAPI {
  on(
    event: "resources_discover",
    handler: (event: ResourcesDiscoverEvent, ctx: ExtensionContext) => ResourcesDiscoverResult | void | Promise<ResourcesDiscoverResult | void>,
  ): void;
  on(
    event: "before_agent_start",
    handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => BeforeAgentStartEventResult | void | Promise<BeforeAgentStartEventResult | void>,
  ): void;
  on(
    event: "input",
    handler: (event: InputEvent, ctx: ExtensionContext) => InputEventResult | void | Promise<InputEventResult | void>,
  ): void;
  on(event: "tool_result", handler: (event: ToolResultEvent, ctx: ExtensionContext) => unknown): void;
  on(event: "session_start", handler: (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>): void;
  on(event: "session_shutdown", handler: (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>): void;
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler(args: string, ctx: ExtensionCommandContext): void | Promise<void>;
    },
  ): void;
  registerTool<TParams extends TSchema>(tool: ToolDefinition<TParams>): void;
  sendMessage(
    message: { customType: string; content: string; display?: boolean; details?: unknown },
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

export function getAgentDir(): string;
