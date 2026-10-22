const { Pool } = require('pg');
const fs = require('fs');
import { path } from "path";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDb() {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    
    // trigger for updatedAt
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const tablesWithUpdatedAt = ['users','hotel_owners','hotels','rooms','hotel_staff','bookings','payments','walk_ins','BookingRenewal','Transaction'];

    for (const t of tablesWithUpdatedAt) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_${t}_updated_at ON "${t}";
        CREATE TRIGGER trg_${t}_updated_at
        BEFORE UPDATE ON "${t}"
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
      `);
    }

    await client.query('COMMIT');
    console.log('DB initialized');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };