# dsh-auto-review-default

English | [中文](README.md)

Starts every **newly created** DeepSeek Harness session in the built-in `auto` permission preset (Auto review) instead of the profile's configured default preset.

## The gap it fills

DSH deliberately keeps Auto out of the new-session default. From the shipped documentation:

- `@deepseek-ai/dsh-permission-presets`: "**Auto cannot be the default**: it exists only while its integration effect is alive, and it deliberately does not enter the `permission` settings schema."
- `@deepseek-ai/dsh-client-ui-permission-presets`: "session-only contributions such as `auto` do not appear [in the settings row]" and "**Auto review is current-session only** — the General Settings row deliberately omits it."

So the General settings permission dropdown only ever lists the configured presets, and Auto has to be selected session by session (the composer's permission control, or `/permission auto`).

The shipped `@deepseek-ai/dsh-experimental-auto-review` layer must be enabled for this plugin to have a target to switch to.

## Install

```sh
dsh plugin --profile web add dsh-auto-review-default        # once published to npm
dsh plugin --profile web add github:devil233-ui/dsh-auto-review-default
```

Replace `web` with your profile name (DSH Desktop uses `desktop`). Restart DSH afterwards so the host reloads its bundles.

## How it works

The single place that decides a session's initial permission is `PermissionPresetService#pinInitialPermission(session)`: the service calls it from its own `session/created` listener and once for every session already live at mount time. This plugin wraps that one method, which is narrower than registering a competing `session/created` listener and does not depend on listener ordering — hooking the same method is also what makes `session.seq === 0` (a genuinely new, empty session) observable *before* the original writes any event.

This does wrap a host-internal method rather than an official extension point; see the limitations below.

## Safety properties

- **Never throws.** A synchronous throw inside `session/created` vetoes and rolls back session publication, so every failure here degrades to the stock behaviour — the configured default preset — and only writes a warning line.
- **Only touches brand-new sessions** (`session.seq === 0`, no `parentSession`, not `isSeeded`). Resumed, forked, seeded, delegated-child and already-started sessions keep whatever they carried.
- **Idempotent**, reversible through the Cordis effect disposer, and degrades automatically when Auto is unavailable.

## Verification

Measured in an isolated `headless` profile with one-shot tasks, reading the session projection cache's `permissions` value:

| Scenario | Result |
|---|---|
| New session with the plugin | `preset: "auto"` (sandbox `danger-full-access` + approval `ask`) |
| New session without it (baseline) | `preset: "workspace-write"` |
| Resuming an old session with it | still `workspace-write`, untouched |
| Full task runs | completed normally; session publication never vetoed |

Verified on DSH Desktop `0.2.0-rc.2`.

## Uninstall

```sh
dsh plugin --profile web remove dsh-auto-review-default
```

Takes effect after a restart. Sessions currently in Auto are left alone.

## Known limitations

- **Auto is experimental**: it can allow unsafe actions, deny useful ones, and it adds one extra model request per supported tool call (no caching, no retries). This plugin only makes it the default; it does not change how Auto behaves.
- **It wraps a host-internal method name.** If DSH renames `pinInitialPermission`, the plugin **silently stops applying** (sessions fall back to the configured preset) — it never errors and never breaks startup. If new sessions stop starting in Auto after an upgrade, look here first.
- Requires the shipped `@deepseek-ai/dsh-experimental-auto-review` layer to be enabled; the plugin degrades on its own when it is not.
- No per-workspace or per-Agent rules. For that granularity use [`dsh-workspace-tools`](https://github.com/AHIOSUZ/dsh-workspace-tools) — note that it currently allows only the three shipped presets, not `auto`.

## License

MIT
