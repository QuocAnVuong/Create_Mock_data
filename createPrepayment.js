const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const axios = require('axios');

// Paths
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.yaml');
const CASE_RECORDS_PATH = path.join(ROOT, 'case_records.json');
const USED_UNIQUE_STRINGS_PATH = path.join(ROOT, 'usedUniqueStrings.json');
const PREPAYMENT_DATA_PATH = path.join(ROOT, 'Prepayment_Data.json');

// Load configuration
const config = yaml.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
const companies = Array.isArray(config.Company)
  ? config.Company
  : (config.Company && typeof config.Company === 'object')
    ? Object.keys(config.Company)
    : [];

// Endpoint details (adapt to your config)
const endpoint = (config.endpoint && (config.endpoint.IF_013)) || {};
if (!endpoint.url || !endpoint.username || !endpoint.password) {
  console.warn('Endpoint is missing url/username/password in config.yaml.');
}

const PREPAYMENT_CURRENCY = (config.prepaymentCurrency || 'USD').toUpperCase();
const MAX_MANY_TO_ONE = Number.isFinite(config.MaxNumberOneToMany) ? Math.max(2, config.MaxNumberOneToMany) : 3;
const NET_MIN = Number.isFinite(config.NetAmount?.Min) ? config.NetAmount.Min : 500;
const NET_MAX = Number.isFinite(config.NetAmount?.Max) ? config.NetAmount.Max : 2500;

// Load case records
const caseRecordsRaw = JSON.parse(fs.readFileSync(CASE_RECORDS_PATH, 'utf8'));
const caseList = Array.isArray(caseRecordsRaw.record) ? caseRecordsRaw.record.map(r => r.case) : [];

// Load used unique strings
let usedUniqueStrings = new Set();
if (fs.existsSync(USED_UNIQUE_STRINGS_PATH)) {
  try {
    const saved = JSON.parse(fs.readFileSync(USED_UNIQUE_STRINGS_PATH, 'utf8'));
    usedUniqueStrings = new Set(Array.isArray(saved) ? saved : []);
  } catch (_) {}
}

function saveUsedUniqueStrings() {
  fs.writeFileSync(USED_UNIQUE_STRINGS_PATH, JSON.stringify(Array.from(usedUniqueStrings), null, 2), 'utf8');
}

function extractBillingNumber(statusDescription) {
  if (!statusDescription || typeof statusDescription !== 'string') return null;
  const match = statusDescription.match(/billing number (\w+)/i);
  return match ? match[1] : null;
}

function generateRandomNetAmount() {
  const min = Math.floor(NET_MIN);
  const max = Math.floor(NET_MAX);
  return Math.floor(Math.random() * (max - min + 1)) + min; // inclusive
}

function generateUniqueId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  let attempts = 0;
  do {
    result = '';
    while (result.length < length) {
      const char = chars.charAt(Math.floor(Math.random() * chars.length));
      if (!result.includes(char)) result += char;
    }
    attempts++;
    if (attempts > 1000) break; // extreme safety
  } while (usedUniqueStrings.has(result));
  usedUniqueStrings.add(result);
  saveUsedUniqueStrings();
  return result;
}

function parseCaseType(caseString) {
  if (!caseString) return { relation: 'OneToOne', mood: null, deliveryType: null };
  const [relation, mood, deliveryType] = caseString.split('-');
  return { relation, mood, deliveryType };
}

