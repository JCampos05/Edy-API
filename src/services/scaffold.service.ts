import fs from 'fs';
import path from 'path';
import type { ProjectStack, ProjectScaffoldResult } from '../types/project.types';
import { toSlug } from '../utils/slug';

const CONTEXT_BASE = process.env.CONTEXT_BASE_PATH ?? './projects';

// ── Entry point ───────────────────────────────────────────────────────────────

export async function scaffoldProject(
    name: string,
    stack: ProjectStack,
    description: string = ''
): Promise<ProjectScaffoldResult> {

    const slug = toSlug(name);
    const projectPath = path.join(CONTEXT_BASE, slug);
    const filesCreated: string[] = [];

    // Crear directorio raíz
    fs.mkdirSync(projectPath, { recursive: true });

    // Archivos comunes a todos los stacks
    const commonFiles = buildCommonFiles(slug, description, stack);

    // Archivos específicos del stack
    const stackFiles = buildStackFiles(slug, description, stack);

    const allFiles = { ...commonFiles, ...stackFiles };

    for (const [filePath, content] of Object.entries(allFiles)) {
        const fullPath = path.join(projectPath, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
        filesCreated.push(filePath);
    }

    return { projectPath, filesCreated, tasksCreated: 0, projectSlug: slug };
}

// ── Archivos comunes ──────────────────────────────────────────────────────────

function buildCommonFiles(
    slug: string,
    description: string,
    stack: ProjectStack
): Record<string, string> {
    const stackLabel = stackLabels[stack] ?? stack;

    return {
        'README.md': `# ${slug}

${description || `Proyecto ${stackLabel} generado por Edy.`}

## Stack
${stackLabel}

## Setup
\`\`\`bash
# Ver instrucciones específicas en SETUP.md
\`\`\`

## Estructura
\`\`\`
${slug}/
$(tree -placeholder)
\`\`\`

---
*Generado por Edy el ${new Date().toLocaleDateString('es-MX')}*
`,

        'SETUP.md': `# Setup — ${slug}

## Prerrequisitos
${prereqs[stack] ?? '- Node.js 20+'}

## Instalación
\`\`\`bash
${installSteps[stack] ?? 'npm install'}
\`\`\`

## Variables de entorno
Copia \`.env.example\` a \`.env\` y configura los valores.

## Desarrollo
\`\`\`bash
${devCommand[stack] ?? 'npm run dev'}
\`\`\`
`,

        '.gitignore': gitignoreFor(stack),

        'edy-context.md': `# Contexto Edy — ${slug}

## Descripción
${description || `Proyecto ${stackLabel}.`}

## Stack
${stackLabel}

## Convenciones de código
- Idioma: español para documentación, inglés para código
- Commits: conventional commits (feat, fix, chore, docs)

## Notas para Edy
- Proyecto iniciado: ${new Date().toLocaleDateString('es-MX')}
- Stack: ${stack}
`,
    };
}

// ── Archivos por stack ────────────────────────────────────────────────────────

function buildStackFiles(
    slug: string,
    description: string,
    stack: ProjectStack
): Record<string, string> {
    switch (stack) {
        case 'express-ts': return expressTs(slug);
        case 'express-js': return expressJs(slug);
        case 'angular': return angularFiles(slug);
        case 'python-flask': return pythonFlask(slug);
        case 'python-fastapi': return pythonFastApi(slug);
        case 'arduino-cpp': return arduinoCpp(slug);
        default: return genericFiles(slug);
    }
}

// ── Express TypeScript ────────────────────────────────────────────────────────

function expressTs(slug: string): Record<string, string> {
    return {
        'package.json': JSON.stringify({
            name: slug,
            version: '1.0.0',
            scripts: {
                dev: 'tsx watch src/server.ts',
                build: 'tsc',
                start: 'node dist/server.js',
                'db:migrate': 'prisma migrate dev',
                'db:generate': 'prisma generate',
                'db:studio': 'prisma studio',
            },
            dependencies: {
                '@prisma/client': '^5.14.0',
                'express': '^4.19.2',
                'dotenv': '^16.4.5',
                'zod': '^3.23.8',
                'morgan': '^1.10.0',
                'cors': '^2.8.5',
            },
            devDependencies: {
                'prisma': '^5.14.0',
                'tsx': '^4.15.7',
                'typescript': '^5.4.5',
                '@types/express': '^4.17.21',
                '@types/morgan': '^1.9.9',
                '@types/cors': '^2.8.17',
                '@types/node': '^20.14.0',
            },
        }, null, 2),

        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                target: 'ES2022', module: 'CommonJS',
                outDir: './dist', rootDir: './src',
                strict: true, esModuleInterop: true,
                skipLibCheck: true, resolveJsonModule: true,
            },
            include: ['src/**/*'], exclude: ['node_modules', 'dist'],
        }, null, 2),

        '.env.example': `PORT=3000\nNODE_ENV=development\nDATABASE_URL="mysql://root:password@localhost:3306/${slug}_db"\n`,

        'prisma/schema.prisma': `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "mysql"\n  url      = env("DATABASE_URL")\n}\n`,

        'src/server.ts': `import 'dotenv/config';\nimport express from 'express';\nimport cors    from 'cors';\nimport morgan  from 'morgan';\n\nconst app  = express();\nconst PORT = process.env.PORT ?? 3000;\n\napp.use(cors());\napp.use(express.json());\napp.use(morgan('dev'));\n\napp.get('/health', (_req, res) => {\n  res.json({ status: 'ok', service: '${slug}' });\n});\n\napp.listen(PORT, () => console.log(\`${slug} → http://localhost:\${PORT}\`));\n`,

        'src/types/index.ts': `// Types for ${slug}\nexport {};\n`,
    };
}

