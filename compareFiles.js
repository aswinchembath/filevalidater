#!/usr/bin/env node

const SourceDestinationValidator = require('./sourceDestinationValidator');
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
    console.log('Source vs Destination File Validator');
    console.log('===================================');
    console.log('');
    console.log('Usage: node compareFiles.js <source-file> <destination-file> [options]');
    console.log('');
    console.log('Arguments:');
    console.log('  source-file      - Path to the source file (CSV or pipe-delimited)');
    console.log('  destination-file - Path to the destination file (CSV or pipe-delimited)');
    console.log('');
    console.log('Options:');
    console.log('  --output <file>  - Output file name (default: comparison_report.xlsx)');
    console.log('  --delimiter <char> - Delimiter character (auto-detected if not specified)');
    console.log('  --key-fields <fields> - Comma-separated key fields for comparison');
    console.log('  --strict         - Enable strict comparison (all fields must match)');
    console.log('  --help           - Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  # Basic comparison with auto-detected delimiter');
    console.log('  node compareFiles.js source.csv destination.csv');
    console.log('');
    console.log('  # Custom output file');
    console.log('  node compareFiles.js source.csv destination.csv --output my_comparison.xlsx');
    console.log('');
    console.log('  # Specify key fields for comparison');
    console.log('  node compareFiles.js source.csv destination.csv --key-fields "ID,Email,Name"');
    console.log('');
    console.log('  # Enable strict comparison');
    console.log('  node compareFiles.js source.csv destination.csv --strict');
    console.log('');
    console.log('  # Force specific delimiter');
    console.log('  node compareFiles.js source.csv destination.csv --delimiter ","');
    console.log('');
    console.log('Key Fields:');
    console.log('  - If not specified, all fields will be used for comparison');
    console.log('  - Key fields determine how records are matched between files');
    console.log('  - Use fields that should be unique identifiers (e.g., ID, Email, etc.)');
    console.log('');
    console.log('Strict Comparison:');
    console.log('  - When enabled, all non-key fields must match exactly');
    console.log('  - When disabled, only key fields are compared for matching');
    console.log('  - Useful for detecting data inconsistencies beyond missing/extra records');
    process.exit(1);
  }

  // Parse arguments
  const sourceFile = args[0];
  const destinationFile = args[1];
  let outputFileName = 'comparison_report.xlsx';
  let delimiter = null;
  let keyFields = null;
  let strictComparison = false;

  // Parse options
  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
        outputFileName = args[++i];
        break;
      case '--delimiter':
        delimiter = args[++i];
        break;
      case '--key-fields':
        keyFields = args[++i].split(',').map(field => field.trim());
        break;
      case '--strict':
        strictComparison = true;
        break;
      case '--help':
        console.log('Source vs Destination File Validator');
        console.log('===================================');
        console.log('');
        console.log('Usage: node compareFiles.js <source-file> <destination-file> [options]');
        console.log('');
        console.log('Arguments:');
        console.log('  source-file      - Path to the source file (CSV or pipe-delimited)');
        console.log('  destination-file - Path to the destination file (CSV or pipe-delimited)');
        console.log('');
        console.log('Options:');
        console.log('  --output <file>  - Output file name (default: comparison_report.xlsx)');
        console.log('  --delimiter <char> - Delimiter character (auto-detected if not specified)');
        console.log('  --key-fields <fields> - Comma-separated key fields for comparison');
        console.log('  --strict         - Enable strict comparison (all fields must match)');
        console.log('  --help           - Show this help message');
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        console.error('Use --help for usage information');
        process.exit(1);
    }
  }

  // Setup artifacts folder
  setupArtifactsFolder();
  const outputFile = getArtifactsOutputPath(outputFileName);

  // Validate file paths
  if (!fs.existsSync(sourceFile)) {
    console.error(`Error: Source file '${sourceFile}' not found`);
    process.exit(1);
  }

  if (!fs.existsSync(destinationFile)) {
    console.error(`Error: Destination file '${destinationFile}' not found`);
    process.exit(1);
  }

  console.log('\nSource vs Destination File Validator');
  console.log('===================================');
  console.log(`Source file: ${sourceFile}`);
  console.log(`Destination file: ${destinationFile}`);
  console.log(`Output file: ${outputFile}`);
  console.log(`Delimiter: ${delimiter ? `'${delimiter}'` : 'auto-detect'}`);
  console.log(`Key fields: ${keyFields ? keyFields.join(', ') : 'all fields'}`);
  console.log(`Strict comparison: ${strictComparison ? 'Yes' : 'No'}`);
  console.log('');

  try {
    const validator = new SourceDestinationValidator();

    // Load source data
    console.log('Loading source file...');
    await validator.loadSourceData(sourceFile, delimiter);
    
    // Load destination data
    console.log('Loading destination file...');
    await validator.loadDestinationData(destinationFile, delimiter);

    // Perform comparison
    console.log('\nPerforming file comparison...');
    const results = validator.compareFiles(keyFields, strictComparison);

    // Display comparison summary
    const summary = results.summary;
    console.log('\nComparison Summary:');
    console.log('==================');
    console.log(`Source Records: ${summary.sourceRecordCount}`);
    console.log(`Destination Records: ${summary.destinationRecordCount}`);
    console.log(`Matching Records: ${summary.matchingRecords}`);
    console.log(`Missing in Destination: ${summary.missingInDestination}`);
    console.log(`Extra in Destination: ${summary.extraInDestination}`);
    console.log(`Data Mismatches: ${summary.dataMismatches}`);
    console.log(`Overall Status: ${validator.getOverallStatus()}`);

    // Generate Excel report
    console.log('\nGenerating comparison report...');
    validator.generateComparisonReport(outputFile);

    // Display detailed results
    console.log('\nDetailed Results:');
    console.log('=================');
    
    if (summary.missingInDestination > 0) {
      console.log(`❌ Missing Records: ${summary.missingInDestination} records found in source but not in destination`);
    }
    
    if (summary.extraInDestination > 0) {
      console.log(`➕ Extra Records: ${summary.extraInDestination} records found in destination but not in source`);
    }
    
    if (summary.dataMismatches > 0) {
      console.log(`⚠️  Data Mismatches: ${summary.dataMismatches} records have different field values`);
    }

    if (summary.missingInDestination === 0 && summary.extraInDestination === 0 && summary.dataMismatches === 0) {
      console.log('✅ Perfect Match: Source and destination files are identical');
    } else {
      console.log('\n📊 Comparison completed with differences found.');
      console.log(`📁 Detailed report saved to: ${outputFile}`);
      console.log(`📁 Check the artifacts folder for all output files`);
      
      // Show recommendations
      console.log('\nRecommendations:');
      console.log('================');
      console.log(`Priority Level: ${validator.getPriorityLevel()}`);
      console.log(`Next Steps: ${validator.getNextSteps()}`);
    }

  } catch (error) {
    console.error('Error during comparison:', error.message);
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
