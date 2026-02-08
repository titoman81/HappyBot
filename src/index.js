require('dotenv').config();
const dns = require('node:dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const { generateResponse, analyzeImage } = require('./ai');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// In-memory state for onboarding and history
const userState = new Map();
const userData = new Map();
const conversationHistory = new Map(); // { telegram_id: [{role, content}] }

async function init() {
    console.log('Bot initialized with Supabase client');

    // Debug middleware to see every update
    bot.use(async (ctx, next) => {
        console.log(`[DEBUG] Received update: ${ctx.updateType} from ${ctx.from?.username || ctx.from?.id}`);
        if (ctx.message?.text) console.log(`[DEBUG] Text: ${ctx.message.text}`);
        if (ctx.message?.photo) console.log(`[DEBUG] Photo received`);
        return next();
    });

    bot.command('start', async (ctx) => {
        console.log('[DEBUG] Command /start received');
        const telegramId = ctx.from.id;
        try {
            console.log(`[DEBUG] Querying Supabase for telegram_id: ${telegramId}`);
            const { data: users, error } = await supabase
                .from('user_responses')
                .select('*')
                .eq('telegram_id', telegramId);

            if (error) {
                console.error('[DEBUG] Supabase selection error:', error);
                throw error;
            }
            console.log(`[DEBUG] Supabase query complete. Users found: ${users.length}`);

            if (users.length === 0) {
                console.log('[DEBUG] New user detected');
                userState.set(telegramId, 'WAITING_NAME');
                userData.set(telegramId, {});
                ctx.reply('¡Hola! Soy tu asistente de inteligencia artificial. Para empezar, ¿quién eres?');
            } else {
                const user = users[0];
                if (!user.who_are_you) {
                    userState.set(telegramId, 'WAITING_NAME');
                    ctx.reply('Hola. ¿Quién eres?');
                } else if (!user.function) {
                    userState.set(telegramId, 'WAITING_FUNCTION');
                    ctx.reply(`Hola ${user.who_are_you}. ¿Cuál es tu función?`);
                } else {
                    ctx.reply(`Hola de nuevo ${user.who_are_you}. Soy tu asistente. ¿En qué te puedo ayudar hoy?\n\nPuedes enviarme una imagen o preguntarme cualquier cosa. Para tablas, solo pídemelo.`);
                }
            }
        } catch (e) {
            console.error('[DEBUG] Start error:', e);
            ctx.reply('Error verificando usuario.');
        }
    });

    bot.on('text', async (ctx) => {
        const telegramId = ctx.from.id;
        const text = ctx.message.text;
        const state = userState.get(telegramId);
        console.log(`[DEBUG] Handling text from ${telegramId}, state: ${state || 'NONE'}`);

        if (state === 'WAITING_NAME') {
            console.log(`[DEBUG] Saving name: ${text}`);
            const data = userData.get(telegramId) || {};
            data.name = text;
            userData.set(telegramId, data);

            userState.set(telegramId, 'WAITING_FUNCTION');
            ctx.reply(`Entendido, ${text}. Ahora dime, ¿cuál es tu función?`);
            return;
        }

        if (state === 'WAITING_FUNCTION') {
            console.log(`[DEBUG] Saving function: ${text}`);
            const data = userData.get(telegramId) || {};
            data.function = text;

            try {
                const { error } = await supabase
                    .from('user_responses')
                    .upsert({
                        telegram_id: telegramId,
                        username: ctx.from.username,
                        who_are_you: data.name,
                        function: data.function
                    }, { onConflict: 'telegram_id' });

                if (error) throw error;
                console.log('[DEBUG] Data upserted to Supabase');

                userState.delete(telegramId);
                userData.delete(telegramId);

                ctx.reply(`¡Perfecto! Todo guardado. Ahora estoy listo para ayudarte.\n\nPuedes enviarme fotos de documentos para analizar o pedirme que cree tablas comparativas.`);
            } catch (e) {
                console.error('[DEBUG] Save error:', e);
                ctx.reply('Error guardando datos en la base de datos.');
            }
            return;
        }

        // General Chat
        console.log('[DEBUG] Calling AI for general chat');
        ctx.sendChatAction('typing');

        // Fetch user context from Supabase
        let userContext = 'El usuario ya se ha identificado.';
        try {
            const { data: user } = await supabase
                .from('user_responses')
                .select('who_are_you, function')
                .eq('telegram_id', telegramId)
                .maybeSingle();
            if (user) {
                userContext = `Estás hablando con "${user.who_are_you}". Su función es "${user.function}".`;
            }
        } catch (e) {
            console.error('[DEBUG] Context fetch error:', e);
        }

        // Get and update history
        let history = conversationHistory.get(telegramId) || [];
        history.push({ role: 'user', content: text });

        const messages = [
            { role: 'system', content: `Eres un asistente experto en resolución de problemas, soporte técnico y análisis de datos. Tu prioridad es ofrecer soluciones directas y útiles. ${userContext} Si la información es compleja o requiere organización, utiliza tablas o listas Markdown para mayor claridad, pero prioriza siempre la resolución del problema.` },
            ...history
        ];

        try {
            const response = await generateResponse(messages);
            console.log('[DEBUG] AI Response success');

            // Save AI response to history
            history.push({ role: 'assistant', content: response });
            // Keep only last 10 messages
            if (history.length > 10) history = history.slice(-10);
            conversationHistory.set(telegramId, history);

            try {
                await ctx.reply(response, { parse_mode: 'Markdown' });
            } catch (replyErr) {
                console.warn('[DEBUG] Markdown reply failed, falling back to plain text:', replyErr.message);
                await ctx.reply(response);
            }
        } catch (err) {
            console.error('[DEBUG] AI Final error:', err);
            ctx.reply('Tuve un pequeño problema con la IA, pero aquí sigo. ¿Podrías intentar de nuevo?');
        }
    });

    bot.on('photo', async (ctx) => {
        console.log('[DEBUG] Photo handler triggered');
        const telegramId = ctx.from.id;
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1];
        const fileId = photo.file_id;

        try {
            const fileLink = await ctx.telegram.getFileLink(fileId);

            // Fetch user context for Vision
            let userContext = '';
            try {
                const { data: user } = await supabase
                    .from('user_responses')
                    .select('who_are_you')
                    .eq('telegram_id', telegramId)
                    .maybeSingle();
                if (user) userContext = ` El usuario se llama "${user.who_are_you}".`;
            } catch (e) { }

            const caption = (ctx.message.caption || 'Analiza esta imagen en detalle para identificar problemas o extraer información clave.') + userContext + ' Si la respuesta incluye datos técnicos o comparativos, considera usar una tabla Markdown para mayor claridad.';

            ctx.sendChatAction('typing');
            const analysis = await analyzeImage(fileLink.href, caption);

            // Add image analysis context to history
            let history = conversationHistory.get(telegramId) || [];
            history.push({ role: 'user', content: '[El usuario envió una imagen]' });
            history.push({ role: 'assistant', content: `[Análisis de imagen]: ${analysis}` });
            if (history.length > 10) history = history.slice(-10);
            conversationHistory.set(telegramId, history);

            try {
                await ctx.reply(analysis, { parse_mode: 'Markdown' });
            } catch (replyErr) {
                console.warn('[DEBUG] Vision Markdown reply failed, falling back to plain text:', replyErr.message);
                await ctx.reply(analysis);
            }
        } catch (e) {
            console.error('Photo error', e);
            ctx.reply('Error procesando la imagen.');
        }
    });

    bot.on(['voice', 'audio'], async (ctx) => {
        console.log(`[DEBUG] Received audio/voice from ${ctx.from.id}`);
        ctx.reply('Por el momento solo puedo procesar texto e imágenes. Muy pronto podré entender tus notas de voz. ¡Envíame un texto o una foto!');
    });

    bot.on('message', async (ctx) => {
        console.log(`[DEBUG] Received unhandled update type for message`);
        if (!ctx.message.text && !ctx.message.photo && !ctx.message.voice && !ctx.message.audio) {
            ctx.reply('No estoy seguro de cómo procesar este tipo de archivo aún. Prueba enviándome un mensaje de texto o una imagen.');
        }
    });

    bot.catch((err, ctx) => {
        console.error(`[ERROR] Unhandled error for ${ctx.updateType}`, err);
        try {
            ctx.reply('Ups, ocurrió un error interno. Pero no te preocupes, ya estoy de vuelta. ¿En qué estábamos?');
        } catch (e) {
            console.error('Error sending crash notice', e);
        }
    });

    bot.launch();
    console.log('Bot started');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

init();