// ── Express JavaScript ────────────────────────────────────────────────────────

function expressJs(slug: string): Record<string, string> {
    return {
        'package.json': JSON.stringify({
            name: slug, version: '1.0.0',
            scripts: { dev: 'node --watch src/server.js', start: 'node src/server.js' },
            dependencies: { express: '^4.19.2', dotenv: '^16.4.5', cors: '^2.8.5' },
        }, null, 2),

        '.env.example': `PORT=3000\nNODE_ENV=development\n`,

        'src/server.js': `require('dotenv').config();\nconst express = require('express');\nconst cors    = require('cors');\n\nconst app  = express();\nconst PORT = process.env.PORT ?? 3000;\n\napp.use(cors());\napp.use(express.json());\n\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\n\napp.listen(PORT, () => console.log(\`${slug} → http://localhost:\${PORT}\`));\n`,
    };
}

// ── Angular ───────────────────────────────────────────────────────────────────

function angularFiles(slug: string): Record<string, string> {
    return {
        'SETUP.md': `# ${slug}\n\n## Crear proyecto\n\`\`\`bash\nng new ${slug} --standalone --style=scss --routing=true\n\`\`\`\n\n## Desarrollo\n\`\`\`bash\nng serve\n\`\`\`\n\n## Build producción\n\`\`\`bash\nng build --configuration=production\n\`\`\`\n`,
        'src/environments/environment.ts': `export const environment = {\n  production: false,\n  apiUrl: 'http://localhost:3000/api/v1',\n};\n`,
    };
}

// ── Python Flask ──────────────────────────────────────────────────────────────

function pythonFlask(slug: string): Record<string, string> {
    return {
        'requirements.txt': `flask==3.0.3\npython-dotenv==1.0.1\nrequests==2.32.3\n`,
        '.env.example': `FLASK_ENV=development\nPORT=5000\n`,
        'src/app.py': `from flask import Flask, jsonify\nimport os\n\napp = Flask(__name__)\n\n@app.route('/health')\ndef health():\n    return jsonify({'status': 'ok', 'service': '${slug}'})\n\nif __name__ == '__main__':\n    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=True)\n`,
    };
}

// ── Python FastAPI ────────────────────────────────────────────────────────────

