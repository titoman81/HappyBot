const { generateResponse } = require('./ai');
const { searchWeb } = require('./search');
const axios = require('axios');
const { applyPersonality } = require('./personality');
const { getCurrentTime } = require('./time');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');
const execFileP = util.promisify(execFile);
const { getBinanceP2PTopSellers } = require('./binance_p2p');

const TOOLS = [
    {
        type: "function",
        function: {
            name: "searchWeb",
            description: "Realiza una búsqueda en internet para obtener datos variados (noticias, clima, precios, definiciones).",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "La consulta de búsqueda optimizada."
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "getGlobalTime",
            description: "Obtiene la hora y fecha EXACTA de una ubicación usando una API de tiempo confiable. Úsalo SIEMPRE para preguntas de 'qué hora es', 'fecha de hoy', 'hora en [país]'.",
            parameters: {
                type: "object",
                properties: {
                    location: {
                        type: "string",
                        description: "El lugar del que se quiere saber la hora (ej: 'Venezuela', 'Madrid', 'Buenos Aires', 'Tokyo')."
                    }
                },
                required: ["location"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "transcribeAudio",
            description: "Transcribe un archivo de audio a texto. Parámetros: { filePath: string }",
            parameters: {
                type: 'object',
                properties: {
                    filePath: { type: 'string', description: 'Ruta al archivo de audio en el sistema de archivos del bot' }
                },
                required: ['filePath']
            }
        }
    }
];

// --- OPENCLAW-STYLE AGENTIC LOOP ---
async function runAgent(ctx, messages, tools = TOOLS, depth = 0, aiFunction = generateResponse) {
    if (depth >= 5) {
        console.log('[AGENT] Max recursion depth reached.');
        return messages[messages.length - 1].content || "Lo siento, me he quedado sin ideas. 🌀";
    }

    try {
        // Handle pending confirmation flow: check for a pending search stored as a system message
        const pending = messages.find(m => m.role === 'system' && m.name === 'pending_search');
        const lastUser = messages.slice().reverse().find(m => m.role === 'user');
        if (pending && lastUser) {
            const payload = (() => {
                try { return JSON.parse(pending.content); } catch (e) { return { query: pending.content }; }
            })();
            const userReply = String(lastUser.content || '').toLowerCase();
            const affirmative = /^(s|si|sí|yes|ok|vale|claro)\b/i.test(userReply);
            const negative = /^(no|n|nah|nop)\b/i.test(userReply);
            const { formatAssistantReply } = require('./postprocess');

            if (affirmative) {
                // remove pending marker
                const idx = messages.findIndex(m => m === pending);
                if (idx !== -1) messages.splice(idx, 1);
                // perform the search and return results in persona
                if (payload && payload.query) {
                    const q = payload.query;
                    if (ctx && ctx.sendChatAction) ctx.sendChatAction('typing');
                    const result = await searchWeb(q);
                    return formatAssistantReply(result, { personaPrefix: true, focus: true });
                }
            }

            if (negative) {
                const idx = messages.findIndex(m => m === pending);
                if (idx !== -1) messages.splice(idx, 1);
                return formatAssistantReply('¡De acuerdo, no busco nada! Si cambias de idea, dime y busco 😊', { personaPrefix: true, focus: false });
            }
            // If neither clearly affirmative nor negative, continue normal flow (the user's reply will be passed to the model)
        }
        // Decide which tools to expose for this turn based on a lightweight heuristic
        function decideTools(msgs) {
            const lastUser = msgs.slice().reverse().find(m => m.role === 'user');
            const text = (lastUser && lastUser.content) ? String(lastUser.content).toLowerCase() : '';
            if (!text) return { selected: [], askForSearch: false };
            const SEARCH_MODE = (process.env.SEARCH_MODE || 'auto').toLowerCase(); // auto | ask | manual

            const includeTime = /\bhora\b|\bfecha\b|qué hora|qué fecha|hora en/gi.test(text);
            const includeSearchAuto = /buscar|busca|investiga|últimas|noticias|precio|precio de|cuánto|quién es|quien es|quién ganó|quien ganó|último|actualizado|actualmente|hoy|clima|tiempo|cotización|cotiza/gi.test(text);
            // In 'ask' mode be more conservative: require explicit "busca" or "investiga"
            const includeSearchAsk = /\bbusca?r?\b|investiga/gi.test(text);

            const includeSearch = SEARCH_MODE === 'manual' ? false : (SEARCH_MODE === 'ask' ? includeSearchAsk : includeSearchAuto);

            const selected = TOOLS.filter(t => {
                const n = t.function.name;
                if (n === 'searchWeb' && includeSearch) return true;
                if (n === 'getGlobalTime' && includeTime) return true;
                return false;
            });

            const askForSearch = SEARCH_MODE === 'ask' && includeSearchAsk;
            return { selected, askForSearch };
        }

        // Ensure personality system message is present but do not duplicate it on recursion
        const messagesWithPersona = applyPersonality(messages);

        const decision = decideTools(messagesWithPersona);
        const toolsToUse = decision.selected;

        // Quick-handlers: if the user's last message clearly asks for BCV rate or P2P USDT in VES,
        // answer directly using local helpers (prefer Python scripts) to avoid unnecessary model tool flow.
        const lastUserMsg = messagesWithPersona.slice().reverse().find(m => m.role === 'user');
        const lastText = (lastUserMsg && lastUserMsg.content) ? String(lastUserMsg.content).toLowerCase() : '';
        const wantsBCVDirect = /banco central|bcv|tasa del bcv|tasa del banco central/.test(lastText);
        const wantsP2PDirect = (/p2p|binance/.test(lastText) || /venezuel/.test(lastText)) && /usdt|tether/.test(lastText) && /ves|boli|bolivar|bolíva|venezuel/.test(lastText);
        if (wantsBCVDirect) {
            // try python bcv.py first
            try {
                const py = path.join(process.cwd(), 'bcv.py');
                if (fs.existsSync(py)) {
                    const { stdout } = await execFileP('python', [py], { cwd: process.cwd(), timeout: 20000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
                    const m = stdout.match(/([0-9]+[\.,]?[0-9]*)/);
                    if (m) {
                        const val = m[1].replace(/,/g, '.');
                        const { formatAssistantReply } = require('./postprocess');
                        return formatAssistantReply(`${val} VES`, { personaPrefix: true, focus: true });
                    }
                }
            } catch (e) {
                console.warn('[AGENT] bcv.py failed (direct):', e.message || e);
            }
            // fallback to JS extractor
            try {
                const val = await (require('./bcv').getBCVRate)();
                const cleaned = String(val).replace(/\s*\(fuente:.*\)/i, '');
                const { formatAssistantReply } = require('./postprocess');
                return formatAssistantReply(cleaned, { personaPrefix: true, focus: true });
            } catch (e) {
                // continue to normal flow if all fails
            }
        }

        if (wantsP2PDirect) {
            try {
                const py = path.join(process.cwd(), 'paralelo.py');
                if (fs.existsSync(py)) {
                    const { stdout } = await execFileP('python', [py], { cwd: process.cwd(), timeout: 20000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
                    const m = stdout.match(/([0-9]+[\.,]?[0-9]*)/);
                    if (m) {
                        const val = m[1].replace(/,/g, '.');
                        const { formatAssistantReply } = require('./postprocess');
                        return formatAssistantReply(`${val} VES`, { personaPrefix: true, focus: true });
                    }
                }
            } catch (e) {
                console.warn('[AGENT] paralelo.py failed (direct):', e.message || e);
            }
            // fallback to JS extractor (returns a list); take the first numeric price if possible
            try {
                const list = await getBinanceP2PTopSellers({ asset: 'USDT', fiat: 'VES', rows: 3 });
                // try to extract the lowest numeric from list
                const m = String(list).match(/([0-9]+[\.,]?[0-9]*)/g);
                if (m && m.length) {
                    const cleaned = m.map(x => x.replace(/,/g, '.')).map(Number).filter(Boolean);
                    if (cleaned.length) {
                        const val = Math.min(...cleaned);
                        const { formatAssistantReply } = require('./postprocess');
                        return formatAssistantReply(`${val} VES`, { personaPrefix: true, focus: true });
                    }
                }
            } catch (e) {
                console.warn('[AGENT] JS P2P extractor failed (direct):', e.message || e);
            }
        }

        const SEARCH_MODE = (process.env.SEARCH_MODE || 'auto').toLowerCase();
        if (decision.askForSearch && SEARCH_MODE === 'ask') {
            // Push a system marker so we remember the original query and can act on the user's confirmation
            const lastUserMsg = messages.slice().reverse().find(m => m.role === 'user');
            const originalQuery = lastUserMsg ? lastUserMsg.content : '';
            // avoid duplicating pending markers
            const existing = messages.find(m => m.role === 'system' && m.name === 'pending_search');
            if (!existing) {
                messages.push({ role: 'system', name: 'pending_search', content: JSON.stringify({ query: originalQuery }) });
            }
            const { formatAssistantReply } = require('./postprocess');
            const askText = formatAssistantReply('¿Quieres que busque en internet para obtener información actualizada sobre esto? (sí/no)', { personaPrefix: true });
            // Also push the assistant's question into the history
            messages.push({ role: 'assistant', content: askText });
            return askText;
        }

        const aiMessage = await aiFunction(messagesWithPersona, toolsToUse);

        // FIX: Handle string errors from generateResponse
        if (typeof aiMessage === 'string') {
            console.error('[AGENT] AI returned string error:', aiMessage);
            return aiMessage;
        }

        // If it's a pure text response, post-process and return it
        if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
            const { formatAssistantReply } = require('./postprocess');
            return formatAssistantReply(aiMessage.content, { personaPrefix: false, focus: true });
        }

        // If tools are called, execute them
        messages.push(aiMessage); // Add assistant's tool request to history

        const toolResponses = [];
        for (const toolCall of aiMessage.tool_calls) {
            try {
                // Normalize tool call names and arguments from the model to our local tool functions
                function normalizeToolCall(tc) {
                    const rawName = ((tc.function && tc.function.name) || '').toString().toLowerCase();
                    // Try parsing arguments safely
                    let parsedArgs = {};
                    try {
                        parsedArgs = typeof tc.function.arguments === 'string' && tc.function.arguments.trim()
                            ? JSON.parse(tc.function.arguments)
                            : (tc.function.arguments || {});
                    } catch (e) {
                        // not JSON — keep raw string for heuristics
                        parsedArgs = { _raw: String(tc.function.arguments || '') };
                    }

                    // Map common model tool names to our internal functions
                    let mapped = null;
                    if (/search|web|google|brave|bing|duckduckgo/.test(rawName)) mapped = 'searchWeb';
                    else if (/time|hora|date|fecha|timezone/.test(rawName)) mapped = 'getGlobalTime';
                    else if (/transcribe|stt|speech|audio|recogniz/.test(rawName)) mapped = 'transcribeAudio';
                    else if (/price|precio|bitcoin|btc/.test(rawName)) mapped = 'searchWeb';
                    else mapped = tc.function.name; // fallback to original

                    // Fill common argument shapes
                    if (mapped === 'searchWeb') {
                        if (!parsedArgs.query) {
                            parsedArgs.query = parsedArgs.q || parsedArgs.term || parsedArgs.text || parsedArgs.prompt || parsedArgs.search || parsedArgs._raw || '';
                        }
                    }
                    if (mapped === 'getGlobalTime') {
                        if (!parsedArgs.location) {
                            parsedArgs.location = parsedArgs.locationName || parsedArgs.city || parsedArgs.zone || parsedArgs._raw || '';
                        }
                    }

                    return { toolName: mapped, args: parsedArgs };
                }

                const { toolName, args } = normalizeToolCall(toolCall);
                console.log(`[AGENT] Raw Tool Call: ${JSON.stringify(toolCall)} -> mapped: ${toolName}`, args);

                console.log(`[AGENT] Executing tool: ${toolName}`, args);
                if (ctx && ctx.sendChatAction) ctx.sendChatAction('typing');

                let toolResult = "Error executing tool.";

                if (toolName === 'searchWeb') {
                    // Detect P2P Binance USDT queries and prefer the local Python helper if available
                    const q = (args.query || '').toString().toLowerCase();
                    const wantsP2P = (/p2p|binance/.test(q) || /venezuel/.test(q)) && /usdt|tether/.test(q) && /ves|boli|bolivar|bolíva|venezuel/.test(q);
                    const wantsBCV = /bcv|banco central|banco central de venezuela|tasa del bcv/.test(q);

                    if (wantsP2P) {
                        const py = path.join(process.cwd(), 'paralelo.py');
                        if (fs.existsSync(py)) {
                            try {
                                const { stdout } = await execFileP('python', [py], { cwd: process.cwd(), timeout: 20000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
                                const m = stdout.match(/([0-9]+[\.,]?[0-9]*)/);
                                if (m) {
                                    toolResult = m[1].replace(/,/g, '.');
                                } else {
                                    // fallback to JS extractor list if python output isn't numeric
                                    toolResult = await getBinanceP2PTopSellers({ asset: 'USDT', fiat: 'VES', rows: 3 });
                                }
                            } catch (e) {
                                console.warn('[AGENT] paralelo.py failed:', e.message || e);
                                toolResult = await getBinanceP2PTopSellers({ asset: 'USDT', fiat: 'VES', rows: 3 });
                            }
                        } else {
                            toolResult = await getBinanceP2PTopSellers({ asset: 'USDT', fiat: 'VES', rows: 3 });
                        }
                    } else if (wantsBCV) {
                        const py = path.join(process.cwd(), 'bcv.py');
                        if (fs.existsSync(py)) {
                            try {
                                const { stdout } = await execFileP('python', [py], { cwd: process.cwd(), timeout: 20000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
                                const m = stdout.match(/([0-9]+[\.,]?[0-9]*)/);
                                if (m) toolResult = m[1].replace(/,/g, '.'); else toolResult = await searchWeb(args.query);
                            } catch (e) {
                                console.warn('[AGENT] bcv.py failed:', e.message || e);
                                toolResult = await searchWeb(args.query);
                            }
                        } else {
                            toolResult = await searchWeb(args.query);
                        }
                    } else {
                        toolResult = await searchWeb(args.query);
                    }
                } else if (toolName === 'transcribeAudio') {
                    // Handle audio transcription via Python script or local helper
                    const stt = require('./stt');
                    try {
                        const fp = args.filePath || args.path || args.file || args.audio || args._raw || '';
                        if (!fp) throw new Error('No se proporcionó `filePath` para transcribir.');
                        const text = await stt.transcribeAudio({ filePath: fp });
                        toolResult = text;
                    } catch (e) {
                        toolResult = `Error transcribiendo audio: ${e.message || e}`;
                    }
                } else if (toolName === 'getGlobalTime') {
                    // Use the dedicated time helper for robust timezone handling
                    try {
                        toolResult = await getCurrentTime({ location: args.location });
                        messages.push({
                            tool_call_id: toolCall.id,
                            role: "tool",
                            name: toolName,
                            content: toolResult
                        });
                        toolResponses.push(String(toolResult));
                        continue; // next tool (if any)
                    } catch (e) {
                        // fallback to previous logic if helper fails
                    }

                    const timezones = {
                        'venezuela': 'America/Caracas',
                        'caracas': 'America/Caracas',
                        'argentina': 'America/Argentina/Buenos_Aires',
                        'buenos aires': 'America/Argentina/Buenos_Aires',
                        'chile': 'America/Santiago',
                        'santiago': 'America/Santiago',
                        'colombia': 'America/Bogota',
                        'bogota': 'America/Bogota',
                        'españa': 'Europe/Madrid',
                        'madrid': 'Europe/Madrid',
                        'mexico': 'America/Mexico_City',
                        'cdmx': 'America/Mexico_City',
                        'peru': 'America/Lima',
                        'lima': 'America/Lima',
                        'miami': 'America/New_York',
                        'new york': 'America/New_York'
                    };
                    let locLower = (args.location || '').toLowerCase();
                    // Interpret vague inputs like 'mi ubicación'
                    if (locLower.includes('mi ubic')) {
                        args.location = process.env.DEFAULT_LOCATION || 'Caracas';
                        locLower = args.location.toLowerCase();
                    }
                    let tz = null;
                    for (const [key, val] of Object.entries(timezones)) {
                        if (locLower.includes(key)) tz = val;
                    }

                    // If no location provided, fall back to DEFAULT_LOCATION env var (e.g., Caracas)
                    if (!args.location || String(args.location).trim() === '') {
                        args.location = process.env.DEFAULT_LOCATION || 'Caracas';
                    }

                    if (tz) {
                        try {
                            const resp = await axios.get(`https://timeapi.io/api/Time/current/zone?timeZone=${tz}`);
                            toolResult = `Hora Exacta (API): ${resp.data.time} - Fecha: ${resp.data.date} - Zona: ${tz}`;
                        } catch (e) { toolResult = "Error conectando a TimeAPI."; }
                    } else {
                        toolResult = await searchWeb(`current time in ${args.location} timeanddate.com`);
                    }
                }

                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolName,
                    content: toolResult
                });
                // collect raw tool outputs to return directly to the user in persona
                toolResponses.push(String(toolResult));
            } catch (toolErr) {
                console.error(`[AGENT] Tool Execution Error (${toolCall.function.name}):`, toolErr);
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: "Error internamente al ejecutar la herramienta."
                });
                toolResponses.push("Error internamente al ejecutar la herramienta.");
            }
        }

        // Instead of asking the LLM to produce a final answer (which can refuse),
        // return the tool outputs directly formatted in persona (one-line focus).
        const { formatAssistantReply } = require('./postprocess');
        const combined = toolResponses.length === 1 ? toolResponses[0] : toolResponses.join(' | ');
        return formatAssistantReply(combined, { personaPrefix: true, focus: true });

    } catch (e) {
        console.error('[AGENT] Error in loop:', e);
        return "Lo siento, me he mareado un poco. ¿Me lo repites?";
    }
}

module.exports = { runAgent, TOOLS };
