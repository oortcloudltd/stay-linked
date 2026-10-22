import pool from "../server.database.js";

// Keep all database consumers on the same pool so SSL, retries, and
// connection settings stay consistent between startup checks and app queries.
export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export default pool;
