require('dotenv').config();
const { runAgent } = require('../src/agent');

(async () => {
    try {
        // Ensure ask mode for demo
        process.env.SEARCH_MODE = process.env.SEARCH_MODE || 'ask';

        const messages = [
            { role: 'user', content: '¿Cuál es el precio actual del bitcoin?' }
        ];

        console.log('--- Demo: user asks a current factual question (SEARCH_MODE=ask) ---');
        console.log('User:', messages[0].content);

        const reply1 = await runAgent(null, messages);
        console.log('Agent:', reply1);

        // Simulate user confirming the search
        messages.push({ role: 'user', content: 'sí' });
        console.log('\n--- User confirms (sí) ---');
        const reply2 = await runAgent(null, messages);
        console.log('Agent:', reply2);

    } catch (e) {
        console.error('Demo error:', e);
    }
})();
