const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = ['AGENTS.md', 'entrypoints', 'lib', 'public'];
const DENY_LIST = [
  { pattern: /3 seconds/i, message: 'No specific speed claims' },
  { pattern: /Drafted in.*by Brevmont/i, message: 'No auto-signature' },
  { pattern: /Drafted by Brevmont/i, message: 'No auto-signature' },
  { pattern: /AI assistant/i, message: 'Use "AI co-pilot"' },
  { pattern: /inside your CRM/i, message: 'Use "works alongside your CRM"' },
  { pattern: /inside the CRM/i, message: 'Use "alongside the CRM"' },
  { pattern: /\bgenerations\b/i, message: 'Use "follow-ups" for customer-facing copy' },
];

function walk(relative) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  return fs.readdirSync(absolute).flatMap((child) => {
    const childPath = path.join(absolute, child);
    const childStat = fs.statSync(childPath);
    if (childStat.isDirectory()) return walk(path.relative(ROOT, childPath));
    return /\.(tsx?|jsx?|html|md)$/.test(childPath) ? [childPath] : [];
  });
}

const violations = [];
for (const file of [...new Set(INCLUDE.flatMap(walk))]) {
  const relative = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of DENY_LIST) {
      if (rule.pattern.test(line)) {
        violations.push({ file: relative, line: index + 1, message: rule.message, text: line.trim() });
      }
    }
  });
}

if (violations.length) {
  console.error('Customer-facing copy contract violations found:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.message}`);
    console.error(`  ${violation.text}`);
  }
  console.error('\nSee C:\\Users\\Yancy\\brevmont-vault\\brand\\CUSTOMER-FACING-COPY-CONTRACT.md');
  process.exit(1);
}

console.log('brand-lint: customer-facing extension copy matches the copy contract.');
