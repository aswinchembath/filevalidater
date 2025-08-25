const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const _ = require('lodash');

class SourceDestinationValidator {
  constructor() {
    this.sourceData = [];
    this.destinationData = [];
    this.comparisonResults = {
      summary: {},
      detailedComparison: [],
      missingInDestination: [],
      extraInDestination: [],
      dataMismatches: [],
      timestamp: new Date().toLocaleString()
    };
  }

  /**
   * Load data from source file
   * @param {string} sourceFilePath - Path to the source file
   * @param {string} delimiter - Delimiter character
   */
  loadSourceData(sourceFilePath, delimiter = null) {
    return new Promise((resolve, reject) => {
      try {
        // Auto-detect delimiter if not specified
        if (!delimiter) {
          delimiter = this.detectDelimiter(sourceFilePath);
        }

        const data = [];
        let rowNumber = 1;

        fs.createReadStream(sourceFilePath)
          .pipe(csv({ separator: delimiter }))
          .on('data', (row) => {
            data.push({
              rowNumber: rowNumber,
              data: row
            });
            rowNumber++;
          })
          .on('end', () => {
            this.sourceData = data;
            console.log(`Loaded ${data.length} records from source file using delimiter: '${delimiter}'`);
            resolve(data);
          })
          .on('error', (error) => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Load data from destination file
   * @param {string} destinationFilePath - Path to the destination file
   * @param {string} delimiter - Delimiter character
   */
  loadDestinationData(destinationFilePath, delimiter = null) {
    return new Promise((resolve, reject) => {
      try {
        // Auto-detect delimiter if not specified
        if (!delimiter) {
          delimiter = this.detectDelimiter(destinationFilePath);
        }

        const data = [];
        let rowNumber = 1;

        fs.createReadStream(destinationFilePath)
          .pipe(csv({ separator: delimiter }))
          .on('data', (row) => {
            data.push({
              rowNumber: rowNumber,
              data: row
            });
            rowNumber++;
          })
          .on('end', () => {
            this.destinationData = data;
            console.log(`Loaded ${data.length} records from destination file using delimiter: '${delimiter}'`);
            resolve(data);
          })
          .on('error', (error) => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Auto-detect delimiter by examining the first few lines
   * @param {string} filePath - Path to the file
   */
  detectDelimiter(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8').split('\n')[0];
      const delimiters = [',', '|', ';', '\t'];
      
      for (const delim of delimiters) {
        if (content.includes(delim)) {
          const parts = content.split(delim);
          if (parts.length > 1) {
            return delim;
          }
        }
      }
      
      return ','; // Default to comma
    } catch (error) {
      return ','; // Default fallback
    }
  }

  /**
   * Compare source and destination files
   * @param {Array} keyFields - Array of field names to use as composite key for comparison
   * @param {boolean} strictComparison - If true, all fields must match exactly
   */
  compareFiles(keyFields = null, strictComparison = false) {
    if (this.sourceData.length === 0 || this.destinationData.length === 0) {
      throw new Error('Both source and destination data must be loaded before comparison');
    }

    console.log('Starting file comparison...');
    
    // If no key fields specified, use all fields from source
    const fieldsToCheck = keyFields || Object.keys(this.sourceData[0].data);
    console.log(`Using key fields for comparison: ${fieldsToCheck.join(', ')}`);

    // Create maps for efficient lookup
    const sourceMap = new Map();
    const destinationMap = new Map();

    // Index source data
    this.sourceData.forEach(item => {
      const compositeKey = fieldsToCheck.map(field => String(item.data[field] || '')).join('|');
      sourceMap.set(compositeKey, item);
    });

    // Index destination data
    this.destinationData.forEach(item => {
      const compositeKey = fieldsToCheck.map(field => String(item.data[field] || '')).join('|');
      destinationMap.set(compositeKey, item);
    });

    // Find missing records in destination
    this.comparisonResults.missingInDestination = [];
    sourceMap.forEach((sourceItem, key) => {
      if (!destinationMap.has(key)) {
        this.comparisonResults.missingInDestination.push({
          compositeKey: key,
          sourceRow: sourceItem.rowNumber,
          sourceData: sourceItem.data,
          keyFields: fieldsToCheck,
          keyValues: fieldsToCheck.map(field => sourceItem.data[field])
        });
      }
    });

    // Find extra records in destination
    this.comparisonResults.extraInDestination = [];
    destinationMap.forEach((destItem, key) => {
      if (!sourceMap.has(key)) {
        this.comparisonResults.extraInDestination.push({
          compositeKey: key,
          destinationRow: destItem.rowNumber,
          destinationData: destItem.data,
          keyFields: fieldsToCheck,
          keyValues: fieldsToCheck.map(field => destItem.data[field])
        });
      }
    });

    // Find data mismatches for records present in both
    this.comparisonResults.dataMismatches = [];
    if (strictComparison) {
      sourceMap.forEach((sourceItem, key) => {
        if (destinationMap.has(key)) {
          const destItem = destinationMap.get(key);
          const mismatches = this.findFieldMismatches(sourceItem.data, destItem.data, fieldsToCheck);
          
          if (mismatches.length > 0) {
            this.comparisonResults.dataMismatches.push({
              compositeKey: key,
              sourceRow: sourceItem.rowNumber,
              destinationRow: destItem.rowNumber,
              sourceData: sourceItem.data,
              destinationData: destItem.data,
              mismatches: mismatches,
              keyFields: fieldsToCheck,
              keyValues: fieldsToCheck.map(field => sourceItem.data[field])
            });
          }
        }
      });
    }

    // Generate summary
    this.comparisonResults.summary = {
      sourceRecordCount: this.sourceData.length,
      destinationRecordCount: this.destinationData.length,
      matchingRecords: this.sourceData.length - this.comparisonResults.missingInDestination.length,
      missingInDestination: this.comparisonResults.missingInDestination.length,
      extraInDestination: this.comparisonResults.extraInDestination.length,
      dataMismatches: this.comparisonResults.dataMismatches.length,
      keyFields: fieldsToCheck,
      strictComparison: strictComparison,
      comparisonDate: new Date().toLocaleString()
    };

    // Generate detailed comparison
    this.generateDetailedComparison();

    console.log('File comparison completed');
    return this.comparisonResults;
  }

  /**
   * Find field mismatches between source and destination records
   * @param {Object} sourceRecord - Source record
   * @param {Object} destinationRecord - Destination record
   * @param {Array} keyFields - Key fields to exclude from comparison
   */
  findFieldMismatches(sourceRecord, destinationRecord, keyFields) {
    const mismatches = [];
    const allFields = new Set([...Object.keys(sourceRecord), ...Object.keys(destinationRecord)]);
    
    allFields.forEach(field => {
      if (!keyFields.includes(field)) {
        const sourceValue = sourceRecord[field] || '';
        const destValue = destinationRecord[field] || '';
        
        if (String(sourceValue).trim() !== String(destValue).trim()) {
          mismatches.push({
            field: field,
            sourceValue: sourceValue,
            destinationValue: destValue,
            difference: 'Value mismatch'
          });
        }
      }
    });

    return mismatches;
  }

  /**
   * Generate detailed comparison results
   */
  generateDetailedComparison() {
    this.comparisonResults.detailedComparison = [];
    
    // Add summary row
    this.comparisonResults.detailedComparison.push({
      Category: '📊 COMPARISON SUMMARY',
      'Source Records': this.comparisonResults.summary.sourceRecordCount,
      'Destination Records': this.comparisonResults.summary.destinationRecordCount,
      'Matching Records': this.comparisonResults.summary.matchingRecords,
      'Missing in Destination': this.comparisonResults.summary.missingInDestination,
      'Extra in Destination': this.comparisonResults.summary.extraInDestination,
      'Data Mismatches': this.comparisonResults.summary.dataMismatches,
      'Status': this.getOverallStatus()
    });

    // Add key fields information
    this.comparisonResults.detailedComparison.push({
      Category: '🔑 COMPARISON KEY FIELDS',
      'Key Fields': this.comparisonResults.summary.keyFields.join(', '),
      'Strict Comparison': this.comparisonResults.summary.strictComparison ? 'Yes' : 'No',
      'Comparison Date': this.comparisonResults.summary.comparisonDate,
      'Status': '',
      'Status': '',
      'Status': ''
    });
  }

  /**
   * Get overall comparison status
   */
  getOverallStatus() {
    const { missingInDestination, extraInDestination, dataMismatches } = this.comparisonResults.summary;
    
    if (missingInDestination === 0 && extraInDestination === 0 && dataMismatches === 0) {
      return '✅ Perfect Match';
    } else if (missingInDestination <= 5 && extraInDestination <= 5 && dataMismatches <= 10) {
      return '⚠️ Minor Differences';
    } else if (missingInDestination <= 20 && extraInDestination <= 20 && dataMismatches <= 50) {
      return '🟠 Moderate Differences';
    } else {
      return '🔴 Major Differences';
    }
  }

  /**
   * Generate Excel report for source vs destination comparison
   * @param {string} outputFilePath - Path for the output Excel file
   */
  generateComparisonReport(outputFilePath) {
    if (!this.comparisonResults.summary) {
      throw new Error('No comparison results available. Please run comparison first.');
    }

    // Create workbook and worksheets
    const workbook = XLSX.utils.book_new();
    
    // Executive Summary worksheet
    const summaryData = this.generateSummaryData();
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    this.formatWorksheet(summarySheet, 'summary');
    XLSX.utils.book_append_sheet(workbook, summarySheet, '📊 Executive Summary');

    // Detailed Comparison worksheet
    const detailedData = this.generateDetailedComparisonData();
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    this.formatWorksheet(detailedSheet, 'detailed');
    XLSX.utils.book_append_sheet(workbook, detailedSheet, '🔍 Detailed Comparison');

    // Missing Records worksheet
    if (this.comparisonResults.missingInDestination.length > 0) {
      const missingData = this.generateMissingRecordsData();
      const missingSheet = XLSX.utils.json_to_sheet(missingData);
      this.formatWorksheet(missingSheet, 'missing');
      XLSX.utils.book_append_sheet(workbook, missingSheet, '❌ Missing in Destination');
    }

    // Extra Records worksheet
    if (this.comparisonResults.extraInDestination.length > 0) {
      const extraData = this.generateExtraRecordsData();
      const extraSheet = XLSX.utils.json_to_sheet(extraData);
      this.formatWorksheet(extraSheet, 'extra');
      XLSX.utils.book_append_sheet(workbook, extraSheet, '➕ Extra in Destination');
    }

    // Data Mismatches worksheet
    if (this.comparisonResults.dataMismatches.length > 0) {
      const mismatchData = this.generateDataMismatchesData();
      const mismatchSheet = XLSX.utils.json_to_sheet(mismatchData);
      this.formatWorksheet(mismatchSheet, 'mismatches');
      XLSX.utils.book_append_sheet(workbook, mismatchSheet, '⚠️ Data Mismatches');
    }

    // Write to file
    XLSX.writeFile(workbook, outputFilePath);
    console.log(`Source vs Destination comparison report generated: ${outputFilePath}`);
  }

  /**
   * Generate summary data for Excel report
   */
  generateSummaryData() {
    const summary = this.comparisonResults.summary;
    
    return [
      { Section: 'SOURCE VS DESTINATION COMPARISON REPORT', Value: '', Details: '', Status: '' },
      { Section: 'Generated On', Value: summary.comparisonDate, Details: 'Report generation timestamp', Status: '' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '📊 COMPARISON SUMMARY', Value: '', Details: '', Status: '' },
      { Section: 'Overall Status', Value: this.getOverallStatus(), Details: 'Overall comparison result', Status: this.getOverallStatus() },
      { Section: 'Source File Records', Value: summary.sourceRecordCount, Details: 'Total records in source file', Status: '📄' },
      { Section: 'Destination File Records', Value: summary.destinationRecordCount, Details: 'Total records in destination file', Status: '📄' },
      { Section: 'Matching Records', Value: summary.matchingRecords, Details: 'Records present in both files with matching keys', Status: '✅' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '🔍 DIFFERENCE ANALYSIS', Value: '', Details: '', Status: '' },
      { Section: 'Missing in Destination', Value: summary.missingInDestination, Details: 'Records in source but not in destination', Status: summary.missingInDestination > 0 ? '❌' : '✅' },
      { Section: 'Extra in Destination', Value: summary.extraInDestination, Details: 'Records in destination but not in source', Status: summary.extraInDestination > 0 ? '⚠️' : '✅' },
      { Section: 'Data Mismatches', Value: summary.dataMismatches, Details: 'Records with different field values', Status: summary.dataMismatches > 0 ? '⚠️' : '✅' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '⚙️ COMPARISON CONFIGURATION', Value: '', Details: '', Status: '' },
      { Section: 'Key Fields', Value: summary.keyFields.join(', '), Details: 'Fields used for record matching', Status: '🔑' },
      { Section: 'Strict Comparison', Value: summary.strictComparison ? 'Yes' : 'No', Details: 'Whether all fields must match exactly', Status: summary.strictComparison ? '🔒' : '🔓' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '📈 RECOMMENDATIONS', Value: '', Details: '', Status: '' },
      { Section: 'Priority Level', Value: this.getPriorityLevel(), Details: 'Recommended action priority', Status: this.getPriorityLevel() === 'High' ? '🔴' : this.getPriorityLevel() === 'Medium' ? '🟡' : '🟢' },
      { Section: 'Next Steps', Value: this.getNextSteps(), Details: 'Recommended next actions', Status: '📋' }
    ];
  }

  /**
   * Get priority level based on differences
   */
  getPriorityLevel() {
    const { missingInDestination, extraInDestination, dataMismatches } = this.comparisonResults.summary;
    const totalDifferences = missingInDestination + extraInDestination + dataMismatches;
    
    if (totalDifferences === 0) return 'Low';
    if (totalDifferences <= 10) return 'Medium';
    return 'High';
  }

  /**
   * Get recommended next steps
   */
  getNextSteps() {
    const { missingInDestination, extraInDestination, dataMismatches } = this.comparisonResults.summary;
    
    if (missingInDestination === 0 && extraInDestination === 0 && dataMismatches === 0) {
      return 'Files are identical - no action needed';
    }
    
    const steps = [];
    if (missingInDestination > 0) steps.push('Review missing records in destination');
    if (extraInDestination > 0) steps.push('Review extra records in destination');
    if (dataMismatches > 0) steps.push('Review data mismatches');
    
    return steps.join('; ');
  }

  /**
   * Generate detailed comparison data
   */
  generateDetailedComparisonData() {
    return this.comparisonResults.detailedComparison;
  }

  /**
   * Generate missing records data
   */
  generateMissingRecordsData() {
    const missingData = [
      { Category: '❌ MISSING RECORDS IN DESTINATION', 'Composite Key': '', 'Source Row': '', 'Key Fields': '', 'Key Values': '', 'Status': '' },
      { Category: `Total Missing: ${this.comparisonResults.missingInDestination.length}`, 'Composite Key': '', 'Key Fields': '', 'Key Values': '', 'Status': '' },
      { Category: '', 'Composite Key': '', 'Source Row': '', 'Key Fields': '', 'Key Values': '', 'Status': '' }
    ];
    
    this.comparisonResults.missingInDestination.forEach(item => {
      missingData.push({
        Category: 'Missing Record',
        'Composite Key': item.compositeKey,
        'Source Row': item.sourceRow,
        'Key Fields': item.keyFields.join(', '),
        'Key Values': item.keyValues.join(' | '),
        'Status': '❌ Missing'
      });
    });

    return missingData;
  }

  /**
   * Generate extra records data
   */
  generateExtraRecordsData() {
    const extraData = [
      { Category: '➕ EXTRA RECORDS IN DESTINATION', 'Composite Key': '', 'Destination Row': '', 'Key Fields': '', 'Key Values': '', 'Status': '' },
      { Category: `Total Extra: ${this.comparisonResults.extraInDestination.length}`, 'Composite Key': '', 'Key Fields': '', 'Key Values': '', 'Status': '' },
      { Category: '', 'Composite Key': '', 'Destination Row': '', 'Key Fields': '', 'Key Values': '', 'Status': '' }
    ];
    
    this.comparisonResults.extraInDestination.forEach(item => {
      extraData.push({
        Category: 'Extra Record',
        'Composite Key': item.compositeKey,
        'Destination Row': item.destinationRow,
        'Key Fields': item.keyFields.join(', '),
        'Key Values': item.keyValues.join(' | '),
        'Status': '➕ Extra'
      });
    });

    return extraData;
  }

  /**
   * Generate data mismatches data
   */
  generateDataMismatchesData() {
    const mismatchData = [
      { Category: '⚠️ DATA MISMATCHES', 'Composite Key': '', 'Source Row': '', 'Dest Row': '', 'Field': '', 'Source Value': '', 'Dest Value': '' },
      { Category: `Total Mismatches: ${this.comparisonResults.dataMismatches.length}`, 'Composite Key': '', 'Source Row': '', 'Dest Row': '', 'Field': '', 'Source Value': '', 'Dest Value': '' },
      { Category: '', 'Composite Key': '', 'Source Row': '', 'Dest Row': '', 'Field': '', 'Source Value': '', 'Dest Value': '' }
    ];
    
    this.comparisonResults.dataMismatches.forEach(item => {
      item.mismatches.forEach(mismatch => {
        mismatchData.push({
          Category: 'Data Mismatch',
          'Composite Key': item.compositeKey,
          'Source Row': item.sourceRow,
          'Dest Row': item.destinationRow,
          'Field': mismatch.field,
          'Source Value': mismatch.sourceValue,
          'Dest Value': mismatch.destinationValue
        });
      });
    });

    return mismatchData;
  }

  /**
   * Format worksheet with appropriate column widths
   * @param {Object} worksheet - The worksheet to format
   * @param {string} type - The type of worksheet
   */
  formatWorksheet(worksheet, type) {
    if (!worksheet['!cols']) {
      worksheet['!cols'] = [];
    }
    
    switch (type) {
      case 'summary':
        worksheet['!cols'] = [
          { width: 30 }, // Section
          { width: 20 }, // Value
          { width: 50 }, // Details
          { width: 15 }  // Status
        ];
        break;
      case 'detailed':
        worksheet['!cols'] = [
          { width: 25 }, // Category
          { width: 15 }, // Source Records
          { width: 15 }, // Destination Records
          { width: 15 }, // Matching Records
          { width: 15 }, // Missing in Destination
          { width: 15 }, // Extra in Destination
          { width: 15 }  // Status
        ];
        break;
      case 'missing':
        worksheet['!cols'] = [
          { width: 25 }, // Category
          { width: 30 }, // Composite Key
          { width: 12 }, // Source Row
          { width: 30 }, // Key Fields
          { width: 40 }, // Key Values
          { width: 15 }  // Status
        ];
        break;
      case 'extra':
        worksheet['!cols'] = [
          { width: 25 }, // Category
          { width: 30 }, // Composite Key
          { width: 15 }, // Destination Row
          { width: 30 }, // Key Fields
          { width: 40 }, // Key Values
          { width: 15 }  // Status
        ];
        break;
      case 'mismatches':
        worksheet['!cols'] = [
          { width: 20 }, // Category
          { width: 30 }, // Composite Key
          { width: 12 }, // Source Row
          { width: 12 }, // Dest Row
          { width: 20 }, // Field
          { width: 25 }, // Source Value
          { width: 25 }  // Dest Value
        ];
        break;
    }
  }

  /**
   * Get comparison statistics
   */
  getComparisonStats() {
    return this.comparisonResults.summary;
  }
}

module.exports = SourceDestinationValidator;
