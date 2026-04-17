/**
 * Brevmont Supabase Logging Test
 * 1. POSTs a test generation_event to Supabase (same payload as the extension)
 * 2. Queries it back to verify the row exists with correct data
 * 3. Reports pass/fail
 *
 * Run: node test-supabase-logging.js
 */

const SUPABASE_URL = 'https://mqnmemnogbotgmsmqfie.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-sD_RSqo9SNizbhQ0kqWSA_tJbsWD_m';

const testEvent = {
  session_id: `ext-test-${Date.now()}`,
  rep_name: 'Jane Smith',
  dealership: "ABC Motors",
  input: 'TEST: new lead walked in, interested in 2025 Tahoe Z71',
  output: 'TEXT\nHey Michael, great meeting you today. The 2025 Tahoe Z71 is a solid choice with the magnetic ride and off-road package. When works best to come take it for a spin?\n\nEMAIL\nSubject: 2025 Chevrolet Tahoe Z71\n\nMichael, it was great meeting you at ABC Motors today. The 2025 Tahoe Z71 you looked at is one of the best-equipped trucks on the lot. I\'d love to get you behind the wheel for a test drive.\n\nJane Smith\nSales Consultant\nABC Motors\n555-123-4567\n\nCRM NOTE\n04/01/26 Walk-in Jane Smith\nContact Type: Walk-in\nSummary: Customer came in interested in 2025 Tahoe Z71.\nVehicle Interest: 2025 Chevrolet Tahoe Z71\nIntent Level: Hot\nAction Taken: Showed vehicle, discussed features\nNext Step: Follow up tomorrow for test drive\nNotes: None',
  has_text: true,
  has_email: true,
  has_crm: true,
  workflow_type: 'all',
  customer_name: 'Michael Johnson',
  vehicle: '2025 Chevrolet Tahoe Z71',
};

async function run() {
  console.log('='.repeat(60));
  console.log('OPER8ER SUPABASE LOGGING TEST');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: POST the test event
  console.log('1. POSTing test generation_event to Supabase...');
  const postResp = await fetch(`${SUPABASE_URL}/rest/v1/generation_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(testEvent)
  });

  if (!postResp.ok) {
    const errText = await postResp.text();
    console.log(`  FAIL — POST returned ${postResp.status}: ${errText}`);
    process.exit(1);
  }

  const inserted = await postResp.json();
  console.log(`  OK — Row inserted. ID: ${inserted[0]?.id || 'unknown'}`);
  console.log(`  session_id: ${inserted[0]?.session_id}`);
  console.log('');

  // Step 2: Query it back
  console.log('2. Querying back by session_id...');
  const getResp = await fetch(
    `${SUPABASE_URL}/rest/v1/generation_events?session_id=eq.${testEvent.session_id}&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }
  );

  if (!getResp.ok) {
    const errText = await getResp.text();
    console.log(`  FAIL — GET returned ${getResp.status}: ${errText}`);
    process.exit(1);
  }

  const rows = await getResp.json();
  if (rows.length === 0) {
    console.log('  FAIL — No row found after insert');
    process.exit(1);
  }

  const row = rows[0];
  console.log(`  OK — Row found.`);
  console.log('');

  // Step 3: Verify fields
  console.log('3. Verifying field values...');
  const checks = [
    ['rep_name', row.rep_name, testEvent.rep_name],
    ['dealership', row.dealership, testEvent.dealership],
    ['customer_name', row.customer_name, testEvent.customer_name],
    ['vehicle', row.vehicle, testEvent.vehicle],
    ['has_text', row.has_text, testEvent.has_text],
    ['has_email', row.has_email, testEvent.has_email],
    ['has_crm', row.has_crm, testEvent.has_crm],
    ['workflow_type', row.workflow_type, testEvent.workflow_type],
  ];

  let allPass = true;
  checks.forEach(([field, actual, expected]) => {
    const ok = actual === expected;
    if (!ok) allPass = false;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${field}: ${JSON.stringify(actual)} ${ok ? '==' : '!='} ${JSON.stringify(expected)}`);
  });

  // Also check created_at is today
  const today = new Date().toISOString().split('T')[0];
  const createdToday = row.created_at?.startsWith(today);
  if (!createdToday) allPass = false;
  console.log(`  ${createdToday ? 'PASS' : 'FAIL'}  created_at starts with ${today}: ${row.created_at?.slice(0, 10)}`);

  console.log('');
  console.log('='.repeat(60));
  console.log(allPass ? 'RESULT: ALL CHECKS PASSED — Logging works end-to-end' : 'RESULT: SOME CHECKS FAILED');
  console.log('='.repeat(60));

  // Step 4: Query today's events count for dashboard context
  console.log('');
  console.log('4. Checking today\'s total events for dashboard...');
  const todayResp = await fetch(
    `${SUPABASE_URL}/rest/v1/generation_events?created_at=gte.${today}T00:00:00&order=created_at.desc&limit=100`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }
  );
  const todayEvents = await todayResp.json();
  console.log(`  Total events today: ${todayEvents.length}`);
  if (todayEvents.length > 0) {
    console.log('  Most recent:');
    todayEvents.slice(0, 5).forEach(e => {
      console.log(`    ${e.created_at?.slice(11, 19)} | ${e.rep_name} → ${e.customer_name} | ${e.vehicle} | ${e.workflow_type}`);
    });
  }
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
