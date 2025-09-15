// Script to generate case_records.json based on config.yaml
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Load configuration from config.yaml
const config = yaml.parse(fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8'));

function generateCaseRecordsFromConfig() {
  const records = [];
  const caseCount = config.Case;
  // Build scenario weighted list
  const scenarioWeights = [];
  function pushScenario(scenario, count) {
    for (let i = 0; i < count; i++) scenarioWeights.push(scenario);
  }
  pushScenario('OneToOne', config.TotalOneToOne || 0);
  pushScenario('OneToMany', config.TotalOneToMany || 0);
  pushScenario('ManyToOne', config.TotalManyToOne || 0);
  // Build type weighted list
  const typeWeights = [];
  function pushType(type, deliveryType, count) {
    for (let i = 0; i < count; i++) typeWeights.push({ type, deliveryType });
  }
  pushType('Happy', 'UnderDelivery', config.UnderDelivery.TotalHappy || 0);
  pushType('NoPrepayment', 'UnderDelivery', config.UnderDelivery.TotalNoPrepayment || 0);
  pushType('DiffPrepayment', 'UnderDelivery', config.UnderDelivery.TotalDiffPrepayment || 0);
  pushType('Happy', 'OverDelivery', config.OverDelivery.TotalHappy || 0);
  pushType('NoPrepayment', 'OverDelivery', config.OverDelivery.TotalNoPrepayment || 0);
  pushType('DiffPrepayment', 'OverDelivery', config.OverDelivery.TotalDiffPrepayment || 0);
  for (let i = 0; i < caseCount; i++) {
    const scenario = scenarioWeights[Math.floor(Math.random() * scenarioWeights.length)];
    const typePick = typeWeights[Math.floor(Math.random() * typeWeights.length)];
    records.push({
      case: `${scenario}-${typePick.type}-${typePick.deliveryType}`
    });
  }
  const output = { record: records };
  fs.writeFileSync(path.join(__dirname, 'case_records.json'), JSON.stringify(output, null, 2));
  console.log('case_records.json generated.');
}

// Run if executed directly
if (require.main === module) {
  generateCaseRecordsFromConfig();
}

// Export the function for use in other modules
module.exports = { generateCaseRecordsFromConfig };