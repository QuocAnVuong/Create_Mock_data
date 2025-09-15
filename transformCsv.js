const fs = require('fs');
const Papa = require('papaparse');
const yaml = require('yaml');
const XLSX = require('xlsx');

// Load configuration from config.yaml
const config = yaml.parse(fs.readFileSync('config.yaml', 'utf8'));
const configType = config.prepaymentCurrency;

// Read the processing-results-updated.csv file
const csvData = fs.readFileSync('processing-results-updated.csv', 'utf8');

// Parse the CSV data
const parsed = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true
});

// Define the new column headers
const newHeaders = [
    'Reference Number (Prepayment SO)',
    'Sold to Party', 
    'Prepayment SO Number',
    'Prepayment SO Line Item Number',
    'Prepayment SO Amount',
    'Prepayment SO Currency',
    'Billing Document (Prepayment Tax Invoice)',
    'Reference Number (Delivery SO)',
    'Delivery SO Number',
    'Delivery SO Line Item Number', 
    'Delivery SO Amount',
    'Delivery SO Currency',
    'Amount to Apply',
    'Sales Organization',
    'Data Source',
    'Assigned Case',
    'Assigned Scenario',
    'Number Of Case'
];

const technicalHeaders = [
    'I_Salesdocument-YY1_PrepaymentReqNum',
    'I_Salesdocument - Soldtoparty',
    'I_Salesdocument-Salesdocument', 
    'I_Salesdocumentitem-Salesdocumentitem',
    'I_Salesdocumentitem-Netamount',
    'I_Salesdocument-Currency',
    'I_Billingdocument-Billingdocument',
    'I_Salesdocument-YY1_PrepaymentReqNum',
    'I_Salesdocument-Salesdocument',
    'I_Salesdocumentitem-Salesdocumentitem',
    'I_Salesdocumentitem-Netamount',
    'I_Salesdocument-Currency',
    'Customzed field (refer to field I_Salesdocumentitem-Netamount)',
    'I_Salesdocument-SALESORGANIZATION',
    'Data Source',
    'Assigned Case',
    'Assigned Scenario', 
    'Number Of Case'
];

// Function to determine currency based on config type and company code
function getCurrency(companyCode) {
    // If type is 'Local', use company-specific currencies
    if (configType === 'Local') {
        const currencyMap = {
            'SAC1': 'SAR',
            'MAC1': 'MAD', 
            'EGC1': 'EGP',
            'AEC1': 'USD'
        };
        return currencyMap[companyCode] || 'USD';
    } else {
        // If type is not 'Local', use the configured type as currency
        return configType.toUpperCase();
    }
}

// Function to generate sold to party based on company code
function getSoldToParty(companyCode) {
    const soldToPartyMap = {
        'SAC1': 'HS58M1PTWJ',
        'MAC1': '4F32L8O0DG',
        'EGC1': '275554HENP',
        'AEC1': '4F32L8O0DG'
    };
    return soldToPartyMap[companyCode] || 'Unknown';
}

