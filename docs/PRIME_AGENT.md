# Prime Agent integration

`pi-oracle` can run as a native Prime Agent package. The Prime port keeps the existing Oracle tools, slash-command workflow, detached browser workers, durable job state, provider-thread follow-ups, and best-effort completion wake-ups while adapting host-specific configuration, lifecycle, input, and output behavior to Prime Agent.

## Install

Install the canonical GitHub package:

```sh
prime-agent package install git:github.com/fitchmultz/pi-oracle
```

For a one-off trial without changing package settings:

```sh
prime-agent -e git:github.com/fitchmultz/pi-oracle
```

Update the installed GitHub package with:

```sh
prime-agent package update git:github.com/fitchmultz/pi-oracle
```

After the Prime-capable release is published to npm, the equivalent source is `npm:pi-oracle` for `package install`, `-e`, and `package update`.

To test the open development branch before it is merged upstream, substitute:

```text
git:github.com/sammyjoyce/pi-oracle@feat/prime-agent
```

Versioned git/npm refs stay pinned until the configured source changes.

## Configure

Prime Agent keeps package configuration under `~/.prime/agent`. The agent-level Oracle configuration file is:

```text
~/.prime/agent/extensions/oracle.json
```

A repository may also provide safe, non-auth overrides at:

```text
.prime/agent/extensions/oracle.json
```

Browser paths, cookie sources, and other privileged `auth.*` settings continue to come only from the agent-level configuration file. The complete schema and provider examples are documented in the main [README configuration section](../README.md#configuration).

## Use

The user-facing commands and agent-facing tools are unchanged:

- `/oracle <request>` and `oracle_submit`
- `/oracle-followup <job-id> <request>`
- `/oracle-auth [chatgpt|grok]` and `oracle_auth`
- `/oracle-read [job-id]` and `oracle_read`
- `/oracle-status [job-id]`
- `/oracle-cancel <job-id>` and `oracle_cancel`
- `/oracle-clean <job-id|all>`
- `oracle_preflight`

Prime Agent's daemon-backed sessions can detach and reattach while an Oracle job runs. Completion remains durable on disk and the extension also sends one hidden, triggered follow-up message to the matching persisted session when the answer becomes available. Command output uses a host-recognized hidden result envelope in daemon/headless modes, plus normal UI notifications when attached, so status, auth, read, cancel, and cleanup feedback is not lost.

## Runtime overrides

Oracle keeps its existing `PI_ORACLE_*` environment names under both hosts. These names are part of the extension's worker protocol rather than the coding-agent host API, so retaining them avoids splitting the extension process and detached workers across different state roots.

| Purpose | Environment variable | Default |
| --- | --- | --- |
| Job directories | `PI_ORACLE_JOBS_DIR` | `/tmp` |
| Shared locks and leases | `PI_ORACLE_STATE_DIR` | `/tmp/pi-oracle-state` |
| macOS clone command | `PI_ORACLE_CP_PATH` | `cp` |

Provider-specific test and diagnostic variables also retain their existing `PI_ORACLE_*` names.

## Trust and archives

Prime Agent treats loaded packages and repository resources as trusted code. Oracle still separates configuration by sensitivity: project configuration can change only the safe override keys, while browser/auth configuration is agent-level only. Project archives exclude both `.pi` and `.prime` directories by default so local agent configuration is not uploaded accidentally.

Review the main [README](../README.md) and [`docs/ORACLE_DESIGN.md`](ORACLE_DESIGN.md) before using Oracle with private or regulated source code. Selected archives are uploaded to the configured ChatGPT or Grok web account.

## Validate

From a dependency-installed source checkout:

```sh
npm run check:prime-agent
npm run check:prime-agent:installed
npm run verify:oracle
```

`check:prime-agent` compiles the complete Oracle extension against a checked-in Prime-shaped public host contract, executes host behavior assertions (including daemon theme fallback, lifecycle invalidation, input delivery, and headless output routing), and runs static compatibility invariants. `check:prime-agent:installed` separately compiles against the declarations shipped by the installed Prime Agent version (0.7.2 by default); use `PRIME_AGENT_PACKAGE_ROOT` or `PI_ORACLE_PRIME_AGENT_VERSION` for an alternate install/baseline. Before release, also install the committed package into an isolated `PRIME_AGENT_CODING_AGENT_DIR` and verify a daemon-backed persisted session can start, report missing auth without crashing, execute `/oracle-status` in JSON/headless mode, and shut down or reload while startup checks are still pending.
