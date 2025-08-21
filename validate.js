#!/usr/bin/env node

const CSVValidator = require('./csvValidator');
const path = require('path');
const fs = require('fs');

/**
 * Clean up artifacts folder and recreate it
 */
function setupArtifactsFolder() {
  const artifactsPath = path.join(__dirname, 'artifacts');
  
  // Remove artifacts folder if it exists
  if (fs.existsSync(artifactsPath)) {
    fs.rmSync(artifactsPath, { recursive: true, force: true });
    console.log('🧹 Cleaned up existing artifacts folder');
  }
  
  // Create fresh artifacts folder
  fs.mkdirSync(artifactsPath, { recursive: true });
  console.log('📁 Created artifacts folder');
  
  return artifactsPath;
}

/**
 * Generate output file path in artifacts folder
 */
function getArtifactsOutputPath(outputFile) {
  const artifactsPath = path.join(__dirname, 'artifacts');
  return path.join(artifactsPath, outputFile);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('CSV Validator - Salesforce Field Validation');
    console.log('==========================================');
    console.log('');
    console.log('Usage: node validate.js <mapping-file> <input-file> [output-file] [delimiter]');
    console.log('');
    console.log('Arguments:');
    console.log('  mapping-file  - Path to the CSV mapping rules file (e.g., salesforce_mapping.csv)');
    console.log('  input-file    - Path to the input file (CSV or pipe-delimited)');
    console.log('  output-file   - Path for the output Excel report (optional, defaults to validation_report.xlsx)');
    console.log('  delimiter     - Delimiter character (optional, auto-detected if not specified)');
    console.log('');
    console.log('Examples:');
    console.log('  # Validate Salesforce data with default output');
    console.log('  node validate.js salesforce_mapping.csv salesforce_input.csv');
    console.log('');
    console.log('  # Custom output file');
    console.log('  node validate.js salesforce_mapping.csv salesforce_input.csv salesforce_validation_report.xlsx');
    console.log('');
    console.log('  # Force specific delimiter');
    console.log('  node validate.js salesforce_mapping.csv salesforce_input.csv report.xlsx ","');
    console.log('');
    console.log('Mapping File Format:');
    console.log('  - Target Field Name: Field name to validate');
    console.log('  - Null Allowed: Yes/No (Yes = field can be empty/null/blank, No = required)');
    console.log('  - Target Data Type: Data type (string, DECIMAL(18,2), boolean, timestamp, etc.)');
    console.log('  - Description: Field description (optional)');
    console.log('');
    console.log('Data Type Support:');
    console.log('  - String types: string, text, picklist, multipicklist, textarea, email, url, phone');
    console.log('  - Numeric types: integer, decimal, number, double, float, currency, percent');
    console.log('  - Date types: date, timestamp, datetime, time');
    console.log('  - Boolean types: boolean, bool');
    console.log('  - Case-insensitive: All data types are handled regardless of case (STRING, String, string)');
    process.exit(1);
  }

  // Setup artifacts folder
  setupArtifactsFolder();

  const mappingFile = args[0];
  const inputFile = args[1];
  const outputFileName = args[2] && !args[2].startsWith('-') ? args[2] : 'validation_report.xlsx';
  const outputFile = getArtifactsOutputPath(outputFileName);
  const delimiter = args[3] || null;

  // Validate file paths
  if (!require('fs').existsSync(mappingFile)) {
    console.error(`Error: Mapping file '${mappingFile}' not found`);
    process.exit(1);
  }

  if (!require('fs').existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' not found`);
    process.exit(1);
  }

  console.log('\nCSV Validator - Salesforce Field Validation');
  console.log('==========================================');
  console.log(`Mapping file: ${mappingFile}`);
  console.log(`Input file: ${inputFile}`);
  console.log(`Output file: ${outputFile}`);
  console.log(`Delimiter: ${delimiter ? `'${delimiter}'` : 'auto-detect'}`);
  console.log('');

  try {
    const validator = new CSVValidator();

    // Load mapping rules
    console.log('Loading validation rules...');
    await validator.loadMappingRules(mappingFile);
    
    // Display loaded rules summary
    console.log(`\nLoaded ${validator.validationRules.length} validation rules:`);
    validator.validationRules.forEach((rule, index) => {
      const requiredText = rule.required ? 'Required' : 'Optional';
      const nullAllowedText = rule.nullAllowed ? 'Yes' : 'No';
      console.log(`  ${index + 1}. ${rule.fieldName} (${rule.originalDataType}) - ${requiredText} (Null Allowed: ${nullAllowedText})`);
    });

    // Display validation summary
    console.log('\nValidation Rules Summary:');
    console.log('========================');
    const ruleTypes = {};
    validator.validationRules.forEach(rule => {
      const dataType = rule.originalDataType;
      ruleTypes[dataType] = (ruleTypes[dataType] || 0) + 1;
    });
    
    Object.entries(ruleTypes)
      .sort(([,a], [,b]) => b - a)
      .forEach(([dataType, count]) => {
        console.log(`  ${dataType}: ${count} fields`);
      });
    
    const requiredCount = validator.validationRules.filter(r => r.required).length;
    const optionalCount = validator.validationRules.filter(r => !r.required).length;
    console.log(`  Required Fields: ${requiredCount}`);
    console.log(`  Optional Fields: ${optionalCount}`);
    
    // Display header validation information
    console.log('\nHeader Validation Information:');
    console.log('==============================');
    console.log(`Expected Headers: ${validator.validationRules.length}`);
    console.log(`Header Validation: Will be performed before data validation`);
    console.log(`Case Sensitivity: Headers must match exactly (case-sensitive)`);

    // Validate input file
    console.log('\nValidating input file...');
    await validator.validateInputFile(inputFile, delimiter);

    // Generate Excel report
    console.log('Generating Excel report...');
    validator.generateExcelReport(outputFile);

    // Display detailed summary
    const stats = validator.getValidationStats();
    if (stats) {
      console.log('');
      console.log('Validation Summary:');
      console.log('==================');
      console.log(`Total Records: ${stats.totalRecords}`);
      console.log(`Valid Records: ${stats.validRecords}`);
      console.log(`Invalid Records: ${stats.invalidRecords}`);
      console.log(`Total Errors: ${stats.totalErrors}`);
      console.log(`Total Warnings: ${stats.totalWarnings}`);
      console.log(`Success Rate: ${stats.successRate.toFixed(2)}%`);
      console.log('');

      // Show field-level error summary
      let fieldErrors = {};
      let uniqueErrors = new Set();
      
      if (stats.invalidRecords > 0) {
        console.log('Field Error Summary:');
        console.log('==================');
        
        validator.validationResults.forEach(result => {
          result.errors.forEach(error => {
            const fieldName = validator.extractFieldNameFromError(error);
            fieldErrors[fieldName] = (fieldErrors[fieldName] || 0) + 1;
            
            // Extract unique error types
            let errorType = 'Unknown Error';
            if (error.includes('required') && (error.includes('missing') || error.includes('empty/null/blank'))) {
              errorType = 'Required Field Missing';
            } else if (error.includes('invalid data type')) {
              errorType = 'Invalid Data Type';
            } else if (error.includes('not a valid')) {
              errorType = 'Invalid Format';
            } else if (error.includes('precision') || error.includes('decimal places') || error.includes('exceeds maximum')) {
              errorType = 'Decimal Precision Error';
            } else if (error.includes('too short') || error.includes('too long')) {
              errorType = 'Length Constraint Error';
            } else if (error.includes('pattern')) {
              errorType = 'Pattern Mismatch';
            } else if (error.includes('allowed values')) {
              errorType = 'Invalid Value';
            } else if (error.includes('not a valid number')) {
              errorType = 'Invalid Number Format';
            } else if (error.includes('not a valid integer')) {
              errorType = 'Invalid Integer Format';
            } else if (error.includes('not a valid boolean')) {
              errorType = 'Invalid Boolean Format';
            } else if (error.includes('not a valid date') || error.includes('not a valid timestamp')) {
              errorType = 'Invalid Date/Time Format';
            }
            uniqueErrors.add(errorType);
          });
        });

        Object.entries(fieldErrors)
          .sort(([,a], [,b]) => b - a)
          .forEach(([field, count]) => {
            console.log(`  ${field}: ${count} errors`);
          });
        
        console.log('');
        console.log('Unique Error Types Found:');
        console.log('========================');
        Array.from(uniqueErrors).sort().forEach(errorType => {
          console.log(`  • ${errorType}`);
        });
        
        console.log('');
        console.log('❌ Validation completed with errors. Please check the Excel report for details.');
        console.log(`📊 Detailed report saved to: ${outputFile}`);
        console.log(`📁 Check the artifacts folder for all output files`);
      } else {
        console.log('✅ All records passed validation successfully!');
        console.log(`📊 Report saved to: ${outputFile}`);
        console.log(`📁 Check the artifacts folder for all output files`);
      }

      // Display validation summary for both success and error cases
      console.log('');
      console.log('Validation Summary:');
      console.log('==================');
      console.log(`Total Records Processed: ${stats.totalRecords}`);
      console.log(`Records with Errors: ${stats.invalidRecords}`);
      console.log(`Records without Errors: ${stats.validRecords}`);
      console.log(`Total Validation Errors: ${stats.totalErrors}`);
      console.log(`Total Validation Warnings: ${stats.totalWarnings}`);
      console.log(`Overall Success Rate: ${stats.successRate.toFixed(2)}%`);
      
      // Show validation coverage
      const totalFields = validator.validationRules.length;
      const totalValidations = stats.totalRecords * totalFields;
      console.log('');
      console.log('Validation Coverage:');
      console.log('==================');
      console.log(`Total Fields Validated: ${totalFields}`);
      console.log(`Total Field Validations: ${totalValidations}`);
      console.log(`Fields with Errors: ${Object.keys(fieldErrors || {}).length}`);
      console.log(`Fields without Errors: ${totalFields - (Object.keys(fieldErrors || {}).length)}`);
      
      // Show data type breakdown
      const dataTypeBreakdown = {};
      validator.validationRules.forEach(rule => {
        const dataType = rule.originalDataType;
        dataTypeBreakdown[dataType] = (dataTypeBreakdown[dataType] || 0) + 1;
      });
      
      console.log('');
      console.log('Data Type Validation Breakdown:');
      console.log('================================');
      Object.entries(dataTypeBreakdown)
        .sort(([,a], [,b]) => b - a)
        .forEach(([dataType, count]) => {
          console.log(`  • ${dataType}: ${count} fields validated`);
        });
      
      // Exit after showing all information
      if (stats.invalidRecords > 0) {
        process.exit(1);
      }
    }

  } catch (error) {
    console.error('Error during validation:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main();
}

module.exports = main;
