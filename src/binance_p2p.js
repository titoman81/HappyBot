const axios = require('axios');

async function getBinanceP2PTopSellers({ asset = 'USDT', fiat = 'VES', rows = 3 } = {}) {
    const url = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
    const body = {
        page: 1,
        rows: rows,
        payTypes: [],
        asset: asset,
        fiat: fiat,
        tradeType: 'SELL' // sellers who sell USDT for fiat
    };

    try {
        const resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json', 'User-Agent': 'HappyBot/1.0' }, timeout: 10000 });
        const data = resp.data;
        if (!data || !data.data) throw new Error('Sin datos en respuesta de Binance P2P');

        const offers = data.data || [];
        const top = offers.slice(0, rows).map((o, i) => {
            const adv = o.adv || o;
            const price = adv.price || (o.adv ? o.adv.price : '');
            const nick = (o.advertiser && (o.advertiser.nickName || o.advertiser.nick)) || (o.nickName) || 'vendedor';
            return `${i + 1}. ${price} ${fiat} — ${nick}` + (adv.advNo ? ` (id:${adv.advNo})` : '');
        });

        return top.join('\n');
    } catch (e) {
        if (e && e.response && e.response.data) {
            // return some detail for debugging
            throw new Error('Binance P2P error: ' + JSON.stringify(e.response.data));
        }
        throw e;
    }
}

module.exports = { getBinanceP2PTopSellers };
