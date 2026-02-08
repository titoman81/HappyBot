const { searchWeb } = require('./src/search');
require('dotenv').config();

async function test() {
    console.log('Testing Brave Search...');
    const results = await searchWeb('noticias de hoy');
    console.log('Results:', results);
}

test();
