/**
 * Run this ONCE, locally, after applying platform_admins_migration.sql,
 * to create your first (and rotated) platform admin account.
 *
 * Usage:
 *   node seed_platform_admin.js "admin@yourdomain.com" "YourNewStrongPassword!" "Your Name"
 *
 * Afterwards:
 *  - Clear this command from your shell history (it contains a plaintext
 *    password as an argument).
 *  - Never reuse "Admin@12345" — treat it as permanently compromised.
 *  - Update your real DB_HOST/DB_USER/DB_PASSWORD/DB_NAME below or via env vars.
 */
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

async function main() {
    const [, , email, password, fullName] = process.argv;

    if (!email || !password || !fullName) {
        console.error(
            'Usage: node seed_platform_admin.js "<email>" "<password>" "<full name>"'
        );
        process.exit(1);
    }

    const connection = await mysql.createConnection({
        host: "127.0.0.1",
        user: "root",
        password: "BTA5EYVWLfWcebF",
        database: "stocknbook",
        ssl: { rejectUnauthorized: false },

    });

    const passwordHash = await bcrypt.hash(password, 12);

    await connection.execute(
        `INSERT INTO platform_admins (full_name, email, password, status)
         VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE password = VALUES(password), full_name = VALUES(full_name)`,
        [fullName, email.trim().toLowerCase(), passwordHash]
    );

    console.log(`Platform admin "${email}" created/updated.`);
    await connection.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});