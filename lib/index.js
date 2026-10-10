/**
 * dsh-auto-review-default
 *
 * Make every genuinely new session start in the experimental `auto` permission
 * preset (Auto review) instead of the profile's configured default preset.
 *
 * Why this exists
 * ---------------
 * `@deepseek-ai/dsh-permission-presets` deliberately keeps `auto` out of its
 * `permission` settings schema, so General settings can never offer it as the
 * new-session default: the preset is contributed by the Auto review integration
 * only while that integration is alive, and `defaultSettings()` rejects any
 * default that is not a configured table entry. Per session the user can pick
 * it (composer control, or `/permission auto`), but every new session starts on
 * the configured preset again.
 *
 * Where to hook
 * -------------
 * `PermissionPresetService#pinInitialPermission(session)` is the single place
 * that decides a session's initial permission: the service calls it from its
 * own `session/created` listener and once per session already live at mount
 * time. Wrapping that one method is therefore narrower and more reliable than
 * registering a competing `session/created` listener, which would depend on
 * listener ordering to still observe the session as empty.
 *
 * Safety properties
 * -----------------
 *  - Never throws. A synchronous throw inside `session/created` vetoes and
 *    rolls back session publication, so every failure here degrades to the
 *    stock behaviour: the configured default preset.
 *  - Only brand-new sessions are touched (`session.seq === 0`, i.e. an empty
 *    log). Resumed, restored, seeded, forked and delegated-child sessions keep
 *    whatever they already carried.
 *  - Idempotent, and reversible through the Cordis effect disposer.
 */

/** Cordis plugin name used by loader diagnostics. */
const name = 'auto-review-default';

/** The permission-presets service must exist before an initial permission can be changed. */
const inject = ['permissionPresets'];

/** The fixed experimental preset contributed by the Auto review integration. */
const AUTO_PRESET = 'auto';

/** Marks a service instance this plugin already wrapped. */
const WRAPPED = Symbol.for('dsh-auto-review-default/wrapped');

/** Render one unknown thrown value as text. */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Log one line; logging must never be able to veto a session. */
function log(ctx, level, message) {
  try {
    ctx.logger?.[level]?.(message);
  } catch {
    /* a logger failure is never a reason to fail a session */
  }
}

/**
 * Whether this session is genuinely new: an empty log, with no fork seed and no
 * delegating parent. Read before the original pins anything, because pinning
 * appends events and advances `session.seq`.
 */
function isFresh(session) {
  try {
    if (session.seq !== 0) return false;
    const header = session.header;
    if (header === null || header === undefined) return false;
    return header.parentSession === undefined && header.isSeeded !== true;
  } catch {
    return false;
  }
}

/** Render a session id for a log line without trusting the accessor. */
function idOf(session) {
  try {
    return String(session?.id);
  } catch {
    return '<unknown>';
  }
}

/** Wrap the initial-permission pin so fresh sessions start in Auto. */
function apply(ctx) {
  const service = ctx.permissionPresets;
  const original = service?.pinInitialPermission;
  if (typeof original !== 'function') {
    log(ctx, 'warn', 'auto-review-default: permissionPresets.pinInitialPermission is unavailable; leaving the configured default preset alone');
    return;
  }

  const wrapped = function pinInitialPermission(session) {
    const fresh = isFresh(session);
    const result = original.call(this, session);
    if (!fresh) return result;
    try {
      if (this.current(session) === AUTO_PRESET) return result;
      this.set(session, AUTO_PRESET);
      log(ctx, 'info', `auto-review-default: session "${idOf(session)}" starts in preset "${AUTO_PRESET}"`);
    } catch (error) {
      log(ctx, 'warn', `auto-review-default: preset "${AUTO_PRESET}" unavailable for session "${idOf(session)}"; kept the configured default (${describe(error)})`);
    }
    return result;
  };

  ctx.effect(() => {
    try {
      service.pinInitialPermission = wrapped;
      service[WRAPPED] = true;
    } catch (error) {
      log(ctx, 'warn', `auto-review-default: could not wrap the initial-permission pin (${describe(error)})`);
      return;
    }
    log(ctx, 'info', `auto-review-default: new sessions will start in preset "${AUTO_PRESET}"`);
    return () => {
      try {
        if (service.pinInitialPermission === wrapped) service.pinInitialPermission = original;
        service[WRAPPED] = false;
      } catch {
        /* disposal is best-effort */
      }
    };
  }, 'auto-review-default: initial permission');
}

export { apply, inject, name };
