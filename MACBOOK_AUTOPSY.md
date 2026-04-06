# MACBOOK BUILD FAILURE — FORENSIC AUTOPSY

**Date:** 2026-04-06
**Investigated by:** Claude Code (Opus 4.6)
**Scope:** Why did oper8er-v2 fail to build/load after `git pull` on Yancy's MacBook Air?

---

## Timeline Reconstruction

| Date | Event | Machine | Evidence |
|------|-------|---------|----------|
| Apr 3-4 | Rapid development v1.7.3 through v1.8.0 (10 commits in 20 hours) | MacBook | Commits `9f8e37b` through `6baa43c` — MacBook branch diverged from PC |
| Apr 4 | PC had its own commits (diagnostic audit fixes) diverging from MacBook | PC | Commit `0943a57` (fixes 4-7, 8-10 from diagnostic audit) |
| Apr 4 17:32 | Merge commit `3d57801` — "merge: MacBook v1.8.0 + working SPA observer" | PC | Merged MacBook's `6baa43c` into PC's `85ee3e3`. Changed 4 files, +891/-116 lines |
| Apr 4 17:45 | Second merge `fd2c1c5` — pull from origin after push | PC | Pulled MacBook-pushed `ae3f1b9` (v1.8.1) into local. Created merge commit |
| Apr 4 17:45 | `stash@{0}` created: "WIP on main: fd2c1c5" | PC | Stash exists — interrupted work during merge window |
| Apr 4-5 | package-lock.json modified in commit `0943a57` (diagnostic audit) | PC | First lockfile churn — npm resolved differently on PC |
| Apr 5 | package-lock.json modified again in `7d4bcaa` (v1.8.5 UI overhaul) | PC | Second lockfile modification |
| Apr 5 | package-lock.json modified third time in `69accba` (safeguards commit) | PC | Third modification — engines field added |
| Apr 5 22:24 | Safeguards shipped: `.nvmrc`, `.npmrc`, `setup.sh`, `.githooks/post-merge`, `.gitattributes` | PC | Commits `69accba`, `8ada7c6`, `172ed58` |

**Key observation:** The MacBook was at commit `6baa43c` (v1.8.0) when it last had a working build. After that, all development moved to the PC. The next time the MacBook pulled, it received 20+ commits including three lockfile rewrites, two merge commits, and massive content.ts changes.

---

## Root Causes (Ranked by Probability)

### #1: Node/npm Version Mismatch (HIGH CONFIDENCE)

**Evidence:**
- PC environment: Node v24.14.0, npm 11.9.0 (documented in CLAUDE.md line 265)
- MacBook environment: Unknown Node version — no `.nvmrc` existed before commit `69accba` (Apr 5)
- Session transcript explicitly identifies this: "If your MacBook has a different Node/npm version, `npm install` will either rewrite the lockfile (creating merge conflicts later) or fail on incompatible dependency resolutions"
- Session transcript also states: "Node 24 is cutting-edge. If one machine has Node 24 and the other has Node 20 or 22, npm versions will differ"
- `package-lock.json` uses lockfileVersion 3, which requires npm 7+. An older npm would silently rewrite it to lockfileVersion 1, causing massive dependency drift
- The lockfile was modified 3 times on the PC between the MacBook's last working state and the pull that broke

**What likely happened:** MacBook had Node 20 or 22 (not 24). Running `npm install` after pull either (a) failed outright on incompatible peer deps enforced by npm 11 but not npm 10, or (b) silently rewrote the lockfile, pulling wrong dependency versions, causing WXT build to fail.

**Safeguard coverage:**
| Safeguard | Addresses this? | How |
|-----------|----------------|-----|
| `.nvmrc` | YES | `nvm use` auto-switches to 24.14.0 |
| `.npmrc` (engine-strict) | YES | Hard-fails `npm install`/`npm ci` if Node != 24.x |
| `package.json` engines | YES | Declares `>=24.0.0` requirement |
| `setup.sh` | YES | Checks Node major version, exits with clear error if wrong |

### #2: Stale Build Artifacts (.wxt/ and .output/ cache poisoning) (MEDIUM CONFIDENCE)

