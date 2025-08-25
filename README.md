# CSV Validator

A comprehensive CSV file validator that checks input files against mapping specifications and generates detailed Excel reports with validation results.

## Features

- **Flexible Mapping Rules**: Define validation rules in CSV format
- **Multiple Data Types**: Support for string, integer, decimal, date, email, phone, and custom patterns
- **Comprehensive Validation**: Length constraints, required fields, allowed values, and regex patterns
- **Duplicate Detection**: Automatically identify duplicate records based on key fields
- **Formatting Consistency**: Detect miss-formatted data and formatting inconsistencies
- **Source vs Destination Validation**: Compare two files to check data consistency
- **Excel Reporting**: Generate detailed Excel reports with multiple worksheets
- **Pipe-Delimited Support**: Handle pipe-delimited input files
- **Detailed Error Reporting**: Row-by-row validation with specific error messages

## Installation

1. Clone or download the project
2. Install dependencies:
```bash
npm install
```

## Usage

### Basic Validation

```bash
node validate.js <mapping-file> <input-file> [output-file] [delimiter]
```

### Source vs Destination File Comparison

```bash
node compareFiles.js <source-file> <destination-file> [options]
```

**Arguments:**
- `source-file`: Path to the source file (CSV or pipe-delimited)
- `destination-file`: Path to the destination file (CSV or pipe-delimited)

**Options:**
- `--output <file>`: Output file name (default: `comparison_report.xlsx`)
- `--delimiter <char>`: Delimiter character (auto-detected if not specified)
- `--key-fields <fields>`: Comma-separated key fields for comparison
- `--strict`: Enable strict comparison (all fields must match exactly)
- `--help`: Show help message

**Examples:**
```bash
# Basic comparison with auto-detected delimiter
node compareFiles.js source.csv destination.csv

# Custom output file
node compareFiles.js source.csv destination.csv --output my_comparison.xlsx

# Specify key fields for comparison
node compareFiles.js source.csv destination.csv --key-fields "ID,Email,Name"

# Enable strict comparison
node compareFiles.js source.csv destination.csv --strict
```

**Arguments:**
- `mapping-file`: Path to the CSV mapping rules file
- `input-file`: Path to the pipe-delimited input file
- `output-file`: Path for the output Excel report (optional, defaults to `validation_report.xlsx`)
- `delimiter`: Delimiter character (optional, defaults to `|`)

**Examples:**
```bash
# Basic validation with Salesforce data
node validate.js salesforce_mapping.csv salesforce_input.csv

# Custom output file name (saved in artifacts folder)
node validate.js salesforce_mapping.csv salesforce_input.csv my_report.xlsx

# Custom delimiter (if needed)
node validate.js salesforce_mapping.csv salesforce_input.csv report.xlsx ","
```

**Note**: All output files are automatically saved in the `artifacts/` folder, which is cleaned and recreated before each validation run.



## Mapping File Format

The mapping file should be a CSV with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| `fieldName` | Name of the field to validate | `id`, `name`, `email` |
| `dataType` | Expected data type | `string`, `integer`, `decimal`, `date`, `email`, `phone` |
| `required` | Whether the field is required | `true`, `false` |
| `minLength` | Minimum length constraint | `1`, `5`, `10` |
| `maxLength` | Maximum length constraint | `50`, `100`, `255` |
| `pattern` | Regex pattern for validation | `^\d{5}$`, `^[A-Z]{2}\d{2}$` |
| `allowedValues` | Comma-separated list of allowed values | `active,inactive,pending` |
| `description` | Field description | `Unique identifier`, `Customer name` |

### Supported Data Types

- **string**: Any text value
- **integer**: Whole numbers
- **decimal/float**: Decimal numbers
- **date**: Valid date strings
- **email**: Valid email addresses
- **phone**: Phone numbers (with formatting)

### Example Mapping File

```csv
fieldName,dataType,required,minLength,maxLength,pattern,allowedValues,description
id,integer,true,1,10,,,Unique identifier
name,string,true,2,50,,,Customer name
email,email,true,,,,,Valid email address
status,string,true,,,,active|inactive|pending,Account status
zip_code,string,false,5,10,^\d{5}(-\d{4})?$,,ZIP code format
```

## Input File Format

The input file should be pipe-delimited (`|`) with headers matching the field names in the mapping file.

### Example Input File

```
id|name|email|status|zip_code
1|John Doe|john@example.com|active|12345
2|Jane Smith|jane@example.com|inactive|54321
3|Bob Wilson|bob@example.com|pending|98765
```

## Output Report

### Main Validation Report

The main validator generates an Excel file with multiple worksheets:

#### 1. Executive Summary
- Total records processed
- Valid/invalid record counts
- Error and warning totals
- Success rate percentage
- Duplicate record count
- Formatting issues count

#### 2. Header Validation
- Header matching results
- Missing/extra headers
- Expected vs actual headers

#### 3. Validation Rules
- All validation rules applied
- Field configurations
- Business rule descriptions

#### 4. Validation Results
- Row-by-row validation results
- All input data
- Error and warning messages
- Validation status

#### 5. Error Analysis
- Detailed error information
- Field-specific error messages
- Record data for failed validations

