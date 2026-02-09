const { getPersonaMeta } = require('./personality');

function formatAssistantReply(text, opts = {}) {
    const { personaPrefix = false, maxChars = 800, focus = false } = opts;
    let out = String(text || '').trim();

    // Normalize whitespace and limit length
    out = out.replace(/\s+/g, ' ');
    if (out.length > maxChars) {
        out = out.slice(0, Math.max(100, maxChars - 3)).trim() + '...';
    }

    // If focus mode is requested, try to return only the first paragraph/line
    if (focus) {
        // Split by double newline (paragraph) and take first paragraph
        const paragraphs = out.split(/\n\n+/);
        let first = (paragraphs && paragraphs[0]) ? paragraphs[0].trim() : out;
        // If still multi-line, take first non-empty line
        const firstLine = first.split(/\n+/).find(l => l && l.trim());
        out = (firstLine || first).trim();
    }

    if (personaPrefix) {
        const { name, emoji } = getPersonaMeta();
        out = `${emoji} ${name}: ${out}`;
    }

    return out;
}

module.exports = { formatAssistantReply };
