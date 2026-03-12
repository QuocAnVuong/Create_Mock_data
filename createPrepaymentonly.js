const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const { generateCaseRecordsFromConfig } = require('./generateCaseRecords');
const { main: createPrepaymentMain } = require('./createPrepayment');
const { transformPrepaymentJsonToCsv } = require('./transformPrepaymentJsonToCsv');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.yaml');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.yaml not found at: ${CONFIG_PATH}`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return yaml.parse(raw) || {};
}

function normalizeCompanies(companyNode) {
  if (Array.isArray(companyNode)) return companyNode.filter(Boolean);
  if (typeof companyNode === 'string' && companyNode.trim()) return [companyNode.trim()];
  if (companyNode && typeof companyNode === 'object') return Object.keys(companyNode);
  return [];
}

async function main() {
  const config = loadConfig();
  const companies = normalizeCompanies(config.Company);
  const caseCount = Number(config.Case);

  if (!companies.length) {
    console.error('No companies configured in config.yaml (Company). Nothing to do.');
    return;
  }

  if (!Number.isFinite(caseCount) || caseCount <= 0) {
    console.error('Invalid case count in config.yaml (Case). Nothing to do.');
    return;
  }

  console.log('💳 Prepayment-only workflow starting...');
  console.log(`- Companies: ${companies.join(', ')}`);
  console.log(`- Cases: ${caseCount}`);

  // Step 1: Generate case_records.json from config.yaml
  console.log('\n📋 Step 1: Generating case records from config.yaml...');
  generateCaseRecordsFromConfig();

  // Step 2: Create prepayment data (reads case_records.json + config.yaml)
  console.log('\n💳 Step 2: Creating prepayment data...');
  await createPrepaymentMain();

  // Step 3: Transform Prepayment_Data.json to CSV listing all cases
  console.log('\n📄 Step 3: Transforming prepayment data to CSV...');
  try {
    const { outputPath, rowCount } = transformPrepaymentJsonToCsv();
    console.log(`✅ CSV written: ${outputPath}`);
    console.log(`Rows: ${rowCount}`);
  } catch (err) {
    console.error('❌ Failed to transform prepayment JSON to CSV:', err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }

  console.log('\n✅ Prepayment-only workflow finished.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error in prepayment-only workflow:', error.message);
    console.error('Stack trace:', error.stack);
    process.exitCode = 1;
  });
}

module.exports = { main };
