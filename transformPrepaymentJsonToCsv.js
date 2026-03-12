const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const Papa = require('papaparse');

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    config: null,
    currency: null,
    help: false,
  };

  function takeValue(i) {
    const v = argv[i + 1];
    if (!v || v.startsWith('-')) return null;
    return v;
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }

    if (a === '--input' || a === '-i') {
      const v = takeValue(i);
      if (v) {
        args.input = v;
        i++;
      }
      continue;
    }

    if (a === '--output' || a === '-o') {
      const v = takeValue(i);
      if (v) {
        args.output = v;
        i++;
      }
      continue;
    }

    if (a === '--config' || a === '-c') {
      const v = takeValue(i);
      if (v) {
        args.config = v;
        i++;
      }
      continue;
    }

    if (a === '--currency') {
      const v = takeValue(i);
      if (v) {
        args.currency = v;
        i++;
      }
      continue;
    }
  }

  return args;
}

function printHelp() {
  const scriptName = path.basename(__filename);
  console.log(`Usage:\n  node .\\${scriptName} [options]\n\nOptions:\n  -i, --input <path>     Input JSON file (default: Prepayment_Data.json)\n  -o, --output <path>    Output CSV file (default: Prepayment_Data.csv)\n  -c, --config <path>    Config YAML for currency (default: config.yaml)\n      --currency <code>  Override currency value written to CSV\n  -h, --help             Show help\n\nExample:\n  node .\\${scriptName} -i Prepayment_Data.json -o Prepayment_Data.csv`);
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function safeReadCurrencyFromConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return '';
    const config = yaml.parse(fs.readFileSync(configPath, 'utf8')) || {};
    if (!config || typeof config !== 'object') return '';
    const cur = config.prepaymentCurrency;
    if (!cur) return '';
    return String(cur).toUpperCase();
  } catch {
    return '';
  }
}

function parseCaseParts(caseStr) {
  if (!caseStr || typeof caseStr !== 'string') {
    return { scenario: '', caseType: '', deliveryType: '' };
  }
  const parts = caseStr.split('-');
  return {
    scenario: parts[0] || '',
    caseType: parts[1] || '',
    deliveryType: parts[2] || '',
  };
}

function toCellValue(v) {
  if (v === null || v === undefined) return '';
  return v;
}

function flattenPrepaymentData(prepaymentJson, currency) {
  const headers = [
    'Company Code',
    'Case',
    'Scenario',
    'Case Type',
    'Delivery Type',
    'Record Index',
    'Prepayment Request Number',
    'SO Number',
    'Billing Number',
    'Amount',
    'Currency',
  ];

  const rows = [];

  const root = prepaymentJson && typeof prepaymentJson === 'object' ? prepaymentJson : {};
  for (const [companyCode, companyData] of Object.entries(root)) {
    const records = Array.isArray(companyData?.Records) ? companyData.Records : [];

    for (const caseEntry of records) {
      const caseStr = toCellValue(caseEntry?.case);
      const { scenario, caseType, deliveryType } = parseCaseParts(caseStr);
      const perCaseRecords = Array.isArray(caseEntry?.record) ? caseEntry.record : [];

      for (let i = 0; i < perCaseRecords.length; i++) {
        const rec = perCaseRecords[i] || {};

        rows.push([
          companyCode,
          caseStr,
          scenario,
          caseType,
          deliveryType,
          i + 1,
          toCellValue(rec.PrepaymentRequestnumber),
          toCellValue(rec.SoNumber),
          toCellValue(rec.BillingNumber),
          toCellValue(rec.Amount),
          currency,
        ]);
      }
    }
  }

  return { headers, rows };
}

function transformPrepaymentJsonToCsv(options = {}) {
  const inputPath = path.resolve(options.inputPath || path.join(__dirname, 'Prepayment_Data.json'));
  const outputPath = path.resolve(options.outputPath || path.join(__dirname, 'Prepayment_Data.csv'));
  const configPath = path.resolve(options.configPath || path.join(__dirname, 'config.yaml'));

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const currency = (options.currency ? String(options.currency).toUpperCase() : '') || safeReadCurrencyFromConfig(configPath);

  const prepaymentJson = safeReadJson(inputPath);
  const { headers, rows } = flattenPrepaymentData(prepaymentJson, currency);

  const csv = Papa.unparse({ fields: headers, data: rows });
  fs.writeFileSync(outputPath, csv, 'utf8');

  return { outputPath, rowCount: rows.length, currency };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  try {
    const result = transformPrepaymentJsonToCsv({
      inputPath: args.input,
      outputPath: args.output,
      configPath: args.config,
      currency: args.currency,
    });

    console.log(`Wrote: ${result.outputPath}`);
    console.log(`Rows: ${result.rowCount}`);
    if (result.currency) console.log(`Currency column: ${result.currency}`);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { transformPrepaymentJsonToCsv, flattenPrepaymentData };
