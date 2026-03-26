/**
 * Cliente HTTP para la API de Taskeer (Render).
 * Se usa solo cuando TASKEER_API_URL está definido en .env.
 */

interface TaskeerTask {
    title: string;
    dueAt?: Date | null;
    priority?: string;
    projectSlug?: string | null;
}

interface TaskeerResponse {
    id: string | number;
    title: string;
}

async function createTask(task: TaskeerTask): Promise<TaskeerResponse> {
    const url = process.env.TASKEER_API_URL;
    if (!url) throw new Error('TASKEER_API_URL not configured');

    const res = await fetch(`${url}/tasks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.TASKEER_API_KEY ?? ''}`,
        },
        body: JSON.stringify({
            title: task.title,
            due_at: task.dueAt?.toISOString() ?? null,
            priority: task.priority ?? 'MEDIUM',
            project: task.projectSlug ?? null,
        }),
        signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
        throw new Error(`Taskeer responded ${res.status}: ${await res.text()}`);
    }

    return res.json() as Promise<TaskeerResponse>;
}

async function getTasks(): Promise<TaskeerResponse[]> {
    const url = process.env.TASKEER_API_URL;
    if (!url) throw new Error('TASKEER_API_URL not configured');

    const res = await fetch(`${url}/tasks`, {
        headers: { 'Authorization': `Bearer ${process.env.TASKEER_API_KEY ?? ''}` },
        signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Taskeer responded ${res.status}`);
    return res.json() as Promise<TaskeerResponse[]>;
}

export const taskeerClient = { createTask, getTasks };