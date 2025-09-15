const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const sendRequest = require('./sendRequest');

// Load config from YAML file
let config = { isEqual: false }; // Default config
try {
    const configPath = path.join(__dirname, 'config.yaml');
    if (fs.existsSync(configPath)) {
        const configFile = fs.readFileSync(configPath, 'utf8');
        config = yaml.parse(configFile) || { isEqual: false };
    }
} catch (error) {
    console.log('Could not load config.yaml, using defaults');
}

// Unique string management
let usedUniqueStrings = new Set();
const uniqueStringsFile = path.join(__dirname, 'usedUniqueStrings.json');

// Load unique strings from file
function loadUniqueStrings() {
    try {
        if (fs.existsSync(uniqueStringsFile)) {
            const data = JSON.parse(fs.readFileSync(uniqueStringsFile, 'utf8'));
            usedUniqueStrings = new Set(data);
        }
    } catch (error) {
        console.log('Could not load existing unique strings, starting fresh');
        usedUniqueStrings = new Set();
    }
}

// Save unique strings to file
function saveUniqueStrings() {
    try {
        fs.writeFileSync(uniqueStringsFile, JSON.stringify([...usedUniqueStrings], null, 2));
    } catch (error) {
        console.error('Error saving unique strings:', error);
    }
}

// Generate unique ID function
function generateUniqueId(length = 9) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    do {
        result = '';
        while (result.length < length) {
            const char = chars.charAt(Math.floor(Math.random() * chars.length));
            result += char;
        }
    } while (usedUniqueStrings.has(result));
    
    usedUniqueStrings.add(result);
    saveUniqueStrings();
    return result;
}

// Helper function to generate random number between min and max (inclusive)
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to generate ZSFN amounts based on case and scenario
function generateZFSN(assignedCase, assignedScenario, amounts, oneToManyNumber) {
    const [delivery, type] = assignedCase.split('-');
    const totalAmount = Array.isArray(amounts) ? amounts.reduce((sum, amt) => sum + (parseFloat(amt) || 0), 0) : (parseFloat(amounts) || 0);
    const { isEqual } = config;
    
    if (delivery === 'UnderDelivery' && assignedScenario === 'OneToOne') {
        if (isEqual) { 
            return [totalAmount]; 
        } else { 
            return [randomBetween(1, Math.max(1, totalAmount - 1))]; 
        }
    } else if (delivery === 'OverDelivery' && assignedScenario === 'OneToOne') {
        // One random number larger than amount
        return [randomBetween(totalAmount + 1, totalAmount + 1000)];
    } else if (delivery === 'OverDelivery' && assignedScenario === 'OneToMany') {
        // Multiple random numbers where sum is larger than amount
        const numbers = [];
        let sum = 0;
        
        // Generate numbers that sum to at least amount + 1
        for (let i = 0; i < oneToManyNumber - 1; i++) {
            const num = randomBetween(1, Math.floor(totalAmount / oneToManyNumber) + 100);
            numbers.push(num);
            sum += num;
        }
        
        // Last number ensures sum is larger than amount
        const lastNumber = randomBetween(totalAmount - sum + 1, totalAmount - sum + 500);
        numbers.push(lastNumber);
        
        return numbers;
    } else if (delivery === 'UnderDelivery' && assignedScenario === 'OneToMany') {
        if (isEqual) {
            // Multiple random numbers where sum is equal to amount
            const numbers = [];
            let sum = 0;
            
            for (let i = 0; i < oneToManyNumber - 1; i++) {
                const maxForThisNumber = Math.floor((totalAmount - sum) / (oneToManyNumber - i));
                const num = randomBetween(1, Math.max(1, maxForThisNumber));
                numbers.push(num);
                sum += num;
            }
            
            // Last number to reach exact amount
            const lastNumber = Math.max(1, totalAmount - sum);
            numbers.push(lastNumber);
            
            return numbers;
        } else {
            // Multiple random numbers where sum is less than amount
            const numbers = [];
            let sum = 0;
            const targetSum = randomBetween(1, Math.max(1, totalAmount - 1));
            
            for (let i = 0; i < oneToManyNumber - 1; i++) {
                const maxForThisNumber = Math.floor((targetSum - sum) / (oneToManyNumber - i));
                const num = randomBetween(1, Math.max(1, maxForThisNumber));
                numbers.push(num);
                sum += num;
            }
            
            // Last number to reach target sum (less than amount)
            const lastNumber = Math.max(1, targetSum - sum);
            numbers.push(lastNumber);
            
            return numbers;
        }
    } else if (delivery === 'UnderDelivery' && assignedScenario === 'ManyToOne') {
        // Generate single ZFSN for multiple prepayments (underdelivery)
        // Always equal to total amount for ManyToOne (don't check isEqual)
        return [totalAmount];
    } else if (delivery === 'OverDelivery' && assignedScenario === 'ManyToOne') {
        // Generate single ZFSN for multiple prepayments (overdelivery)
        return [randomBetween(totalAmount + 1, totalAmount + 1000)];
    }
    
    return [totalAmount]; // Default fallback
}

