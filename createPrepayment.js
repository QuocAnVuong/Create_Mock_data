const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const axios = require('axios');

// Load configuration
const config = yaml.parse(fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8'));

// File to store used unique strings
const uniqueStringsFile = path.join(__dirname, 'usedUniqueStrings.json');

// File to store SO numbers and billing numbers
const soTrackingFile = path.join(__dirname, 'USD.json');

// Load existing unique strings or initialize empty set
let usedUniqueStrings = new Set();
if (fs.existsSync(uniqueStringsFile)) {
  const savedStrings = JSON.parse(fs.readFileSync(uniqueStringsFile, 'utf8'));
  usedUniqueStrings = new Set(savedStrings);
}

// Initialize empty SO tracking for each run
let soTracking = {};

// Generate random net amount based on config
function generateRandomNetAmount() {
  const min = config.NetAmount.Min;
  const max = config.NetAmount.Max;
  // Generate random integer between min and max (inclusive)
  const amount = Math.floor(Math.random() * (max - min + 1)) + min;
  return amount;
}

// Save unique strings to file
function saveUniqueStrings() {
  fs.writeFileSync(uniqueStringsFile, JSON.stringify(Array.from(usedUniqueStrings), null, 2), 'utf8');
}

// Save SO tracking to file
function saveSOTracking() {
  fs.writeFileSync(soTrackingFile, JSON.stringify(soTracking, null, 2), 'utf8');
}

// Extract billing number from status description
function extractBillingNumber(statusDescription) {
  if (!statusDescription) return null;
  
  // Look for pattern like "billing number 1SA5000078"
  const match = statusDescription.match(/billing number (\w+)/i);
  return match ? match[1] : null;
}

// Add response to SO tracking
function addToSOTracking(companyCode, type, iteration, response, uniqueString, amount) {
  if (response && response.SO_Number__c) {
    const soNumber = response.SO_Number__c;
    
    // Use company code as key, initialize if it doesn't exist
    if (!soTracking[companyCode]) {
      soTracking[companyCode] = {
        "SoNumber": soNumber,
        "Records": []
      };
    }
    
    // Extract billing number from status description
    const billingNumber = extractBillingNumber(response.Status_Description__c);
    
    if (billingNumber) {
      soTracking[companyCode].Records.push({
        "BillingNumber": billingNumber,
        "PrepaymentRequestnumber": uniqueString,
        "Amount": amount
      });
    }
    
    saveSOTracking();
  }
}

function generateUniqueId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  // Keep generating until we get a unique string
  do {
    result = '';
    while (result.length < length) {
      const char = chars.charAt(Math.floor(Math.random() * chars.length));
      if (!result.includes(char)) result += char;
    }
  } while (usedUniqueStrings.has(result));
  
  // Add to used strings set and save
  usedUniqueStrings.add(result);
  saveUniqueStrings();
  return result;
}

