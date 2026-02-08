require('dotenv').config();
const dns = require('node:dns');
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');
const OpenAI = require('openai');

const client = new OpenAI({
    apiKey: process.env.NVIDIA_NIM_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
});

async function test() {
    try {
        console.log('Testing model:', 'stepfun-ai/step-3.5-flash');
        const completion = await client.chat.completions.create({
            model: 'stepfun-ai/step-3.5-flash',
            messages: [{ role: 'user', content: 'Say hello in Spanish' }],
            max_tokens: 10,
        });
        console.log('Result:', completion.choices[0].message.content);
    } catch (e) {
        console.error('Error:', e.status, e.message);
    }
}

test();