**Evidence:**
- MACBOOK_DIAGNOSTIC_REPORT.md (line 12-13) shows two separate copies of the extension existed on the MacBook: `floq-extension/` (source with `.output/`) and `floq-chrome-mv3/` (flat copy of build output)
- The MacBook had a working `.output/chrome-mv3/` from the v1.8.0 build. After pulling 20+ commits with major content.ts restructuring, WXT's incremental build cache (`.wxt/`) would contain stale TypeScript compilation artifacts
- Session transcript prescribes: "Nuke all build artifacts and deps: `rm -rf node_modules .wxt .output`" — this fix implies stale artifacts were a known failure vector
- WXT's `.wxt/` directory contains compiled TypeScript module graphs. A version jump from 1.8.0 to 1.9.0 with 891 lines of changes would invalidate the cache but WXT may not detect all stale entries

**What likely happened:** After `git pull`, the working tree updated but `.wxt/` retained cached compilation from v1.8.0. Running `npm run build` or `npx wxt build` used stale cached modules that referenced old function signatures (e.g., `detectPlatform()` was inlined in v1.8.4 commit `5c2cbc0`), producing a broken build that Chrome rejected.

**Safeguard coverage:**
| Safeguard | Addresses this? | How |
|-----------|----------------|-----|
| `setup.sh` | YES | `rm -rf node_modules .wxt .output` before build |
| `.githooks/post-merge` | YES | Nukes `.wxt .output` on source file changes, nukes `node_modules .wxt .output` on lockfile changes |
| `npm run fresh` | YES | `clean && npm ci && build` |

### #3: CRLF Line Ending Corruption on Shell Scripts (MEDIUM-LOW CONFIDENCE)

**Evidence:**
- Commit `8ada7c6` (Apr 5) explicitly adds `.gitattributes` with `* text=auto eol=lf` and forces LF on `*.sh` and `.githooks/*`
- The commit message states: "Forces LF on all text files, especially shell scripts and git hooks which break on Mac with CRLF endings"
- Commit `172ed58` adds `chmod +x .githooks/*` to `setup.sh` because the executable bit doesn't survive Windows-to-Mac crossing
- Before these safeguards, any shell script or git hook created on Windows would have CRLF line endings, causing `/bin/bash^M: bad interpreter` errors on macOS

**What likely happened:** This is a compounding factor, not the primary cause. If Yancy tried to run a build script or if git hooks existed before the safeguards, CRLF corruption would have caused confusing failures. However, the `.githooks/` directory and `setup.sh` didn't exist until after the failure was already diagnosed, so CRLF was a future risk that was preemptively addressed, not the original failure trigger.

**Safeguard coverage:**
| Safeguard | Addresses this? | How |
|-----------|----------------|-----|
| `.gitattributes` | YES | Forces LF on all text files |
| `setup.sh` | YES | `chmod +x .githooks/*` for fresh clones |
| Commit `172ed58` | YES | Sets executable bit on post-merge in git index |

---

## Additional Contributing Factors

### Divergent Branch History

The MacBook branch diverged from the PC branch around v1.7.2, accumulated 10 rapid commits (v1.7.3 through v1.8.0), then was merged back. The merge commit `3d57801` touched 4 files with +891/-116 lines. A second merge `fd2c1c5` followed 13 minutes later. This created a complex merge history where the MacBook's local state was significantly behind the PC's post-merge state.

### Multiple Extension Copies on MacBook

The MACBOOK_DIAGNOSTIC_REPORT.md documents 4 separate extension directories on the MacBook:
1. `/Users/yancygarcia/Desktop/floq-extension/` (v1.8.0, git-tracked, correct)
2. `/Users/yancygarcia/Desktop/floq-chrome-mv3/` (v1.8.0, flat copy of build)
3. `/Users/yancygarcia/Desktop/floq-extension-v1.0.1-local/` (v1.0.1, ancient stale)
4. `/Users/yancygarcia/oper8er-extension/` (v1.0.0, obsolete)

Chrome Profile 2 was loading from `floq-chrome-mv3` (the flat copy), not from the git repo's `.output/` directory. After a `git pull && npm run build`, the updated build goes to `.output/chrome-mv3/` but Chrome was still pointing at the old flat copy. This means even a successful build would appear broken in Chrome.

### Lockfile Churn

`package-lock.json` has only 4 commits in its entire history:
1. `a1fd3c4` — initial (Floq v1.2.0 production)
2. `0943a57` — diagnostic audit fixes (Apr 4)
3. `7d4bcaa` — v1.8.5 UI overhaul (Apr 5)
4. `69accba` — safeguards commit (Apr 5)

