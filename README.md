# Edy API

> Asistente digital local con procesamiento de IA, transcripción de voz y gestión inteligente de tareas.

## Tabla de contenidos

- [Descripción](#descripción)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Base de datos](#base-de-datos)
- [Modelos de IA](#modelos-de-ia)
- [Endpoints](#endpoints)
- [Intents soportados](#intents-soportados)
- [Acceso remoto](#acceso-remoto)
- [Servicios relacionados](#servicios-relacionados)

---

## Descripción

Edy es un asistente digital de arquitectura distribuida que prioriza privacidad, autonomía y funcionamiento local. Procesa comandos de voz transcritos desde hardware embebido (ESP32 + Arduino UNO Q), analiza la intención del usuario mediante IA local (Ollama), ejecuta acciones concretas y mantiene historial de conversación persistente.

**Principios de diseño:**

- Todo el procesamiento de IA es local — ningún dato sale a la nube
- Funciona offline excepto para servicios web específicos (clima, tareas externas)
- Arquitectura modular — cada servicio tiene una responsabilidad única
- Streaming de respuestas en tiempo real vía Server-Sent Events

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      ECOSISTEMA EDY                         │
└─────────────────────────────────────────────────────────────┘

  ESP32 (audio)          Arduino UNO Q (STT)        Mini PC (IA)
┌─────────────┐         ┌─────────────────┐       ┌──────────────────┐
│ INMP441 mic │──WAV──▶│  Whisper.cpp    │──────▶│   Edy API        │
│ MAX98357    │◀──WAV──│  Flask :5000    │  JSON │   Express + TS   │
│ Botón       │         └─────────────────┘       │                  │
└─────────────┘                                   │  Ollama :11434   │
                                                  │  edy-assistant   │
                                                  │  MySQL           │
                                                  │  ChromaDB (RAG)  │
                                                  └──────────────────┘
                                                         │
                                           ┌─────────────┼──────────────┐
                                           ▼             ▼              ▼
                                       Taskeer      Weatherly       Otros
                                       (Render)     (Vercel)    servicios
```

### Flujo de un comando completo

```
1. Usuario habla → ESP32 captura audio (WAV)
2. ESP32 → HTTP POST → Arduino UNO Q
3. Arduino transcribe con Whisper → devuelve JSON con texto
4. ESP32 → HTTP POST /api/v1/stream → Edy API
5. Edy API:
   a. Recupera/crea sesión con historial
   b. Consulta RAG (ChromaDB) para contexto relevante
   c. Llama a Ollama con historial + contexto → stream de tokens
   d. En paralelo: analyzeIntent → detecta la intención
   e. Ejecuta acción concreta (crea tarea, consulta clima, etc.)
   f. Persiste conversación en MySQL
   g. Emite evento 'done'
6. Dashboard Angular recibe tokens en tiempo real via SSE
```

---

## Stack tecnológico

| Capa | Tecnología | Propósito |
|---|---|---|
| Runtime | Node.js 20+ | Entorno de ejecución |
| Lenguaje | TypeScript 5.4 | Tipado estático |
| Framework | Express.js 4 | API REST + SSE |
| ORM | Prisma 5 | Acceso a base de datos |
| Base de datos | MySQL 8 | Persistencia de datos |
| IA local | Ollama | Motor de inferencia |
| Modelo general | qwen2.5:14b (edy-assistant) | Chat + análisis de intents |
| Modelo embeddings | nomic-embed-text | Vectorización para RAG |
| Vector store | ChromaDB | Búsqueda semántica (RAG) |
| Parseo de fechas | chrono-node | Lenguaje natural → ISO 8601 |
| Scheduler | node-cron | Recordatorios y jobs periódicos |
| Validación | Zod | Validación de schemas en runtime |
| CORS | cors | Soporte cross-origin para dashboard |

---

## Estructura del proyecto

```
edy-api/
├── prisma/
│   └── schema.prisma            # Schema de base de datos
├── src/
│   ├── server.ts                # Entry point — Express + middlewares + scheduler
│   ├── middleware/
│   │   └── deviceAutoRegister.ts  # Auto-registro de dispositivos ESP32
│   ├── routes/
│   │   ├── command.route.ts     # POST /api/v1/command — respuesta completa
│   │   ├── stream.route.ts      # GET  /api/v1/stream  — respuesta SSE en tiempo real
│   │   ├── session.route.ts     # GET/DELETE /api/v1/sessions
│   │   ├── project.route.ts     # GET/POST /api/v1/projects
│   │   ├── task.route.ts        # GET/POST/PATCH /api/v1/tasks
│   │   └── action.route.ts      # POST /api/v1/actions/execute
│   ├── services/
│   │   ├── ollama.service.ts    # Chat con Ollama + RAG + análisis de intents
│   │   ├── session.service.ts   # Gestión de sesiones (memoria + MySQL)
│   │   ├── context.service.ts   # Carga de contexto desde archivos .md/.json
│   │   ├── action.router.ts     # Dispatcher de intents → acciones concretas
│   │   ├── batch-task.service.ts # Creación de múltiples tareas en batch
│   │   ├── scaffold.service.ts  # Generación de proyectos en disco
│   │   └── scheduler.service.ts # Jobs periódicos con node-cron
│   ├── integrations/
│   │   ├── taskeer.client.ts    # Cliente HTTP para Taskeer (Render)
│   │   └── weatherly.client.ts  # Cliente HTTP para Weatherly (Vercel)
│   ├── utils/
│   │   └── date-parser.ts       # Parseo de fechas en lenguaje natural
│   └── types/
│       ├── index.ts             # Tipos globales (ChatMessage, IntentResult, etc.)
│       └── project.types.ts     # Tipos para proyectos y scaffold
├── .env.example                 # Plantilla de variables de entorno
├── package.json
└── tsconfig.json
```

---

## Requisitos

- Node.js 20+
- MySQL 8+
- [Ollama](https://ollama.com) instalado y corriendo
- Python 3.11+ (para el servicio RAG — repositorio separado)

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd edy-api

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con los valores correspondientes

# 4. Crear la base de datos
mysql -u root -p -e "CREATE DATABASE edy_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Ejecutar migraciones
npx prisma migrate dev --name init
npx prisma generate

# 6. Crear el modelo personalizado de Ollama
ollama create edy-assistant -f ./Modelfile

# 7. Iniciar en desarrollo
npm run dev
```

---

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `DATABASE_URL` | Cadena de conexión MySQL | `mysql://root:pass@localhost:3306/edy_db` |
| `OLLAMA_HOST` | Host de Ollama | `http://localhost:11434` |
| `OLLAMA_MODEL` | Modelo principal | `edy-assistant` |
| `OLLAMA_EMBED_MODEL` | Modelo de embeddings | `nomic-embed-text` |
| `RAG_SERVICE_URL` | URL del servicio RAG (Python) | `http://localhost:5001` |
| `CONTEXT_BASE_PATH` | Directorio raíz de proyectos | `C:/Projects` |
| `MAX_HISTORY_MESSAGES` | Máximo de mensajes por sesión | `20` |
| `TASKEER_API_URL` | URL de la API Taskeer *(opcional)* | `https://app.onrender.com/api` |
| `TASKEER_API_KEY` | API key de Taskeer *(opcional)* | `sk-...` |
| `WEATHERLY_API_URL` | URL de la API Weatherly *(opcional)* | `https://app.vercel.app/api` |
| `WEATHERLY_API_KEY` | API key de Weatherly *(opcional)* | `sk-...` |

---

## Base de datos

### Tablas

| Tabla | Descripción |
|---|---|
| `devices` | Dispositivos registrados (ESP32, dashboard web) |
| `transcriptions` | Historial de transcripciones de audio |
| `sessions` | Sesiones de conversación con historial en JSON |
| `tasks` | Tareas y recordatorios creados por Edy |
| `projects` | Proyectos registrados con su ruta de contexto |

Los dispositivos se registran automáticamente al primer request gracias al middleware `deviceAutoRegister`. La convención de nombres es `esp32-sala`, `esp32-oficina`, `edy-dashboard`.

---

## Modelos de IA

### edy-assistant (modelo principal)

Basado en `qwen2.5:14b` con un `Modelfile` personalizado que define:

- Idioma de respuesta: español
- Stack tecnológico del usuario (TypeScript, Angular, C++, MySQL, etc.)
- Convenciones de código por lenguaje
- Estilo de documentación técnica
- Proyectos conocidos (Edy, Taskeer, Weatherly)

```bash
# Crear el modelo
ollama create edy-assistant -f ./Modelfile

# Verificar
ollama list

# Actualizar después de editar el Modelfile
ollama rm edy-assistant
ollama create edy-assistant -f ./Modelfile
```

### nomic-embed-text (embeddings RAG)

```bash
ollama pull nomic-embed-text
```

---

## Endpoints

### `POST /api/v1/command`

Respuesta completa (no streaming). Útil para el ESP32 o clientes que no soporten SSE.

```bash
curl -X POST http://localhost:3000/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{
    "text": "recuérdame comprar leche mañana a las 8am",
    "deviceId": "esp32-sala",
    "projectSlug": "edy"
  }'
```

```json
{
  "reply": "Listo, te recordaré mañana a las 8:00 AM.",
  "intent": {
    "type": "CREATE_REMINDER",
    "confidence": 0.97,
    "params": { "task": "comprar leche", "datetime": "mañana a las 8am" }
  },
  "sessionId": "uuid-de-la-sesion",
  "sources": []
}
```

---

### `GET /api/v1/stream`

Streaming de tokens en tiempo real vía SSE. Usado por el dashboard Angular.

```
GET /api/v1/stream?text=...&deviceId=...&sessionId=...&projectSlug=...
```

**Eventos emitidos:**

| Evento | Payload | Descripción |
|---|---|---|
| `token` | `{ type: "token", content: "hola" }` | Token generado por Ollama |
| `intent` | `{ type: "intent", content: IntentResult }` | Intent detectado |
| `action` | `{ type: "action", content: "Tarea creada..." }` | Resultado de la acción |
| `done` | `{ type: "done", sessionId: "uuid" }` | Fin del stream |
| `error` | `{ type: "error", content: "mensaje" }` | Error durante el proceso |

```javascript
// Ejemplo de consumo con EventSource
const es = new EventSource(
  `http://localhost:3000/api/v1/stream?text=hola&deviceId=mi-device`
);
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'token') process.stdout.write(event.content);
  if (event.type === 'done')  es.close();
};
```

---

### `GET /api/v1/sessions/:deviceId`

Lista las sesiones activas de un dispositivo.

### `DELETE /api/v1/sessions/:sessionId`

Cierra y archiva una sesión.

---

### `GET /api/v1/tasks`

```
GET /api/v1/tasks?status=PENDING&project=edy
```

### `POST /api/v1/tasks`

```json
{
  "title": "Revisar el PR de la rama feature/streaming",
  "dueAt": "2026-03-28T10:00:00.000Z",
  "priority": "HIGH",
  "projectSlug": "edy"
}
```

### `PATCH /api/v1/tasks/:id`

```json
{ "status": "DONE" }
```

---

### `GET /api/v1/projects`

Devuelve proyectos registrados en DB y directorios disponibles en disco.

### `GET /api/v1/projects/:slug/context`

Previsualiza el contexto que Edy cargará para ese proyecto (contenido del `README.md` o `edy-context.md`).

### `POST /api/v1/projects/:slug/reload`

Invalida la caché del contexto y lo recarga desde disco.

---

### `POST /api/v1/actions/execute`

Ejecuta un intent directamente sin pasar por el chat. Útil para testing.

```bash
curl -X POST http://localhost:3000/api/v1/actions/execute \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CREATE_TASK_BATCH",
    "params": {
      "tasks": [
        { "title": "Configurar Tailscale", "datetime": "el viernes", "priority": "HIGH" },
        { "title": "Documentar la API",    "datetime": "el domingo" }
      ],
      "projectSlug": "edy"
    }
  }'
```

---

### `GET /health`

```json
{ "status": "ok", "service": "edy-api", "timestamp": "2026-03-26T03:00:00.000Z" }
```

---

## Intents soportados

| Intent | Trigger (ejemplos) | Acción ejecutada |
|---|---|---|
| `CREATE_REMINDER` | "recuérdame X mañana a las 8" | Crea tarea con fecha en MySQL |
| `CREATE_TASK` | "agrega tarea: revisar PR" | Crea tarea sin fecha en MySQL |
| `CREATE_TASK_BATCH` | "esta semana necesito: X, Y, Z" | Crea múltiples tareas en batch |
| `CREATE_PROJECT` | "crea proyecto Express TS llamado mi-api" | Scaffolding en disco + registro en DB |
| `GET_WEATHER` | "¿cómo está el clima en Los Mochis?" | Consulta Weatherly API |
| `GET_TASK_LIST` | "¿qué tengo pendiente?" | Lista tareas desde MySQL |
| `OPEN_PROJECT` | "abre el proyecto taskeer" | Carga contexto del proyecto en la sesión |
| `GENERAL_QUERY` | cualquier pregunta técnica | Responde con Ollama + RAG |

### Stacks soportados en `CREATE_PROJECT`

| Valor | Descripción |
|---|---|
| `express-ts` | Express.js + TypeScript + Prisma |
| `express-js` | Express.js + JavaScript |
| `angular` | Angular standalone |
| `python-flask` | Python + Flask |
| `python-fastapi` | Python + FastAPI |
| `arduino-cpp` | Arduino C++ (ESP32) |
| `generic` | Estructura básica sin stack específico |

---

## Contexto de proyectos

Edy puede cargar el contexto de un proyecto y usarlo como memoria en la conversación. La búsqueda sigue este orden de prioridad:

1. `C:/Projects/<slug>/README.md`
2. `C:/Projects/<slug>/context.md`
3. `C:/Projects/<slug>/edy-context.md`
4. Concatenación de los primeros 5 archivos `.md`/`.txt`/`.json` del directorio

Para agregar contexto a un proyecto existente, crea un archivo `edy-context.md` en la raíz del proyecto con la información relevante: stack, convenciones, estado actual, notas para Edy.

---

## Scheduler

El servidor ejecuta tres jobs automáticos al iniciar (zona horaria: `America/Mazatlan`):

| Job | Frecuencia | Acción |
|---|---|---|
| Verificación de tareas | Cada minuto | Dispara notificaciones para tareas con `dueAt` en los próximos 60 segundos |
| Resumen diario | 8:00 AM | Imprime en consola las tareas del día |
| Limpieza | Domingos 00:00 | Marca como `CANCELLED` las tareas vencidas hace más de 7 días |

---

## Acceso remoto

El acceso remoto se gestiona a través de **ZeroTier** (VPN mesh). Una vez configurado, la API es accesible en `http://<IP-ZeroTier>:3000` desde cualquier dispositivo en la red virtual.

```bash
# Verificar IP ZeroTier del Mini PC (Windows)
ipconfig | findstr "ZeroTier"

# Configurar en el dashboard Angular (environment.prod.ts)
apiUrl: 'http://10.147.X.X:3000/api/v1'
```

---

## Servicios relacionados

| Servicio | Repositorio | Descripción |
|---|---|---|
| `edy-dashboard` | `/edy-dashboard` | Frontend Angular 21 con chat en tiempo real |
| `edy-rag` | `/edy-rag` | Servicio Python de indexación y búsqueda vectorial |
| `voiceTranscription` | `/voiceTranscription` | Gateway STT con Whisper.cpp (Arduino UNO Q) |
| `esp32-audio-client` | `/esp32-audio-client` | Firmware ESP32 para captura y reproducción de audio |
| Taskeer | Render | Gestión de tareas externa |
| Weatherly | Vercel | Información del clima |

---

## Scripts disponibles

```bash
npm run dev          # Desarrollo con hot reload (tsx watch)
npm run build        # Compilar TypeScript a dist/
npm run start        # Producción desde dist/
npm run db:migrate   # Ejecutar migraciones de Prisma
npm run db:generate  # Regenerar cliente de Prisma
npm run db:studio    # Abrir Prisma Studio (GUI de base de datos)
```

---

*Edy — Iniciado en marzo 2026.*
