/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Wipes ONE database (DB_NAME, default stocknbook_v2) and recreates the 28 empty v2 tables
 * from schema.sql. Other databases on the same MySQL server (your other projects) are not touched.
 *
 *   node scripts/seed/reset-db.js --yes
 */
const fs = require("fs");
const path = require("path");
const { CONFIG } = require("./lib/config");
const { connect } = require("./lib/db");

const PROTECTED = new Set(["mysql", "sys", "information_schema", "performance_schema"]);

async function main() {
    const name = CONFIG.db.database;
    if (!/^[A-Za-z0-9_]+$/.test(name) || PROTECTED.has(name.toLowerCase()))
        throw new Error(`Refusing to reset "${name}".`);
    if (!/stocknbook/i.test(name) && process.env.SEED_ALLOW_ANY_DB !== "true")
        throw new Error(`DB_NAME "${name}" does not contain "stocknbook". Set SEED_ALLOW_ANY_DB=true if this is really the right database.`);
    if (!process.argv.includes("--yes")) {
        console.log(`This DELETES every row in database "${name}" on ${CONFIG.db.host}:${CONFIG.db.port} and recreates the empty v2 tables.`);
        console.log(`Other databases are not touched. Run again with --yes to continue:\n\n  node scripts/seed/reset-db.js --yes\n`);
        process.exit(1);
    }
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    const v2Tables = new Set([...schema.matchAll(/CREATE TABLE `([a-z_]+)`/g)].map((m) => m[1]));
    const db = await connect({ noDatabase: true, multipleStatements: true });
    // Guard against wiping the OLD database by mistake (for example DB_NAME=stocknbook in .env.local).
    const [existing] = await db.query(`SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`, [name]);
    const extra = existing.map((r) => r.t).filter((t) => !v2Tables.has(t));
    if (extra.length && !process.argv.includes("--force")) {
        console.log(`"${name}" has ${extra.length} table(s) that are not part of v2 (${extra.slice(0, 6).join(", ")}${extra.length > 6 ? ", ..." : ""}).`);
        console.log(`It may be your OLD database. Check DB_NAME in .env.local (v2 is usually stocknbook_v2).`);
        console.log(`If you really want to wipe it, back it up first, then add --force.`);
        await db.end();
        process.exit(1);
    }
    await db.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await db.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.query(`USE \`${name}\``);
    await db.query(schema);
    const [rows] = await db.query(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`, [name]);
    console.log(`Database "${name}" was reset: ${rows[0].n} empty tables created.`);
    console.log(`Next: node scripts/seed/run.js`);
    await db.end();
}

main().catch((error) => {
    console.error("Reset failed:", error.message);
    process.exit(1);
});