// Function to read JSON template based on company code
function loadTemplate(companyCode) {
    const templatePath = path.join(__dirname, 'Sample/Delivery', `${companyCode}.json`);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found for company code: ${companyCode}`);
    }
    return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
}

// Function to deep clone an object
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Function to create JSON body for a single record
function createJSONBody(template, prepaymentRequestNumber, zsfnValue, testId) {
    const jsonBody = deepClone(template);
    const salesOrderItem = jsonBody.SalesOrder[0].SalesOrderItem[0];
    
    // Update PrepaymentRequestnumber
    salesOrderItem.PrepaymentRequestnumber = prepaymentRequestNumber || '';
    
    // Update the three fields based on testId
    salesOrderItem.YY1_SFDCLINEID_I = testId;
    salesOrderItem.YY1_SALESFORCEID_I = testId;
    salesOrderItem.YY1_BATCHID_I = testId;
    
    // Update SalesOrderItemsSet
    jsonBody.SalesOrder[0].SalesOrderItemsSet = [testId];
    
    // Update ZSFN value in PricingElement
    const zsfnElement = salesOrderItem.PricingElement.find(pe => pe.ConditionType === 'ZSFN');
    if (zsfnElement && zsfnValue !== null && zsfnValue !== undefined) {
        zsfnElement.ConditionRateValue = parseFloat(zsfnValue) || 0;
    }
    
    return jsonBody;
}

// Function to process a single test case and send API requests
async function processCase(caseData, caseName, template, companyCode) {
    const results = [];
    const transactionOrderNumbers = [];
    const records = caseData.record;
    
    console.log(`  Processing case: ${caseName}`);
    
    // Extract data from records
    const prepaymentNumbers = records.map(r => r.PrepaymentRequestnumber);
    const amounts = records.map(r => r.Amount);
    const billingNumbers = records.map(r => r.BillingNumber);
    const soNumbers = records.map(r => r.SoNumber);
    const uniquePrepaymentNumbers = [...new Set(prepaymentNumbers)];
    
    // Parse case name to determine delivery type, case type, and scenario
    const caseParts = caseName.split('-');
    const deliveryType = caseParts[0]; // ManyToOne, OneToOne, OneToMany
    const detailType = caseParts[1]; // OverDelivery, UnderDelivery
    const caseType = caseParts[2]; // Happy, NoPrepayment, DiffPrepayment (for Over/Under delivery)
    
    // Determine scenario from case name
    let assignedScenario = 'OneToOne'; // default
    if (caseName.includes('ManyToOne')) {
        assignedScenario = 'ManyToOne';
    } else if (caseName.includes('OneToMany')) {
        assignedScenario = 'OneToMany';
    }
    
    // Determine the full case type for processing
    let fullCaseType = caseType;
    if ((caseType === 'OverDelivery' || caseType === 'UnderDelivery') && detailType) {
        fullCaseType = `${caseType}-${detailType}`;
    }
    
    console.log(`    Scenario: ${assignedScenario}, Case Type: ${fullCaseType}`);
    
    // Determine number of deliveries for OneToMany
    let oneToManyNumber = 1;
    if (assignedScenario === 'OneToMany') {
        oneToManyNumber = amounts.length > 1 ? amounts.length : 2; // Default to 2 if only one amount
    }
    
    // Generate ZSFN amounts based on case and scenario
    const zsfnAmounts = generateZFSN(fullCaseType, assignedScenario, amounts, oneToManyNumber);
    console.log(`    Generated ZSFN amounts: ${zsfnAmounts.join(', ')}`);
    
    // Helper function to create JSON and send request
    async function createAndSendRequest(prepaymentReq, zsfnVal, testId) {
        const jsonBody = createJSONBody(template, prepaymentReq, zsfnVal, testId);
        results.push(jsonBody);
        
        try {
            console.log(`    Sending request for TestID: ${testId}...`);
            const response = await sendRequest(jsonBody);
            
            if (response && response.TransactionOrderNumber) {
                transactionOrderNumbers.push(response.TransactionOrderNumber);
                console.log(`    ✅ Success: ${testId} - TransactionOrderNumber: ${response.TransactionOrderNumber}`);
            } else {
                transactionOrderNumbers.push('NO_TRANSACTION_NUMBER');
                console.log(`    ⚠️  Success but no TransactionOrderNumber: ${testId}`);
            }
            
            // Add small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
            
        } catch (error) {
            transactionOrderNumbers.push('ERROR');
            console.log(`    ❌ Failed: ${testId} - ${error.message}`);
        }
    }
    
    // Determine prepayment request numbers to use based on case type
    function getPrepaymentRequestNumbers() {
        // console.log("detailType:", detailType, "caseType:", caseType, "deliveryType:", deliveryType);
        
        // Determine the scenario type from deliveryType
        if (deliveryType === 'OneToOne') {
            // OneToOne: Always create exactly 1 prepayment number
            if (detailType === 'Happy' || caseType === 'Happy') {
                // Use the first original prepayment number
                return [uniquePrepaymentNumbers[0]];
            } else if (detailType === 'NoPrepayment') {
                // Use empty string
                return [''];
            } else if (detailType === 'DiffPrepayment') {
                // Generate 1 new unique ID
                return [generateUniqueId(9)];
            }
            
        } else if (deliveryType === 'OneToMany') {
            // OneToMany: Create array of min 2 to max MaxNumberOneToMany
            const maxNumber = config.MaxNumberOneToMany || 3; // Default to 3 if not in config
            const arraySize = Math.max(2, Math.min(maxNumber, oneToManyNumber)); // Ensure min 2, max MaxNumberOneToMany
            
            if (detailType === 'Happy' || caseType === 'Happy') {
                // Create array filled with the same original prepayment number
                return new Array(arraySize).fill(uniquePrepaymentNumbers[0]);
            } else if (detailType === 'NoPrepayment') {
                // Create array filled with empty strings
                return new Array(arraySize).fill('');
            } else if (detailType === 'DiffPrepayment') {
                // Generate the same amount of different prepayment numbers
                return Array.from({ length: arraySize }, () => generateUniqueId(9));
            }
            
        } else if (deliveryType === 'ManyToOne') {
            // ManyToOne: Always use exactly 1 prepayment number
            if (detailType === 'Happy' || caseType === 'Happy') {
                // Use the first original prepayment number
                return [uniquePrepaymentNumbers[0]];
            } else if (detailType === 'NoPrepayment') {
                // Use empty string
                return [''];
            } else if (detailType === 'DiffPrepayment') {
                // Generate 1 new unique ID
                return [generateUniqueId(9)];
            }
        }
        
        // Fallback to original behavior
        return uniquePrepaymentNumbers;
    }

    
    const prepaymentRequestNumbers = getPrepaymentRequestNumbers();
    
    // Handle different scenarios
    if (assignedScenario === 'ManyToOne') {
        // ManyToOne: Multiple prepayment numbers, create single request
        const firstPrepaymentNumber = prepaymentRequestNumbers[0];
        const testId = `Delvr_${firstPrepaymentNumber || 'ManyToOne'}`;
        const zsfn = zsfnAmounts[0]; // Use generated ZSFN amount
        
        await createAndSendRequest(firstPrepaymentNumber, zsfn, testId);
        
    } else if (assignedScenario === 'OneToMany') {
        // OneToMany: Single prepayment number, create multiple requests
        const basePrepaymentNumber = prepaymentRequestNumbers[0];
        
        for (let i = 0; i < oneToManyNumber; i++) {
            const testId = `Delvr_${basePrepaymentNumber || 'OneToMany'}_${i + 1}`;
            const zsfn = zsfnAmounts[i]; // Use corresponding generated ZSFN amount
            
            await createAndSendRequest(basePrepaymentNumber, zsfn, testId);
        }
        
    } else {
        // OneToOne: Create requests for each unique prepayment number
        for (let i = 0; i < prepaymentRequestNumbers.length; i++) {
            const prepaymentNumber = prepaymentRequestNumbers[i];
            const testId = `Delvr_${prepaymentNumber || `OneToOne_${i + 1}`}`;
            const zsfn = zsfnAmounts[0]; // Use generated ZSFN amount (should be single value for OneToOne)
            
            await createAndSendRequest(prepaymentNumber, zsfn, testId);
        }
    }
    
    // Concatenate TransactionOrderNumbers with comma delimiter
    const transactionOrderNumbersString = transactionOrderNumbers.join(', ');
    
    // Create CSV-compatible result object
    const csvResult = {
        'Company Code': companyCode,
        'Data Source': 'JSON',
        'SO Number': soNumbers.join(', '),
        'Record Index': records.map((_, i) => i + 1).join(', '),
        'Billing Number': billingNumbers.join(', '),
        'Original Prepayment Request Number': prepaymentNumbers.join(', '),
        'Amount': amounts.join(', '),
        'Assigned Case': fullCaseType,
        'Assigned Scenario': assignedScenario,
        'OneToMany Number': assignedScenario === 'OneToMany' ? results.length : 
                        assignedScenario === 'ManyToOne' ? uniquePrepaymentNumbers.length : null,
        'ZFSN': zsfnAmounts.join(', '), // Using generated ZSFN amounts
        'Generated Prepayment Request Number': prepaymentRequestNumbers.join(', '),
        'Processed': true,
        'TransactionOrderNumbers': transactionOrderNumbersString
    };
    
    return { 
        jsonBodies: results, 
        transactionOrderNumbers: transactionOrderNumbersString,
        caseName: caseName,
        scenario: assignedScenario,
        caseType: fullCaseType,
        csvResult: csvResult
    };
}

// Function to convert object to CSV row
function objectToCsvRow(obj) {
    const values = [
        obj['Company Code'] || '',
        obj['Data Source'] || '',
        obj['SO Number'] || '',
        obj['Record Index'] || '',
        obj['Billing Number'] || '',
        obj['Original Prepayment Request Number'] || '',
        obj['Amount'] || '',
        obj['Assigned Case'] || '',
        obj['Assigned Scenario'] || '',
        obj['OneToMany Number'] || '',
        obj['ZFSN'] || '',
        obj['Generated Prepayment Request Number'] || '',
        obj['Processed'] || false,
        obj['TransactionOrderNumbers'] || ''
    ];
    
    // Escape values that contain commas or quotes
    return values.map(value => {
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    }).join(',');
}

// Main function
async function main() {
    try {
        // Load unique strings at startup
        loadUniqueStrings();
        
        // Read and parse JSON file
        const jsonFilePath = path.join(__dirname, 'Prepayment_Data.json');
        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const inputData = JSON.parse(jsonContent);
        
        console.log(`Processing JSON data for companies: ${Object.keys(inputData).join(', ')}`);
        console.log(`Config loaded - isEqual: ${config.isEqual}`);
        
        // Create output directories
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        // Process each company group
        let totalJsonsCreated = 0;
        let totalRequestsSent = 0;
        let totalSuccessfulRequests = 0;
        const allCsvResults = [];
        const resultsData = {};
        
        for (const companyCode of Object.keys(inputData)) {
            console.log(`\nProcessing company: ${companyCode}`);
            
            try {
                const template = loadTemplate(companyCode);
                const companyData = inputData[companyCode];
                const records = companyData.Records || [];
                const allJsonBodies = [];
                const caseResults = [];
                
                console.log(`  Found ${records.length} test case(s)`);
                
                // Process each test case
                for (let index = 0; index < records.length; index++) {
                    const caseData = records[index];
                    const caseName = caseData.case;
                    
                    console.log(`  Processing case ${index + 1}/${records.length}: ${caseName}`);
                    
                    // Process the case
                    const { jsonBodies, transactionOrderNumbers, scenario, caseType, csvResult } = await processCase(caseData, caseName, template, companyCode);
                    
                    // Add JSONs to collection
                    allJsonBodies.push(...jsonBodies);
                    
                    // Add CSV result to collection
                    allCsvResults.push(csvResult);
                    
                    // Store case results
                    const caseResult = {
                        caseName: caseName,
                        scenario: scenario,
                        caseType: caseType,
                        originalData: caseData,
                        generatedJsonCount: jsonBodies.length,
                        transactionOrderNumbers: transactionOrderNumbers
                    };
                    caseResults.push(caseResult);
                    
                    console.log(`  Case ${caseName}: Generated ${jsonBodies.length} JSON(s), TransactionOrderNumbers: ${transactionOrderNumbers}`);
                    
                    totalJsonsCreated += jsonBodies.length;
                    totalRequestsSent += jsonBodies.length;
                    
                    // Count successful requests
                    const successCount = transactionOrderNumbers.split(', ').filter(num => num !== 'ERROR' && num !== 'NO_TRANSACTION_NUMBER').length;
                    totalSuccessfulRequests += successCount;
                }
                
                // Save JSON bodies to output folder
                const outputFilePath = path.join(outputDir, `${companyCode}_generated.json`);
                fs.writeFileSync(outputFilePath, JSON.stringify(allJsonBodies, null, 2));
                
                // Store results data
                resultsData[companyCode] = caseResults;
                
                console.log(`  Total JSONs created for ${companyCode}: ${allJsonBodies.length}`);
                console.log(`  JSON output written to: ${outputFilePath}`);
                
            } catch (error) {
                console.error(`Error processing company ${companyCode}:`, error.message);
            }
        }
        
        // Generate CSV output
        const csvHeaders = [
            'Company Code',
            'Data Source', 
            'SO Number',
            'Record Index',
            'Billing Number',
            'Original Prepayment Request Number',
            'Amount',
            'Assigned Case',
            'Assigned Scenario',
            'OneToMany Number',
            'ZFSN',
            'Generated Prepayment Request Number',
            'Processed',
            'TransactionOrderNumbers'
        ].join(',');
        
        const csvRows = allCsvResults.map(row => objectToCsvRow(row)).join('\n');
        const csvContent = csvHeaders + '\n' + csvRows;
        
        // Save CSV file
        const csvFilePath = path.join(__dirname, 'processing-results-updated.csv');
        fs.writeFileSync(csvFilePath, csvContent, 'utf8');
        
        // Save overall results summary
        const overallSummaryPath = path.join(outputDir, 'overall_results_summary.json');
        const overallSummary = {
            timestamp: new Date().toISOString(),
            totalCompaniesProcessed: Object.keys(inputData).length,
            totalJsonsCreated: totalJsonsCreated,
            totalRequestsSent: totalRequestsSent,
            totalSuccessfulRequests: totalSuccessfulRequests,
            totalFailedRequests: totalRequestsSent - totalSuccessfulRequests,
            companiesResults: resultsData
        };
        fs.writeFileSync(overallSummaryPath, JSON.stringify(overallSummary, null, 2));
        
        console.log(`\n=== Summary ===`);
        console.log(`Total companies processed: ${Object.keys(inputData).length}`);
        console.log(`Total JSON bodies created: ${totalJsonsCreated}`);
        console.log(`Total API requests sent: ${totalRequestsSent}`);
        console.log(`Successful API requests: ${totalSuccessfulRequests}`);
        console.log(`Failed API requests: ${totalRequestsSent - totalSuccessfulRequests}`);
        console.log(`JSON output directory: ${outputDir}`);
        console.log(`CSV results saved to: ${csvFilePath}`);
        console.log(`Overall summary saved to: ${overallSummaryPath}`);
        
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main, processCase, createJSONBody };