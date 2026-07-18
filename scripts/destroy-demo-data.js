/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Removes only the demo dataset created by seed-demo-data.js.
 * Real stores are not matched unless they use the same explicit SEED_RUN_TAG
 * slug/email namespace.
 *
 * Usage:
 *   node destroy-demo-data.js
 *
 * To target a different seed run:
 *   SEED_RUN_TAG=another-run node destroy-demo-data.js
 */
require("dotenv").config({ path: ".env.local" });

const mysql = require("mysql2/promise");

function sanitizeRunTag(value) {
    const tag = String(value || "demo-v1")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30);

    if (!tag) throw new Error("SEED_RUN_TAG must contain letters or numbers.");
    return tag;
}

const RUN_TAG = sanitizeRunTag(process.env.SEED_RUN_TAG || "demo-v1");
const STORE_SLUG_PREFIX = `${RUN_TAG}-party-store-`;
const STORE_EMAIL_DOMAIN = `${RUN_TAG}.seed.stocknbook.test`;

function dbConfig() {
    const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
    const missing = required.filter((key) => !String(process.env[key] || "").trim());

    if (missing.length) throw new Error(`Missing ${missing.join(", ")} in .env.local.`);

    return {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 3306),
        ssl: String(process.env.DB_SSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
        charset: "utf8mb4",
        supportBigNumbers: true,
    };
}

function quoteIdentifier(identifier) {
    return `\`${String(identifier).replace(/`/g, "``")}\``;
}

async function tableExists(db, tableName) {
    const [rows] = await db.execute(
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
             LIMIT 1`,
        [tableName]
    );
    return rows.length > 0;
}

async function getTableColumns(db, tableName) {
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [tableName]
    );
    return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}

async function createTargetStoreTable(db) {
    await db.query("DROP TEMPORARY TABLE IF EXISTS tmp_perf_destroy_store_ids");
    await db.query(`
        CREATE TEMPORARY TABLE tmp_perf_destroy_store_ids (
            id BIGINT PRIMARY KEY
        ) ENGINE=InnoDB
    `);

    const [stores] = await db.execute(
        `SELECT id, store_name, email, slug
         FROM stores
         WHERE slug LIKE ?
            OR email LIKE ?
         ORDER BY id`,
        [`${STORE_SLUG_PREFIX}%`, `%@${STORE_EMAIL_DOMAIN}`]
    );

    for (let offset = 0; offset < stores.length; offset += 1000) {
        const chunk = stores.slice(offset, offset + 1000);
        const placeholders = chunk.map(() => "(?)").join(", ");
        await db.query(
            `INSERT INTO tmp_perf_destroy_store_ids (id) VALUES ${placeholders}`,
            chunk.map((row) => row.id)
        );
    }

    return stores;
}

async function deleteChildByParent(db, relation) {
    const { childTable, childColumn, parentTable, parentColumn } = relation;

    if (!(await tableExists(db, childTable)) || !(await tableExists(db, parentTable))) return;

    const childColumns = await getTableColumns(db, childTable);
    const parentColumns = await getTableColumns(db, parentTable);

    if (!childColumns.has(childColumn) || !parentColumns.has(parentColumn) || !parentColumns.has("store_id")) return;

    const [result] = await db.query(
        `DELETE child
         FROM ${quoteIdentifier(childTable)} AS child
        INNER JOIN ${quoteIdentifier(parentTable)} AS parent
        ON child.${quoteIdentifier(childColumn)} = parent.${quoteIdentifier(parentColumn)}
        INNER JOIN tmp_perf_destroy_store_ids AS seeded
        ON parent.store_id = seeded.id`
    );

    console.log(`Deleted ${Number(result.affectedRows || 0).toLocaleString()} rows from ${childTable}.`);
}

async function deleteStoreScopedTables(db) {
    const [tables] = await db.execute(
        `SELECT DISTINCT TABLE_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND COLUMN_NAME = 'store_id'
           AND TABLE_NAME <> 'stores'
         ORDER BY TABLE_NAME`
    );

    for (const row of tables) {
        const tableName = String(row.TABLE_NAME);
        const [result] = await db.query(
            `DELETE scoped
             FROM ${quoteIdentifier(tableName)} AS scoped
            INNER JOIN tmp_perf_destroy_store_ids AS seeded
            ON scoped.store_id = seeded.id`
        );

        console.log(`Deleted ${Number(result.affectedRows || 0).toLocaleString()} rows from ${tableName}.`);
    }
}

async function main() {
    const db = await mysql.createConnection(dbConfig());
    console.log("Connected to database.");

    let foreignKeyChecksDisabled = false;

    try {
        const stores = await createTargetStoreTable(db);

        if (!stores.length) {
            console.log(`No stores found for seed run "${RUN_TAG}". Nothing was deleted.`);
            return;
        }

        console.log(`Found ${stores.length} stores for seed run "${RUN_TAG}". Deleting only those stores and their related rows...`);

        await db.query("SET FOREIGN_KEY_CHECKS = 0");
        foreignKeyChecksDisabled = true;

        const childRelations = [
            ["order_items", "order_id", "orders", "order_id"],
            ["booking_items", "booking_id", "bookings", "id"],
            ["product_variants", "product_id", "products", "id"],
            ["package_items", "package_id", "packages", "id"],
            ["payment_submissions", "booking_id", "bookings", "id"],
            ["payment_submissions", "order_id", "orders", "order_id"],
            ["subscription_audit_logs", "subscription_id", "subscriptions", "id"],
            ["subscription_notifications", "subscription_id", "subscriptions", "id"],
            ["payment_submissions", "subscription_id", "subscriptions", "id"],
        ].map(([childTable, childColumn, parentTable, parentColumn]) => ({
            childTable,
            childColumn,
            parentTable,
            parentColumn,
        }));

        for (const relation of childRelations) {
            await deleteChildByParent(db, relation);
        }

        await deleteStoreScopedTables(db);

        const [storeResult] = await db.query(
            `DELETE store_row
             FROM stores AS store_row
             INNER JOIN tmp_perf_destroy_store_ids AS seeded
                ON store_row.id = seeded.id`
        );

        console.log(`Deleted ${Number(storeResult.affectedRows || 0).toLocaleString()} seeded stores.`);
        console.log("Demo dataset destroyed successfully.");
    } finally {
        if (foreignKeyChecksDisabled) {
            await db.query("SET FOREIGN_KEY_CHECKS = 1");
        }
        await db.query("DROP TEMPORARY TABLE IF EXISTS tmp_perf_destroy_store_ids");
        await db.end();
    }
}

main().catch((error) => {
    console.error("Demo destroy failed:", error);
    process.exit(1);
});