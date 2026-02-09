const axios = require('axios');

const TIMEZONE_MAP = {
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
    'new york': 'America/New_York',
    'estados unidos': 'America/New_York',
};

async function getCurrentTime({ location } = {}) {
    let loc = (location || '').toString().toLowerCase().trim();

    // Interpret vague inputs like 'mi ubicación'
    if (!loc || loc.includes('mi ubic') || loc === 'mi ubicación' || loc === 'mi ubicacion') {
        loc = (process.env.DEFAULT_LOCATION || 'Caracas').toString().toLowerCase();
    }

    // Find a timezone mapping
    let tz = TIMEZONE_MAP[loc] || null;
    if (!tz) {
        for (const [k, v] of Object.entries(TIMEZONE_MAP)) {
            if (loc.includes(k)) {
                tz = v;
                break;
            }
        }
    }

    // If the user provided a timezone-like string, accept it
    if (!tz && location && location.includes('/')) tz = location;

    if (!tz) tz = TIMEZONE_MAP[(process.env.DEFAULT_LOCATION || 'Caracas').toString().toLowerCase()] || 'America/Caracas';

    try {
        const resp = await axios.get(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(tz)}`, { timeout: 10000 });
        const data = resp.data || {};
        if (data.date && data.time) {
            return `Fecha: ${data.date} Hora: ${data.time} (zona: ${tz})`;
        }
        if (data.dateTime) {
            return `${data.dateTime} (zona: ${tz})`;
        }
        return `Hora: ${JSON.stringify(data)} (zona: ${tz})`;
    } catch (e) {
        // Fallback to worldtimeapi.org if timeapi.io fails
        try {
            const resp2 = await axios.get(`http://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`, { timeout: 10000 });
            const d2 = resp2.data || {};
            if (d2.datetime) {
                const dt = new Date(d2.datetime);
                const date = dt.toISOString().slice(0, 10);
                const time = dt.toISOString().slice(11, 19);
                return `Fecha: ${date} Hora: ${time} (zona: ${tz})`;
            }
            return `Hora (fallback): ${JSON.stringify(d2)} (zona: ${tz})`;
        } catch (e2) {
            throw new Error('Error al obtener hora desde servicios externos: ' + (e.message || e) + ' / ' + (e2.message || e2));
        }
    }
}

module.exports = { getCurrentTime };
