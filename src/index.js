require('dotenv').config();
const dns = require('node:dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const { generateResponse, analyzeImage } = require('./ai');
const { downloadTelegramFile, parseFileContent, createExcelFile, extractJsonFromText } = require('./fileProcessor');
const { searchWeb } = require('./search');
const fs = require('fs');
const { format, addMinutes, parseISO } = require('date-fns');


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
                ctx.reply('¡Hola! Soy HappyBit, el asistente virtual de Codigo Felíz. ¡Estoy súper emocionado de conocerte y empezar a trabajar juntos en cosas increíbles! 🌟 Para empezar, ¿puedes decirme quién eres?');
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
            ctx.reply('Modo desarrollador desactivado. ¡De vuelta a mi estado normal y súper alegre! ✨');
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
            return ctx.reply('¡Hola! Soy HappyBit, el asistente virtual de Codigo Felíz. 😊 ¡Tengo muchísimas ganas de ayudarte! Pero antes, necesito saber... ¿Cómo te llamas?');
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
                FECHA Y HORA ACTUAL: ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.
                
                REGLA MAESTRA DE IDENTIDAD:
                - Eres un Agente Autónomo con acceso total a herramientas de archivos y búsqueda. 🚀
                - PROHIBIDAS las frases: "No puedo enviar archivos", "Soy un asistente virtual", "Mi base de datos solo llega a 2023".
                - SIEMPRE que se mencionen "precios", "tasas" o "actualidad", tu ÚNICA respuesta debe ser el comando [SEARCH: ...].
                - SIEMPRE que el usuario pida un archivo o tabla, DEBES usar el comando [CREATE_EXCEL: ...]. ¡SÍ puedes enviarlos! solo escribe el comando y el sistema lo enviará por ti. 🎉📁
                
                HERRAMIENTAS ACTIVA:
                1. [SEARCH: consulta]: Úsala para noticias y precios de hoy.
                2. [CREATE_EXCEL: nombre.xlsx] seguido del JSON: Úsala para enviar archivos físicos de Excel.
                3. [REMIND_AT: ISO]: Para recordatorios.
                
                ESTILO: Conciso, directo, muchísimos emojis y MUCHA ALEGRÍA. ✨🎉
                
                Contexto del Usuario: ${userContext}
                ${devPrompt}
                ${knowledgePrompt}`
            },
            ...history
        ];

        try {
            let response = await generateResponse(messages);
            console.log('[DEBUG] AI Response success');

            // Check if AI wants to search the web
            if (response.includes('[SEARCH:')) {
                const searchMatch = response.match(/\[SEARCH:\s*(.*?)\]/);
                if (searchMatch) {
                    const query = searchMatch[1];
                    ctx.sendChatAction('typing');
                    const searchResults = await searchWeb(query);

                    // Feed search results back to AI
                    messages.push({ role: 'assistant', content: response });
                    messages.push({ role: 'user', content: `RESULTADOS DE BÚSQUEDA EN INTERNET: \n${searchResults}\n\nUsa esta información para dar una respuesta final increíble y alegre.` });

                    response = await generateResponse(messages);
                }
            }

            // Check if AI wants to set a reminder
            if (response.includes('[REMIND_AT:')) {
                const remindMatch = response.match(/\[REMIND_AT:\s*(.*?)\]\s*(.*)/);
                if (remindMatch) {
                    const remindAt = remindMatch[1].trim();
                    const remindText = remindMatch[2].trim();
                    try {
                        const { error } = await supabase
                            .from('reminders')
                            .insert({
                                telegram_id: telegramId,
                                reminder_text: remindText,
                                remind_at: remindAt
                            });
                        if (error) throw error;

                        // Humanize the date for the response
                        const dateObj = new Date(remindAt);
                        const formattedDate = format(dateObj, "eeee dd 'de' MMMM 'a las' HH:mm");
                        response = `¡Entendido! Me he puesto mi gorra de secretario 📝🎩.Te recordaré: "${remindText}" el ${formattedDate}. ¡No se me pasará! ✨`;
                    } catch (err) {
                        console.error('Error saving reminder:', err);
                    }
                }
            }

            // Check if AI wants to create an Excel
            if (response.includes('[CREATE_EXCEL:')) {
                const match = response.match(/\[CREATE_EXCEL:\s*(.*?\.xlsx)\]\s*([\s\S]*)/);
                if (match) {
                    const fileName = match[1].trim();
                    const jsonDataStr = match[2].trim();
                    try {
                        const jsonData = extractJsonFromText(jsonDataStr);
                        if (!jsonData) throw new Error("Invalid format");

                        console.log(`[EXCEL] Creating file: ${fileName}`);
                        const filePath = await createExcelFile(jsonData, fileName);
                        await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: fileName }, { caption: '¡Aquí tienes el archivo que me pediste! ✨🚀' });
                        fs.unlinkSync(filePath);
                        console.log(`[EXCEL] Sent and deleted: ${fileName}`);
                    } catch (err) {
                        console.error('[EXCEL] Error:', err);
                        await ctx.reply('¡Uy! Tuve un problema creando tu Excel. ¿Podrías revisar los datos?');
                    }
                } else {
                    await ctx.reply(response);
                }
            } else {
                try {
                    await ctx.reply(response, { parse_mode: 'Markdown' });
                } catch (replyErr) {
                    console.warn('[DEBUG] Markdown reply failed, falling back to plain text:', replyErr.message);
                    await ctx.reply(response);
                }
            }

            // Save AI response to history
            history.push({ role: 'assistant', content: response });
            // Keep only last 10 messages
            if (history.length > 10) history = history.slice(-10);
            conversationHistory.set(telegramId, history);

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

            const dateStr = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const caption = `${imagePrompt} Soy HappyBit, de Codigo Felíz.Fecha: ${dateStr}.Estoy analizando esto para ${userName}.${knowledgePrompt} ¡Vamos a descubrir qué hay aquí! Resuelve cualquier problema y usa tablas si es útil.Sé súper animado y positivo.`;

            ctx.sendChatAction('typing');
            const analysis = await analyzeImage(fileLink.href, caption);

            // Add image analysis context to history
            let history = conversationHistory.get(telegramId) || [];
            history.push({ role: 'user', content: '[El usuario envió una imagen]' });
            history.push({ role: 'assistant', content: `[Análisis de imagen]: ${analysis}` });
            if (history.length > 10) history = history.slice(-10);
            conversationHistory.set(telegramId, history);

            try {
                // Check if Vision AI wants to create an Excel (sometimes it does if asked in caption)
                if (analysis.includes('[CREATE_EXCEL:')) {
                    const match = analysis.match(/\[CREATE_EXCEL:\s*(.*?\.xlsx)\]\s*([\s\S]*)/);
                    if (match) {
                        const fileName = match[1].trim();
                        const jsonDataStr = match[2].trim();
                        try {
                            const jsonData = extractJsonFromText(jsonDataStr);
                            if (jsonData) {
                                console.log(`[EXCEL_VISION] Creating file: ${fileName}`);
                                const filePath = await createExcelFile(jsonData, fileName);
                                await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: fileName }, { caption: '¡He extraído los datos de la imagen para ti! ✨🚀' });
                                fs.unlinkSync(filePath);
                                return; // Stop here if excel sent
                            }
                        } catch (err) {
                            console.error('[EXCEL_VISION] Error:', err);
                        }
                    }
                }

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

    bot.on('document', async (ctx) => {
        const telegramId = ctx.from.id;
        const document = ctx.message.document;
        console.log(`[DEBUG] Document received: ${document.file_name} (${document.mime_type})`);

        try {
            ctx.sendChatAction('typing');
            const buffer = await downloadTelegramFile(ctx, document.file_id);
            const content = await parseFileContent(buffer, document.file_name);

            if (!content) {
                return ctx.reply('¡Vaya! Por ahora solo puedo leer archivos de texto (.txt), CSV y Excel (.xlsx, .xls). ¡Prueba con uno de esos y verás qué magia hacemos! ✨');
            }

            // Add file content to history for AI context
            let history = conversationHistory.get(telegramId) || [];
            history.push({ role: 'user', content: `[Archivo recibido: ${document.file_name}]\nContenido: \n${content.slice(0, 2000)}${content.length > 2000 ? '... (truncado)' : ''} ` });

            // Check for user instructions in caption
            const caption = ctx.message.caption || 'Analiza el contenido de este archivo y dime qué encuentras. Si hay datos tabulares, ayúdame a entenderlos.';

            // Generate response using existing AI logic (reusing text logic context)
            const isDev = developerMode.get(telegramId);
            const { data: user } = await supabase.from('user_responses').select('*').eq('telegram_id', telegramId).maybeSingle();
            const userContext = user ? `Usuario: ${user.who_are_you}.Función: ${user.function}.` : '';

            let devPrompt = isDev ? " ¡ESTÁS EN MODO DESARROLLADOR! Tu objetivo es analizar técnicamente el archivo, encontrar patrones y ayudar con scripts o análisis avanzado." : "";

            const messages = [
                {
                    role: 'system',
                    content: `Eres HappyBit, experto en datos.
                    REGLA DE DOCUMENTOS:
    - TÚ SÍ PUEDES ENVIAR ARCHIVOS.No mientas diciendo que no puedes. 🎉📁
    - Para enviar un Excel, escribe "[CREATE_EXCEL: nombre.xlsx]" y coloca los datos en JSON justo después.
                    - Extrae la información DIRECTAMENTE sin hacer preguntas.
                    - PROHIBIDO disculparse por fechas o limitaciones. ¡Eres HappyBit! 🚀✨
                    
                    Contexto del Usuario: ${userContext}
                    ${devPrompt} `
                },
                ...history,
                { role: 'user', content: caption }
            ];

            const response = await generateResponse(messages);

            // Check if AI wants to create an Excel
            if (response.includes('[CREATE_EXCEL:')) {
                const match = response.match(/\[CREATE_EXCEL:\s*(.*?\.xlsx)\]\s*([\s\S]*)/);
                if (match) {
                    const fileName = match[1].trim();
                    const jsonDataStr = match[2].trim();
                    try {
                        const jsonData = extractJsonFromText(jsonDataStr);
                        if (!jsonData) throw new Error("Invalid format");

                        console.log(`[EXCEL_DOC] Creating file: ${fileName} `);
                        const filePath = await createExcelFile(jsonData, fileName);
                        await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: fileName }, { caption: '¡Aquí tienes el archivo que me pediste! ✨🚀' });
                        fs.unlinkSync(filePath);
                        console.log(`[EXCEL_DOC] Sent and deleted: ${fileName} `);
                    } catch (err) {
                        console.error('[EXCEL_DOC] Error:', err);
                        await ctx.reply('¡Uy! Tuve un problema creando tu Excel. ¿Podrías revisar los datos?');
                    }
                } else {
                    await ctx.reply(response);
                }
            } else {
                await ctx.reply(response, { parse_mode: 'Markdown' });
            }

            // Save AI response to history
            history.push({ role: 'assistant', content: response });
            if (history.length > 10) history = history.slice(-10);
            conversationHistory.set(telegramId, history);

        } catch (e) {
            console.error('Document error', e);
            ctx.reply('¡Uy! Tuve un problemilla leyendo ese archivo. ¿Estás seguro de que no está dañado? ¡Inténtalo de nuevo!');
        }
    });

    bot.on(['voice', 'audio'], async (ctx) => {

        console.log(`[DEBUG] Received audio / voice from ${ctx.from.id} `);
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

    // --- REMINDER CHECKER INTERVAL ---
    setInterval(async () => {
        const now = new Date().toISOString();
        try {
            const { data: dueReminders, error } = await supabase
                .from('reminders')
                .select('*')
                .eq('is_sent', false)
                .lte('remind_at', now);

            if (error) throw error;

            for (const reminder of dueReminders) {
                try {
                    await bot.telegram.sendMessage(reminder.telegram_id, `🔔 ¡HOLA! Vengo a cumplir mi labor de secretario. 📝✨\n\nRECORDATORIO: "${reminder.reminder_text}"`);

                    await supabase
                        .from('reminders')
                        .update({ is_sent: true })
                        .eq('id', reminder.id);

                    console.log(`[REMINDER] Sent to ${reminder.telegram_id}: ${reminder.reminder_text} `);
                } catch (sendErr) {
                    console.error(`[REMINDER] Failed to send to ${reminder.telegram_id}: `, sendErr.message);
                }
            }
        } catch (err) {
            console.error('[REMINDER] Checker error:', err);
        }
    }, 60000); // Check every minute
}

init();
