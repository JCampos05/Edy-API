import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Cache en memoria para no golpear MySQL en cada request
const knownDevices = new Set<string>();

/**
 * Middleware de auto-registro de dispositivos.
 * Si el deviceId del body/query no existe en la DB, lo crea automáticamente.
 * Cachea los IDs conocidos en memoria para evitar queries repetidos.
 *
 * Uso: app.use(deviceAutoRegister) antes de las rutas que reciben deviceId.
 */
export async function deviceAutoRegister(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const deviceId = req.body?.deviceId ?? req.query?.deviceId as string;

    // Sin deviceId — dejar pasar, la validación de Zod lo manejará
    if (!deviceId) { next(); return; }

    // Ya conocido en memoria — skip sin query a DB
    if (knownDevices.has(deviceId)) { next(); return; }

    try {
        await prisma.device.upsert({
            where: { deviceId },
            update: { isActive: true },
            create: {
                deviceId,
                deviceName: inferDeviceName(deviceId),
                location: inferLocation(deviceId),
                isActive: true,
            },
        });

        knownDevices.add(deviceId);
    } catch (err) {
        // No bloqueamos el request si falla el registro
        console.error('[device] auto-register failed:', err);
    }

    next();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Infiere un nombre legible del deviceId.
 * Convención: "esp32-sala", "esp32-oficina", "edy-dashboard"
 */
function inferDeviceName(deviceId: string): string {
    const map: Record<string, string> = {
        'edy-dashboard': 'Dashboard Web',
    };
    if (map[deviceId]) return map[deviceId];

    // Capitaliza y reemplaza guiones: "esp32-sala" → "Esp32 Sala"
    return deviceId
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Infiere la ubicación del dispositivo basándose en el ID.
 * Convención sugerida: "esp32-sala", "esp32-oficina", "esp32-recamara"
 */
function inferLocation(deviceId: string): string | null {
    const parts = deviceId.split('-');
    if (parts.length >= 2) {
        const loc = parts.slice(1).join(' ');
        return loc.charAt(0).toUpperCase() + loc.slice(1);
    }
    return null;
}