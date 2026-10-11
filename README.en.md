# dsh-auto-review-default

English | [中文](README.md)

Puts sessions into the built-in `auto` permission preset (Auto review): **newly created sessions at creation**, and **existing root sessions when they are restored (reopened)**.

Sessions delegated to subagents are never touched — their permission is fixed by the parent's delegation, and Auto's `ask` policy would surface child approvals to the human mid-delegation.

## The gap it fills

DSH deliberately keeps Auto out of the new-session default. From the shipped documentation:

- `@deepseek-ai/dsh-permission-presets`: "**Auto cannot be the default**: it exists only while its integration effect is alive, and it deliberately does not enter the `permission` settings schema."
- `@deepseek-ai/dsh-client-ui-permission-presets`: "session-only contributions such as `auto` do not appear [in the settings row]" and "**Auto review is current-session only** — the General Settings row deliberately omits it."

So the General settings permission dropdown only ever lists the configured presets, and Auto has to be selected session by session (the composer's permission control, or `/permission auto`).

The shipped `@deepseek-ai/dsh-experimental-auto-review` layer must be enabled for this plugin to have a target to switch to.

## Install

```sh
dsh plugin --profile web add github:devil233-ui/dsh-auto-review-default
```

Replace `web` with your profile name (DSH Desktop uses `desktop`). The host hot-loads new bundles, so no restart is needed.

## How it works

The single place that decides a session's initial permission is `PermissionPresetService#pinInitialPermission(session)`: the service calls it from its own `session/created` listener **for every session that enters the store** (freshly created or restored), and once for every session already live at mount time. This plugin wraps that one method: after the original runs, if the session is not a delegated child and is not already on `auto`, it switches to `auto` through the official `permissionPresets.set`. Hooking the same method is also what makes `session.seq === 0` (a genuinely new, empty session) observable *before* the original writes any event — used to distinguish "created" from "restored" for log wording only.

This does wrap a host-internal method rather than an official extension point; see the limitations below.

**Sessions already live when this plugin mounts are deliberately left alone**: this plugin acts on creation and on restore only, so a session you are working in keeps its preset until it is reopened.

## Safety properties

- **Never throws.** A synchronous throw inside `session/created` vetoes and rolls back session publication, so every failure here degrades to keeping whatever preset the session already had — it only writes a warning line.
- **Never touches delegated subagent children**: `dsh-subagent` stamps `origin: "subagent"` and a positive `delegationDepth` (persistence writes `delegationDepth: 0` for root sessions, so only a positive depth means a child). An unreadable header counts as a child: leave it alone rather than guess.
- **Never touches scheduled-task runner sessions**: `@michengai/dsh-automation` names its run sessions with the fixed `dsh-automation-session-` prefix, and a task carries its own unattended preset (typically `approval: never`) — flipping it to Auto would turn every step into an approval prompt nobody may answer (the actual v0.2.0 incident, fixed in v0.2.1).
- **Idempotent**, reversible through the Cordis effect disposer, and degrades automatically when Auto is unavailable.

## Verification

Measured in an isolated `headless` profile with one-shot tasks, reading the session projection cache's `permissions` value:

| Scenario | Result |
|---|---|
| New session with the plugin | `preset: "auto"` (sandbox `danger-full-access` + approval `ask`) |
| New session without it (baseline) | `preset: "workspace-write"` |
| **Reopening that baseline session with the plugin** | **`preset: "auto"`** (switched on restore) |
| A subagent child spawned by the model | not adopted by this plugin (a probe measured `isChild=true` and the guard held); the `permission/preset auto` on the child is written by `dsh-subagent` copying the parent's preset |
| A `dsh-automation-session-*` run session | not adopted; keeps the task's own unattended preset (v0.2.1) |

Verified on DSH Desktop `0.2.0-rc.2`.

## Uninstall

```sh
dsh plugin --profile web remove dsh-auto-review-default
```

## Known limitations

- **Restoring an old session always switches it to Auto**, including sessions you had explicitly set to read-only or workspace-write — it widens the sandbox to `danger-full-access` (while adding per-call review). That is an intended choice, not a side effect; if you only want new sessions to adopt Auto, do not install this plugin, or narrow the `adopt()` check.
- **Auto is experimental**: it can allow unsafe actions, deny useful ones, and it adds one extra model request per supported tool call (no caching, no retries). This plugin only makes it the default; it does not change how Auto behaves.
- **It wraps a host-internal method name.** If DSH renames `pinInitialPermission`, the plugin **silently stops applying** (sessions keep whatever preset they had) — it never errors and never breaks startup. If new sessions stop starting in Auto after an upgrade, look here first.
- Requires the shipped `@deepseek-ai/dsh-experimental-auto-review` layer to be enabled; the plugin degrades on its own when it is not.
- No per-workspace or per-Agent rules. For that granularity use [`dsh-workspace-tools`](https://github.com/AHIOSUZ/dsh-workspace-tools) — note that it currently allows only the three shipped presets, not `auto`.

## License

MIT
