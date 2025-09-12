const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const axios = require('axios');

// Read configuration once
let config = null;
function getConfig() {
    if (!config) {
        const configPath = path.join(__dirname, 'config.yaml');
        const configFile = fs.readFileSync(configPath, 'utf8');
        config = yaml.parse(configFile);
    }
    return config;
}

async function sendRequest(jsonBody, env) {
    try {
        const config = getConfig();
        const endpoint = config.endpoint.SRV_010_Create;
        const { url, username, password } = endpoint;
        
        if (!url || !username || !password) {
            throw new Error('Missing endpoint configuration in config.yaml');
        }
        if (env == 'Cust') {
            url = url+'_Cust';
        }
        
        const authConfig = {
            auth: {
                username: username,
                password: password
            },
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000
        };
        
        const response = await axios.post(url, jsonBody, authConfig);
        console.log(response.data);

        // Save response data to file
        const responseFile = path.join(__dirname, 'responses.json');
        let responses = [];
        
        // Read existing responses if file exists
        if (fs.existsSync(responseFile)) {
            try {
                const existingData = fs.readFileSync(responseFile, 'utf8');
                responses = JSON.parse(existingData);
            } catch (error) {
                // If file is corrupted, start with empty array
                responses = [];
            }
        }
        
        // Add new response
        // responses.push(response.data);
        
        // // Write back to file
        // fs.writeFileSync(responseFile, JSON.stringify(responses, null, 2));
        
        const responseData = response.data;
        
        // Extract TransactionOrderNumber and TransactionOrderItem
        const result = {
            TransactionOrderNumber: responseData.TransactionOrderNumber || null,
            TransactionOrderItem: responseData.LineDetails && responseData.LineDetails.length > 0 
                ? responseData.LineDetails[0].TransactionOrderItem || null 
                : null
        };
        
        return result;
        
    } catch (error) {
        const errorMessage = error.response ? 
            `HTTP ${error.response.status}: ${error.response.statusText}` : 
            error.message;
        
        console.log(`Error: ${errorMessage}`);
        throw error;
    }
}

module.exports = sendRequest;