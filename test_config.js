require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function testConfig() {
    console.log('Testing Supabase config load...');
    try {
        const { data, error } = await supabase.from('bot_config').select('*');
        if (error) {
            console.error('Supabase Error:', error);
        } else {
            console.log('Config loaded:', data);
        }
    } catch (e) {
        console.error('Exception:', e);
    }
}

testConfig();
