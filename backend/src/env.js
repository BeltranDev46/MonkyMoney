import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ENV_PATH = path.resolve(__dirname, '../.env')

// Carga inicial al arrancar el proceso
if (fs.existsSync(ENV_PATH)) {
  dotenv.config({ path: ENV_PATH })
}

/**
 * En desarrollo local permite recargar cambios de backend/.env en caliente;
 * en producción (Render) usa directamente las variables de entorno inyectadas sin leer disco.
 */
export function refreshLocalEnv() {
  if (process.env.NODE_ENV !== 'production' && fs.existsSync(ENV_PATH)) {
    dotenv.config({ path: ENV_PATH, override: true })
  }
}