#### 6. Duplicate Records (if found)
- Duplicate record details
- Key fields used for detection
- Row numbers of duplicates

#### 7. Formatting Issues (if found)
- Formatting inconsistency details
- Field-level formatting problems
- Data quality assessment

#### 8. Data Quality Dashboard
- Overall data quality metrics
- Error distribution analysis
- Risk assessment

### Source vs Destination Comparison Report

The comparison validator generates a separate Excel file with:

#### 1. Executive Summary
- Overall comparison status
- Record counts for both files
- Difference analysis summary
- Priority level and recommendations

#### 2. Detailed Comparison
- Comparison configuration
- Key fields used
- Overall status

#### 3. Missing Records (if any)
- Records in source but not in destination
- Key field values
- Source row numbers

#### 4. Extra Records (if any)
- Records in destination but not in source
- Key field values
- Destination row numbers

#### 5. Data Mismatches (if strict comparison enabled)
- Records with different field values
- Field-by-field comparison
- Source vs destination values

## Validation Rules

### Required Fields
Fields marked as `required: true` must have values. Empty strings, null, or undefined values will cause validation errors.

### Length Constraints
- `minLength`: Minimum character length
- `maxLength`: Maximum character length

### Data Type Validation
- **Integer**: Must be a valid whole number
- **Decimal**: Must be a valid number (can include decimals)
- **Date**: Must be a parseable date string
- **Email**: Must match email format (user@domain.com)
- **Phone**: Must be a valid phone number format

### Duplicate Detection
The validator automatically detects duplicate records based on:
- **All Fields**: If no specific key fields are specified, all fields are used
- **Custom Key Fields**: You can specify specific fields for duplicate detection
- **Composite Keys**: Multiple fields can be combined to form unique identifiers

### Formatting Consistency Checks
The validator identifies formatting issues such as:
- **Leading/Trailing Whitespace**: Inconsistent spacing around values
- **Case Inconsistencies**: Mixed case in email fields
- **Phone Number Formats**: Inconsistent phone number formatting
- **Date Format Variations**: Different date formats in the same field
- **Decimal Precision**: Inconsistent decimal place formatting

### Decimal Precision and Scale
For decimal fields with precision specifications like `DECIMAL(18,2)`:
- **Precision (18)**: Total number of digits allowed (integer + decimal parts)
- **Scale (2)**: Number of decimal places allowed
- **Examples**:
  - `DECIMAL(18,2)`: Allows up to 18 total digits with 2 decimal places
  - Valid: `1234567890123456.78` (16 digits + 2 decimals = 18 total)
  - Invalid: `12345678901234567.89` (17 digits + 2 decimals = 19 total)
  - Invalid: `123.456` (3 decimal places exceeds scale 2)

### Pattern Validation
Use regex patterns to validate field formats:
- `^\d{5}$` - Exactly 5 digits
- `^[A-Z]{2}\d{2}$` - 2 uppercase letters followed by 2 digits

### Allowed Values
Comma-separated list of acceptable values:
- `active,inactive,pending`
- `yes,no`
- `1,2,3,4,5`

## Error Handling

The validator provides detailed error messages for each validation failure:

- **Missing Required Field**: "Field 'name' is required but missing"
- **Invalid Data Type**: "Field 'age' has invalid data type. Expected: integer, Got: abc"
- **Length Violation**: "Field 'name' is too long. Maximum length: 50, Actual: 65"
- **Pattern Mismatch**: "Field 'zip_code' does not match required pattern: ^\d{5}$"
- **Invalid Value**: "Field 'status' has invalid value 'invalid'. Allowed values: active, inactive, pending"

## Programmatic Usage

You can also use the validator programmatically:

```javascript
const CSVValidator = require('./csvValidator');

async function validateData() {
  const validator = new CSVValidator();
  
  // Load mapping rules
  await validator.loadMappingRules('mapping.csv');
  
  // Validate input file
  await validator.validateInputFile('input.txt', '|');
  
  // Generate Excel report
  validator.generateExcelReport('report.xlsx');
  
  // Get validation statistics
  const stats = validator.getValidationStats();
  console.log(`Success rate: ${stats.successRate}%`);
}

validateData();
```

## Quick Start

### Main CSV Validation

1. **Install Dependencies**: `npm install`
2. **Prepare Your Files**: Create a mapping CSV and input file
3. **Run Validation**: `node validate.js mapping.csv input.csv`
4. **Review Results**: Check the `artifacts/` folder for the generated Excel report

### Source vs Destination Comparison

1. **Prepare Your Files**: Have source and destination files ready
2. **Run Comparison**: `node compareFiles.js source.csv destination.csv`
3. **Review Results**: Check the `artifacts/` folder for the comparison report

### Using NPM Scripts

```bash
# Main validation
npm run validate

# File comparison
npm run compare
```

## Output Management

- All validation reports are saved to the `artifacts/` folder
- The artifacts folder is automatically cleaned before each validation run
- This keeps your project directory clean and organizes all output files in one place

## Dependencies

- **csv-parser**: CSV file parsing
- **csv-writer**: CSV file writing
- **xlsx**: Excel file generation
- **lodash**: Utility functions

## License

MIT License - see package.json for details.

## Support

For issues or questions, please check the test files and examples provided in the project.
