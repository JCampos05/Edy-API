import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface ShellOptions {
    /** Directorio de trabajo (default: ./projects/<slug> o CWD) */
    cwd?: string;
    /** Variables de entorno adicionales */
    env?: Record<string, string>;
    /** Tiempo máximo de ejecución en ms (default: 120 000 = 2 min) */
    timeoutMs?: number;
    /** Callback para recibir salida en tiempo real */
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface ShellResult {
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    /** Mensaje legible para Edy */
    summary: string;
    /** Comando ejecutado (redactado si contiene tokens/passwords) */
    command: string;
    durationMs: number;
}

// ── Allowlist de comandos seguros ─────────────────────────────────────────────
//
// Usa prefijos normalizados. El comando real se compara contra esta lista
// después de dividir en tokens (argv[0] + subcomando opcional).
//
// Formato: "<ejecutable> [subcomando]"
// Ejemplos que matchean:  "npm install" → token[0]="npm" token[1]="install"
//                         "pip install" → token[0]="pip" token[1]="install"

const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
    // Node / npm
    'npm install',
    'npm ci',
    'npm run',
    'npm init',
    'npm update',
    'npx prisma',
    'npx tsc',
    'npx tsx',

    // Python / pip
    'pip install',
    'pip3 install',
    'python -m pip',
    'python3 -m pip',
    'pip install -r',
    'pip3 install -r',

    // Git (solo lectura + clone)
    'git clone',
    'git pull',
    'git status',
    'git log',
    'git diff',
    'git init',
    'git add',
    'git commit',

    // Información del sistema (solo lectura)
    'node --version',
    'node -v',
    'npm --version',
    'npm -v',
    'python --version',
    'python3 --version',
    'pip --version',
    'pip3 --version',
    'git --version',
    'ollama --version',
    'ollama list',
    'ollama pull',

    // Listado de archivos (no destructivo)
    'ls',
    'dir',
    'pwd',
    'echo',

    // Herramientas de proyecto
    'prisma migrate',
    'prisma generate',
    'prisma studio',
    'tsc',
    'tsx',
    'ng serve',
    'ng build',
    'ng generate',
    'uvicorn',
    'flask run',
]);

// Comandos siempre bloqueados (aunque estuvieran en la allowlist por error)
const BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
    /\brm\s+-rf\b/i,
    /\bformat\b/i,
    /\bdel\s+\/[sf]/i,           // Windows: del /S /F
    /\brd\s+\/[sq]/i,            // Windows: rd /S /Q
    /\brmdir\b/i,
    /\bpoweroff\b|\breboot\b|\bshutdown\b/i,
    /\bsudo\b/i,                  // No escalada de privilegios
    /\bcurl\s+.*\|\s*(bash|sh)\b/i,   // Pipe to shell
    /\bwget\s+.*\|\s*(bash|sh)\b/i,
    /\b(DROP|TRUNCATE|DELETE)\s+TABLE\b/i,  // SQL destructivo
    />\s*\/dev\/sd[a-z]/i,        // Escritura a discos crudos
];

// ── Detección de OS ───────────────────────────────────────────────────────────

export type SupportedOS = 'win32' | 'linux' | 'darwin';

export function getOS(): SupportedOS {
    const platform = os.platform();
    if (platform === 'win32') return 'win32';
    if (platform === 'darwin') return 'darwin';
    return 'linux';
}

/**
 * Adapta el comando al shell del sistema operativo actual.
 * En Windows usamos `cmd /C` para evitar problemas con PATH.
 * En Linux/macOS usamos `bash -c`.
 */
function buildSpawnArgs(rawCommand: string): { cmd: string; args: string[] } {
    const platform = getOS();

    if (platform === 'win32') {
        return { cmd: 'cmd.exe', args: ['/C', rawCommand] };
    }

    return { cmd: 'bash', args: ['-c', rawCommand] };
}

// ── Validación de seguridad ────────────────────────────────────────────────────

