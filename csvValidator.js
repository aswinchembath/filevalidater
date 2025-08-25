const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const _ = require('lodash');

class CSVValidator {
  constructor() {
    this.validationResults = [];
    this.validationRules = [];
    this.duplicateResults = [];
    this.missFormattedResults = [];
    this.sourceDestinationResults = null;
    this.headerValidationResult = null;
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
          // Handle different column name formats with priority order
          const fieldName = row['Target Field Name'] || row['TargetFieldName'] || row['Field Name'] || row['fieldName'];
          const dataType = row['Target Data Type'] || row['TargetDataType'] || row['Data Type'] || row['dataType'] || row['may come '] || row['may come'];
          const nullAllowed = row['Null Allowed'] || row['NullAllowed'] || row['Required'] || row['required'];
          const description = row['Description'] || row['description'];
          
          // Additional optional fields
          const minLength = this.parseNumber(row['Min Length'] || row['MinLength'] || row['minLength']);
          const maxLength = this.parseNumber(row['Max Length'] || row['MaxLength'] || row['maxLength']);
          const pattern = row['Pattern'] || row['pattern'];
          const allowedValues = row['Allowed Values'] || row['AllowedValues'] || row['allowedValues'];

          // Skip rows without essential information
          if (!fieldName || !dataType) {
            console.warn(`Skipping row with missing field name or data type: ${JSON.stringify(row)}`);
            return;
          }

          // Parse null allowed field - handle various formats
          const isNullAllowed = this.parseNullAllowed(nullAllowed);
          
          // Normalize data type to handle mixed case and various formats
          const normalizedDataType = this.normalizeDataType(dataType);

          rules.push({
            fieldName: fieldName.trim(),
            dataType: normalizedDataType,
            originalDataType: dataType.trim(), // Keep original for display
            required: !isNullAllowed, // Invert since "Null Allowed" means not required
            nullAllowed: isNullAllowed, // Store the original null allowed value
            minLength,
            maxLength,
            pattern,
            allowedValues,
            description: description ? description.trim() : ''
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
   * Parse null allowed field with smart handling of various formats
   * @param {string} value - The null allowed value
   */
  parseNullAllowed(value) {
    if (value === undefined || value === null || value === '') {
      return false; // Default to not allowing null if not specified
    }
    
    const lowerValue = value.toString().toLowerCase().trim();
    
    // Handle various "Yes" formats
    if (lowerValue === 'yes' || lowerValue === 'y' || lowerValue === 'true' || lowerValue === '1' || lowerValue === 'allow' || lowerValue === 'allowed') {
      return true;
    }
    
    // Handle various "No" formats
    if (lowerValue === 'no' || lowerValue === 'n' || lowerValue === 'false' || lowerValue === '0' || lowerValue === 'deny' || lowerValue === 'denied' || lowerValue === 'required') {
      return false;
    }
    
    // Default to false for unrecognized values
    console.warn(`Unrecognized 'Null Allowed' value: '${value}'. Defaulting to false (not allowed).`);
    return false;
  }

  /**
   * Normalize data type to handle mixed case formats and various Salesforce data types
   * @param {string} dataType - The data type string
   */
  normalizeDataType(dataType) {
    if (!dataType) return 'string';
    
    const normalized = dataType.toString().toLowerCase().trim();
    
    // Handle Salesforce-specific data types with better pattern matching
    if (normalized.includes('decimal') || normalized.includes('number') || normalized.includes('double') || normalized.includes('float')) {
      return 'decimal';
    }
    if (normalized.includes('boolean') || normalized.includes('bool')) {
      return 'boolean';
    }
    if (normalized.includes('timestamp') || normalized.includes('datetime') || normalized.includes('date') || normalized.includes('time')) {
      return 'date';
    }
    if (normalized.includes('string') || normalized.includes('text') || normalized.includes('picklist') || normalized.includes('multipicklist') || normalized.includes('textarea')) {
      return 'string';
    }
    if (normalized.includes('integer') || normalized.includes('int') || normalized.includes('long')) {
      return 'integer';
    }
    if (normalized.includes('email') || normalized.includes('url') || normalized.includes('phone')) {
      return 'string'; // These are specialized string types
    }
    if (normalized.includes('currency') || normalized.includes('percent')) {
      return 'decimal'; // These are specialized decimal types
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
    if (rule.required && this.isEmptyValue(value)) {
      result.errors.push(`Field '${fieldName}' is required (Null Allowed: ${rule.nullAllowed ? 'Yes' : 'No'}) but contains empty/null/blank value`);
      return result;
    }

    // Skip validation if value is empty and not required
    if (!rule.required && this.isEmptyValue(value)) {
      return result;
    }

    const stringValue = String(value);

    // Check data type
    if (rule.dataType) {
      const typeValidation = this.validateDataType(stringValue, rule.dataType, rule.originalDataType);
      if (!typeValidation.isValid) {
        const errorMessage = typeValidation.details 
          ? `Field '${fieldName}' has invalid data type. Expected: ${rule.originalDataType}, Got: '${stringValue}'. ${typeValidation.details}`
          : `Field '${fieldName}' has invalid data type. Expected: ${rule.originalDataType}, Got: '${stringValue}'`;
        result.errors.push(errorMessage);
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
        const intValidation = !isNaN(Number(value)) && Number.isInteger(Number(value));
        return { 
          isValid: intValidation,
          details: intValidation ? null : `Value '${value}' is not a valid integer`
        };
      case 'decimal':
        const decimalValidation = this.validateDecimal(value, originalDataType);
        return decimalValidation;
      case 'date':
      case 'timestamp':
        const dateValidation = !isNaN(Date.parse(value));
        return { 
          isValid: dateValidation,
          details: dateValidation ? null : `Value '${value}' is not a valid date/timestamp`
        };
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emailValidation = emailRegex.test(value);
        return { 
          isValid: emailValidation,
          details: emailValidation ? null : `Value '${value}' is not a valid email address`
        };
      case 'phone':
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        const phoneValidation = phoneRegex.test(value.replace(/[\s\-\(\)]/g, ''));
        return { 
          isValid: phoneValidation,
          details: phoneValidation ? null : `Value '${value}' is not a valid phone number`
        };
      case 'boolean':
        const boolValidation = this.isValidBoolean(value);
        return { 
          isValid: boolValidation,
          details: boolValidation ? null : `Value '${value}' is not a valid boolean (expected: true/false, yes/no, 1/0)`
        };
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
      return { 
        isValid: false, 
        details: `Value '${value}' is not a valid number` 
      };
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
        return { 
          isValid: false, 
          details: `Integer value '${value}' exceeds maximum precision of ${decimalInfo.precision} digits. Expected format: ${originalDataType}` 
        };
      }
    } else {
      // Decimal - check precision and scale
      const parts = numStr.split('.');
      const integerPart = parts[0];
      const decimalPart = parts[1];
      
      // Check decimal places (scale) - must have exactly the specified scale
      if (decimalPart && decimalPart.length !== decimalInfo.scale) {
        return { 
          isValid: false, 
          details: `Decimal value '${value}' must have exactly ${decimalInfo.scale} decimal places. Expected format: ${originalDataType}` 
        };
      }
      
      // Check total digits (integer + decimal parts)
      const totalDigits = integerPart.length + (decimalPart ? decimalPart.length : 0);
      if (totalDigits > decimalInfo.precision) {
        return { 
          isValid: false, 
          details: `Value '${value}' exceeds maximum precision of ${decimalInfo.precision} total digits. Expected format: ${originalDataType}` 
        };
      }
      
      // Additional check: ensure integer part doesn't exceed (precision - scale)
      // This prevents cases like DECIMAL(5,2) with 1234.5 (4 digits + 1 decimal = 5 total, but integer part 1234 exceeds 3)
      const maxIntegerDigits = decimalInfo.precision - decimalInfo.scale;
      if (integerPart.length > maxIntegerDigits) {
        return { 
          isValid: false, 
          details: `Integer part '${integerPart}' exceeds maximum of ${maxIntegerDigits} digits. Expected format: ${originalDataType}` 
        };
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
   * Check if a value is considered empty (null, undefined, empty string, or whitespace-only)
   * @param {*} value - The value to check
   */
  isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') {
      return value.trim() === '';
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
   * Detect duplicate records in the validation results
   * @param {Array} records - Array of records to check for duplicates
   * @param {Array} keyFields - Array of field names to use as composite key for duplicate detection
   */
  detectDuplicates(records, keyFields = null) {
    const duplicates = [];
    const seen = new Map();
    
    // If no key fields specified, use all fields
    const fieldsToCheck = keyFields || Object.keys(records[0] || {});
    
    records.forEach((record, index) => {
      // Create composite key from specified fields
      const compositeKey = fieldsToCheck.map(field => String(record[field] || '')).join('|');
      
      if (seen.has(compositeKey)) {
        // This is a duplicate
        const duplicateInfo = {
          rowNumber: index + 1,
          originalRowNumber: seen.get(compositeKey) + 1,
          record: record,
          compositeKey: compositeKey,
          keyFields: fieldsToCheck,
          keyValues: fieldsToCheck.map(field => record[field])
        };
        duplicates.push(duplicateInfo);
      } else {
        seen.set(compositeKey, index);
      }
    });

    this.duplicateResults = duplicates;
    return duplicates;
  }

  /**
   * Detect miss-formatted data based on validation rules
   * @param {Array} records - Array of records to check
   */
  detectMissFormattedData(records) {
    const missFormatted = [];
    
    records.forEach((record, index) => {
      const rowNumber = index + 1;
      const issues = [];
      
      this.validationRules.forEach(rule => {
        const fieldValue = record[rule.fieldName];
        
        if (!this.isEmptyValue(fieldValue)) {
          // Check for common formatting issues
          const formattingIssues = this.checkFormattingIssues(fieldValue, rule, rule.fieldName);
          if (formattingIssues.length > 0) {
            issues.push(...formattingIssues);
          }
        }
      });
      
      if (issues.length > 0) {
        missFormatted.push({
          rowNumber: rowNumber,
          record: record,
          issues: issues,
          issueCount: issues.length
        });
      }
    });

    this.missFormattedResults = missFormatted;
    return missFormatted;
  }

  /**
   * Check for specific formatting issues in a field value
   * @param {*} value - The field value to check
   * @param {Object} rule - The validation rule
   * @param {string} fieldName - The field name
   */
  checkFormattingIssues(value, rule, fieldName) {
    const issues = [];
    const stringValue = String(value);
    
    // Check for leading/trailing whitespace
    if (typeof value === 'string' && value !== value.trim()) {
      issues.push(`Field '${fieldName}' has leading/trailing whitespace: '${value}'`);
    }
    
    // Check for inconsistent case in specific fields
    if (rule.fieldName.toLowerCase().includes('email') && stringValue !== stringValue.toLowerCase()) {
      issues.push(`Field '${fieldName}' has inconsistent case for email: '${value}'`);
    }
    
    // Check for phone number formatting inconsistencies
    if (rule.fieldName.toLowerCase().includes('phone') || rule.fieldName.toLowerCase().includes('mobile')) {
      const cleanPhone = stringValue.replace(/[\s\-\(\)]/g, '');
      if (cleanPhone.length > 0 && !/^[\+]?[1-9][\d]{0,15}$/.test(cleanPhone)) {
        issues.push(`Field '${fieldName}' has inconsistent phone number format: '${value}'`);
      }
    }
    
    // Check for date format inconsistencies
    if (rule.dataType === 'date' || rule.dataType === 'timestamp') {
      if (!this.isConsistentDateFormat(stringValue)) {
        issues.push(`Field '${fieldName}' has inconsistent date format: '${value}'`);
      }
    }
    
    // Check for decimal format inconsistencies
    if (rule.dataType === 'decimal') {
      if (!this.isConsistentDecimalFormat(stringValue, rule.originalDataType)) {
        issues.push(`Field '${fieldName}' has inconsistent decimal format: '${value}'`);
      }
    }
    
    return issues;
  }

  /**
   * Check if date format is consistent
   * @param {string} value - The date value to check
   */
  isConsistentDateFormat(value) {
    // Common date formats
    const dateFormats = [
      /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/,         // MM/DD/YYYY
      /^\d{2}-\d{2}-\d{4}$/,           // MM-DD-YYYY
      /^\d{4}\/\d{2}\/\d{2}$/,         // YYYY/MM/DD
      /^\d{2}\.\d{2}\.\d{4}$/,         // MM.DD.YYYY
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,    // M/D/YYYY
      /^\d{1,2}-\d{1,2}-\d{4}$/        // M-D-YYYY
    ];
    
    return dateFormats.some(format => format.test(value));
  }

  /**
   * Check if decimal format is consistent
   * @param {string} value - The decimal value to check
   * @param {string} originalDataType - The original data type string
   */
  isConsistentDecimalFormat(value, originalDataType) {
    const decimalInfo = this.parseDecimalPrecision(originalDataType);
    if (!decimalInfo) return true; // No precision constraints
    
    const parts = value.toString().split('.');
    if (parts.length === 2) {
      const decimalPlaces = parts[1].length;
      return decimalPlaces === decimalInfo.scale;
    }
    return true;
  }

  /**
   * Validate headers match between input file and mapping rules
   * @param {string} inputFilePath - Path to the input file
   * @param {string} delimiter - Delimiter character
   */
  validateHeaders(inputFilePath, delimiter) {
    return new Promise((resolve, reject) => {
      try {
        // Read the first line to get headers
        const content = fs.readFileSync(inputFilePath, 'utf8');
        const firstLine = content.split('\n')[0];
        const inputHeaders = firstLine.split(delimiter).map(header => header.trim().replace(/"/g, ''));
        
        // Get expected headers from validation rules
        const expectedHeaders = this.validationRules.map(rule => rule.fieldName);
        
        // Find missing and extra headers
        const missingHeaders = expectedHeaders.filter(header => !inputHeaders.includes(header));
        const extraHeaders = inputHeaders.filter(header => !expectedHeaders.includes(header));
        
        const headerValidation = {
          isValid: missingHeaders.length === 0 && extraHeaders.length === 0,
          inputHeaders,
          expectedHeaders,
          missingHeaders,
          extraHeaders,
          totalExpected: expectedHeaders.length,
          totalFound: inputHeaders.length
        };
        
        resolve(headerValidation);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Validate input file (supports both CSV and pipe-delimited)
   * @param {string} inputFilePath - Path to the input file
   * @param {string} delimiter - Delimiter character (default: auto-detect)
   */
  validateInputFile(inputFilePath, delimiter = null) {
    return new Promise(async (resolve, reject) => {
      try {
        // Auto-detect delimiter if not specified
        if (!delimiter) {
          delimiter = this.detectDelimiter(inputFilePath);
        }

        // First validate headers
        console.log('Validating headers...');
        const headerValidation = await this.validateHeaders(inputFilePath, delimiter);
        
        if (!headerValidation.isValid) {
          console.log('\n❌ Header Validation Failed!');
          console.log('==========================');
          console.log(`Expected ${headerValidation.totalExpected} headers, found ${headerValidation.totalFound}`);
          
          if (headerValidation.missingHeaders.length > 0) {
            console.log(`\nMissing Headers (${headerValidation.missingHeaders.length}):`);
            headerValidation.missingHeaders.forEach(header => {
              console.log(`  - ${header}`);
            });
          }
          
          if (headerValidation.extraHeaders.length > 0) {
            console.log(`\nExtra Headers (${headerValidation.extraHeaders.length}):`);
            headerValidation.extraHeaders.forEach(header => {
              console.log(`  - ${header}`);
            });
          }
          
          console.log('\n💡 Suggestion: Please ensure your input CSV file headers exactly match the mapping file field names.');
          console.log('   Headers are case-sensitive and must match exactly.\n');
          
          // Store header validation result for reporting even when it fails
          this.headerValidationResult = headerValidation;
          
          // Generate header validation report before rejecting
          try {
            const artifactsPath = require('path').join(__dirname, 'artifacts');
            if (!fs.existsSync(artifactsPath)) {
              fs.mkdirSync(artifactsPath, { recursive: true });
            }
            
            const headerReportPath = require('path').join(artifactsPath, 'header_validation_report.xlsx');
            this.generateHeaderValidationReport(headerReportPath);
            console.log(`📊 Header validation report saved to: ${headerReportPath}`);
          } catch (reportError) {
            console.log('⚠️  Could not generate header validation report:', reportError.message);
          }
          
          reject(new Error('Header validation failed - input file headers do not match mapping file'));
          return;
        }
        
        console.log('✅ Headers validated successfully!');
        console.log(`   Found all ${headerValidation.totalExpected} expected headers`);

        // Store header validation result for reporting
        this.headerValidationResult = headerValidation;

        // Proceed with data validation
        const results = [];
        const allRecords = [];
        let rowNumber = 1; // Start from 1 for user-friendly reporting

        fs.createReadStream(inputFilePath)
          .pipe(csv({ separator: delimiter }))
          .on('data', (row) => {
            const validationResult = this.validateRecord(row, rowNumber);
            results.push(validationResult);
            allRecords.push(row);
            rowNumber++;
          })
          .on('end', () => {
            this.validationResults = results;
            console.log(`Validated ${results.length} records using delimiter: '${delimiter}'`);
            
            // Perform additional data quality checks
            console.log('Performing duplicate detection...');
            const duplicates = this.detectDuplicates(allRecords);
            if (duplicates.length > 0) {
              console.log(`Found ${duplicates.length} duplicate records`);
            } else {
              console.log('No duplicate records found');
            }
            
            console.log('Performing formatting consistency checks...');
            const missFormatted = this.detectMissFormattedData(allRecords);
            if (missFormatted.length > 0) {
              console.log(`Found ${missFormatted.length} records with formatting issues`);
            } else {
              console.log('No formatting issues found');
            }
            
            resolve(results);
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
   * Generate standalone header validation report
   * @param {string} outputFilePath - Path for the output Excel file
   */
  generateHeaderValidationReport(outputFilePath) {
    if (!this.headerValidationResult) {
      throw new Error('No header validation results available.');
    }

    // Create workbook and worksheets
    const workbook = XLSX.utils.book_new();
    
    // Header validation worksheet
    const headerData = this.generateProfessionalHeaderData();
    const headerSheet = XLSX.utils.json_to_sheet(headerData);
    this.formatWorksheet(headerSheet, 'header');
    XLSX.utils.book_append_sheet(workbook, headerSheet, '🔍 Header Validation');

    // Validation rules worksheet
    const rulesData = this.generateProfessionalRulesData();
    const rulesSheet = XLSX.utils.json_to_sheet(rulesData);
    this.formatWorksheet(rulesSheet, 'rules');
    XLSX.utils.book_append_sheet(workbook, rulesSheet, '📋 Expected Headers');

    // Write to file
    XLSX.writeFile(workbook, outputFilePath);
    console.log(`Header validation report generated: ${outputFilePath}`);
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
    
    // Executive Summary worksheet
    const executiveSummaryData = this.generateExecutiveSummaryData();
    const executiveSummarySheet = XLSX.utils.json_to_sheet(executiveSummaryData);
    this.formatWorksheet(executiveSummarySheet, 'executive');
    XLSX.utils.book_append_sheet(workbook, executiveSummarySheet, '📊 Executive Summary');

    // Header Validation worksheet (if headers were validated)
    if (this.headerValidationResult) {
      const headerData = this.generateProfessionalHeaderData();
      const headerSheet = XLSX.utils.json_to_sheet(headerData);
      this.formatWorksheet(headerSheet, 'header');
      XLSX.utils.book_append_sheet(workbook, headerSheet, '🔍 Header Validation');
    }

    // Validation Rules worksheet
    const rulesData = this.generateProfessionalRulesData();
    const rulesSheet = XLSX.utils.json_to_sheet(rulesData);
    this.formatWorksheet(rulesSheet, 'rules');
    XLSX.utils.book_append_sheet(workbook, rulesSheet, '📋 Validation Rules');

    // Detailed results worksheet
    const detailedData = this.generateProfessionalDetailedData();
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    this.formatWorksheet(detailedSheet, 'detailed');
    XLSX.utils.book_append_sheet(workbook, detailedSheet, '📄 Validation Results');

    // Error details worksheet
    const errorData = this.generateProfessionalErrorData();
    if (errorData.length > 0) {
      const errorSheet = XLSX.utils.json_to_sheet(errorData);
      this.formatWorksheet(errorSheet, 'errors');
      XLSX.utils.book_append_sheet(workbook, errorSheet, '⚠️ Error Analysis');
    }

    // Duplicate records worksheet
    if (this.duplicateResults && this.duplicateResults.length > 0) {
      const duplicateData = this.generateDuplicateData();
      const duplicateSheet = XLSX.utils.json_to_sheet(duplicateData);
      this.formatWorksheet(duplicateSheet, 'duplicates');
      XLSX.utils.book_append_sheet(workbook, duplicateSheet, '🔄 Duplicate Records');
    }

    // Formatting issues worksheet
    if (this.missFormattedResults && this.missFormattedResults.length > 0) {
      const formattingData = this.generateFormattingData();
      const formattingSheet = XLSX.utils.json_to_sheet(formattingData);
      this.formatWorksheet(formattingSheet, 'formatting');
      XLSX.utils.book_append_sheet(workbook, formattingSheet, '📝 Formatting Issues');
    }

    // Data Quality Dashboard
    const dashboardData = this.generateDataQualityDashboard();
    const dashboardSheet = XLSX.utils.json_to_sheet(dashboardData);
    this.formatWorksheet(dashboardSheet, 'dashboard');
    XLSX.utils.book_append_sheet(workbook, dashboardSheet, '📈 Data Quality Dashboard');

    // Write to file
    XLSX.writeFile(workbook, outputFilePath);
    console.log(`Professional Excel report generated: ${outputFilePath}`);
  }

  /**
   * Generate executive summary data for professional report
   */
  generateExecutiveSummaryData() {
    const totalRecords = this.validationResults.length;
    const validRecords = this.validationResults.filter(r => r.isValid).length;
    const invalidRecords = totalRecords - validRecords;
    const totalErrors = this.validationResults.reduce((sum, r) => sum + r.errors.length, 0);
    const totalWarnings = this.validationResults.reduce((sum, r) => sum + r.warnings.length, 0);
    const successRate = ((validRecords / totalRecords) * 100);

    // Generate timestamp
    const timestamp = new Date().toLocaleString();
    
    return [
      { Section: 'VALIDATION REPORT', Value: '', Details: '', Status: '' },
      { Section: 'Generated On', Value: timestamp, Details: 'Report generation timestamp', Status: '' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '📊 EXECUTIVE SUMMARY', Value: '', Details: '', Status: '' },
      { Section: 'Data Quality Score', Value: `${successRate.toFixed(1)}%`, Details: `${validRecords} of ${totalRecords} records passed validation`, Status: successRate >= 95 ? '✅ Excellent' : successRate >= 80 ? '⚠️ Good' : '❌ Needs Attention' },
      { Section: 'Total Records Processed', Value: totalRecords, Details: 'Total number of data records analyzed', Status: '📄' },
      { Section: 'Valid Records', Value: validRecords, Details: 'Records that passed all validation checks', Status: '✅' },
      { Section: 'Invalid Records', Value: invalidRecords, Details: 'Records with validation errors', Status: invalidRecords > 0 ? '⚠️' : '✅' },
      { Section: 'Total Validation Errors', Value: totalErrors, Details: 'Sum of all validation errors found', Status: totalErrors > 0 ? '❌' : '✅' },
      { Section: 'Total Warnings', Value: totalWarnings, Details: 'Non-critical validation warnings', Status: totalWarnings > 0 ? '⚠️' : '✅' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '🔄 DUPLICATE ANALYSIS', Value: '', Details: '', Status: '' },
      { Section: 'Duplicate Records', Value: this.duplicateResults ? this.duplicateResults.length : 0, Details: 'Records with identical key field values', Status: this.duplicateResults && this.duplicateResults.length > 0 ? '⚠️' : '✅' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '📝 FORMATTING ANALYSIS', Value: '', Details: '', Status: '' },
      { Section: 'Records with Formatting Issues', Value: this.missFormattedResults ? this.missFormattedResults.length : 0, Details: 'Records with inconsistent formatting', Status: this.missFormattedResults && this.missFormattedResults.length > 0 ? '⚠️' : '✅' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '🔍 VALIDATION COVERAGE', Value: '', Details: '', Status: '' },
      { Section: 'Fields Validated', Value: this.validationRules.length, Details: 'Total number of fields checked', Status: '📋' },
      { Section: 'Total Field Validations', Value: totalRecords * this.validationRules.length, Details: 'Total validation operations performed', Status: '🔧' },
      { Section: 'Required Fields', Value: this.validationRules.filter(r => r.required).length, Details: 'Fields that cannot be empty', Status: '🔒' },
      { Section: 'Optional Fields', Value: this.validationRules.filter(r => !r.required).length, Details: 'Fields that can be empty', Status: '🔓' },
      { Section: '', Value: '', Details: '', Status: '' },
      
      { Section: '📈 RECOMMENDATIONS', Value: '', Details: '', Status: '' },
      { Section: 'Priority Level', Value: successRate >= 95 ? 'Low' : successRate >= 80 ? 'Medium' : 'High', Details: 'Recommended action priority based on data quality', Status: successRate >= 95 ? '🟢' : successRate >= 80 ? '🟡' : '🔴' },
      { Section: 'Next Steps', Value: invalidRecords > 0 ? 'Review Error Analysis tab' : 'Data ready for processing', Details: 'Recommended next actions', Status: invalidRecords > 0 ? '📋' : '🚀' }
    ];
  }

  /**
   * Generate data quality dashboard
   */
  generateDataQualityDashboard() {
    const totalRecords = this.validationResults.length;
    const validRecords = this.validationResults.filter(r => r.isValid).length;
    const invalidRecords = totalRecords - validRecords;
    
    // Calculate error distribution by type
    const errorTypes = {};
    this.validationResults.forEach(result => {
      result.errors.forEach(error => {
        let errorType = this.categorizeError(error);
        errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
      });
    });

    // Calculate field error rates
    const fieldErrors = {};
    this.validationResults.forEach(result => {
      result.errors.forEach(error => {
        const fieldName = this.extractFieldNameFromError(error);
        fieldErrors[fieldName] = (fieldErrors[fieldName] || 0) + 1;
      });
    });

    const dashboardData = [
      { Metric: '📊 DATA QUALITY DASHBOARD', Value: '', Percentage: '', Trend: '', Risk: '' },
      { Metric: '', Value: '', Percentage: '', Trend: '', Risk: '' },
      
      { Metric: '🎯 QUALITY METRICS', Value: '', Percentage: '', Trend: '', Risk: '' },
      { Metric: 'Overall Data Quality', Value: `${validRecords}/${totalRecords}`, Percentage: `${((validRecords/totalRecords)*100).toFixed(1)}%`, Trend: '📈', Risk: validRecords/totalRecords >= 0.95 ? 'Low' : validRecords/totalRecords >= 0.8 ? 'Medium' : 'High' },
      { Metric: 'Error Rate', Value: `${invalidRecords}/${totalRecords}`, Percentage: `${((invalidRecords/totalRecords)*100).toFixed(1)}%`, Trend: '📉', Risk: invalidRecords/totalRecords <= 0.05 ? 'Low' : invalidRecords/totalRecords <= 0.2 ? 'Medium' : 'High' },
      { Metric: '', Value: '', Percentage: '', Trend: '', Risk: '' },
      
      { Metric: '⚠️ TOP ERROR TYPES', Value: '', Percentage: '', Trend: '', Risk: '' }
    ];

    // Add top error types
    Object.entries(errorTypes)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .forEach(([errorType, count]) => {
        dashboardData.push({
          Metric: errorType,
          Value: count,
          Percentage: `${((count/Object.values(errorTypes).reduce((a,b) => a+b, 0))*100).toFixed(1)}%`,
          Trend: '📊',
          Risk: count > totalRecords * 0.1 ? 'High' : count > totalRecords * 0.05 ? 'Medium' : 'Low'
        });
      });

    dashboardData.push({ Metric: '', Value: '', Percentage: '', Trend: '', Risk: '' });
    dashboardData.push({ Metric: '🔍 TOP PROBLEMATIC FIELDS', Value: '', Percentage: '', Trend: '', Risk: '' });

    // Add top problematic fields
    Object.entries(fieldErrors)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .forEach(([fieldName, count]) => {
        dashboardData.push({
          Metric: fieldName,
          Value: count,
          Percentage: `${((count/totalRecords)*100).toFixed(1)}%`,
          Trend: '📊',
          Risk: count > totalRecords * 0.1 ? 'High' : count > totalRecords * 0.05 ? 'Medium' : 'Low'
        });
      });

    return dashboardData;
  }

  /**
   * Categorize error for better analysis
   */
  categorizeError(error) {
    if (error.includes('required') && (error.includes('missing') || error.includes('empty/null/blank'))) {
      return 'Required Field Missing';
    } else if (error.includes('invalid data type')) {
      return 'Invalid Data Type';
    } else if (error.includes('not a valid')) {
      return 'Invalid Format';
    } else if (error.includes('precision') || error.includes('decimal places') || error.includes('exceeds maximum')) {
      return 'Decimal Precision Error';
    } else if (error.includes('too short') || error.includes('too long')) {
      return 'Length Constraint Error';
    } else if (error.includes('pattern')) {
      return 'Pattern Mismatch';
    } else if (error.includes('allowed values')) {
      return 'Invalid Value';
    } else if (error.includes('not a valid number')) {
      return 'Invalid Number Format';
    } else if (error.includes('not a valid integer')) {
      return 'Invalid Integer Format';
    } else if (error.includes('not a valid boolean')) {
      return 'Invalid Boolean Format';
    } else if (error.includes('not a valid date') || error.includes('not a valid timestamp')) {
      return 'Invalid Date/Time Format';
    }
    return 'Other Error';
  }

  /**
   * Generate summary data for Excel report (backward compatibility)
   */
  generateSummaryData() {
    return this.generateExecutiveSummaryData();
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
   * Generate professional header validation data
   */
  generateProfessionalHeaderData() {
    const timestamp = new Date().toLocaleString();
    const headerData = [
      { Category: '🔍 HEADER VALIDATION REPORT', Status: '', 'Header Name': '', Description: '', Action: '' },
      { Category: 'Generated On', Status: timestamp, 'Header Name': '', Description: 'Validation timestamp', Action: '' },
      { Category: '', Status: '', 'Header Name': '', Description: '', Action: '' },
      
      { Category: '📊 VALIDATION SUMMARY', Status: '', 'Header Name': '', Description: '', Action: '' },
      { Category: 'Overall Status', Status: this.headerValidationResult.isValid ? '✅ PASSED' : '❌ FAILED', 'Header Name': '', Description: 'Header validation result', Action: this.headerValidationResult.isValid ? 'Proceed to data validation' : 'Fix header mismatches' },
      { Category: 'Expected Headers', Status: this.headerValidationResult.totalExpected, 'Header Name': '', Description: 'Number of headers defined in mapping', Action: '' },
      { Category: 'Found Headers', Status: this.headerValidationResult.totalFound, 'Header Name': '', Description: 'Number of headers in input file', Action: '' },
      { Category: 'Missing Headers', Status: this.headerValidationResult.missingHeaders.length, 'Header Name': '', Description: 'Headers expected but not found', Action: this.headerValidationResult.missingHeaders.length > 0 ? 'Add missing headers' : '' },
      { Category: 'Extra Headers', Status: this.headerValidationResult.extraHeaders.length, 'Header Name': '', Description: 'Headers found but not expected', Action: this.headerValidationResult.extraHeaders.length > 0 ? 'Remove extra headers' : '' },
      { Category: '', Status: '', 'Header Name': '', Description: '', Action: '' },
      
      { Category: '📋 DETAILED HEADER ANALYSIS', Status: '', 'Header Name': '', Description: '', Action: '' }
    ];
    
    // Add detailed header validation
    this.headerValidationResult.expectedHeaders.forEach(header => {
      const found = this.headerValidationResult.inputHeaders.includes(header);
      headerData.push({
        Category: 'Expected Header',
        Status: found ? '✅ Found' : '❌ Missing',
        'Header Name': header,
        Description: found ? 'Header correctly present in input file' : 'Header missing from input file',
        Action: found ? '' : 'Add this header to input file'
      });
    });
    
    // Add extra headers if any
    if (this.headerValidationResult.extraHeaders.length > 0) {
      headerData.push({ Category: '', Status: '', 'Header Name': '', Description: '', Action: '' });
      headerData.push({ Category: '⚠️ EXTRA HEADERS FOUND', Status: '', 'Header Name': '', Description: '', Action: '' });
      
      this.headerValidationResult.extraHeaders.forEach(header => {
        headerData.push({
          Category: 'Extra Header',
          Status: '⚠️ Unexpected',
          'Header Name': header,
          Description: 'Header found in input but not defined in mapping',
          Action: 'Remove from input or add to mapping'
        });
      });
    }
    
    return headerData;
  }

  /**
   * Generate header validation data for Excel report (backward compatibility)
   */
  generateHeaderValidationData() {
    return this.generateProfessionalHeaderData();
  }

  /**
   * Generate professional validation rules data
   */
  generateProfessionalRulesData() {
    const rulesData = [
      { Category: '📋 VALIDATION RULES CONFIGURATION', 'Field Name': '', 'Data Type': '', 'Business Rule': '', 'Validation Logic': '', Priority: '' },
      { Category: `Total Rules: ${this.validationRules.length}`, 'Field Name': '', 'Data Type': '', 'Business Rule': '', 'Validation Logic': '', Priority: '' },
      { Category: '', 'Field Name': '', 'Data Type': '', 'Business Rule': '', 'Validation Logic': '', Priority: '' }
    ];
    
    this.validationRules.forEach((rule, index) => {
      const priority = rule.required ? '🔴 Critical' : '🟡 Standard';
      const businessRule = `${rule.required ? 'Mandatory' : 'Optional'} ${rule.originalDataType} field`;
      const validationLogic = this.getDetailedValidationLogic(rule);
      
      rulesData.push({
        Category: `Rule ${index + 1}`,
        'Field Name': rule.fieldName,
        'Data Type': rule.originalDataType,
        'Business Rule': businessRule,
        'Validation Logic': validationLogic,
        Priority: priority
      });
    });

    return rulesData;
  }

  /**
   * Get detailed validation logic description
   */
  getDetailedValidationLogic(rule) {
    const validations = [];
    
    if (rule.required) {
      validations.push('✓ Required field validation');
    } else {
      validations.push('✓ Optional field (null allowed)');
    }
    
    if (rule.dataType) {
      validations.push(`✓ ${rule.dataType.toUpperCase()} type validation`);
    }
    
    if (rule.minLength !== undefined) {
      validations.push(`✓ Minimum length: ${rule.minLength} characters`);
    }
    
    if (rule.maxLength !== undefined) {
      validations.push(`✓ Maximum length: ${rule.maxLength} characters`);
    }
    
    if (rule.pattern) {
      validations.push('✓ Pattern/Format validation');
    }
    
    if (rule.allowedValues) {
      validations.push('✓ Allowed values validation');
    }

    return validations.join(' | ') || 'Basic validation';
  }

  /**
   * Generate professional detailed validation data
   */
  generateProfessionalDetailedData() {
    const detailedData = [
      { Category: '📄 DETAILED VALIDATION RESULTS', 'Row #': '', Status: '', 'Error Count': '', 'Error Summary': '', 'Data Quality': '' },
      { Category: `Total Records: ${this.validationResults.length}`, 'Row #': '', Status: '', 'Error Count': '', 'Error Summary': '', 'Data Quality': '' },
      { Category: '', 'Row #': '', Status: '', 'Error Count': '', 'Error Summary': '', 'Data Quality': '' }
    ];
    
    this.validationResults.forEach(result => {
      const dataQuality = result.isValid ? '✅ High' : result.errors.length <= 2 ? '⚠️ Medium' : '❌ Low';
      const errorSummary = result.errors.length > 0 ? result.errors.slice(0, 2).join('; ') + (result.errors.length > 2 ? '...' : '') : 'No errors';
      
      detailedData.push({
        Category: 'Data Record',
        'Row #': result.rowNumber,
        Status: result.isValid ? '✅ Valid' : '❌ Invalid',
        'Error Count': result.errors.length,
        'Error Summary': errorSummary,
        'Data Quality': dataQuality
      });
    });

    return detailedData;
  }

  /**
   * Generate professional error analysis data
   */
  generateProfessionalErrorData() {
    const errorData = [
      { Category: '⚠️ ERROR ANALYSIS REPORT', 'Row #': '', 'Field Name': '', 'Error Type': '', 'Error Message': '', 'Severity': '' },
      { Category: `Total Errors: ${this.validationResults.reduce((sum, r) => sum + r.errors.length, 0)}`, 'Row #': '', 'Field Name': '', 'Error Type': '', 'Error Message': '', 'Severity': '' },
      { Category: '', 'Row #': '', 'Field Name': '', 'Error Type': '', 'Error Message': '', 'Severity': '' }
    ];
    
    this.validationResults.forEach(result => {
      result.errors.forEach(error => {
        const fieldName = this.extractFieldNameFromError(error);
        const errorType = this.categorizeError(error);
        const severity = error.includes('required') ? '🔴 Critical' : error.includes('invalid data type') ? '🟠 High' : '🟡 Medium';
        
        errorData.push({
          Category: 'Validation Error',
          'Row #': result.rowNumber,
          'Field Name': fieldName,
          'Error Type': errorType,
          'Error Message': error,
          'Severity': severity
        });
      });
    });

    return errorData;
  }

  /**
   * Add formatting method stub (XLSX formatting is limited in basic version)
   */
  formatWorksheet(worksheet, type) {
    // Basic formatting - can be enhanced with more advanced Excel libraries
    if (!worksheet['!cols']) {
      worksheet['!cols'] = [];
    }
    
    // Set column widths based on worksheet type
    switch (type) {
      case 'executive':
        worksheet['!cols'] = [
          { width: 25 }, // Section
          { width: 15 }, // Value
          { width: 40 }, // Details
          { width: 15 }  // Status
        ];
        break;
      case 'header':
        worksheet['!cols'] = [
          { width: 20 }, // Category
          { width: 15 }, // Status
          { width: 25 }, // Header Name
          { width: 40 }, // Description
          { width: 25 }  // Action
        ];
        break;
      case 'rules':
        worksheet['!cols'] = [
          { width: 15 }, // Category
          { width: 25 }, // Field Name
          { width: 15 }, // Data Type
          { width: 25 }, // Business Rule
          { width: 50 }, // Validation Logic
          { width: 15 }  // Priority
        ];
        break;
      case 'detailed':
        worksheet['!cols'] = [
          { width: 15 }, // Category
          { width: 10 }, // Row #
          { width: 15 }, // Status
          { width: 12 }, // Error Count
          { width: 50 }, // Error Summary
          { width: 15 }  // Data Quality
        ];
        break;
      case 'errors':
        worksheet['!cols'] = [
          { width: 15 }, // Category
          { width: 10 }, // Row #
          { width: 20 }, // Field Name
          { width: 20 }, // Error Type
          { width: 60 }, // Error Message
          { width: 15 }  // Severity
        ];
        break;
      case 'dashboard':
        worksheet['!cols'] = [
          { width: 25 }, // Metric
          { width: 15 }, // Value
          { width: 12 }, // Percentage
          { width: 10 }, // Trend
          { width: 15 }  // Risk
        ];
        break;
      case 'duplicates':
        worksheet['!cols'] = [
          { width: 20 }, // Category
          { width: 10 }, // Row #
          { width: 15 }, // Original Row #
          { width: 30 }, // Key Fields
          { width: 40 }, // Key Values
          { width: 15 }  // Status
        ];
        break;
      case 'formatting':
        worksheet['!cols'] = [
          { width: 20 }, // Category
          { width: 10 }, // Row #
          { width: 12 }, // Issue Count
          { width: 60 }, // Issues
          { width: 15 }  // Data Quality
        ];
        break;
    }
  }

  /**
   * Generate validation rules data for Excel report (backward compatibility)
   */
  generateValidationRulesData() {
    return this.generateProfessionalRulesData();
  }

  /**
   * Generate detailed validation data for Excel report (backward compatibility)
   */
  generateDetailedData() {
    return this.generateProfessionalDetailedData();
  }

  /**
   * Generate error details for Excel report (backward compatibility)
   */
  generateErrorData() {
    return this.generateProfessionalErrorData();
  }

  /**
   * Get description of validation applied to a rule
   */
  getValidationApplied(rule) {
    const validations = [];
    
    if (rule.required) {
      validations.push('Required field validation');
    }
    
    if (rule.dataType) {
      validations.push(`${rule.dataType} type validation`);
    }
    
    if (rule.minLength !== undefined) {
      validations.push(`Min length: ${rule.minLength}`);
    }
    
    if (rule.maxLength !== undefined) {
      validations.push(`Max length: ${rule.maxLength}`);
    }
    
    if (rule.pattern) {
      validations.push('Pattern validation');
    }
    
    if (rule.allowedValues) {
      validations.push('Allowed values validation');
    }

    return validations.join('; ') || 'Basic validation';
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
   * Generate duplicate records data for Excel report
   */
  generateDuplicateData() {
    const duplicateData = [
      { Category: '🔄 DUPLICATE RECORDS ANALYSIS', 'Row #': '', 'Original Row #': '', 'Key Fields': '', 'Key Values': '', 'Status': '' },
      { Category: `Total Duplicates Found: ${this.duplicateResults.length}`, 'Row #': '', 'Original Row #': '', 'Key Fields': '', 'Key Values': '', 'Status': '' },
      { Category: '', 'Row #': '', 'Original Row #': '', 'Key Fields': '', 'Key Values': '', 'Status': '' }
    ];
    
    this.duplicateResults.forEach(duplicate => {
      duplicateData.push({
        Category: 'Duplicate Record',
        'Row #': duplicate.rowNumber,
        'Original Row #': duplicate.originalRowNumber,
        'Key Fields': duplicate.keyFields.join(', '),
        'Key Values': duplicate.keyValues.join(' | '),
        'Status': '🔄 Duplicate'
      });
    });

    return duplicateData;
  }

  /**
   * Generate formatting issues data for Excel report
   */
  generateFormattingData() {
    const formattingData = [
      { Category: '📝 FORMATTING ISSUES ANALYSIS', 'Row #': '', 'Issue Count': '', 'Issues': '', 'Data Quality': '' },
      { Category: `Total Records with Formatting Issues: ${this.missFormattedResults.length}`, 'Row #': '', 'Issue Count': '', 'Issues': '', 'Data Quality': '' },
      { Category: '', 'Row #': '', 'Issue Count': '', 'Issues': '', 'Data Quality': '' }
    ];
    
    this.missFormattedResults.forEach(issue => {
      const dataQuality = issue.issueCount <= 2 ? '⚠️ Minor' : issue.issueCount <= 5 ? '🟠 Moderate' : '🔴 Major';
      const issuesSummary = issue.issues.slice(0, 3).join('; ') + (issue.issues.length > 3 ? '...' : '');
      
      formattingData.push({
        Category: 'Formatting Issue',
        'Row #': issue.rowNumber,
        'Issue Count': issue.issueCount,
        'Issues': issuesSummary,
        'Data Quality': dataQuality
      });
    });

    return formattingData;
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
