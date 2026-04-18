# PARALLEL EXECUTION RULES

Multiple Claude Code sessions are working on the Brevmont codebase simultaneously.
Read this BEFORE any tool use.

## The rules

1. **Stay in your repo.** You are scoped to exactly ONE repo/directory. If a file path you're about to edit is not inside your repo's root, STOP and ping Telegram. Do not edit it. Do not read it. Do not create it.

2. **One session owns migrations. That session is the BACKEND worker, and only the backend worker.** If you are NOT the backend worker, you must NOT:
   - Create files under `migrations/`
   - Run Supabase CLI migration commands
   - Edit any SQL schema
   - Even if it seems necessary, STOP and ping Telegram with the request.

3. **If you see a build error in a file you did NOT edit, do not try to fix it.** Wait 30 seconds, then retry your own task. Another agent is likely mid-edit.

4. **No shared env file edits.** Each worker operates on its own repo's `.env` ONLY. You may not edit env vars that live in a different repo. If coordination is needed, ping Telegram.

5. **No Vercel, no new deployments, no hosting migrations.** If you find yourself wanting to "deploy to Vercel" or "create a new Vercel project" or "migrate to..." — STOP. Commit your changes to git. The existing CI/CD will redeploy. Do NOT run `vercel deploy`. Do NOT create new deployment targets.

6. **Commit in your own branch.** Create a branch `onboarding-20260417-{your-worker-name}` at the start of your sprint. Push commits to that branch. Open a draft PR when done. DO NOT merge.

7. **Ping Telegram on phase start, phase completion, errors, and unexpected scope creep.** Use the wrapper script at `.scripts/tg.sh` that will be in the root of your repo (or create it — §0b below).

8. **Hard scope boundary: if you >5 files changed without an explicit phase in your plan, STOP.** Ping Telegram with a diff summary. The most common failure mode is a session silently committing 30 bad files at 2am.

9. **If tests fail, fix the test if you broke the code it covers. Do NOT delete tests.**

10. **When finished, write a handoff note to `.handoff/{your-worker-name}.md`** — what you did, what branch you pushed, what the next worker depending on you needs to know.
