import "./config/env.js";
import app from "./app.js";
import { ensureDatabaseConnectivity } from "./server.database.js";
import { initializeDatabaseTablesSafe } from "./database/initDb.js";
import { transporter } from "./services/email.service.js";

const PORT = Number(process.env.PORT) || 5001;
let httpServer;
const requireDbOnStartup =
  process.env.REQUIRE_DB_ON_STARTUP === "true" ||
  process.env.NODE_ENV === "production";
const requireSmtpOnStartup = process.env.REQUIRE_SMTP_ON_STARTUP === "true";

const validateStartupEnv = () => {
  const requiredVars = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
  const missing = requiredVars.filter((name) => !process.env[name]);

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
};

const formatDbError = (err) => {
  if (!err) return "Unknown database error";

  const code = err.code ? ` (code: ${err.code})` : "";
  const message = err.message ?? "";

  if (message.includes("Connection terminated unexpectedly")) {
    return `Database connection terminated unexpectedly${code}. Verify DATABASE_URL/SSL settings or set DB_SSL explicitly for your database.`;
  }

  if (
    err.code === "28000" ||
    message.includes("SSL/TLS required") ||
    message.includes("SSL required")
  ) {
    return `Database rejected a non-SSL connection${code}. The app will retry with SSL automatically; if this persists, remove DB_SSL=false from Render or set DB_SSL=true.`;
  }

  switch (err.code) {
    case "ECONNREFUSED":
      return `Database connection refused${code}. Check DATABASE_URL host/port and ensure PostgreSQL is running.`;
    case "ECONNRESET":
      return `Database connection reset${code}. The DB server closed the connection unexpectedly; verify network/SSL settings and DB availability.`;
    case "ENOTFOUND":
      return `Database host not found${code}. Check DATABASE_URL host value.`;
    case "28P01":
      return `Database authentication failed${code}. Check DB username/password in DATABASE_URL.`;
    case "3D000":
      return `Database does not exist${code}. Check DB name in DATABASE_URL.`;
    default:
      return `${err.message}${code}`;
  }
};

const formatSmtpError = (err) => {
  if (!err) return "Unknown SMTP error";
  const code = err.code ? ` (code: ${err.code})` : "";

  if (err.code === "EAUTH") {
    return `SMTP authentication failed${code}. Check SMTP credentials/app password configuration.`;
  }

  return `${err.message}${code}`;
};

/* -------------------------------------------------------------------------- */
/*                                APP STARTUP                                 */
/* -------------------------------------------------------------------------- */
const start = async () => {
  try {
    validateStartupEnv();

    try {
      await ensureDatabaseConnectivity();
      console.log("✅ Database connection successful");

      await initializeDatabaseTablesSafe();
      console.log("✅ Database tables ensured");
    } catch (dbErr) {
      const dbMessage = formatDbError(dbErr);
      if (requireDbOnStartup) {
        throw new Error(dbMessage);
      }
      console.warn(`⚠️ Database unavailable: ${dbMessage}`);
      console.warn(
        "⚠️ Continuing startup because REQUIRE_DB_ON_STARTUP is not true."
      );
    }

    try {
      await transporter.verify();
      console.log("✅ SMTP connection successful");
    } catch (smtpErr) {
      const smtpMessage = formatSmtpError(smtpErr);
      if (requireSmtpOnStartup) {
        throw new Error(smtpMessage);
      }
      console.warn(`⚠️ SMTP unavailable: ${smtpMessage}`);
      console.warn(
        "⚠️ Continuing startup because REQUIRE_SMTP_ON_STARTUP is not true."
      );
    }

    httpServer = app.listen(PORT, "0.0.0.0");
    httpServer.once("listening", () => {
      const address = httpServer.address();
      console.log(`🚀 Server listening at http://${address.address}:${address.port}`);
    });
    httpServer.on("close", () => {
      console.error("[server] HTTP listener closed.");
    });
    httpServer.on("error", (err) => {
      console.error(`[server] Could not listen on port ${PORT}: ${err.code ?? "ERROR"} — ${err.message}`);
      process.exit(1);
    });
  } catch (err) {
    const message = formatDbError(err);
    console.error("❌ Startup failed:", message);
    process.exit(1);
  }
};

start();
