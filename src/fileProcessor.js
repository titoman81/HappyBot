const XLSX = require('xlsx');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Downloads a file from Telegram and returns its buffer and name
 */
async function downloadTelegramFile(ctx, fileId) {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

/**
 * Processes text, CSV, and Excel files to extract content as string
 */
async function parseFileContent(buffer, fileName) {
    const ext = path.extname(fileName).toLowerCase();

    const textExtensions = ['.txt', '.json', '.md', '.js', '.html', '.css', '.py', '.sql'];
    if (textExtensions.includes(ext)) {
        return buffer.toString('utf-8');
    }

    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let fullText = '';

        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            fullText += `--- Hoja: ${sheetName} ---\n`;
            json.forEach(row => {
                fullText += row.join('\t') + '\n';
            });
            fullText += '\n';
        });

        return fullText;
    }

    return null;
}

/**
 * Creates an Excel file from JSON data and returns the path to the temporary file
 */
async function createExcelFile(data, fileName = 'resultado.xlsx') {
    try {
        const wb = XLSX.utils.book_new();
        let ws;

        if (Array.isArray(data) && Array.isArray(data[0])) {
            ws = XLSX.utils.aoa_to_sheet(data);
        } else {
            ws = XLSX.utils.json_to_sheet(data);
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Datos');

        // Ensure filename ends correctly
        if (!fileName.endsWith('.xlsx')) fileName += '.xlsx';

        const tempPath = path.join(process.cwd(), fileName);
        XLSX.writeFile(wb, tempPath);

        return tempPath;
    } catch (e) {
        console.error('[EXCEL_CORE] Error:', e.message);
        throw e;
    }
}

/**
 * Extracts structured data from text if it looks like a table
 */
function extractTableData(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    const data = lines.map(line => {
        // Split by separators
        let cells = line.split(/[\t,|]/).map(cell => cell.trim());

        // Remove empty cells at the start and end (common in markdown tables: | cell |)
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();

        return cells;
    });

    // Filter out separator rows (like |---|---|)
    return data.filter(row => {
        const isSeparator = row.every(cell => /^[-:|]+$/.test(cell));
        return !isSeparator && row.length > 0;
    });
}

/**
 * Extracts and parses JSON or tabular data from a string
 */
function extractJsonFromText(text) {
    try {
        // Clean markdown backticks if present
        let cleanText = text.replace(/```json|```/g, '').trim();

        // Strategy 1: Look for JSON Array
        const startArray = cleanText.indexOf('[');
        const endArray = cleanText.lastIndexOf(']');
        if (startArray !== -1 && endArray !== -1 && endArray > startArray) {
            try {
                const jsonPart = cleanText.substring(startArray, endArray + 1);
                return JSON.parse(jsonPart);
            } catch (e) { /* ignore and try next */ }
        }

        // Strategy 2: Look for JSON Object
        const startObject = cleanText.indexOf('{');
        const endObject = cleanText.lastIndexOf('}');
        if (startObject !== -1 && endObject !== -1 && endObject > startObject) {
            try {
                const jsonPart = cleanText.substring(startObject, endObject + 1);
                return JSON.parse(jsonPart);
            } catch (e) { /* ignore and try next */ }
        }

        // Strategy 3: Try to parse as a markdown table or CSV-like text
        const tableData = extractTableData(cleanText);
        if (tableData && tableData.length > 1) {
            // Convert array of arrays to array of objects
            const headers = tableData[0];
            return tableData.slice(1).map(row => {
                const obj = {};
                headers.forEach((h, i) => {
                    obj[h || `Columna ${i + 1}`] = row[i] || '';
                });
                return obj;
            });
        }

        return null;
    } catch (e) {
        console.error('[JSON_EXTRACT] Critical error:', e.message);
        return null;
    }
}

module.exports = {
    downloadTelegramFile,
    parseFileContent,
    createExcelFile,
    extractTableData,
    extractJsonFromText
};
