require('dotenv').config();
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN;

function callTelegram(method) {
    return new Promise((resolve, reject) => {
        https.get(`https://api.telegram.org/bot${token}/${method}`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function diagnostic() {
    console.log('Checking Bot Token and Webhook...');
    try {
        const me = await callTelegram('getMe');
        console.log('Bot Info:', JSON.stringify(me, null, 2));

        const webhook = await callTelegram('getWebhookInfo');
        console.log('Webhook Info:', JSON.stringify(webhook, null, 2));

        if (webhook.result && webhook.result.url) {
            console.log('Detected active webhook. Deleting it to enable polling...');
            const deleted = await callTelegram('deleteWebhook');
            console.log('Delete Webhook result:', JSON.stringify(deleted, null, 2));
        } else {
            console.log('No active webhook detected.');
        }
    } catch (e) {
        console.error('Diagnostic failed:', e.message);
    }
}

diagnostic();
