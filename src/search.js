const axios = require('axios');
require('dotenv').config();

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

/**
 * Searches the web using Brave Search API
 * @param {string} query The search query
 * @returns {Promise<string>} A formatted string with search results
 */
async function searchWeb(query) {
    if (!BRAVE_API_KEY) {
        console.error('[BRAVE] Missing API Key');
        return "No tengo configurada la búsqueda web actualmente.";
    }

    try {
        console.log(`[BRAVE] Searching for: ${query}`);
        const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
            params: { q: query, count: 5 },
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': BRAVE_API_KEY
            }
        });

        const results = response.data.web?.results || [];
        if (results.length === 0) return "No encontré resultados para esa búsqueda.";

        return results.map(r => `TÍTULO: ${r.title}\nURL: ${r.url}\nDESCRIPCIÓN: ${r.description}`).join('\n\n');
    } catch (error) {
        console.error('[BRAVE] Error searching:', error.response?.data || error.message);
        return "Tuve un problema al buscar en internet.";
    }
}

module.exports = { searchWeb };
