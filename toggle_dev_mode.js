require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function toggleDevMode() {
    console.log('Fetching current dev mode state...');
    const { data: current, error: fetchError } = await supabase
        .from('bot_config')
        .select('value')
        .eq('key', 'developer_mode_active')
        .single();

    if (fetchError) {
        console.error('Error fetching state:', fetchError);
        return;
    }

    const currentState = current ? current.value === 'true' : false;
    const newState = !currentState;

    console.log(`Current state: ${currentState}. Flipping to: ${newState}...`);

    const { error: updateError } = await supabase
        .from('bot_config')
        .upsert({ key: 'developer_mode_active', value: newState.toString() });

    if (updateError) {
        console.error('Error updating state:', updateError);
    } else {
        console.log(`Successfully updated developer_mode_active to ${newState}`);
    }
}

toggleDevMode();