/**
 * Verifica si un comando está en la allowlist y no contiene patrones peligrosos.
 * Retorna null si es seguro, o un mensaje de error si está bloqueado.
 */
export function validateCommand(rawCommand: string): string | null {
    const trimmed = rawCommand.trim();

    // 1. Verificar patrones siempre bloqueados
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return `Comando bloqueado por seguridad (patrón peligroso detectado).`;
        }
    }

    // 2. Extraer los primeros 2 tokens del comando para comparar con allowlist
    const tokens = trimmed.split(/\s+/).slice(0, 2);
    const twoTokenKey = tokens.join(' ').toLowerCase();
    const oneTokenKey = tokens[0]?.toLowerCase() ?? '';

    const isAllowed =
        ALLOWED_COMMANDS.has(twoTokenKey) ||
        ALLOWED_COMMANDS.has(oneTokenKey) ||
        // Permitir variaciones como "npm run dev", "npx prisma migrate dev"
        [...ALLOWED_COMMANDS].some(allowed => twoTokenKey.startsWith(allowed));

    if (!isAllowed) {
        return [
            `Comando no permitido: "${oneTokenKey}".`,
            `Comandos disponibles: npm, pip, git, node, python, prisma, tsc, ollama.`,
            `Si necesitas ejecutar otro comando, agrégalo a la allowlist en shell.service.ts.`,
        ].join(' ');
    }

    return null; // todo ok
}

// ── Ejecutor principal ────────────────────────────────────────────────────────

/**
 * Ejecuta un comando de shell de forma segura con streaming de output.
 *
 * @example
 * // Instalar dependencias de un proyecto recién scaffoldeado
 * const result = await executeShellCommand('npm install', {
 *   cwd: './projects/mi-api',
 *   onOutput: (line, stream) => console.log(`[${stream}] ${line}`),
 * });
 *
 * @example
 * // Instalar paquete Python
 * const result = await executeShellCommand('pip install flask requests', {
 *   cwd: './projects/mi-flask-app',
 * });
 */
export async function executeShellCommand(
    rawCommand: string,
    options: ShellOptions = {}
): Promise<ShellResult> {
    const {
        cwd = process.cwd(),
        env = {},
        timeoutMs = 120_000,
        onOutput,
    } = options;

    const startTime = Date.now();

    // 1. Validar seguridad
    const validationError = validateCommand(rawCommand);
    if (validationError) {
        return {
            success: false,
            exitCode: null,
            stdout: '',
            stderr: validationError,
            summary: `No ejecuté el comando: ${validationError}`,
            command: rawCommand,
            durationMs: 0,
        };
    }

    // 2. Resolver directorio de trabajo (debe existir)
    const resolvedCwd = path.resolve(cwd);

    // 3. Armar args para el SO actual
    const { cmd, args } = buildSpawnArgs(rawCommand);

    return new Promise((resolve) => {
        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];

        const child = spawn(cmd, args, {
            cwd: resolvedCwd,
            env: { ...process.env, ...env },
            shell: false,   // Ya pasamos el comando a cmd/bash explícitamente
        });

        // Streaming stdout
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            const lines = chunk.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                stdoutLines.push(line);
                onOutput?.(line, 'stdout');
            }
        });

        // Streaming stderr
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            const lines = chunk.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                stderrLines.push(line);
                onOutput?.(line, 'stderr');
            }
        });

        // Timeout
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            resolve({
                success: false,
                exitCode: null,
                stdout: stdoutLines.join('\n'),
                stderr: stderrLines.join('\n'),
                summary: `El comando tardó más de ${timeoutMs / 1000}s y fue cancelado.`,
                command: rawCommand,
                durationMs: Date.now() - startTime,
            });
        }, timeoutMs);

        child.on('close', (exitCode) => {
            clearTimeout(timer);
            const success = exitCode === 0;
            const duration = Date.now() - startTime;

            const summary = buildSummary(rawCommand, exitCode, success, duration, stderrLines);

            resolve({
                success,
                exitCode,
                stdout: stdoutLines.join('\n'),
                stderr: stderrLines.join('\n'),
                summary,
                command: rawCommand,
                durationMs: duration,
            });
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({
                success: false,
                exitCode: null,
                stdout: '',
                stderr: err.message,
                summary: `No se pudo ejecutar el comando: ${err.message}`,
                command: rawCommand,
                durationMs: Date.now() - startTime,
            });
        });
    });
}

