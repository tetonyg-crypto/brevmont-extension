#!/usr/bin/env node
/**
 * Tool: verify-registry-sync.js
 * Purpose: Verify that brevmont-api extension_versions registry latest row
 *          matches the version in package.json. Run before publishing a
 *          release to catch the kind of drift the 2026-04-30 audit caught
 *          (registry was on 1.9.2 while shipped build was 1.10.4).
 *
 * Inputs:
 *   - package.json version (read from disk)
 *   - extension_versions table (read via Supabase REST, service role)
 *
 * Outputs:
 *   - exit 0 if registry latest === package.json version
 *   - exit 1 with a clear message if they diverge
 *
 * Dependencies:
 *   - Node 18+ for fetch built-in
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env
 *
 * Last Updated: 2026-04-30
 * Changelog:
 *   - 2026-04-30: Initial creation per Wave 1.6 of audit execution sprint.
 *     Closes audit 04 H1 (stale extension version registry).
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..');

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  if (!pkg.version) {
    throw new Error('package.json has no version field');
  }
  return pkg.version;
}

async function fetchRegistryLatestRows() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  // No `limit` filter on purpose. We must see every is_latest=true row so
  // multi-latest corruption surfaces as a release-blocker, not a silent pass.
  const res = await fetch(
    `${url}/rest/v1/extension_versions?select=version,is_latest,deprecated&is_latest=eq.true`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) {
    throw new Error(`registry query failed: ${res.status} ${res.statusText}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('extension_versions has no is_latest=true row');
  }
  return rows;
}

async function main() {
  const pkgVersion = readPackageVersion();
  const rows = await fetchRegistryLatestRows();

  // Corruption guard. Exactly one row must be is_latest=true.
  if (rows.length > 1) {
    const versions = rows.map((r) => r.version).join(', ');
    console.error(
      `REGISTRY CORRUPTION: ${rows.length} rows have is_latest=true. Versions seen: ${versions}.\n` +
        `\n` +
        `The registry must have exactly one latest row. Fix in the database before releasing.\n` +
        `Set is_latest=false on every row except the genuine current release.\n`
    );
    process.exit(1);
  }

  const latest = rows[0];

  if (latest.version !== pkgVersion) {
    console.error(
      `REGISTRY DRIFT: package.json says ${pkgVersion}, registry latest is ${latest.version}.\n` +
        `\n` +
        `Reps reading the registry would download the wrong version.\n` +
        `\n` +
        `Fix:\n` +
        `  1. Insert a new extension_versions row with version="${pkgVersion}", is_latest=true, is_minimum=true.\n` +
        `  2. Update the previous latest row to is_latest=false (and deprecated=true if appropriate).\n`
    );
    process.exit(1);
  }

  if (latest.deprecated) {
    console.error(
      `REGISTRY DRIFT: latest row is marked deprecated=true. Releases cannot ship a deprecated build as latest.`
    );
    process.exit(1);
  }

  console.log(`Registry sync OK: package.json ${pkgVersion} matches registry latest, single is_latest row.`);
}

main().catch((err) => {
  console.error(`verify-registry-sync failed: ${err.message}`);
  process.exit(1);
});