// Create prepayment for a given company code
async function createPrepayment(companyCode, type) {
  // Generate unique ID and SFID
  const uniqueString = generateUniqueId();
  const SFID = `TEST${companyCode}${uniqueString}`;

  // Load company JSON
  const filePath = path.join(__dirname, 'First', `${companyCode}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`File not found for company code: ${companyCode}`);
  const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Generate random amount for tracking
  let randomAmount = null;

  // Update fields
  jsonData.SalesOrder.forEach(order => {
    order.SalesOrderItemsSet = [SFID];
    
    // Update currency if type is not Local
    if (type !== 'Local') {
      const currency = type.toUpperCase();
      order.TransactionCurrency = currency;
    }
    
    order.SalesOrderItem.forEach(item => {
      item.YY1_SFDCLINEID_I = SFID;
      item.YY1_SALESFORCEID_I = SFID;
      item.PrepaymentRequestnumber = uniqueString;
      item.YY1_BATCHID_I = uniqueString;
      randomAmount = generateRandomNetAmount();
      
      // Update currency in PricingElement if type is not Local
      if (item.PricingElement && Array.isArray(item.PricingElement)) {
        item.PricingElement.forEach(pricing => {
          // Update currency if type is not Local
          if (type !== 'Local') {
            const currency = type.toUpperCase();
            pricing.ConditionCurrency = currency;
          }
          
          // Update ZSFN ConditionRateValue with random net amount
          if (pricing.ConditionType === 'ZSFN') {
            pricing.ConditionRateValue = randomAmount;
          }
          
        });
      }
      if (item.to_billingplan && Array.isArray(item.to_billingplan)) {
        item.to_billingplan.forEach(billingPlan => {
          if (billingPlan.to_billingplanitem && Array.isArray(billingPlan.to_billingplanitem)) {
            billingPlan.to_billingplanitem.forEach(billingPlanItem => {
              billingPlanItem.BillingPlanAmount = randomAmount;
            });
          }
        });
      }
    });
  });

  // Create company folder if it doesn't exist
  const companyFolderPath = path.join(__dirname, companyCode);
  const typeFolderPath = path.join(companyFolderPath, type.toLowerCase());
  if (!fs.existsSync(typeFolderPath)) {
    fs.mkdirSync(typeFolderPath, { recursive: true });
  }

  // Save the initial JSON before calling the URL
  const initialFilePath = path.join(typeFolderPath, `initial_${type.toLowerCase()}.json`);
  fs.writeFileSync(initialFilePath, JSON.stringify(jsonData, null, 2), 'utf8');

  // Send request
  const { url, username, password } = config.endpoint.IF_013;
  const response = await axios.post(url, jsonData, {
    headers: { 'Content-Type': 'application/json', env: 'Test', mode: 'debug' },
    auth: { username, password }
  });

  console.log(`${companyCode} ${type} Initial Response:`, response.data);

  // Add to SO tracking
  addToSOTracking(companyCode, type, 'initial', response.data, uniqueString, randomAmount);

  // Extract SO_Number__c from response and update SalesOrder fields
  if (response.data && response.data.SO_Number__c) {
    const soNumber = response.data.SO_Number__c;

    // Update all SalesOrder fields in the JSON data
    jsonData.SalesOrder.forEach(order => {
      order.SalesOrder = soNumber;
      order.SalesOrderItem.forEach(item => {
        item.SalesOrder = soNumber;
        
        // Update SalesOrder in PricingElement array
        if (item.PricingElement && Array.isArray(item.PricingElement)) {
          item.PricingElement.forEach(pricing => {
            pricing.SalesOrder = soNumber;
          });
        }
        
        // Update SalesOrder in ItemText array
        if (item.ItemText && Array.isArray(item.ItemText)) {
          item.ItemText.forEach(text => {
            text.SalesOrder = soNumber;
          });
        }
        
        // Update SalesOrder in to_billingplan array
        if (item.to_billingplan && Array.isArray(item.to_billingplan)) {
          item.to_billingplan.forEach(billing => {
            billing.SalesOrder = soNumber;
            
            // Update SalesOrder in to_billingplanitem if it exists
            if (billing.to_billingplanitem && Array.isArray(billing.to_billingplanitem)) {
              billing.to_billingplanitem.forEach(billingItem => {
                billingItem.SalesOrder = soNumber;
              });
            }
          });
        }
      });
    });
  }

  return { responseData: response.data, finalJson: jsonData };
}

// Function to process multiple prepayments based on config
async function processMultiplePrepayments(companyCode, baseJson, type) {
  const count = config.Company[companyCode]?.[type];
  
  if (count === undefined || count === null) {
    throw new Error(`${type} count not found for company code: ${companyCode}`);
  }
  
  // If count is 0, return empty results without processing
  if (count === 0) {
    return [];
  }
  
  const results = [];
  
  for (let i = 0; i < count; i++) {
    // Create a deep copy of the base JSON to avoid modifying the original
    const jsonData = JSON.parse(JSON.stringify(baseJson));
    
    // Generate new unique string and SFID
    const uniqueString = generateUniqueId();
    const SFID = `TEST${companyCode}${uniqueString}`;
    
    // Generate random amount for tracking
    let randomAmount = null;
    
    // Update fields with new unique values
    jsonData.SalesOrder.forEach(order => {
      order.SalesOrderItemsSet = [SFID];
      
      // Update currency if type is not Local
      if (type !== 'Local') {
        const currency = type.toUpperCase();
        order.TransactionCurrency = currency;
      }
      
      order.SalesOrderItem.forEach(item => {
        item.YY1_SFDCLINEID_I = SFID;
        item.YY1_SALESFORCEID_I = SFID;
        item.PrepaymentRequestnumber = uniqueString;
        item.YY1_BATCHID_I = uniqueString;
        
        // Update currency in PricingElement if type is not Local
        if (item.PricingElement && Array.isArray(item.PricingElement)) {
          item.PricingElement.forEach(pricing => {
            // Update currency if type is not Local
            if (type !== 'Local') {
              const currency = type.toUpperCase();
              pricing.ConditionCurrency = currency;
            }
            
            // Update ZSFN ConditionRateValue with random net amount
            if (pricing.ConditionType === 'ZSFN') {
              randomAmount = generateRandomNetAmount();
              pricing.ConditionRateValue = randomAmount;
            }
          });
        }
      });
    });
    
    try {
      // Send request to IF_013 endpoint
      const { url, username, password } = config.endpoint.IF_013;
      const response = await axios.post(url, jsonData, {
        headers: { 'Content-Type': 'application/json', env: 'Cust', mode: 'debug' },
        auth: { username, password }
      });
      
      console.log(`${companyCode} ${type} ${i + 1} Response:`, response.data);

      // Add to SO tracking
      addToSOTracking(companyCode, type, i + 1, response.data, uniqueString, randomAmount);
      
      // Store the result
      results.push({
        iteration: i + 1,
        uniqueString: uniqueString,
        SFID: SFID,
        response: response.data,
        finalJson: jsonData
      });
      
      // Create company and type folders if they don't exist
      const companyFolderPath = path.join(__dirname, companyCode);
      const typeFolderPath = path.join(companyFolderPath, type.toLowerCase());
      if (!fs.existsSync(typeFolderPath)) {
        fs.mkdirSync(typeFolderPath, { recursive: true });
      }
      
      // Save each iteration to the appropriate folder
      const tempFilePath = path.join(typeFolderPath, `${i + 1}.json`);
      fs.writeFileSync(tempFilePath, JSON.stringify(jsonData, null, 2), 'utf8');
      
    } catch (error) {
      results.push({
        iteration: i + 1,
        uniqueString: uniqueString,
        SFID: SFID,
        error: error.message
      });
    }
  }
  
  return results;
}

// Process all companies for a specific type
async function processCompaniesForType(type) {
  try {
    const allResults = {};
    
    // Iterate through each company
    for (const companyCode in config.Company) {
      allResults[companyCode] = {};
      
      // Step 1: Create initial prepayment for the specified type
      const { responseData, finalJson } = await createPrepayment(companyCode, type);
      allResults[companyCode].initial = { responseData, finalJson };
      
      // Step 2: Process multiple prepayments for the specified type
      const results = await processMultiplePrepayments(companyCode, finalJson, type);
      allResults[companyCode].multiple = results;
    }
    
    return allResults;
    
  } catch (error) {
    console.error('Process execution error:', error.message);
    throw error;
  }
}

const type = config.type;

processCompaniesForType(type)