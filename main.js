const { generateCaseRecordsFromConfig } = require('./generateCaseRecords');
const { main: createPrepaymentMain } = require('./createPrepayment');
const { main: createDeliveryMain } = require('./createDelivery');

/**
 * Main orchestrator function that runs the entire workflow:
 * 1. Generate case records from config
 * 2. Create prepayment data
 * 3. Create delivery data
 * 4. Transform CSV to Excel format
 */
async function main() {
    console.log('🚀 Starting the complete workflow...\n');
    
    try {
        // Step 1: Generate case records from config
        console.log('📋 Step 1: Generating case records from config...');
        await generateCaseRecordsFromConfig();
        console.log('✅ Case records generated successfully\n');
        
        // Step 2: Create prepayment data
        console.log('💳 Step 2: Creating prepayment data...');
        await createPrepaymentMain();
        console.log('✅ Prepayment data created successfully\n');
        
        // Step 3: Create delivery data
        console.log('📦 Step 3: Creating delivery data...');
        await createDeliveryMain();
        console.log('✅ Delivery data created successfully\n');
        
        // Step 4: Transform CSV to Excel format
        console.log('📊 Step 4: Transforming CSV data to Excel format...');
        require('./transformCsv');
        console.log('✅ CSV transformation completed successfully\n');
        
        console.log('🎉 Complete workflow finished successfully!');
        
    } catch (error) {
        console.error('❌ Error during workflow execution:', error.message);
        console.error('Stack trace:', error.stack);
        process.exitCode = 1;
    }
}

// Run the main function if this script is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error in main orchestrator:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { main };