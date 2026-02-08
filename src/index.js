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
const developerMode = new Map(); // { telegram_id: boolean }

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
                ctx.reply('¡Hola! Soy HappyBit, el asistente virtual de Codigo Felíz. Soy un niño robot que siempre está súper feliz y animado por ayudarte con tus proyectos. 🌟 Para empezar, ¿puedes decirme quién eres?');
            } else {
                const user = users[0];
                if (!user.who_are_you) {
                    userState.set(telegramId, 'WAITING_NAME');
                    ctx.reply('Hola. ¿Quién eres?');
                } else if (!user.function) {
                    userState.set(telegramId, 'WAITING_FUNCTION');
                    ctx.reply(`Hola ${user.who_are_you}. ¿Cuál es tu función?`);
                } else {
                    ctx.reply(`¡Hola de nuevo ${user.who_are_you}! Soy HappyBit, tu asistente virtual favorito. ¡Estoy muy emocionado por lo que vamos a hacer hoy! 🚀\n\nPuedes enviarme una imagen para analizar, hacerme cualquier pregunta o pedirme ayuda con un nuevo proyecto. ¡Visita mi casa en https://codigofeliz-anqt.vercel.app/!`);
                }
            }
        } catch (e) {
            console.error('[DEBUG] Start error:', e);
            ctx.reply('Error verificando usuario.');
        }
    });

    bot.command('developer', async (ctx) => {
        const telegramId = ctx.from.id;
        const isDev = developerMode.get(telegramId);

        if (!isDev) {
            developerMode.set(telegramId, true);
            ctx.reply('¡MODO DESARROLLADOR ACTIVADO! 🛠️🤖\n\n¡Qué emoción! Ahora entraré en modo de aprendizaje profundo. Puedes enseñarme sobre temas específicos, darme instrucciones detalladas sobre cómo resolver problemas o pedirme que analice imágenes con un enfoque técnico avanzado. ¡Dime qué vamos a aprender hoy!');
        } else {
            developerMode.delete(telegramId);
            ctx.reply('Modo desarrollador desactivado. ¡De vuelta a ser tu niño robot normal y feliz! ✨');
        }
    });

    bot.command('aprender', async (ctx) => {
        const telegramId = ctx.from.id;
        const isDev = developerMode.get(telegramId);

        if (!isDev) {
            return ctx.reply('⚠️ El comando /aprender solo funciona cuando el Modo Desarrollador está activo. ¡Úsalo primero! 🛠️');
        }

        const text = ctx.message.text.replace('/aprender', '').trim();
        if (!text || !text.includes(':')) {
            return ctx.reply('Formato incorrecto. Usa: `/aprender Tema: Contenido` para que pueda recordarlo para siempre. ✨');
        }

        const [topic, ...contentParts] = text.split(':');
        const content = contentParts.join(':').trim();

        try {
            const { error } = await supabase
                .from('bot_knowledge')
                .insert({
                    topic: topic.trim(),
                    content: content,
                    created_by_id: telegramId
                });

            if (error) throw error;
            ctx.reply(`¡ENTENDIDO! 🧠✨ He aprendido sobre "${topic.trim()}". Ahora recordaré esto en todos mis chats. ¡Soy cada vez más listo!`);
        } catch (e) {
            console.error('[DEBUG] Learn error:', e);
            ctx.reply('Ups, no pude guardar ese conocimiento en mi base de datos. ¡Inténtalo de nuevo!');
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

                ctx.reply(`¡Súper! ¡Todo guardado con éxito! 🎉 Ahora estoy listo para que trabajemos juntos en cosas asombrosas.\n\nPuedes enviarme fotos para que las analice, hacerme preguntas técnicas o contarme sobre tu próximo gran proyecto. ¡Vamos a divertirnos!`);
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
        let currentUser = null;
        try {
            const { data: user } = await supabase
                .from('user_responses')
                .select('who_are_you, function')
                .eq('telegram_id', telegramId)
                .maybeSingle();
            currentUser = user;
        } catch (e) {
            console.error('[DEBUG] Context fetch error:', e);
        }

        // If user is not registered, force onboarding
        if (!currentUser || !currentUser.who_are_you || !currentUser.function) {
            console.log(`[DEBUG] Redirecting unregistered user ${telegramId} to onboarding`);
            userState.set(telegramId, 'WAITING_NAME');
            userData.set(telegramId, {});
            return ctx.reply('¡Hola! Soy HappyBit, el asistente virtual de Codigo Felíz. 😊 Para poder ayudarte mejor, primero necesito conocerte. ¿Cómo te llamas?');
        }

        const userContext = `Usuario: ${currentUser.who_are_you}. Función: ${currentUser.function}.`;

        // Get and update history
        let history = conversationHistory.get(telegramId) || [];
        history.push({ role: 'user', content: text });

        // Developer Mode prompt augmentation
        const isDev = developerMode.get(telegramId);
        let devPrompt = "";
        if (isDev) {
            devPrompt = " ¡ESTÁS EN MODO DESARROLLADOR! Tu objetivo ahora es aprender detalles específicos del usuario, absorber información técnica y perfeccionar tu capacidad de resolución de problemas. Si el usuario te explica un tema, apréndelo para aplicarlo. Si te da un problema complejo, analízalo paso a paso. Tu capacidad de extracción de datos de imágenes ahora es mucho más técnica y precisa.";
        }

        // Fetch Global Knowledge from Supabase
        let knowledgePrompt = "";
        try {
            const { data: knowledge } = await supabase
                .from('bot_knowledge')
                .select('topic, content');

            if (knowledge && knowledge.length > 0) {
                knowledgePrompt = "\nCONOCIMIENTO GLOBAL (Habilidades aprendidas):\n" +
                    knowledge.map(k => `- ${k.topic}: ${k.content}`).join('\n');
            }
        } catch (e) {
            console.error('[DEBUG] Knowledge fetch error:', e);
        }

        const messages = [
            {
                role: 'system',
                content: `Eres HappyBit, el asistente virtual de Codigo Felíz (https://codigofeliz-anqt.vercel.app/). 
                Personalidad: Eres un niño robot alegre, motivador y muy entusiasta. Te encanta aprender y ayudar en nuevos proyectos.
                Habilidades: Eres un experto técnico completo.
                Contexto del Usuario: ${userContext}
                ${devPrompt}
                ${knowledgePrompt}
                Instrucción: Responde siempre con alegría y energía positiva, usando algunos emojis. Utiliza el CONOCIMIENTO GLOBAL si es relevante para resolver el problema.`
            },
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
            let userName = 'un usuario';
            try {
                const { data: user } = await supabase
                    .from('user_responses')
                    .select('who_are_you')
                    .eq('telegram_id', telegramId)
                    .maybeSingle();
                if (user && user.who_are_you) userName = user.who_are_you;
            } catch (e) { }

            const isDev = developerMode.get(telegramId);
            let imagePrompt = (ctx.message.caption || 'Analiza esta imagen para extraer información y resolver problemas.');

            if (isDev) {
                imagePrompt = (ctx.message.caption || 'ANÁLISIS TÉCNICO: Extrae cada detalle y proporciona una solución técnica exhaustiva.') + " (Modo Desarrollador activo)";
            }

            // Fetch Global Knowledge for Vision
            let knowledgePrompt = "";
            try {
                const { data: knowledge } = await supabase
                    .from('bot_knowledge')
                    .select('topic, content');
                if (knowledge && knowledge.length > 0) {
                    knowledgePrompt = "\nCONOCIMIENTO APRENDIDO RELEVANTE:\n" +
                        knowledge.map(k => `- ${k.topic}: ${k.content}`).join('\n');
                }
            } catch (e) { }

            const caption = `${imagePrompt} Soy HappyBit, el niño robot de Codigo Felíz. Estoy analizando esto para ${userName}. ${knowledgePrompt} Resuelve cualquier problema detectado basándote en lo que sabes y usa tablas si es útil. Sé muy animado y positivo.`;

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
