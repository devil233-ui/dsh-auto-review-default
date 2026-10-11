/**
 * dsh-auto-review-default
 *
 * Put sessions into the experimental `auto` permission preset (Auto review)
 * instead of the profile's configured default preset:
 *
 *  - every newly created session starts in Auto;
 *  - every restored (resumed) root session is switched to Auto as it is loaded.
 *
 * Delegated subagent children are never touched: their parent's delegation
 * fixed their policy, and Auto's `ask` policy would surface child approvals to
 * the human mid-delegation.
 *
 * Why this exists
 * ---------------
 * `@deepseek-ai/dsh-permission-presets` deliberately keeps `auto` out of its
 * `permission` settings schema, so General settings can never offer it as the
 * new-session default: the preset is contributed by the Auto review
 * integration only while that integration is alive, and `defaultSettings()`
 * rejects any default that is not a configured table entry. Per session the
 * user can pick it (composer control, or `/permission auto`), but nothing makes
 * it the default.
 *
 * Where to hook
 * -------------
 * `PermissionPresetService#pinInitialPermission(session)` is the single place
 * that decides a session's initial permission: the service calls it from its
 * own `session/created` listener — for every session that enters the store,
 * freshly created or restored — and once per session already live at mount
 * time. Wrapping that one method is therefore narrower and more reliable than
 * registering a competing `session/created` listener, which would depend on
 * listener ordering to still observe a fresh session as empty.
 *
 * Sessions already live when this plugin mounts are deliberately left alone:
 * this plugin acts on creation and on restore only, so a session you are
 * working in keeps its preset until it is reopened.
 *
 * Safety properties
 * -----------------
 *  - Never throws. A synchronous throw inside `session/created` vetoes and
 *    rolls back session publication, so every failure here degrades to the
 *    stock behaviour: whatever preset the session already had.
 *  - Never touches delegated subagent children (`origin: "subagent"`, or a
 *    positive `delegationDepth`), or scheduled-task runner sessions
 *    (`dsh-automation-session-*`), which keep the preset their task or
 *    delegation was configured with.
 *  - Idempotent, and reversible through the Cordis effect disposer.
 *  - Degrades to stock behaviour when the Auto integration is absent or its
 *    admission check fails.
 */

/** Cordis plugin name used by loader diagnostics. */
const name = 'auto-review-default';

/** The permission-presets service must exist before any session can be adopted. */
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
 * Whether this session is genuinely new: an empty log. Read before the original
 * pins anything, because pinning appends events and advances `session.seq`.
 * Used for log wording only; adoption does not depend on it.
 */
function isFresh(session) {
  try {
    return session.seq === 0;
  } catch {
    return false;
  }
}

/**
 * Sessions created by scheduled-task runners keep the preset their task was
 * configured with: a run that is meant to execute unattended (typically with
 * `approval: "never"`) must not be flipped to Auto, whose `ask` policy would
 * turn every step into an approval prompt nobody may be there to answer.
 * `@michengai/dsh-automation` names every run session with this fixed prefix.
 */
const AUTOMATION_SESSION_PREFIX = 'dsh-automation-session-';

/**
 * Whether this session is a delegated subagent child, which keeps the policy
 * its parent's delegation fixed. `dsh-subagent` stamps `origin: "subagent"` and
 * a positive `delegationDepth`; persistence writes `delegationDepth: 0` for
 * root sessions, so only a positive depth means a child. An unreadable header
 * counts as a child: leave it alone rather than guess.
 */
function isDelegatedChild(session) {
  try {
    const header = session.header;
    if (header === null || header === undefined) return true;
    if (header.origin === 'subagent') return true;
    return (header.delegationDepth ?? 0) > 0;
  } catch {
    return true;
  }
}

/** Whether this session belongs to a scheduled-task runner. */
function isRunnerSession(session) {
  try {
    return String(session?.id ?? '').startsWith(AUTOMATION_SESSION_PREFIX);
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

/** Wrap the initial-permission pin so root sessions adopt Auto. */
function apply(ctx) {
  const service = ctx.permissionPresets;
  const original = service?.pinInitialPermission;
  if (typeof original !== 'function') {
    log(ctx, 'warn', 'auto-review-default: permissionPresets.pinInitialPermission is unavailable; leaving the configured default preset alone');
    return;
  }

  /**
   * Move one root session onto Auto. Never throws: an unavailable Auto
   * integration, a failed admission check or a missing projection only logs.
   */
  const adopt = (session, wording) => {
    if (isDelegatedChild(session)) return;
    if (isRunnerSession(session)) return;
    try {
      if (service.current(session) === AUTO_PRESET) return;
      service.set(session, AUTO_PRESET);
      log(ctx, 'info', `auto-review-default: session "${idOf(session)}" ${wording} preset "${AUTO_PRESET}"`);
    } catch (error) {
      log(ctx, 'warn', `auto-review-default: preset "${AUTO_PRESET}" unavailable for session "${idOf(session)}"; kept its current preset (${describe(error)})`);
    }
  };

  const wrapped = function pinInitialPermission(session) {
    // Freshness must be read before the original pins anything, because pinning
    // appends events and therefore advances `session.seq`.
    const fresh = isFresh(session);
    const result = original.call(this, session);
    adopt(session, fresh ? 'starts in' : 'was switched to');
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
    log(ctx, 'info', `auto-review-default: sessions adopt preset "${AUTO_PRESET}" on creation and on restore`);
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
