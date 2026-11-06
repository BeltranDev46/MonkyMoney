import { getPool } from './db.js'

async function main() {
  try {
    const pool = await getPool()
    await pool.query('SELECT 1')
    console.log('✅ Tablas inicializadas correctamente en PostgreSQL (Neon / Supabase).')
    await pool.end()
    process.exit(0)
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err.message)
    process.exit(1)
  }
}

main()

