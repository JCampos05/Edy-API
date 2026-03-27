/**
 * Cliente HTTP para el servicio RAG local (Python / ChromaDB).
 * Si el servicio no está disponible, retorna contexto vacío sin lanzar error
 * para no bloquear el flujo principal de Edy.
 */

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:5001';

export interface RagResult {
    context: string;
    sources: string[];
}

/**
 * Consulta el servicio RAG con una pregunta y retorna los fragmentos
 * más relevantes de la base de conocimiento local.
 *
 * @param question Texto a buscar en la base vectorial
 * @param topK     Número máximo de fragmentos a retornar (default: 3)
 */
export async function fetchRagContext(
    question: string,
    topK = 3
): Promise<RagResult> {
    try {
        const res = await fetch(`${RAG_URL}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, top_k: topK }),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) return { context: '', sources: [] };
        return res.json() as Promise<RagResult>;

    } catch {
        // RAG no disponible — el flujo continúa sin contexto adicional
        return { context: '', sources: [] };
    }
}