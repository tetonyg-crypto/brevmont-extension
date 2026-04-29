/**
 * Tool: dev.ts
 * Purpose: Production-stripped console wrappers. In dev builds these forward
 *   to console.log/info/debug. In production builds Vite/WXT replaces
 *   `import.meta.env.DEV` with the literal `false` at transform time and
 *   terser eliminates the dead branch entirely. The shipped bundle never
 *   contains a console.log or console.info or console.debug call from
 *   our code.
 * Inputs: same as console.* — variadic args
 * Outputs: nothing in prod; console output in dev
 * Dependencies: import.meta.env.DEV (set by Vite/WXT at build time)
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation — extension hardening sprint (E4)
 *   - 2026-04-29: Move IS_DEV check inline so terser DCE strips the
 *                 console call entirely (the IIFE pattern survived
 *                 minification and left console.log(...args) in prod).
 *
 * Why: 36 console.log/info/debug calls scattered across background.ts and
 * content.ts. They printed "[Brevmont] ..." status to the user's devtools
 * console — fine in dev, looks unprofessional in prod. console.warn and
 * console.error are intentionally NOT wrapped — those are for things we
 * want surfaced in prod.
 */

export function dlog(...args: unknown[]): void {
  // Vite static-replaces import.meta.env.DEV with `false` in production
  // builds. terser collapses `if (false) ...` to nothing, the function
  // body becomes empty, and downstream call sites become no-ops.
  if (import.meta.env.DEV) console.log(...args);
}

// dinfo / ddebug intentionally not exported — no call sites in current
// codebase. If we ever need them, mirror dlog with console.info/debug.