// Function to process each row and handle different scenarios
function processRow(row) {
    const results = [];
    
    const assignedCase = row['Assigned Case'];
    const assignedScenario = row['Assigned Scenario'];
    const originalPrepaymentReq = row['Original Prepayment Request Number'];
    const generatedPrepaymentReqs = row['Generated Prepayment Request Number'] ? 
        row['Generated Prepayment Request Number'].split(', ').map(s => s.trim()) : [''];
    const deliveryAmounts = row['ZFSN'] ? 
        row['ZFSN'].split(', ').map(s => s.trim()) : [''];
    const transactionOrders = row['TransactionOrderNumbers'] ? 
        row['TransactionOrderNumbers'].split(', ').map(s => s.trim()) : [''];
    
    // Parse comma-separated values for all scenarios
    const soNumbers = row['SO Number'] ? 
        row['SO Number'].split(', ').map(s => s.trim()) : [''];
    const billingNumbers = row['Billing Number'] ? 
        row['Billing Number'].split(', ').map(s => s.trim()) : [''];
    const amounts = row['Amount'] ? 
        row['Amount'].toString().split(', ').map(s => s.trim()) : [''];
    const prepaymentReqs = originalPrepaymentReq ? 
        originalPrepaymentReq.split(', ').map(s => s.trim()) : [''];
    const recordIndices = row['Record Index'] ? 
        row['Record Index'].split(', ').map(s => s.trim()) : [''];
    
    const baseData = {
        'Sold to Party': getSoldToParty(row['Company Code']),
        'Prepayment SO Currency': getCurrency(row['Company Code']),
        'Sales Organization': row['Company Code'],
        'Data Source': row['Data Source'],
        'Assigned Case': row['Assigned Case'],
        'Assigned Scenario': row['Assigned Scenario'],
        'Number Of Case': assignedScenario === 'OneToOne' ? '1' : row['OneToMany Number']
    };

    // Handle different scenarios
    if (assignedScenario === 'OneToOne') {
        // OneToOne scenario - single row
        const deliveryRefNum = generatedPrepaymentReqs[0] || '';
        const deliveryAmount = deliveryAmounts[0] || '';
        const deliveryOrder = transactionOrders[0] || '';
        const recordIndex = recordIndices[0] || row['Record Index'] || '';
        
        results.push({
            ...baseData,
            'Reference Number (Prepayment SO)': prepaymentReqs[0] || '',
            'Prepayment SO Number': soNumbers[0] || '',
            'Prepayment SO Line Item Number': recordIndex ? (parseInt(recordIndex) * 10).toString() : '',
            'Prepayment SO Amount': amounts[0] || '',
            'Billing Document (Prepayment Tax Invoice)': billingNumbers[0] || '',
            'Reference Number (Delivery SO)': deliveryRefNum,
            'Delivery SO Number': deliveryOrder,
            'Delivery SO Line Item Number': '10',
            'Delivery SO Amount': deliveryAmount,
            'Delivery SO Currency': getCurrency(row['Company Code']),
            'Amount to Apply': deliveryAmount
        });
    } else if (assignedScenario === 'OneToMany') {
        // OneToMany scenario - multiple rows
        const isHappyScenario = assignedCase.includes('Happy');
        const recordIndex = recordIndices[0] || row['Record Index'] || '';
        
        for (let i = 0; i < Math.max(generatedPrepaymentReqs.length, deliveryAmounts.length, transactionOrders.length); i++) {
            const deliveryRefNum = generatedPrepaymentReqs[i] || '';
            const deliveryAmount = deliveryAmounts[i] || '';
            const deliveryOrder = transactionOrders[i] || '';
            
            // For Happy scenarios, use original prepayment request number for delivery reference
            const finalDeliveryRefNum = (isHappyScenario && originalPrepaymentReq === deliveryRefNum) ? 
                originalPrepaymentReq : deliveryRefNum;
            
            results.push({
                ...baseData,
                'Reference Number (Prepayment SO)': prepaymentReqs[0] || '', // Single prepayment SO
                'Prepayment SO Number': soNumbers[0] || '',
                'Prepayment SO Line Item Number': recordIndex ? (parseInt(recordIndex) * 10).toString() : '',
                'Prepayment SO Amount': amounts[0] || '',
                'Billing Document (Prepayment Tax Invoice)': billingNumbers[0] || '',
                'Reference Number (Delivery SO)': finalDeliveryRefNum,
                'Delivery SO Number': deliveryOrder,
                'Delivery SO Line Item Number': '10',
                'Delivery SO Amount': deliveryAmount,
                'Delivery SO Currency': getCurrency(row['Company Code']),
                'Amount to Apply': deliveryAmount
            });
        }
    } else if (assignedScenario === 'ManyToOne') {
        // ManyToOne scenario - multiple prepayment SOs to one delivery SO
        const deliveryRefNum = generatedPrepaymentReqs[0] || ''; // Single delivery reference
        const deliveryAmount = deliveryAmounts[0] || '';
        const deliveryOrder = transactionOrders[0] || '';
        const numberOfRows = parseInt(row['OneToMany Number']) || Math.max(
            prepaymentReqs.length, 
            soNumbers.length, 
            billingNumbers.length, 
            amounts.length,
            recordIndices.length
        );
        
        // Create multiple rows, each with different prepayment SO data but same delivery SO
        for (let i = 0; i < numberOfRows; i++) {
            const prepaymentRef = prepaymentReqs[i] || '';
            const soNumber = soNumbers[i] || '';
            const billingNumber = billingNumbers[i] || '';
            const amount = amounts[i] || '';
            const recordIndex = recordIndices[i] || '';
            
            results.push({
                ...baseData,
                'Reference Number (Prepayment SO)': prepaymentRef, // Different for each row
                'Prepayment SO Number': soNumber, // Different for each row
                'Prepayment SO Line Item Number': recordIndex ? (parseInt(recordIndex) * 10).toString() : '', // Different for each row
                'Prepayment SO Amount': amount, // Different for each row
                'Billing Document (Prepayment Tax Invoice)': billingNumber, // Different for each row
                'Reference Number (Delivery SO)': deliveryRefNum,   // Same for all rows
                'Delivery SO Number': deliveryOrder,
                'Delivery SO Line Item Number': '10',
                'Delivery SO Amount': deliveryAmount,
                'Delivery SO Currency': getCurrency(row['Company Code']),
                'Amount to Apply': deliveryAmount,
                'Number Of Case': numberOfRows.toString()
            });
        }
    }
    
    return results;
}

