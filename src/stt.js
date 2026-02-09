const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');
const execFileP = util.promisify(execFile);

async function transcribeAudio({ filePath } = {}) {
    if (!filePath) throw new Error('transcribeAudio requiere `filePath`');
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) throw new Error('Archivo de audio no encontrado: ' + abs);

    // Prefer a local Python script `stt.py` if present
    const py = path.join(process.cwd(), 'stt.py');
    if (fs.existsSync(py)) {
        try {
            const { stdout } = await execFileP('python', [py, abs], { cwd: process.cwd(), timeout: 120000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
            return String(stdout || '').trim();
        } catch (e) {
            throw new Error('Error ejecutando stt.py: ' + (e.message || e));
        }
    }

    throw new Error('No se encontró un script de STT (stt.py). Añade un script que acepte una ruta de audio y devuelva la transcripción.');
}

module.exports = { transcribeAudio };
