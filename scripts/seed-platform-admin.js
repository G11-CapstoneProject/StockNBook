/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Creates (or resets the password of) a REAL platform admin account in the v2 database.
 * Updated for v2: the column is `password_hash` and the role is `platform_admin`.
 * The database login is read from .env.local (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).
 *
 * Usage:
 *   node scripts/seed-platform-admin.js "admin@yourdomain.com" "YourNewStrongPassword!" "Your Name"
 *
 * Afterwards, clear this command from your shell history (it contains a plaintext password).
 */
require("dotenv").config({ path: ".env.local" });
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

async function main() {
    const [, , email, password, fullName] = process.argv;
    if (!email || !password || !fullName) {
        console.error('Usage: node scripts/seed-platform-admin.js "<email>" "<password>" "<full name>"');
        process.exit(1);
    }
    if (password.length < 10) throw new Error("Use a password with at least 10 characters.");

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD ?? process.env.DB_ROOT_PASSWORD ?? "",
        database: process.env.DB_NAME || "stocknbook_v2",
        ssl: String(process.env.DB_SSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
    });
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute(
        `INSERT INTO platform_admins (full_name, email, password_hash, role, status)
         VALUES (?, ?, ?, 'platform_admin', 'active')
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name), status = 'active'`,
        [fullName.trim(), email.trim().toLowerCase(), passwordHash]);
    console.log(`Platform admin "${email}" created/updated in ${process.env.DB_NAME || "stocknbook_v2"}.`);
    await connection.end();
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