// Process all rows
const transformedData = [];
parsed.data.forEach(row => {
    if (row['Company Code']) { // Skip empty rows
        const processedRows = processRow(row);
        transformedData.push(...processedRows);
    }
});

// Create the worksheet data
const worksheetData = [];

// Add headers
worksheetData.push(newHeaders);
worksheetData.push(technicalHeaders);

// Add transformed data
transformedData.forEach(row => {
    const excelRow = newHeaders.map(header => row[header] || '');
    worksheetData.push(excelRow);
});

// Create a new workbook and worksheet
const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

// Optional: Set column widths for better readability
const columnWidths = newHeaders.map(() => ({ wch: 20 })); // 20 characters wide
worksheet['!cols'] = columnWidths;

// Optional: Style the header rows
const headerRange = XLSX.utils.decode_range(worksheet['!ref']);
for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
    // Style first header row
    const headerCell1 = XLSX.utils.encode_cell({ r: 0, c: col });
    if (worksheet[headerCell1]) {
        worksheet[headerCell1].s = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "366092" } },
            alignment: { horizontal: "center" }
        };
    }
    
    // Style second header row (technical headers)
    const headerCell2 = XLSX.utils.encode_cell({ r: 1, c: col });
    if (worksheet[headerCell2]) {
        worksheet[headerCell2].s = {
            font: { bold: true, color: { rgb: "000000" } },
            fill: { fgColor: { rgb: "D9E1F2" } },
            alignment: { horizontal: "center" }
        };
    }
}

// Add worksheet to workbook
XLSX.utils.book_append_sheet(workbook, worksheet, 'Transformed Data');

// Write the Excel file
XLSX.writeFile(workbook, 'transformed-prepayment-scenarios.xlsx');

console.log('Excel transformation completed! Output saved to: transformed-prepayment-scenarios.xlsx');
console.log(`Configuration type: ${configType}`);
console.log(`Currency used: ${configType === 'Local' ? 'Company-specific currencies' : configType.toUpperCase()}`);
console.log(`Processed ${transformedData.length} rows from ${parsed.data.length} original rows`);

// Log scenario breakdown for debugging
const scenarioBreakdown = {};
transformedData.forEach(row => {
    const scenario = row['Assigned Scenario'];
    scenarioBreakdown[scenario] = (scenarioBreakdown[scenario] || 0) + 1;
});

console.log('\nScenario breakdown:');
Object.entries(scenarioBreakdown).forEach(([scenario, count]) => {
    console.log(`  ${scenario}: ${count} rows`);
});