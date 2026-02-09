require('dotenv').config();
const { searchWeb } = require('../src/search');

function normalizeToolCall(tc) {
    const rawName = ((tc.function && tc.function.name) || '').toString().toLowerCase();
    let parsedArgs = {};
    try {
        parsedArgs = typeof tc.function.arguments === 'string' && tc.function.arguments.trim()
            ? JSON.parse(tc.function.arguments)
            : (tc.function.arguments || {});
    } catch (e) {
        parsedArgs = { _raw: String(tc.function.arguments || '') };
    }

    let mapped = null;
    if (/search|web|google|brave|bing|duckduckgo|buscar/.test(rawName)) mapped = 'searchWeb';
    else if (/time|hora|date|fecha|timezone/.test(rawName)) mapped = 'getGlobalTime';
    else if (/price|precio|bitcoin|btc/.test(rawName)) mapped = 'searchWeb';
    else mapped = tc.function.name;

    if (mapped === 'searchWeb') {
        if (!parsedArgs.query) {
            parsedArgs.query = parsedArgs.q || parsedArgs.term || parsedArgs.text || parsedArgs.prompt || parsedArgs.search || parsedArgs.consulta || parsedArgs._raw || '';
        }
    }
    if (mapped === 'getGlobalTime') {
        if (!parsedArgs.location) {
            parsedArgs.location = parsedArgs.locationName || parsedArgs.city || parsedArgs.zone || parsedArgs._raw || '';
        }
    }

    return { toolName: mapped, args: parsedArgs };
}

async function run() {
    const examples = [
        { function: { name: 'buscar_web', arguments: JSON.stringify({ consulta: 'precio actual del bitcoin' }) }, id: '1' },
        { function: { name: 'get_current_bitcoin_price', arguments: '{}' }, id: '2' },
        { function: { name: 'buscarweb', arguments: JSON.stringify({ q: 'últimas noticias sobre inteligencia artificial' }) }, id: '3' }
    ];

    for (const ex of examples) {
        const { toolName, args } = normalizeToolCall(ex);
        console.log('\n--- Simulated tool call ---');
        console.log('raw:', ex.function.name, ex.function.arguments);
        console.log('mapped:', toolName, args);

        if (toolName === 'searchWeb') {
            const q = args.query || args.q || '';
            console.log('[simulate] Running searchWeb for:', q);
            const res = await searchWeb(q);
            console.log('[simulate] Result:\n', res);
        } else if (toolName === 'getGlobalTime') {
            console.log('[simulate] getGlobalTime mapping — no implementation in this script.');
        } else {
            console.log('[simulate] Unknown mapped tool — skipping');
        }
    }
}

run().catch(e => { console.error('simulate error', e); process.exit(1); });