function pythonFastApi(slug: string): Record<string, string> {
    return {
        'requirements.txt': `fastapi==0.111.0\nuvicorn==0.30.1\npython-dotenv==1.0.1\n`,
        '.env.example': `PORT=8000\n`,
        'src/main.py': `from fastapi import FastAPI\n\napp = FastAPI(title='${slug}')\n\n@app.get('/health')\ndef health():\n    return {'status': 'ok', 'service': '${slug}'}\n`,
        'src/run.py': `import uvicorn, os\nif __name__ == '__main__':\n    uvicorn.run('main:app', host='0.0.0.0', port=int(os.getenv('PORT', 8000)), reload=True)\n`,
    };
}

// ── Arduino / C++ ─────────────────────────────────────────────────────────────

function arduinoCpp(slug: string): Record<string, string> {
    return {
        [`${slug}.ino`]: `/**\n * ${slug}\n * Generado por Edy\n * Fecha: ${new Date().toLocaleDateString('es-MX')}\n */\n\n#include "config.h"\n#include "utils.h"\n\nvoid setup() {\n  Serial.begin(115200);\n  Serial.println("${slug} iniciando...");\n}\n\nvoid loop() {\n  // Main loop\n  delay(10);\n}\n`,
        'config.h': `#pragma once\n\n// ── WiFi ──────────────────────────────────\n#define WIFI_SSID     "tu_red"\n#define WIFI_PASSWORD "tu_password"\n\n// ── Server ────────────────────────────────\n#define SERVER_HOST "192.168.1.x"\n#define SERVER_PORT 3000\n`,
        'utils.h': `#pragma once\n\nvoid printStatus(const char* msg) {\n  Serial.println(msg);\n}\n`,
    };
}

// ── Generic ───────────────────────────────────────────────────────────────────

function genericFiles(slug: string): Record<string, string> {
    return {
        'src/.gitkeep': '',
        'docs/.gitkeep': '',
    };
}

// ── .gitignore por stack ─────────────────────────────────────────────────────

function gitignoreFor(stack: ProjectStack): string {
    const node = `node_modules/\ndist/\n.env\n*.log\n`;
    const py = `__pycache__/\n*.pyc\n.env\nvenv/\n.venv/\n`;
    const map: Partial<Record<ProjectStack, string>> = {
        'express-ts': `${node}.tsbuildinfo\n`,
        'express-js': node,
        'angular': `${node}.angular/\n`,
        'python-flask': py,
        'python-fastapi': py,
        'arduino-cpp': `.pio/\n.vscode/\nbuild/\n`,
        'generic': `.env\n*.log\n`,
    };
    return map[stack] ?? `.env\n*.log\n`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// toSlug importado desde ../utils/slug

const stackLabels: Partial<Record<ProjectStack, string>> = {
    'express-ts': 'Express.js + TypeScript + Prisma',
    'express-js': 'Express.js + JavaScript',
    'angular': 'Angular (standalone)',
    'python-flask': 'Python + Flask',
    'python-fastapi': 'Python + FastAPI',
    'arduino-cpp': 'Arduino C++ (ESP32)',
    'generic': 'Proyecto genérico',
};

const prereqs: Partial<Record<ProjectStack, string>> = {
    'express-ts': '- Node.js 20+\n- MySQL 8+',
    'express-js': '- Node.js 20+',
    'angular': '- Node.js 20+\n- Angular CLI 17+',
    'python-flask': '- Python 3.11+\n- pip',
    'python-fastapi': '- Python 3.11+\n- pip',
    'arduino-cpp': '- Arduino IDE 2+\n- Placa ESP32 instalada',
};

const installSteps: Partial<Record<ProjectStack, string>> = {
    'express-ts': 'npm install\nnpx prisma migrate dev\nnpx prisma generate',
    'express-js': 'npm install',
    'angular': 'npm install\nng serve',
    'python-flask': 'pip install -r requirements.txt',
    'python-fastapi': 'pip install -r requirements.txt',
    'arduino-cpp': '# Abrir .ino en Arduino IDE',
};

const devCommand: Partial<Record<ProjectStack, string>> = {
    'express-ts': 'npm run dev',
    'express-js': 'npm run dev',
    'angular': 'ng serve',
    'python-flask': 'python src/app.py',
    'python-fastapi': 'python src/run.py',
    'arduino-cpp': '# Compilar y subir desde Arduino IDE',
};