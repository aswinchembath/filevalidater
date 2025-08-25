#!/usr/bin/env node

const CSVValidator = require('./csvValidator');
const SourceDestinationValidator = require('./sourceDestinationValidator');
const fs = require('fs');
const path = require('path');

/**
 * Create test data files for demonstration
 */
function createTestFiles() {
  const artifactsPath = path.join(__dirname, 'artifacts');
  if (!fs.existsSync(artifactsPath)) {
    fs.mkdirSync(artifactsPath, { recursive: true });
  }

  // Create test mapping file
  const mappingData = `Target Field Name,Target Data Type,Null Allowed,Description
ID,integer,No,Unique identifier
Name,string,No,Customer name
Email,string,No,Email address
Phone,string,Yes,Phone number
Status,string,No,Account status
Amount,DECIMAL(10,2),Yes,Transaction amount
CreatedDate,date,No,Creation date`;

  fs.writeFileSync(path.join(artifactsPath, 'test_mapping.csv'), mappingData);

  // Create test input file with duplicates and formatting issues
  const inputData = `ID|Name|Email|Phone|Status|Amount|CreatedDate
1|John Doe|john@example.com|555-1234|Active|100.50|2024-01-15
2|Jane Smith|jane@example.com|555-5678|Inactive|250.75|2024-01-16
3|John Doe|john@example.com|555-1234|Active|100.50|2024-01-15
4|Bob Wilson|bob@example.com|555-9012|Active|75.25|2024-01-17
5|Alice Brown|ALICE@EXAMPLE.COM|555-3456|Pending|300.00|2024-01-18
6|Charlie Davis|charlie@example.com| 555-7890 |Active|125.50|2024-01-19
7|Eva Green|eva@example.com|555-2345|Active|200.00|01/20/2024
8|Frank Lee|frank@example.com|555-6789|Active|150.75|2024-01-21`;

  fs.writeFileSync(path.join(artifactsPath, 'test_input.csv'), inputData);

  // Create test source file
  const sourceData = `ID|Name|Email|Status
1|John Doe|john@example.com|Active
2|Jane Smith|jane@example.com|Inactive
3|Bob Wilson|bob@example.com|Active
4|Alice Brown|alice@example.com|Pending`;

  fs.writeFileSync(path.join(artifactsPath, 'test_source.csv'), sourceData);

  // Create test destination file with differences
  const destinationData = `ID|Name|Email|Status
1|John Doe|john@example.com|Active
2|Jane Smith|jane@example.com|Inactive
3|Bob Wilson|bob@example.com|Inactive
5|Eva Green|eva@example.com|Active`;

  fs.writeFileSync(path.join(artifactsPath, 'test_destination.csv'), destinationData);

  console.log('✅ Test files created in artifacts folder');
}

/**
 * Test the main CSV validator with new features
 */
async function testMainValidator() {
  console.log('\n🧪 Testing Main CSV Validator with New Features...');
  
  try {
    const validator = new CSVValidator();
    
    // Load mapping rules
    await validator.loadMappingRules('./artifacts/test_mapping.csv');
    console.log('✅ Mapping rules loaded');
    
    // Validate input file
    await validator.validateInputFile('./artifacts/test_input.csv', '|');
    console.log('✅ File validation completed');
    
    // Generate Excel report
    validator.generateExcelReport('./artifacts/main_validation_report.xlsx');
    console.log('✅ Main validation report generated');
    
    // Display results
    const stats = validator.getValidationStats();
    console.log(`\n📊 Main Validation Results:`);
    console.log(`Total Records: ${stats.totalRecords}`);
    console.log(`Valid Records: ${stats.validRecords}`);
    console.log(`Invalid Records: ${stats.invalidRecords}`);
    console.log(`Success Rate: ${stats.successRate.toFixed(2)}%`);
    
    // Display duplicate and formatting results
    console.log(`\n🔄 Duplicate Detection:`);
    console.log(`Duplicate Records: ${validator.duplicateResults.length}`);
    
    console.log(`\n📝 Formatting Issues:`);
    console.log(`Records with Formatting Issues: ${validator.missFormattedResults.length}`);
    
  } catch (error) {
    console.error('❌ Error in main validation:', error.message);
  }
}

/**
 * Test the source vs destination validator
 */
async function testSourceDestinationValidator() {
  console.log('\n🧪 Testing Source vs Destination Validator...');
  
  try {
    const validator = new SourceDestinationValidator();
    
    // Load both files
    await validator.loadSourceData('./artifacts/test_source.csv', '|');
    console.log('✅ Source file loaded');
    
    await validator.loadDestinationData('./artifacts/test_destination.csv', '|');
    console.log('✅ Destination file loaded');
    
    // Compare files with strict comparison
    const results = validator.compareFiles(['ID'], true);
    console.log('✅ File comparison completed');
    
    // Generate comparison report
    validator.generateComparisonReport('./artifacts/comparison_report.xlsx');
    console.log('✅ Comparison report generated');
    
    // Display results
    const summary = results.summary;
    console.log(`\n📊 Comparison Results:`);
    console.log(`Source Records: ${summary.sourceRecordCount}`);
    console.log(`Destination Records: ${summary.destinationRecordCount}`);
    console.log(`Matching Records: ${summary.matchingRecords}`);
    console.log(`Missing in Destination: ${summary.missingInDestination}`);
    console.log(`Extra in Destination: ${summary.extraInDestination}`);
    console.log(`Data Mismatches: ${summary.dataMismatches}`);
    console.log(`Overall Status: ${validator.getOverallStatus()}`);
    
  } catch (error) {
    console.error('❌ Error in source destination validation:', error.message);
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Testing New CSV Validator Features');
  console.log('=====================================');
  
  // Create test files
  createTestFiles();
  
  // Test main validator
  await testMainValidator();
  
  // Test source destination validator
  await testSourceDestinationValidator();
  
  console.log('\n🎉 All tests completed!');
  console.log('📁 Check the artifacts folder for generated reports:');
  console.log('   - main_validation_report.xlsx (Main validation with duplicates & formatting)');
  console.log('   - comparison_report.xlsx (Source vs destination comparison)');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, createTestFiles };
