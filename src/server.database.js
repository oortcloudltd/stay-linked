import pg from "pg";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const { Pool } = pg;

// --- Resolve connection string --------------------------------------------
// NOTE: Pick ONE source of truth. If you're on Render and using the internal
// URL for prod, that's fine — but log it loudly so a URL rotation never goes
// unnoticed again like it did with Redis.
const isProd = process.env.NODE_ENV === "production";
const dbUrl = isProd
  ? process.env.DATABASE_INTERNAL_URL || process.env.DATABASE_URL
  : process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL is not defined.");
}

const parsed = new URL(dbUrl);
const usingInternal = isProd && !!process.env.DATABASE_INTERNAL_URL;

console.log("[db] NODE_ENV:", process.env.NODE_ENV);
console.log("[db] Using:", usingInternal ? "DATABASE_INTERNAL_URL" : "DATABASE_URL");
console.log("[db] HOST:", parsed.hostname);
console.log("[db] DATABASE:", parsed.pathname.replace("/", ""));
console.log("[db] USER:", parsed.username);

// --- SSL ---------------------------------------------------------------
function resolveSslOptions() {
  if (String(process.env.DB_SSL).toLowerCase() === "false") {
    console.warn("[db] SSL explicitly disabled via DB_SSL=false");
    return false;
  }

  const caBase64 = process.env.PG_SSL_CA_BASE64;
  const caFile = process.env.PG_SSL_CA_FILE;

  if (caBase64) {
    try {
      return { rejectUnauthorized: true, ca: Buffer.from(caBase64, "base64").toString() };
    } catch (e) {
      console.warn("[db] Failed to parse PG_SSL_CA_BASE64:", e.message);
    }
  }
  if (caFile && fs.existsSync(caFile)) {
    try {
      return { rejectUnauthorized: true, ca: fs.readFileSync(caFile, "utf8") };
    } catch (e) {
      console.warn("[db] Failed to read PG_SSL_CA_FILE:", e.message);
    }
  }
  // Most managed PG providers (Render, Supabase, Neon) use certs not in the
  // default CA store, so rejectUnauthorized:false is the pragmatic default.
  return { rejectUnauthorized: false };
}

// --- Pool config ---------------------------------------------------------
const POOL_OPTS = {
  connectionString: dbUrl,
  ssl: resolveSslOptions(),
  max: Number(process.env.DB_POOL_MAX || 10),
  min: Number(process.env.DB_POOL_MIN || 0),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),   // close idle clients after 30s
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS || 5000), // fail fast if can't acquire
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

let internalPool = new Pool(POOL_OPTS);
let recreating = null; // dedupe concurrent recreate calls

function attachPoolHandlers(p) {
  p.on("error", (err) => {
    // Fired for errors on IDLE clients (not caught by query try/catch).
    // This is the case that silently breaks pools after a URL/host change.
    console.error("[db] Idle client error, scheduling pool recreate:", err.message);
    recreatePool().catch((e) => console.error("[db] Recreate after idle error failed:", e.message));
  });
}
attachPoolHandlers(internalPool);

export async function recreatePool() {
  if (recreating) return recreating; // avoid thundering herd
  recreating = (async () => {
    const old = internalPool;
    internalPool = new Pool(POOL_OPTS);
    attachPoolHandlers(internalPool);
    try {
      await old.end();
    } catch (e) {
      console.warn("[db] Error closing old pool:", e.message);
    }
    console.log("[db] Pool recreated");
  })();
  try {
    await recreating;
  } finally {
    recreating = null;
  }
  return internalPool;
}

// --- Proxy so imports of `pool` survive underlying recreation ------------
const TRANSIENT_ERRORS = new Set(["ECONNRESET", "ECONNREFUSED", "57P01", "08006", "08003"]);

function isTransient(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("connection terminated unexpectedly") ||
    msg.includes("terminating connection") ||
    TRANSIENT_ERRORS.has(err?.code)
  );
}

const pool = new Proxy(
  {},
  {
    get(_, prop) {
      if (prop === "query") {
        return async function queryWithRetry(text, params) {
          try {
            return await internalPool.query(text, params);
          } catch (err) {
            if (isTransient(err)) {
              console.warn("[db] Transient query error, retrying once:", err.message);
              await recreatePool();
              return await internalPool.query(text, params);
            }
            throw err;
          }
        };
      }
      const val = internalPool[prop];
      return typeof val === "function" ? val.bind(internalPool) : val;
    },
  }
);

// --- Startup connectivity check with backoff ------------------------------
export async function ensureDatabaseConnectivity(retries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = await pool.connect().catch((err) => {
      console.error(`[db] Connectivity attempt ${attempt} failed:`, err.message);
      return null;
    });
    if (client) {
      try {
        const result = await client.query("SELECT NOW()");
        console.log("[db] ✅ Connected:", result.rows[0]);
        return true;
      } finally {
        client.release();
      }
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    } else {
      throw new Error("Database connectivity check failed after retries");
    }
  }
}

// --- Graceful shutdown -----------------------------------------------------
async function shutdown(signal) {
  console.log(`[db] ${signal} received, closing pool...`);
  try {
    await internalPool.end();
    console.log("[db] Pool closed cleanly");
  } catch (e) {
    console.error("[db] Error closing pool:", e.message);
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default pool;

export function __setInternalPoolForTests(mockPool) {
  internalPool = mockPool;
  attachPoolHandlers(internalPool);
}