/**
 * Brevmont Vehicle Detection Test V2
 * Tests extractVehicle() + scanText() against 20 realistic VinSolutions page texts.
 * Includes the REAL failure case: equity line vehicle grabbed instead of actual vehicle.
 * Run: node test-vehicle-detection.js
 */

// ===== EXTRACTED from content.ts =====
const MAKES = 'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';
const STOP_WORDS = 'Created|Attempted|Contacted|Looking|Wants|Also|Stock|Source|Status|miles|General|Customer|Interested|Trade|lineup|options|inventory|Calculated|Equity|Payoff|hover|details|Bad|Sold|Active|Lost';
const POISON_BEFORE = /(?:Equity|Payoff|Trade-in|trade\s+value|Credit)\b[\s\S]{0,50}$/i;
const POISON_AFTER = /^[\s\S]{0,20}(?:Calculated|Payoff|payoff|appraised)/i;

function isPoisoned(text, matchIndex, matchLength) {
  const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 40);
  return POISON_BEFORE.test(before) || POISON_AFTER.test(after);
}

function extractVehicle(text) {
  let vehicle = '';

  // Strategy 1 (BEST): "Vehicle Info" section header
  const vi = text.match(new RegExp('Vehicle Info[\\s\\n]+(20\\d{2}\\s+(?:' + MAKES + ')\\s+[^\\n(]+?)\\s*(?:\\(|\\n|$)', 'i'));
  if (vi) vehicle = vi[1].trim().replace(/\s+/g, ' ').slice(0, 50);

  // Strategy 2: Active row in sales status table — must have tab after "Active"
  if (!vehicle) {
    const activeMatch = text.match(new RegExp('Active\\t[\\s\\S]{0,80}?(20\\d{2}\\s+(?:' + MAKES + ')[^\\t\\n]*)', 'i'));
    if (activeMatch) {
      let v = activeMatch[1].trim().replace(/\s+/g, ' ');
      v = v.replace(new RegExp('\\s+(?:' + STOP_WORDS + ')\\b.*', 'i'), '');
      vehicle = v.slice(0, 50);
    }
  }

  // Strategy 3: "YYYY Make Model..." with poison context filtering (before AND after)
  if (!vehicle) {
    const allMatches = text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')(?:\\s+(?!(?:' + STOP_WORDS + ')\\b)[A-Za-z0-9./-]+){0,5})', 'gi'));
    for (const m of allMatches) {
      if (isPoisoned(text, m.index, m[0].length)) continue;
      vehicle = m[1].trim().replace(/\s+/g, ' ').slice(0, 50);
      break;
    }
  }

  // Strategy 4: "YYYY Make" only
  if (!vehicle) {
    const allMakes = text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + '))', 'gi'));
    for (const m of allMakes) {
      if (isPoisoned(text, m.index, m[0].length)) continue;
      vehicle = m[1].trim().slice(0, 40);
      break;
    }
  }

  // Strategy 5: near "Stock #" or "Vehicle" label
  if (!vehicle) {
    const sv = text.match(/(?:Stock\s*#|Vehicle)\s*:?\s*[\s\S]{0,30}?(20\d{2}\s+\w+\s+[\w-]+)/i);
    if (sv) vehicle = sv[1].trim().slice(0, 50);
  }

  if (vehicle) vehicle = vehicle.replace(/[.,;:!]+$/, '').trim();
  return vehicle;
}

function scanText(text) {
  let name = '';
  const dm = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/);
  if (dm) name = dm[1].trim();
  if (!name) { const im = text.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/); if (im) name = im[1].trim(); }

  let phone = '';
  const pm = text.match(/[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (pm) phone = pm[0].replace(/^[CHW]:\s*/, '');

  let email = '';
  const em = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  if (em) email = em[0];

  const vehicle = extractVehicle(text);

  let source = '';
  const sm = text.match(/Source:\s*(.+)/i);
  if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);

  let status = '';
  const stm = text.match(/Status:\s*(.+)/i);
  if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);

  let lastContact = '';
  const cm = text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i);
  if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);

  return { customerName: name, phone, email, vehicle, source, status, lastContact };
}

