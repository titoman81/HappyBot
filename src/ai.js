require('dotenv').config();
const dns = require('node:dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const OpenAI = require('openai');

const client = new OpenAI({
    apiKey: process.env.NVIDIA_NIM_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    timeout: 30000, // 30 seconds
});

async function generateResponse(messages) {
    try {
        console.log(`[DEBUG] AI Request: ${JSON.stringify(messages).slice(0, 50)}...`);
        const completion = await client.chat.completions.create({
            model: process.env.NVIDIA_MODEL,
            messages: messages,
            temperature: 0.5,
            top_p: 1,
            max_tokens: 1024,
        });
        console.log('[DEBUG] AI Response received');
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('[DEBUG] AI Error:', error.status, error.message);
        return 'Lo siento, tuve un problema procesando tu solicitud.';
    }
}

async function analyzeImage(imageUrl, prompt) {
    try {
        console.log(`[DEBUG] Analyzing image: ${imageUrl.slice(0, 50)}...`);
        const completion = await client.chat.completions.create({
            model: 'microsoft/phi-4-multimodal-instruct', // Modern multimodal model on NIM
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl,
                            },
                        },
                    ],
                },
            ],
            temperature: 0.1, // Lower temperature for more accurate extraction
            max_tokens: 1536,
        });
        console.log('[DEBUG] Image analysis complete');
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('[DEBUG] Vision Error:', error.status, error.message);
        return 'No pude analizar la imagen correctamente. Intenta con otra o asegúrate de que el texto sea legible.';
    }
}


module.exports = { generateResponse, analyzeImage };
