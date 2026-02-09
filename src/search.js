const axios = require('axios');
const { generateResponse } = require('./ai');
const { applyPersonality } = require('./personality');

// Simple TTL cache to avoid hammering the search API for repeated queries
const cache = new Map();
const DEFAULT_TTL = Number(process.env.SEARCH_CACHE_TTL || 300); // seconds

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet(key, value, ttl = DEFAULT_TTL) {
    cache.set(key, { value, expires: Date.now() + ttl * 1000 });
}

async function rawBraveSearch(query, opts = {}) {
    const apiUrlEnv = process.env.BRAVE_API_URL;
    const defaultUrls = [
        'https://api.search.brave.com/v1/search',
        'https://api.search.brave.com/res/v1/web/search',
        'https://api.search.brave.com/res/v1/search'
    ];
    const apiUrlOptions = apiUrlEnv ? [apiUrlEnv, ...defaultUrls] : defaultUrls;
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) throw new Error('BRAVE_API_KEY not set in environment');

    const params = {
        q: query,
        size: opts.size || 5,
    };

    // Try several header styles commonly used by Brave/other providers.
    const headerOptions = [
        { 'Accept': 'application/json', 'User-Agent': 'HappyBot/1.0', 'X-Subscription-Token': apiKey },
        { 'Accept': 'application/json', 'User-Agent': 'HappyBot/1.0', 'Authorization': `Bearer ${apiKey}` },
        { 'Accept': 'application/json', 'User-Agent': 'HappyBot/1.0', 'X-API-Key': apiKey }
    ];

    // Allow overriding headers via env if needed
    const CUSTOM_HEADER = process.env.BRAVE_API_HEADER; // e.g. 'X-Subscription-Token'
    if (CUSTOM_HEADER) {
        headerOptions.unshift({ 'Accept': 'application/json', 'User-Agent': 'HappyBot/1.0', [CUSTOM_HEADER]: apiKey });
    }

    let lastErr = null;
    for (const url of apiUrlOptions) {
        for (const headers of headerOptions) {
            try {
                const resp = await axios.get(url, { params, headers, timeout: 10000 });
                return resp.data;
            } catch (e) {
                lastErr = e;
                // If non-403 error, rethrow immediately
                if (e && e.response && e.response.status && e.response.status !== 403) {
                    throw e;
                }
                // otherwise try next header or URL
            }
        }
    }

    // If we reach here, all header attempts failed; throw the last error so caller can log
    throw lastErr || new Error('Brave search failed with unknown error');
}

function normalizeBraveResponse(data) {
    // Brave results shapes may vary; try common fields
    let items = [];
    if (!data) return items;

    // Common locations for results in various API shapes
    if (Array.isArray(data.web && data.web.results)) items = data.web.results;
    else if (Array.isArray(data.results)) items = data.results;
    else if (Array.isArray(data.items)) items = data.items;
    else if (Array.isArray(data.organic_results)) items = data.organic_results;
    else if (Array.isArray(data.data && data.data.results)) items = data.data.results;
    else if (Array.isArray(data.value && data.value.results)) items = data.value.results;
    else if (Array.isArray(data.items && data.items.results)) items = data.items.results;

    // If items is empty but there's a textual answer/summary, return it as single pseudo-item
    if ((!items || items.length === 0) && (data.answer || data.summary || data.snippet)) {
        const text = data.answer || data.summary || data.snippet;
        return [{ title: '', snippet: text, url: '', source: '' }];
    }

    return items.map(it => ({
        title: String(it.title || it.name || it.header || it.label || ''),
        snippet: String(it.snippet || it.snippet_highlighted || it.snippet_html || it.description || it.summary || it.excerpt || it.body || ''),
        url: String(it.url || it.link || it.source || it.canonical_url || it.display_url || ''),
        source: String((it.domain || it.source || it.host || it.site) || '').replace(/^https?:\/\//, '')
    }));
}

async function searchWeb(query, opts = {}) {
    try {
        const key = `brave:${query}`;
        const fromCache = cacheGet(key);
        if (fromCache) return fromCache;
        const data = await rawBraveSearch(query, opts);
        const items = normalizeBraveResponse(data).slice(0, opts.max || 3);

        // If there are no items, try fallback textual answers
        if (!items || items.length === 0) {
            const fallback = (data && (data.answer || data.summary || data.snippet)) || '';
            const text = fallback ? String(fallback).trim() : 'No se encontraron resultados claros.';
            cacheSet(key, text);
            return text;
        }

        // Helper to strip HTML and normalize whitespace
        function stripHtml(s) {
            if (!s) return '';
            return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        const maxSnippet = Number(process.env.SEARCH_SNIPPET_MAX_CHARS || 240);
        const formatted = items.map((i, idx) => {
            const title = stripHtml(i.title) || 'Sin título';
            let snippet = stripHtml(i.snippet || '');
            if (snippet.length > maxSnippet) snippet = snippet.slice(0, Math.max(80, maxSnippet - 3)).trim() + '...';
            const url = i.url || '';
            const source = i.source || (url ? url.replace(/^https?:\/\//, '') : 'fuente desconocida');
            const entry = `${idx + 1}. ${title}${snippet ? ' — ' + snippet : ''} (${source})` + (url ? `\n   Enlace: ${url}` : '');
            return entry;
        }).join('\n\n');

        cacheSet(key, formatted);
        // Optionally generate a short LLM summary (2 lines) about the top results
        try {
            const doSummary = (process.env.SEARCH_SUMMARY || 'true').toLowerCase() === 'true';
            if (doSummary) {
                const lines = Number(process.env.SEARCH_SUMMARY_LINES || 2);
                const summaryPrompt = `IMPORTANTE: En la PRIMERA LÍNEA responde SOLO lo que pidió el usuario y nada más (ejemplo: "70,911.61 USD"). No expliques ni añadas comentarios en esa primera línea. Después de la primera línea puedes, si es necesario, listar hasta ${Math.max(1, lines)} fuentes en líneas separadas. Haz el resumen en ${lines} linea${lines === 1 ? '' : 's'} en español y en estilo de un robot entusiasta.` +
                    `\n\nResultados:\n\n${formatted}`;
                const messages = applyPersonality([{ role: 'user', content: summaryPrompt }]);
                const aiResp = await generateResponse(messages);
                if (aiResp && typeof aiResp === 'object' && aiResp.content) {
                    const summary = String(aiResp.content).trim();
                    const combined = `${summary}\n\n${formatted}`;
                    cacheSet(key, combined);
                    return combined;
                }
            }
        } catch (e) {
            if (process.env.SEARCH_DEBUG) console.error('[searchWeb] Summary generation failed:', e && e.message ? e.message : e);
            // fallthrough to return formatted results
        }

        return formatted;
    } catch (e) {
        // Log a bit more detail in debug mode
        if (process.env.SEARCH_DEBUG) console.error('[searchWeb] Error detail:', e && e.response ? { status: e.response.status, data: e.response.data } : e);
        console.error('[searchWeb] Error:', e.message || e);
        return 'No pude obtener resultados de búsqueda en este momento.';
    }
}

module.exports = { searchWeb };
