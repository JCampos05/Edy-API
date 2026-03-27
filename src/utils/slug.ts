/**
 * Convierte un nombre libre a un slug válido para rutas y directorios.
 * Elimina acentos, caracteres especiales y reemplaza espacios con guiones.
 *
 * @example
 * toSlug("Mi Proyecto Génial!")  // → "mi-proyecto-genial"
 * toSlug("API REST con Node.js") // → "api-rest-con-nodejs"
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}