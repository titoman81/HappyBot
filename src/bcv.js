const axios = require('axios');

function normalizeNumberString(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    // common cases: "1.234.567,89" or "1,234,567.89" or "1234567.89"
    // Remove non-digit except ., and ,
    s = s.replace(/[^0-9.,]/g, '');
    // If comma is decimal (there is one comma and groups of 3 separated by dots), convert
    const commaCount = (s.match(/,/g) || []).length;
    const dotCount = (s.match(/\./g) || []).length;
    if (commaCount === 1 && dotCount >= 1 && /\.[0-9]{3}\./.test(s) === false) {
        // ambiguous, prefer treating comma as decimal if dots look like thousands
    }
    // Heuristic: if comma exists and it's rightmost separator, make it a decimal
    if (commaCount > 0 && (s.lastIndexOf(',') > s.lastIndexOf('.'))) {
        s = s.replace(/\./g, ''); // remove thousand dots
        s = s.replace(/,/g, '.');
    } else {
        s = s.replace(/,/g, '');
    }

    const m = s.match(/\d+\.?\d*/);
    return m ? m[0] : null;
}

async function tryBCVUrls(urls) {
    for (const url of urls) {
        try {
            const resp = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'HappyBot/1.0' } });
            const html = String(resp.data || '');

            // 1) Try to find JSON-LD or inline JSON with rates
            const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]{0,2000}?)<\/script>/i);
            if (jsonLdMatch && jsonLdMatch[1]) {
                try {
                    const j = JSON.parse(jsonLdMatch[1]);
                    const flat = JSON.stringify(j);
                    const num = normalizeNumberString(flat.match(/\d[\d.,]{0,20}\d/));
                    if (num) return `${num} VES (fuente: ${url})`;
                } catch (e) { /* ignore JSON parse issues */ }
            }

            // 2) Look for nearby words indicating dollar rate
            const patterns = [
                /d[óo]lar[^\n\r]{0,80}?([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]+))/i,
                /(?:Tasa|Paridad|Precio|Tipo de cambio)[^\n\r]{0,80}?([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]+))/i,
                /([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})\s*(?:Bs|VES|VEF)/i,
                /([0-9]{1,3}(?:,[0-9]{3})*\.?[0-9]+)\s*(?:Bs|VES|VEF)/i
            ];

            for (const re of patterns) {
                const m = html.match(re);
                if (m && m[1]) {
                    const n = normalizeNumberString(m[1]);
                    if (n) return `${n} VES (fuente: ${url})`;
                }
            }

            // 3) Last resort: find any plausible number with 'Bs' or 'VES' nearby
            const alt = html.match(/([0-9][0-9\.,]{3,})\s*(?:Bs|VES|VEF)/i);
            if (alt && alt[1]) {
                const n = normalizeNumberString(alt[1]);
                if (n) return `${n} VES (fuente: ${url})`;
            }

        } catch (e) {
            // Try next URL
            continue;
        }
    }
    return null;
}

async function tryDolarToday() {
    const candidates = [
        'https://s3.amazonaws.com/dolartoday/data.json',
        'https://s3.amazonaws.com/dolartoday/dolartoday.json'
    ];
    for (const url of candidates) {
        try {
            const r = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'HappyBot/1.0' } });
            const j = r.data;
            if (!j) continue;

            // Search for numeric fields in the JSON that look like a USD->VES price
            const found = [];
            function walk(obj, path = []) {
                if (obj && typeof obj === 'object') {
                    for (const k of Object.keys(obj)) {
                        walk(obj[k], path.concat(k));
                    }
                } else {
                    if (typeof obj === 'number' || (typeof obj === 'string' && /\d/.test(obj))) {
                        const key = path.join('.').toLowerCase();
                        const s = String(obj);
                        const n = normalizeNumberString(s);
                        if (n) {
                            // prefer keys with 'usd' or 'dollar' or 'transfer' or 'promedio'
                            const score = (key.includes('usd') || key.includes('dolar') || key.includes('dollar') ? 3 : 0)
                                + (key.includes('transfer') || key.includes('promedio') || key.includes('transferencia') ? 2 : 0);
                            found.push({ key, n, score });
                        }
                    }
                }
            }

            walk(j);
            if (found.length) {
                found.sort((a, b) => b.score - a.score);
                return `${found[0].n} VES (fuente: ${url} key:${found[0].key})`;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

async function getBCVRate() {
    const bcvUrls = [
        'https://www.bcv.org.ve/',
        'https://bcv.org.ve/',
        'https://www.bcv.gob.ve/'
    ];

    const fromBcv = await tryBCVUrls(bcvUrls);
    if (fromBcv) return fromBcv;

    // fallback: try DolarToday S3 JSON mirrors
    const fromDt = await tryDolarToday();
    if (fromDt) return fromDt;

    throw new Error('No pude extraer la tasa del BCV ni de fuentes alternativas.');
}

module.exports = { getBCVRate };
