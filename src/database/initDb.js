import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sqlCandidates = [
  path.resolve(__dirname, "../database.js/initDb.sql"),
  path.resolve(__dirname, "initDb.sql"),
];

function loadInitializationSql() {
  for (const candidate of sqlCandidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }

  throw new Error("Database initialization SQL file not found.");
}

export async function initializeDatabaseTables() {
  const sql = loadInitializationSql();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabaseTablesSafe() {
  try {
    await initializeDatabaseTables();
    return true;
  } catch (error) {
    const message = String(error?.message ?? "");
    const isAlreadyInitialized =
      message.includes("already exists") ||
      message.includes("duplicate_object") ||
      message.includes("relation") && message.includes("already exists");

    if (isAlreadyInitialized) {
      return false;
    }

    throw error;
  }
}

export default pool;