// ===== 20 TEST CASES =====
const testCases = [
  {
    id: 1,
    description: 'REAL BUG: Equity line vehicle grabbed instead of actual vehicle (Thomas Smits)',
    expectedName: 'Thomas Smits',
    expectedVehicle: /2024.*Chevrolet.*Silverado.*2500/i,
    text: `Customer Dashboard
Thomas Smits
(Individual)
H: (307) 699-3753
W: (307) 739-4360
C: (307) 699-4364
tomschmits@icloud.com
285 E Karns Ave
Jackson, WY 83001
Equity: $2,620 2014 Chevrolet Equinox Calculated: 03/21/2026 (hover for details)
PO Box 3377
no money down besides trade equity
72 months
$56 in
Sales (7)\tService Lead (48)\tAppts (2)\tWish List\tService (64)\tValue
Status\tBuyer/Co-Buyer\tCreated\tSource\tVehicle
Active\t\t3/3/26\tRepeat Customer\t2024 Chevrolet Silverado 2500HD
Bad\t\t3/7/25\tCm Financial Customer Payoff Request\t2023 Make Unknown M
Sold\tCatherine Smits\t1/25/24\tCM 3rd Party\t2023 Chevrolet Suburban
Bad\t\t12/27/23\tCm Financial Customer Payoff Request\t2023 Make Unknown M
Sold\tCatherine Smits\t7/24/21\tRepeat Customer\t2022 Chevrolet Silverado 2500HD
Lead Info
OEM Lead: 236563992
Status: Active
Sales: unassigned
Rep: Jane Smith
Source: Repeat Customer (Phone)
Contacted: Yes (0:00)
Created: 3/3/26 11:32a (256)
Trade-in Info
2019 GMC Canyon Denali
75,848 miles Automatic
$19,505 value
Appraised Received
03/03/2026 12:14:54`
  },
  {
    id: 2,
    description: 'Vehicle Info section present (different iframe, but in same text)',
    expectedName: 'Michael Johnson',
    expectedVehicle: /2025.*Chevrolet.*Tahoe.*LT/i,
    text: `Customer Dashboard
Michael Johnson
Status: Active
C: (307) 555-1234
mjohnson@gmail.com
Source: Internet Lead
Vehicle Info
2025 Chevrolet Tahoe LT (New)
Stock #: T25041
Created: 03/28/2026`
  },
  {
    id: 3,
    description: 'Equity line + Vehicle Info — Vehicle Info wins',
    expectedName: 'Sarah Williams',
    expectedVehicle: /2026.*Subaru.*Outback.*Premium/i,
    text: `Customer Dashboard
Sarah Williams
(Individual)
H: (307) 555-5678
sarah.w@yahoo.com
Equity: $4,200 2020 Honda CR-V Calculated: 03/15/2026
Vehicle Info
2026 Subaru Outback Premium (New)
Stock #: S26012
Source: Walk-in`
  },
  {
    id: 4,
    description: 'Payoff line + Active row — Active row wins',
    expectedName: 'Robert Martinez',
    expectedVehicle: /2025.*Chevrolet.*Silverado.*1500/i,
    text: `Customer Dashboard
Robert Martinez
C: (208) 555-9012
rob.martinez@hotmail.com
Source: Facebook
Payoff: $22,500 on 2021 Ford F-150 XLT
Status\tCreated\tSource\tVehicle
Active\t3/30/26\tFacebook\t2025 Chevrolet Silverado 1500 RST
Bad\t2/15/26\tInternet\t2024 Chevy Colorado`
  },
  {
    id: 5,
    description: 'Trade-in value line should NOT capture trade vehicle',
    expectedName: 'Jennifer Chen',
    expectedVehicle: /2025.*Subaru.*Forester/i,
    text: `Customer Dashboard
Jennifer Chen
C: (307) 555-3456
Trade-in value: $8,500 2018 Toyota RAV4 LE
Status: Active
Source: Internet Lead
Looking at 2025 Subaru Forester Touring`
  },
  {
    id: 6,
    description: 'Business contact — Chevy fleet',
    expectedName: 'David Thompson',
    expectedVehicle: /2025.*Chevrolet.*Silverado.*2500/i,
    text: `David Thompson
(Business)
Jackson Hole Property Management
W: (307) 555-7890
dthompson@jhpm.com
Source: Phone Up
Status: Prospect
Vehicle Info
2025 Chevrolet Silverado 2500HD LT (New)
Stock #: T25102`
  },
  {
    id: 7,
    description: 'Spanish-named customer — Toyota Tacoma',
    expectedName: 'Carlos Hernandez',
    expectedVehicle: /2024.*Toyota.*Tacoma.*TRD/i,
    text: `Customer Dashboard
Carlos Hernandez
C: (307) 555-2345
carlos.h@gmail.com
Source: Referral
Status: Active
Vehicle Info
2024 Toyota Tacoma TRD Off-Road (Used)
12,450 miles
Stock #: U24033`
  },
  {
    id: 8,
    description: 'Only year+make, no model',
    expectedName: 'Brian Foster',
    expectedVehicle: /^2025 Subaru$/i,
    text: `Customer Dashboard
Brian Foster
C: (307) 555-0123
Status: Prospect
Source: Walk-in
Customer looking at 2025 Subaru lineup
Created: 03/29/2026`
  },
  {
    id: 9,
    description: 'Hyphenated last name',
    expectedName: "Maria O'Brien",
    expectedVehicle: /2025.*Chevrolet.*Equinox.*RS/i,
    text: `Customer Dashboard
Maria O'Brien
C: (307) 555-4567
maria.obrien@gmail.com
Source: Internet Lead
Status: Active
Vehicle Info
2025 Chevrolet Equinox RS (New)
Stock #: E25019`
  },
  {
    id: 10,
    description: 'Three-part name — Individual format',
    expectedName: 'Jose Luis Garcia',
    expectedVehicle: /2024.*Ram.*1500/i,
    text: `Jose Luis Garcia
(Individual)
C: (208) 555-8901
jlgarcia@gmail.com
Source: Facebook
Status: Active
Vehicle Info
2024 Ram 1500 Big Horn (Used)
28,100 miles`
  },
  {
    id: 11,
    description: 'Minimal page — vehicle mention in body',
    expectedName: 'Kevin Wright',
    expectedVehicle: /2026.*Subaru.*Forester.*Touring/i,
    text: `Customer Dashboard
Kevin Wright
Status: Active
Contacted: 03/25/2026
Looking at the 2026 Subaru Forester Touring. Wants AWD for winter.`
  },
  {
    id: 12,
    description: 'Credit app payoff should not grab old vehicle',
    expectedName: 'Lisa Park',
    expectedVehicle: /2025.*Chevrolet.*Traverse/i,
    text: `Customer Dashboard
Lisa Park
C: (307) 555-2222
lisa.park@proton.me
Source: Internet Lead
Status: Active
Credit: Approved on 2019 Honda Civic payoff $12,300
Vehicle Info
2025 Chevrolet Traverse LT (New)
Attempted: 03/31/2026`
  },
  {
    id: 13,
    description: 'Used BMW — non-franchise make',
    expectedName: 'Thomas Reed',
    expectedVehicle: /2023.*BMW.*X5/i,
    text: `Customer Dashboard
Thomas Reed
C: (307) 555-3333
Status: Prospect
Source: Walk-in
Vehicle Info
2023 BMW X5 xDrive40i (Used)
19,800 miles
Stock #: U23111`
  },
  {
    id: 14,
    description: 'Chevy abbreviated',
    expectedName: 'Nicole Adams',
    expectedVehicle: /2025.*Chevy.*Blazer/i,
    text: `Customer Dashboard
Nicole Adams
C: (307) 555-4444
nicole.adams@gmail.com
Source: Phone Up
Status: Active
Interested in 2025 Chevy Blazer EV`
  },
  {
    id: 15,
    description: 'Tesla — pre-owned',
    expectedName: 'Ryan Cooper',
    expectedVehicle: /2023.*Tesla.*Model.*Y/i,
    text: `Customer Dashboard
Ryan Cooper
C: (208) 555-5555
ryan.cooper@me.com
Source: Internet Lead
Status: Active
Vehicle Info
2023 Tesla Model Y Long Range (Used)
15,200 miles`
  },
  {
    id: 16,
    description: 'No vehicle anywhere — should return empty',
    expectedName: 'Patricia Bell',
    expectedVehicle: null,
    text: `Customer Dashboard
Patricia Bell
C: (307) 555-6666
patricia.bell@aol.com
Source: Walk-in
Status: Active
General inquiry, no specific vehicle interest.
Created: 04/01/2026`
  },
  {
    id: 17,
    description: 'Multiple vehicles — Active row preferred',
    expectedName: 'James Wilson',
    expectedVehicle: /2025.*Chevrolet.*Tahoe.*Z71/i,
    text: `Customer Dashboard
James Wilson
C: (307) 555-7777
Source: Internet Lead
Equity: $3,100 2019 Toyota 4Runner Calculated: 03/20/2026
Status\tCreated\tSource\tVehicle
Active\t3/28/26\tInternet Lead\t2025 Chevrolet Tahoe Z71
Sold\tCatherine Wilson\t1/15/25\tRepeat\t2023 Chevrolet Suburban`
  },
  {
    id: 18,
    description: 'Jeep — used, cross-brand',
    expectedName: 'Emily Davis',
    expectedVehicle: /2024.*Jeep.*Grand Cherokee/i,
    text: `Customer Dashboard
Emily Davis
C: (307) 555-8888
emilyd@gmail.com
Source: Referral
Status: Prospect
Vehicle Info
2024 Jeep Grand Cherokee Limited (Used)
32,500 miles`
  },
  {
    id: 19,
    description: 'GMC Sierra',
    expectedName: 'Daniel Brown',
    expectedVehicle: /2024.*GMC.*Sierra.*1500/i,
    text: `Daniel Brown
(Individual)
C: (208) 555-9999
dan.brown@yahoo.com
Source: Facebook
Status: Active
Vehicle Info
2024 GMC Sierra 1500 Denali (Used)
8,900 miles`
  },
  {
    id: 20,
    description: 'VW abbreviated + equity poison',
    expectedName: 'Hannah Scott',
    expectedVehicle: /2026.*Subaru.*Crosstrek/i,
    text: `Customer Dashboard
Hannah Scott
C: (307) 555-1111
hannah.s@gmail.com
Source: Internet Lead
Status: Active
Equity: $1,800 2023 VW Tiguan SE Calculated 02/28/2026
Interested in 2026 Subaru Crosstrek Sport`
  },
];

