require('dotenv').config();
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');
const execFileP = util.promisify(execFile);
const { runAgent } = require('../src/agent');
const { getBCVRate } = require('../src/bcv');
const { getBinanceP2PTopSellers } = require('../src/binance_p2p');
const { getCurrentTime } = require('../src/time');

async function ask(question, history = []) {
    const msgs = [...history, { role: 'user', content: question }];
    const resp = await runAgent(null, msgs);
    return resp;
}

(async () => {
    try {
        process.env.SEARCH_MODE = process.env.SEARCH_MODE || 'auto';

        console.log('Inicio de pruebas: ejecutar 3 consultas seguidas.');

        const results = {};

        // 1) Fecha y hora actual (a través del agente)
        console.log('\n1) Preguntando fecha y hora (a través del agente)...');
        const q1 = '¿Qué fecha y hora es ahora?';
        results.datetime = await ask(q1);
        console.log('Resultado 1:', results.datetime);

        // 2) Tasa del dólar en la página del Banco Central (preferir script Python `bcv.py` si existe)
        console.log('\n2) Preguntando tasa del dólar BCV (a través del agente)...');
        const q2 = 'Tasa del dólar según la página del Banco Central de Venezuela (última actualización)';
        results.dolar_bc = await ask(q2, [{ role: 'user', content: q1 }, { role: 'assistant', content: results.datetime }]);
        console.log('Resultado 2:', results.dolar_bc);

        // 3) Precio del Tether (USDT) en P2P de Binance, últimos 3 vendedores (API pública)
        console.log('\n3) Preguntando precio USDT P2P Binance en VES (a través del agente)...');
        const q3 = 'Precio de Tether (USDT) en P2P de Binance en bolívares venezolanos (últimos 3 vendedores)';
        results.usdt_p2p = await ask(q3, [{ role: 'user', content: q2 }, { role: 'assistant', content: results.dolar_bc }]);
        console.log('Resultado 3:', results.usdt_p2p);

        console.log('\nPruebas finalizadas. Si alguna respuesta está vacía o contiene errores, dime y lo depuro.');
    } catch (e) {
        console.error('Error en pruebas:', e);
    }
})();