function timesForCase(relation) {
  if (relation === 'ManyToOne') {
    const count = Math.floor(Math.random() * (MAX_MANY_TO_ONE - 2 + 1)) + 2; // [2..MAX]
    return count;
  }
  // OneToOne, OneToMany -> 1 send
  return 1;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadBaseJson(companyCode) {
  const filePath = path.join(ROOT, 'Sample', 'Prepayment', `${companyCode}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Base JSON not found for company ${companyCode} at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function applyPrepaymentEdits(jsonData, { companyCode, currency, uniqueString, sfid, amount }) {
  if (!jsonData || !jsonData.SalesOrder) return jsonData;

  jsonData.SalesOrder.forEach(order => {
    // Ensure set fields
    order.SalesOrderItemsSet = [sfid];
    if (currency) order.TransactionCurrency = currency;

    if (Array.isArray(order.SalesOrderItem)) {
      order.SalesOrderItem.forEach(item => {
        item.YY1_SFDCLINEID_I = sfid;
        item.YY1_SALESFORCEID_I = sfid;
        item.PrepaymentRequestnumber = uniqueString;
        item.YY1_BATCHID_I = uniqueString;

        if (Array.isArray(item.PricingElement)) {
          item.PricingElement.forEach(pe => {
            if (currency) pe.ConditionCurrency = currency;
            if (pe.ConditionType === 'ZSFN') {
              pe.ConditionRateValue = amount;
            }
          });
        }

        if (Array.isArray(item.to_billingplan)) {
          item.to_billingplan.forEach(bp => {
            if (Array.isArray(bp.to_billingplanitem)) {
              bp.to_billingplanitem.forEach(bpi => {
                bpi.BillingPlanAmount = amount;
              });
            }
          });
        }
      });
    }
  });

  return jsonData;
}

function setSalesOrderInPayload(jsonData, soNumber) {
  if (!jsonData || !jsonData.SalesOrder || !soNumber) return jsonData;
  jsonData.SalesOrder.forEach(order => {
    order.SalesOrder = soNumber;
    if (Array.isArray(order.SalesOrderItem)) {
      order.SalesOrderItem.forEach(item => {
        item.SalesOrder = soNumber;
        if (Array.isArray(item.PricingElement)) {
          item.PricingElement.forEach(pe => {
            pe.SalesOrder = soNumber;
          });
        }
        if (Array.isArray(item.ItemText)) {
          item.ItemText.forEach(txt => {
            txt.SalesOrder = soNumber;
          });
        }
        if (Array.isArray(item.to_billingplan)) {
          item.to_billingplan.forEach(bp => {
            bp.SalesOrder = soNumber;
            if (Array.isArray(bp.to_billingplanitem)) {
              bp.to_billingplanitem.forEach(bpi => {
                bpi.SalesOrder = soNumber;
              });
            }
          });
        }
      });
    }
  });
  return jsonData;
}

async function postToCPI(payload) {
  if (!endpoint.url) throw new Error('No CPI endpoint URL configured.');
  const { url, username, password } = endpoint;
  const res = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json', env: 'Test', mode: 'debug' },
    auth: { username, password },
    timeout: 120000,
  });
  // Try to extract companyCode and type from payload if possible
  let companyCode = '';
  let type = '';
  if (payload && payload.SalesOrder && Array.isArray(payload.SalesOrder) && payload.SalesOrder.length > 0) {
    companyCode = payload.SalesOrder[0].CompanyCode || '';
    type = payload.SalesOrder[0].TransactionCurrency || '';
  }
  console.log(`${companyCode} ${type} CPI Response:`, res.data);
  return res.data;
}

async function processCompany(companyCode, cases) {
  const prepaymentBase = loadBaseJson(companyCode);
  const companyOutput = { Records: [] };

  for (const caseStr of cases) {
    const { relation } = parseCaseType(caseStr);
    const count = timesForCase(relation);

    const perCaseRecords = [];

    // Initial send to create or reference SO
    const unique0 = generateUniqueId();
    const sfid0 = `TEST${companyCode}${unique0}`;
    const amount0 = generateRandomNetAmount();
    const payload0 = applyPrepaymentEdits(clone(prepaymentBase), {
      companyCode,
      currency: PREPAYMENT_CURRENCY,
      uniqueString: unique0,
      sfid: sfid0,
      amount: amount0,
    });
    let soNumberForCase = null;
    try {
      const data0 = await postToCPI(payload0);
      soNumberForCase = data0 && data0.SO_Number__c ? data0.SO_Number__c : null;
      const billingNumber0 = extractBillingNumber(data0 && data0.Status_Description__c);
      perCaseRecords.push({
        SoNumber: soNumberForCase,
        BillingNumber: billingNumber0,
        PrepaymentRequestnumber: unique0,
        Amount: amount0,
      });
    } catch (err) {
      perCaseRecords.push({
        SoNumber: null,
        BillingNumber: null,
        PrepaymentRequestnumber: unique0,
        Amount: amount0,
      });
    }

    // For ManyToOne, send more times referencing the same SO
    if (count > 1 && soNumberForCase) {
      for (let i = 1; i < count; i++) {
        const unique = generateUniqueId();
        const sfid = `TEST${companyCode}${unique}`;
        const amount = generateRandomNetAmount();
        const payloadN = applyPrepaymentEdits(
          setSalesOrderInPayload(clone(prepaymentBase), soNumberForCase),
          {
            companyCode,
            currency: PREPAYMENT_CURRENCY,
            uniqueString: unique,
            sfid,
            amount,
          }
        );
        try {
          const dataN = await postToCPI(payloadN);
          const billingNumber = extractBillingNumber(dataN && dataN.Status_Description__c);
          perCaseRecords.push({
            SoNumber: soNumberForCase,
            BillingNumber: billingNumber,
            PrepaymentRequestnumber: unique,
            Amount: amount,
          });
        } catch (err) {
          perCaseRecords.push({
            SoNumber: soNumberForCase,
            BillingNumber: null,
            PrepaymentRequestnumber: unique,
            Amount: amount,
          });
        }
      }
    }

    companyOutput.Records.push({ case: caseStr, record: perCaseRecords });
  }

  return companyOutput;
}

async function main() {
  if (!companies.length) {
    console.error('No companies configured in config.yaml (Company). Nothing to do.');
    return;
  }
  if (!caseList.length) {
    console.error('No cases found in case_records.json. Nothing to do.');
    return;
  }

  const finalOutput = {};
  for (const company of companies) {
    console.log(`Processing company ${company} with ${caseList.length} cases (currency=${PREPAYMENT_CURRENCY})...`);
    finalOutput[company] = await processCompany(company, caseList);
  }
  fs.writeFileSync(PREPAYMENT_DATA_PATH, JSON.stringify(finalOutput, null, 2), 'utf8');
  console.log(`Wrote ${PREPAYMENT_DATA_PATH}`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exitCode = 1;
  });
}