// ===== RUN =====
console.log('='.repeat(70));
console.log('OPER8ER VEHICLE DETECTION TEST V2 — 20 Cases (includes real bug)');
console.log('='.repeat(70));
console.log('');

let pass = 0, fail = 0;
const failures = [];

testCases.forEach(tc => {
  const result = scanText(tc.text);
  let nameOk = tc.expectedName ? result.customerName === tc.expectedName : !result.customerName;
  let vehicleOk;
  if (tc.expectedVehicle === null) vehicleOk = !result.vehicle;
  else if (tc.expectedVehicle instanceof RegExp) vehicleOk = tc.expectedVehicle.test(result.vehicle);
  else vehicleOk = result.vehicle === tc.expectedVehicle;

  const passed = nameOk && vehicleOk;
  if (passed) { pass++; console.log(`  PASS  #${tc.id}: ${tc.description}`); }
  else {
    fail++;
    const reasons = [];
    if (!nameOk) reasons.push(`NAME: expected "${tc.expectedName}" got "${result.customerName}"`);
    if (!vehicleOk) reasons.push(`VEHICLE: expected ${tc.expectedVehicle} got "${result.vehicle}"`);
    console.log(`  FAIL  #${tc.id}: ${tc.description}`);
    reasons.forEach(r => console.log(`        → ${r}`));
    failures.push({ id: tc.id, desc: tc.description, reasons });
  }
  console.log(`        Name: "${result.customerName}" | Vehicle: "${result.vehicle}" | Phone: "${result.phone}" | Source: "${result.source}"`);
  console.log('');
});

console.log('='.repeat(70));
console.log(`RESULTS: ${pass}/20 PASS | ${fail}/20 FAIL | Rate: ${(pass/20*100).toFixed(0)}%`);
console.log('='.repeat(70));
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach(f => { console.log(`  #${f.id}: ${f.desc}`); f.reasons.forEach(r => console.log(`    ${r}`)); });
}
