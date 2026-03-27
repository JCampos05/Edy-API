/**
 * Cliente HTTP para la API de Weatherly (Vercel).
 */

interface WeatherResult {
    location: string;
    temp: number;
    feelsLike: number;
    humidity: number;
    description: string;
    icon?: string;
}

async function getCurrent(location: string): Promise<WeatherResult> {
    const url = process.env.WEATHERLY_API_URL;
    if (!url) throw new Error('WEATHERLY_API_URL not configured');

    const params = new URLSearchParams({ location });
    const res = await fetch(`${url}/current?${params}`, {
        headers: { 'Authorization': `Bearer ${process.env.WEATHERLY_API_KEY ?? ''}` },
        signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Weatherly responded ${res.status}`);
    return res.json() as Promise<WeatherResult>;
}

export const weatherlyClient = { getCurrent };