const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const _ = require('lodash');

class CSVValidator {
  constructor() {
    this.validationRules = [];
    this.validationResults = [];
  }

  /**
   * Load mapping rules from CSV file
   * @param {string} mappingFilePath - Path to the mapping CSV file
   */
  loadMappingRules(mappingFilePath) {
    return new Promise((resolve, reject) => {
      const rules = [];
      
      fs.createReadStream(mappingFilePath)
        .pipe(csv())
        .on('data', (row) => {
          // Handle different column name formats
          const fieldName = row.fieldName || row['Field Name'] || row['Target Field Name'] || row['TargetFieldName'];
          const dataType = row.dataType || row['Data Type'] || row['Target Data Type'] || row['TargetDataType'];
          const required = this.parseBoolean(row.required || row['Required'] || row['Null Allowed'] || row['NullAllowed']);
          const minLength = this.parseNumber(row.minLength || row['Min Length'] || row['MinLength']);
          const maxLength = this.parseNumber(row.maxLength || row['Max Length'] || row['MaxLength']);
          const pattern = row.pattern || row['Pattern'];
          const allowedValues = row.allowedValues || row['Allowed Values'] || row['AllowedValues'];
          const description = row.description || row['Description'];

          // Normalize data type to handle mixed case
          const normalizedDataType = this.normalizeDataType(dataType);

          rules.push({
            fieldName,
            dataType: normalizedDataType,
            originalDataType: dataType, // Keep original for display
            required: !required, // Invert since "Null Allowed" means not required
            minLength,
            maxLength,
            pattern,
            allowedValues,
            description
          });
        })
        .on('end', () => {
          this.validationRules = rules;
          console.log(`Loaded ${rules.length} validation rules`);
          resolve(rules);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Normalize data type to handle mixed case formats
   * @param {string} dataType - The data type string
   */
  normalizeDataType(dataType) {
    if (!dataType) return 'string';
    
    const normalized = dataType.toString().toLowerCase().trim();
    
    // Handle Salesforce-specific data types
    if (normalized.includes('decimal') || normalized.includes('number')) {
      return 'decimal';
    }
    if (normalized.includes('boolean')) {
      return 'boolean';
    }
    if (normalized.includes('timestamp') || normalized.includes('datetime') || normalized.includes('date')) {
      return 'date';
    }
    if (normalized.includes('string') || normalized.includes('text') || normalized.includes('picklist')) {
      return 'string';
    }
    if (normalized.includes('integer') || normalized.includes('int')) {
      return 'integer';
    }
    
    return 'string'; // Default fallback
  }

  /**
   * Parse decimal precision and scale from data type string
   * @param {string} dataType - The data type string (e.g., "DECIMAL(18,2)")
   */
  parseDecimalPrecision(dataType) {
    if (!dataType) return null;
    
    const match = dataType.toString().match(/decimal\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (match) {
      return {
        precision: parseInt(match[1]),
        scale: parseInt(match[2])
      };
    }
    return null;
  }

  /**
   * Validate a single record against the mapping rules
   * @param {Object} record - The record to validate
   * @param {number} rowNumber - Row number for error reporting
   */
  validateRecord(record, rowNumber) {
    const recordResults = {
      rowNumber,
      record,
      isValid: true,
      errors: [],
      warnings: []
    };

    this.validationRules.forEach(rule => {
      const fieldValue = record[rule.fieldName];
      const validationResult = this.validateField(fieldValue, rule, rule.fieldName);
      
      if (validationResult.errors.length > 0) {
        recordResults.isValid = false;
        recordResults.errors.push(...validationResult.errors);
      }
      
      if (validationResult.warnings.length > 0) {
        recordResults.warnings.push(...validationResult.warnings);
      }
    });

    return recordResults;
  }

  /**
   * Validate a single field against its rule
   * @param {*} value - The field value to validate
   * @param {Object} rule - The validation rule
   * @param {string} fieldName - The field name
   */
  validateField(value, rule, fieldName) {
    const result = { errors: [], warnings: [] };

    // Check if required field is present
    if (rule.required && (value === undefined || value === null || value === '')) {
      result.errors.push(`Field '${fieldName}' is required but missing`);
      return result;
    }

    // Skip validation if value is empty and not required
    if (!rule.required && (value === undefined || value === null || value === '')) {
      return result;
    }

    const stringValue = String(value);

    // Check data type
    if (rule.dataType) {
      const typeValidation = this.validateDataType(stringValue, rule.dataType, rule.originalDataType);
      if (!typeValidation.isValid) {
        result.errors.push(`Field '${fieldName}' has invalid data type. Expected: ${rule.originalDataType}, Got: ${stringValue}`);
      }
    }

    // Check length constraints
    if (rule.minLength !== undefined && stringValue.length < rule.minLength) {
      result.errors.push(`Field '${fieldName}' is too short. Minimum length: ${rule.minLength}, Actual: ${stringValue.length}`);
    }

    if (rule.maxLength !== undefined && stringValue.length > rule.maxLength) {
      result.errors.push(`Field '${fieldName}' is too long. Maximum length: ${rule.maxLength}, Actual: ${stringValue.length}`);
    }

    // Check pattern (regex)
    if (rule.pattern) {
      try {
        const regex = new RegExp(rule.pattern);
        if (!regex.test(stringValue)) {
          result.errors.push(`Field '${fieldName}' does not match required pattern: ${rule.pattern}`);
        }
      } catch (error) {
        result.warnings.push(`Invalid regex pattern for field '${fieldName}': ${rule.pattern}`);
      }
    }

    // Check allowed values
    if (rule.allowedValues) {
      const allowedValues = rule.allowedValues.split(',').map(v => v.trim());
      if (!allowedValues.includes(stringValue)) {
        result.errors.push(`Field '${fieldName}' has invalid value '${stringValue}'. Allowed values: ${allowedValues.join(', ')}`);
      }
    }

    return result;
  }

  /**
   * Validate data type
   * @param {string} value - The value to check
   * @param {string} expectedType - The expected data type
   * @param {string} originalDataType - The original data type string for decimal precision
   */
  validateDataType(value, expectedType, originalDataType) {
    switch (expectedType.toLowerCase()) {
      case 'string':
        return { isValid: true };
      case 'number':
      case 'integer':
        return { isValid: !isNaN(Number(value)) && Number.isInteger(Number(value)) };
      case 'decimal':
        const decimalValidation = this.validateDecimal(value, originalDataType);
        return decimalValidation;
      case 'date':
      case 'timestamp':
        return { isValid: !isNaN(Date.parse(value)) };
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return { isValid: emailRegex.test(value) };
      case 'phone':
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        return { isValid: phoneRegex.test(value.replace(/[\s\-\(\)]/g, '')) };
      case 'boolean':
        return { isValid: this.isValidBoolean(value) };
      default:
        return { isValid: true };
    }
  }

  /**
   * Validate decimal with precision and scale
   * @param {string} value - The value to check
   * @param {string} originalDataType - The original data type string
   */
  validateDecimal(value, originalDataType) {
    if (isNaN(Number(value))) {
      return { isValid: false };
    }

    const decimalInfo = this.parseDecimalPrecision(originalDataType);
    if (!decimalInfo) {
      return { isValid: true }; // No precision constraints
    }

    // Work with the original string value to avoid JavaScript number precision issues
    let numStr = value.toString().trim();
    
    // Handle negative numbers
    if (numStr.startsWith('-')) {
      numStr = numStr.substring(1);
    }
    
    // Check if it's a decimal
    if (!numStr.includes('.')) {
      // Integer - check total precision (integer part length)
      if (numStr.length > decimalInfo.precision) {
        return { isValid: false };
      }
    } else {
      // Decimal - check precision and scale
      const parts = numStr.split('.');
      const integerPart = parts[0];
      const decimalPart = parts[1];
      
      // Check decimal places (scale) - must have exactly the specified scale
      if (decimalPart && decimalPart.length !== decimalInfo.scale) {
        return { isValid: false };
      }
      
      // Check total digits (integer + decimal parts)
      const totalDigits = integerPart.length + (decimalPart ? decimalPart.length : 0);
      if (totalDigits > decimalInfo.precision) {
        return { isValid: false };
      }
      
      // Additional check: ensure integer part doesn't exceed (precision - scale)
      // This prevents cases like DECIMAL(5,2) with 1234.5 (4 digits + 1 decimal = 5 total, but integer part 1234 exceeds 3)
      const maxIntegerDigits = decimalInfo.precision - decimalInfo.scale;
      if (integerPart.length > maxIntegerDigits) {
        return { isValid: false };
      }
    }

    return { isValid: true };
  }

  /**
   * Check if value is a valid boolean
   * @param {string} value - The value to check
   */
  isValidBoolean(value) {
    if (typeof value === 'boolean') return true;
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      return lowerValue === 'true' || lowerValue === 'false' || 
             lowerValue === 'yes' || lowerValue === 'no' || 
             lowerValue === '1' || lowerValue === '0';
    }
    return false;
  }

  /**
   * Parse boolean value from string
   * @param {string} value - The string value to parse
   */
  parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      return lowerValue === 'true' || lowerValue === 'yes' || lowerValue === '1' || lowerValue === 'no';
    }
    return false;
  }

  /**
   * Parse number value from string
   * @param {string} value - The string value to parse
   */
  parseNumber(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Validate input file (supports both CSV and pipe-delimited)
   * @param {string} inputFilePath - Path to the input file
   * @param {string} delimiter - Delimiter character (default: auto-detect)
   */
  validateInputFile(inputFilePath, delimiter = null) {
    return new Promise((resolve, reject) => {
      const results = [];
      let rowNumber = 1; // Start from 1 for user-friendly reporting

      // Auto-detect delimiter if not specified
      if (!delimiter) {
        delimiter = this.detectDelimiter(inputFilePath);
      }

      fs.createReadStream(inputFilePath)
        .pipe(csv({ separator: delimiter }))
        .on('data', (row) => {
          const validationResult = this.validateRecord(row, rowNumber);
          results.push(validationResult);
          rowNumber++;
        })
        .on('end', () => {
          this.validationResults = results;
          console.log(`Validated ${results.length} records using delimiter: '${delimiter}'`);
          resolve(results);
        })
        .on('error', (error) => {
          reject(error);
        });
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
   * Generate Excel report with validation results
   * @param {string} outputFilePath - Path for the output Excel file
   */
  generateExcelReport(outputFilePath) {
    if (!this.validationResults || this.validationResults.length === 0) {
      throw new Error('No validation results available. Please run validation first.');
    }

    // Create workbook and worksheets
    const workbook = XLSX.utils.book_new();
    
    // Summary worksheet
    const summaryData = this.generateSummaryData();
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Detailed results worksheet
    const detailedData = this.generateDetailedData();
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    XLSX.utils.book_append_sheet(workbook, detailedSheet, 'Validation Results');

    // Error details worksheet
    const errorData = this.generateErrorData();
    if (errorData.length > 0) {
      const errorSheet = XLSX.utils.json_to_sheet(errorData);
      XLSX.utils.book_append_sheet(workbook, errorSheet, 'Error Details');
    }

    // Write to file
    XLSX.writeFile(workbook, outputFilePath);
    console.log(`Excel report generated: ${outputFilePath}`);
  }

  /**
   * Generate summary data for Excel report
   */
  generateSummaryData() {
    const totalRecords = this.validationResults.length;
    const validRecords = this.validationResults.filter(r => r.isValid).length;
    const invalidRecords = totalRecords - validRecords;
    const totalErrors = this.validationResults.reduce((sum, r) => sum + r.errors.length, 0);
    const totalWarnings = this.validationResults.reduce((sum, r) => sum + r.warnings.length, 0);

    return [
      { Metric: 'Total Records', Value: totalRecords },
      { Metric: 'Valid Records', Value: validRecords },
      { Metric: 'Invalid Records', Value: invalidRecords },
      { Metric: 'Total Errors', Value: totalErrors },
      { Metric: 'Total Warnings', Value: totalWarnings },
      { Metric: 'Success Rate', Value: `${((validRecords / totalRecords) * 100).toFixed(2)}%` }
    ];
  }

  /**
   * Generate detailed validation data for Excel report
   */
  generateDetailedData() {
    return this.validationResults.map(result => {
      const row = {
        'Row Number': result.rowNumber,
        'Is Valid': result.isValid ? 'Yes' : 'No',
        'Error Count': result.errors.length,
        'Warning Count': result.warnings.length,
        'Errors': result.errors.join('; '),
        'Warnings': result.warnings.join('; ')
      };

      // Add all record fields
      Object.keys(result.record).forEach(key => {
        row[key] = result.record[key];
      });

      return row;
    });
  }

  /**
   * Generate error details for Excel report
   */
  generateErrorData() {
    const errorDetails = [];
    
    this.validationResults.forEach(result => {
      result.errors.forEach(error => {
        errorDetails.push({
          'Row Number': result.rowNumber,
          'Field': this.extractFieldNameFromError(error),
          'Error Message': error,
          'Record Data': JSON.stringify(result.record)
        });
      });
    });

    return errorDetails;
  }

  /**
   * Extract field name from error message
   * @param {string} errorMessage - The error message
   */
  extractFieldNameFromError(errorMessage) {
    const match = errorMessage.match(/Field '([^']+)'/);
    return match ? match[1] : 'Unknown';
  }

  /**
   * Get validation statistics
   */
  getValidationStats() {
    if (!this.validationResults || this.validationResults.length === 0) {
      return null;
    }

    const totalRecords = this.validationResults.length;
    const validRecords = this.validationResults.filter(r => r.isValid).length;
    const invalidRecords = totalRecords - validRecords;
    const totalErrors = this.validationResults.reduce((sum, r) => sum + r.errors.length, 0);
    const totalWarnings = this.validationResults.reduce((sum, r) => sum + r.warnings.length, 0);

    return {
      totalRecords,
      validRecords,
      invalidRecords,
      totalErrors,
      totalWarnings,
      successRate: (validRecords / totalRecords) * 100
    };
  }
}

module.exports = CSVValidator;
