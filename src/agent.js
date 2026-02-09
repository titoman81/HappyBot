const { generateResponse } = require('./ai');
const { searchWeb } = require('./search');
const axios = require('axios');

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
    }
];

// --- OPENCLAW-STYLE AGENTIC LOOP ---
async function runAgent(ctx, messages, tools = TOOLS, depth = 0, aiFunction = generateResponse) {
    if (depth >= 5) {
        console.log('[AGENT] Max recursion depth reached.');
        return messages[messages.length - 1].content || "Lo siento, me he quedado sin ideas. 🌀";
    }

    try {
        const aiMessage = await aiFunction(messages, tools);

        // FIX: Handle string errors from generateResponse
        if (typeof aiMessage === 'string') {
            console.error('[AGENT] AI returned string error:', aiMessage);
            return aiMessage;
        }

        // If it's a pure text response, return it
        if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
            return aiMessage.content;
        }

        // If tools are called, execute them
        messages.push(aiMessage); // Add assistant's tool request to history

        for (const toolCall of aiMessage.tool_calls) {
            try {
                const toolName = toolCall.function.name;
                console.log(`[AGENT] Raw Tool Call: ${JSON.stringify(toolCall)}`);

                let args = {};
                try {
                    args = JSON.parse(toolCall.function.arguments);
                } catch (parseErr) {
                    console.error(`[AGENT] JSON Parse Failed: ${toolCall.function.arguments}`);
                    messages.push({
                        tool_call_id: toolCall.id,
                        role: "tool",
                        name: toolName,
                        content: "Error: Invalid JSON arguments provided."
                    });
                    continue;
                }

                console.log(`[AGENT] Executing tool: ${toolName}`, args);
                if (ctx && ctx.sendChatAction) ctx.sendChatAction('typing');

                let toolResult = "Error executing tool.";

                if (toolName === 'searchWeb') {
                    toolResult = await searchWeb(args.query);
                } else if (toolName === 'getGlobalTime') {
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
                    const locLower = (args.location || '').toLowerCase();
                    let tz = null;
                    for (const [key, val] of Object.entries(timezones)) {
                        if (locLower.includes(key)) tz = val;
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
            } catch (toolErr) {
                console.error(`[AGENT] Tool Execution Error (${toolCall.function.name}):`, toolErr);
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: "Error internamente al ejecutar la herramienta."
                });
            }
        }

        // RECURSIVE CALL: Feed tool results back to the agent
        return await runAgent(ctx, messages, tools, depth + 1, aiFunction);

    } catch (e) {
        console.error('[AGENT] Error in loop:', e);
        return "Lo siento, me he mareado un poco. ¿Me lo repites?";
    }
}

module.exports = { runAgent, TOOLS };
