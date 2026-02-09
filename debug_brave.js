require('dotenv').config();
const axios = require('axios');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

async function testSearch(query) {
    console.log(`Searching for: "${query}"...`);
    try {
        const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
            params: { q: query, count: 5, freshness: 'day' },
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': BRAVE_API_KEY
            }
        });

        const results = response.data.web?.results || [];
        results.forEach((r, i) => {
            console.log(`\n--- Result ${i + 1} ---`);
            console.log(`Title: ${r.title}`);
            console.log(`Desc:  ${r.description}`);
            console.log(`Date:  ${r.page_age || 'N/A'}`);
            console.log(`URL:   ${r.url}`);
        });

        // Check specifically for "extra_snippets" which sometimes have the direct answer
        console.log('\n--- Extra Data ---');
        if (response.data.web?.infobox) {
            console.log('Infobox:', JSON.stringify(response.data.web.infobox, null, 2));
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSearch("hora actual en Venezuela");
