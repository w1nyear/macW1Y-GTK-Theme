/**
 * Logger for the modules that have no settings of their own. extension.js
 * hands in the shared Logger so that their output follows `output-logs` like
 * everything else.
 */
type UtilsLogger = { log: (...args: any[]) => void, readonly enabled?: boolean };
export let _utilsLogger: UtilsLogger | null = null;
export function setUtilsLogger(logger: UtilsLogger | null): void {
  _utilsLogger = logger;
}

export function utilsLog(msg: string): void {
  _utilsLogger?.log(msg);
}

/**
 * Output the user asked for explicitly (Looking Glass diagnostics, the dump
 * shortcut), so it is not gated on `output-logs`.
 */
export function diagnosticLog(msg: string): void {
  console.log(msg);
}

// Reports an exception that escaped a per-frame sync loop. Not gated on
// `output-logs`, since it means a glass stopped following its target, and
// rate-limited per tag, since the cause usually repeats every frame.
const _frameLoopErrorLastLogged: Map<string, number> = new Map();
const FRAME_LOOP_ERROR_LOG_INTERVAL_MS = 5000;
export function reportFrameLoopError(tag: string, e: unknown): void {
  const now = Date.now();
  const last = _frameLoopErrorLastLogged.get(tag) ?? 0;
  if (now - last < FRAME_LOOP_ERROR_LOG_INTERVAL_MS) return;
  _frameLoopErrorLastLogged.set(tag, now);
  const stack = e instanceof Error && e.stack ? `\n${e.stack}` : '';
  console.error(`[Liquid Glass] exception in ${tag} frame sync: ${e}${stack}`);
}
