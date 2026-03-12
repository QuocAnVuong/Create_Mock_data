const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const XLSX = require('xlsx');

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    config: null,
    sheet: 'Prepayment Data',
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

    if (a === '--sheet' || a === '-s') {
      const v = takeValue(i);
      if (v) {
        args.sheet = v;
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
  console.log(`Usage:\n  node .\\${scriptName} [options]\n\nOptions:\n  -i, --input <path>     Input JSON file (default: Prepayment_Data.json)\n  -o, --output <path>    Output XLSX file (default: Prepayment_Data.xlsx)\n  -c, --config <path>    Config YAML for currency (default: config.yaml)\n  -s, --sheet <name>     Excel sheet name (default: "Prepayment Data")\n      --currency <code>  Override currency value written to sheet\n  -h, --help             Show help\n\nExample:\n  node .\\${scriptName} -i Prepayment_Data.json -o Prepayment_Data.xlsx`);
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

function computeColumnWidths(headers, rows) {
  const widths = headers.map((h, idx) => {
    let maxLen = String(h).length;
    for (const row of rows) {
      const cell = row[idx];
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > maxLen) maxLen = len;
    }
    // Clamp to keep file readable and not huge.
    const wch = Math.min(60, Math.max(12, maxLen + 2));
    return { wch };
  });
  return widths;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = path.resolve(args.input || path.join(__dirname, 'Prepayment_Data.json'));
  const outputPath = path.resolve(args.output || path.join(__dirname, 'Prepayment_Data.xlsx'));
  const configPath = path.resolve(args.config || path.join(__dirname, 'config.yaml'));

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exitCode = 1;
    return;
  }

  const currency = (args.currency ? String(args.currency).toUpperCase() : '') || safeReadCurrencyFromConfig(configPath);

  let prepaymentJson;
  try {
    prepaymentJson = safeReadJson(inputPath);
  } catch (err) {
    console.error(`Failed to read/parse JSON: ${inputPath}`);
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const { headers, rows } = flattenPrepaymentData(prepaymentJson, currency);

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = computeColumnWidths(headers, rows);

  XLSX.utils.book_append_sheet(workbook, worksheet, args.sheet || 'Prepayment Data');
  XLSX.writeFile(workbook, outputPath);

  console.log(`Wrote: ${outputPath}`);
  console.log(`Rows: ${rows.length}`);
  if (currency) console.log(`Currency column: ${currency}`);
}

if (require.main === module) {
  main();
}
