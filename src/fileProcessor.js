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
    const wb = XLSX.utils.book_new();

    // data should be an array of objects or an array of arrays
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    const tempPath = path.join(process.cwd(), fileName);
    XLSX.writeFile(wb, tempPath);

    return tempPath;
}

/**
 * Extracts structured data from text if it looks like a table
 */
function extractTableData(text) {
    // This is a simple helper, AI usually does a better job.
    // We can use this to try and "edit" files by converting AI response back to Excel.
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    return lines.map(line => line.split(/[\t,|]/).map(cell => cell.trim()));
}

/**
 * Extracts and parses JSON from a string that might contain markdown or extra text
 */
function extractJsonFromText(text) {
    try {
        // Clean markdown backticks if present
        let cleanText = text.replace(/```json|```/g, '').trim();

        // Find the first [ and the last ] for arrays, or { and } for objects
        const startArray = cleanText.indexOf('[');
        const endArray = cleanText.lastIndexOf(']');
        const startObject = cleanText.indexOf('{');
        const endObject = cleanText.lastIndexOf('}');

        let start = -1;
        let end = -1;

        if (startArray !== -1 && (startObject === -1 || startArray < startObject)) {
            start = startArray;
            end = endArray;
        } else if (startObject !== -1) {
            start = startObject;
            end = endObject;
        }

        if (start !== -1 && end !== -1 && end > start) {
            const jsonPart = cleanText.substring(start, end + 1);
            return JSON.parse(jsonPart);
        }

        return JSON.parse(cleanText);
    } catch (e) {
        console.error('[JSON_EXTRACT] Error parsing:', e.message);
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