Three of those four happened within 24 hours on the PC after the MacBook's last working state. Each modification means npm resolved the dependency tree slightly differently, compounding the Node version mismatch risk.

---

## Safeguard Assessment

### What Is Covered

| Risk | Safeguard | Status |
|------|-----------|--------|
| Wrong Node version | `.nvmrc` + `.npmrc` engine-strict + `setup.sh` check | COVERED |
| Stale `.wxt/` cache | `setup.sh` + post-merge hook nuke artifacts | COVERED |
| Stale `node_modules/` | `setup.sh` + post-merge hook `npm ci` | COVERED |
| CRLF line endings on Mac | `.gitattributes` eol=lf | COVERED |
| Shell script not executable | `setup.sh` chmod + git index executable bit | COVERED |
| Lockfile drift from `npm install` | `npm ci` enforced in setup.sh and post-merge | COVERED |

### Remaining Gaps

**Gap 1: Chrome loading from wrong directory.** No safeguard addresses the fact that Chrome Profile 2 on the MacBook was loading the extension from `~/Desktop/floq-chrome-mv3/` (a flat copy) instead of the git repo's `.output/chrome-mv3/`. After a successful build, Yancy would still see the old version unless he manually repoints Chrome or copies the build output.

**Recommendation:** Add a post-build step to `setup.sh` that prints the exact path Chrome should load from, or add a script that syncs `.output/chrome-mv3/` to the flat copy directory if it exists:
```
if [ -d "$HOME/Desktop/floq-chrome-mv3" ]; then
  echo "WARNING: Chrome may be loading from ~/Desktop/floq-chrome-mv3/"
  echo "Update Chrome to load from: $(pwd)/.output/chrome-mv3"
fi
```

**Gap 2: No `nvm use` auto-trigger.** The `.nvmrc` file exists, but `nvm use` must be run manually (or configured in the shell profile with `cdnvm` / auto-use). If Yancy opens a terminal and runs `git pull` without first running `nvm use`, the post-merge hook will execute with whatever Node version is active. If that version is wrong, `npm ci` will fail (thanks to engine-strict), but the error may be confusing in the context of an auto-triggered hook.

**Recommendation:** Add a Node version check to the top of `.githooks/post-merge`:
```bash
CURRENT_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$CURRENT_MAJOR" != "24" ]; then
  echo "ERROR: Node 24.x required. Run: nvm use"
  exit 1
fi
```

**Gap 3: No post-merge hook activation on first pull.** The `core.hooksPath` is set by `npm run prepare` (which runs after `npm install`/`npm ci`) and by `setup.sh`. But on first pull, before running setup, the hooks directory is not active. The post-merge hook won't fire for the very pull that brings it in. This is a one-time bootstrap problem — subsequent pulls are covered.

**Recommendation:** Already mitigated by `setup.sh` being the documented first step. The `prepare` script in package.json also sets hooks path after `npm ci`. No additional action needed as long as documentation says "run `bash setup.sh` after first clone/pull."

**Gap 4: Stale flat copy directories not cleaned up.** Three obsolete extension directories still exist on the MacBook (`floq-extension-v1.0.1-local/`, `oper8er-extension/`, and the flat `floq-chrome-mv3/` copy). These create confusion about which directory is authoritative.

**Recommendation:** On next MacBook session, delete: `~/Desktop/floq-extension-v1.0.1-local/`, `~/oper8er-extension/`, and optionally `~/Desktop/floq-chrome-mv3/` (after repointing Chrome to load from the git repo's `.output/chrome-mv3/`).

---

## Summary

The build failure was most likely caused by **Node version mismatch** (Root Cause #1) compounded by **stale WXT build cache** (Root Cause #2). The MacBook was running an older Node while the PC had moved to v24.14.0 with npm 11.9.0. After pulling 20+ commits that included 3 lockfile rewrites, `npm install` either failed on engine requirements or silently produced a broken dependency tree. Even if deps installed correctly, the `.wxt/` cache from v1.8.0 would have poisoned the v1.9.0 build.

The safeguards added in commits `69accba`, `8ada7c6`, and `172ed58` address all three root causes. The remaining gaps (Chrome loading from wrong directory, no auto-nvm-use, stale flat copies) are operational issues that should be resolved on the next MacBook session.