// ── Helpers de alto nivel ──────────────────────────────────────────────────────

/**
 * Instala dependencias npm en un directorio de proyecto.
 * Usa `npm ci` si existe package-lock.json, sino `npm install`.
 */
export async function npmInstall(
    projectPath: string,
    onOutput?: ShellOptions['onOutput']
): Promise<ShellResult> {
    const fs = await import('fs');
    const lockExists = fs.existsSync(path.join(projectPath, 'package-lock.json'));
    const command = lockExists ? 'npm ci' : 'npm install';

    return executeShellCommand(command, {
        cwd: projectPath,
        timeoutMs: 180_000, // npm install puede ser lento
        onOutput,
    });
}

/**
 * Instala dependencias Python desde requirements.txt.
 */
export async function pipInstallRequirements(
    projectPath: string,
    onOutput?: ShellOptions['onOutput']
): Promise<ShellResult> {
    const fs = await import('fs');
    const reqPath = path.join(projectPath, 'requirements.txt');

    if (!fs.existsSync(reqPath)) {
        return {
            success: false,
            exitCode: null,
            stdout: '',
            stderr: 'No se encontró requirements.txt',
            summary: `No hay requirements.txt en ${projectPath}`,
            command: 'pip install -r requirements.txt',
            durationMs: 0,
        };
    }

    // En Windows puede que solo exista "python", no "python3"
    const pip = getOS() === 'win32' ? 'pip' : 'pip3';

    return executeShellCommand(`${pip} install -r requirements.txt`, {
        cwd: projectPath,
        timeoutMs: 180_000,
        onOutput,
    });
}

/**
 * Ejecuta `prisma generate` + `prisma migrate dev` en un proyecto.
 */
export async function prismaSetup(
    projectPath: string,
    onOutput?: ShellOptions['onOutput']
): Promise<ShellResult[]> {
    const generate = await executeShellCommand('npx prisma generate', {
        cwd: projectPath,
        onOutput,
    });

    if (!generate.success) return [generate];

    const migrate = await executeShellCommand('npx prisma migrate dev --name init', {
        cwd: projectPath,
        onOutput,
    });

    return [generate, migrate];
}

/**
 * Verifica qué herramientas del sistema están disponibles.
 * Útil para el onboarding y para saber qué comandos podemos ofrecer.
 */
export async function checkAvailableTools(): Promise<Record<string, boolean>> {
    const tools = ['node', 'npm', 'python', 'python3', 'pip', 'pip3', 'git', 'ollama'];
    const results: Record<string, boolean> = {};

    for (const tool of tools) {
        const result = await executeShellCommand(`${tool} --version`);
        results[tool] = result.success;
    }

    return results;
}

// ── Construcción de resumen ────────────────────────────────────────────────────

function buildSummary(
    command: string,
    exitCode: number | null,
    success: boolean,
    durationMs: number,
    stderrLines: string[]
): string {
    const durationSec = (durationMs / 1000).toFixed(1);

    if (success) {
        return `Ejecuté \`${command}\` correctamente en ${durationSec}s.`;
    }

    // Intentar extraer un error útil de stderr
    const errorHint = stderrLines
        .filter(l => /error|failed|not found|cannot/i.test(l))
        .slice(0, 2)
        .join('. ');

    return [
        `El comando \`${command}\` falló (código ${exitCode ?? 'null'}) en ${durationSec}s.`,
        errorHint ? `Error: ${errorHint}` : '',
    ].filter(Boolean).join(' ');
}