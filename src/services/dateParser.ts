import * as chrono from 'chrono-node';

export interface ParsedDate {
    iso: string;       // fecha en ISO 8601
    isRelative: boolean;      // true si era "mañana", "en 2 horas", etc.
    original: string;       // texto original recibido
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Parsea una expresión de fecha/hora en lenguaje natural (español o inglés)
 * y la convierte a ISO 8601.
 *
 * @param text      Expresión: "mañana a las 8am", "el viernes", "en 2 horas"
 * @param reference Fecha de referencia (default: ahora)
 * @returns ParsedDate si se pudo parsear, null si no se reconoció nada
 *
 * @example
 * parseNaturalDate("mañana a las 8am")
 * // → { iso: "2026-03-26T08:00:00.000Z", isRelative: true, confidence: "high" }
 */
export function parseNaturalDate(
    text: string,
    reference: Date = new Date()
): ParsedDate | null {

    // 1. Intentar en español primero
    let result = chrono.es.parse(text, reference, { forwardDate: true });

    // 2. Fallback a inglés si el español no encontró nada
    if (result.length === 0) {
        result = chrono.parse(text, reference, { forwardDate: true });
    }

    if (result.length === 0) return null;

    const parsed = result[0];
    const date = parsed.date();

    // Determinar si es una fecha relativa (mañana, en X horas) vs absoluta (26 de marzo)
    const relativeKeywords = /mañana|pasado|próximo|siguiente|hoy|ahora|en \d|after|next|tomorrow|today/i;
    const isRelative = relativeKeywords.test(text);

    // Estimar confianza basada en qué tan completo fue el parse
    const hasTime = parsed.start.isCertain('hour');
    const hasDate = parsed.start.isCertain('day');
    const confidence: ParsedDate['confidence'] =
        hasTime && hasDate ? 'high' :
            hasDate ? 'medium' : 'low';

    return {
        iso: date.toISOString(),
        isRelative,
        original: text,
        confidence,
    };
}

/**
 * Extrae la primera expresión de fecha encontrada dentro de un texto largo.
 * Útil para analizar el texto completo del comando de voz.
 *
 * @example
 * extractDateFromText("recuérdame comprar leche mañana a las 8am")
 * // → { iso: "...", original: "mañana a las 8am", ... }
 */
export function extractDateFromText(
    text: string,
    reference: Date = new Date()
): ParsedDate | null {

    let results = chrono.es.parse(text, reference, { forwardDate: true });
    if (results.length === 0) {
        results = chrono.parse(text, reference, { forwardDate: true });
    }
    if (results.length === 0) return null;

    const parsed = results[0];
    const date = parsed.date();

    const relativeKeywords = /mañana|pasado|próximo|siguiente|hoy|ahora|en \d|after|next|tomorrow|today/i;
    const originalText = text.slice(parsed.index, parsed.index + parsed.text.length);

    return {
        iso: date.toISOString(),
        isRelative: relativeKeywords.test(originalText),
        original: originalText,
        confidence: parsed.start.isCertain('hour') && parsed.start.isCertain('day')
            ? 'high' : parsed.start.isCertain('day') ? 'medium' : 'low',
    };
}

/**
 * Formatea una fecha ISO para mostrarla en respuestas de Edy.
 *
 * @example
 * formatDateForReply("2026-03-26T08:00:00.000Z")
 * // → "mañana 26 de marzo a las 8:00 AM"
 */
export function formatDateForReply(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    const timeStr = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });

    if (days === 0) return `hoy a las ${timeStr}`;
    if (days === 1) return `mañana ${dateStr} a las ${timeStr}`;
    if (days === -1) return `ayer ${dateStr} a las ${timeStr}`;
    if (days < 7) return `el ${date.toLocaleDateString('es-MX', { weekday: 'long' })} ${dateStr} a las ${timeStr}`;

    return `${dateStr} a las ${timeStr}`;
}