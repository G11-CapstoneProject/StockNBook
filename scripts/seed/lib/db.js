/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const { CONFIG } = require("./config");

async function connect(options = {}) {
    if (!CONFIG.db.password && !options.allowEmptyPassword)
        console.warn("Warning: DB_PASSWORD is empty. Set it in .env.local if your MySQL user has a password.");
    return mysql.createConnection({
        ...CONFIG.db,
        ...(options.noDatabase ? { database: undefined } : {}),
        multipleStatements: Boolean(options.multipleStatements),
        decimalNumbers: true,
        dateStrings: true,
    });
}

// Insert many rows with as few statements as possible (MySQL allows at most 65,535 placeholders).
// Columns each table really has in this database (so the seeder works with every copy of the v2 schema).
const tableColumns = new Map();
async function columnsOf(db, table) {
    if (!tableColumns.has(table)) {
        const [rows] = await db.query(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
        tableColumns.set(table, new Set(rows.map((r) => r.c)));
    }
    return tableColumns.get(table);
}

async function insertMany(db, table, rows, columns = null) {
    if (!rows.length) return 0;
    const existing = await columnsOf(db, table);
    // Fields this database doesn't have (for example pickup/delivery columns) are simply left out.
    const cols = (columns || Object.keys(rows[0])).filter((c) => existing.has(c));
    const perRow = cols.length;
    const batch = Math.max(1, Math.min(2000, Math.floor(60000 / perRow)));
    const colSql = cols.map((c) => `\`${c}\``).join(", ");
    for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const values = [];
        for (const row of chunk) for (const c of cols) values.push(row[c] === undefined ? null : row[c]);
        const tuple = `(${cols.map(() => "?").join(", ")})`;
        await db.query(`INSERT INTO \`${table}\` (${colSql}) VALUES ${chunk.map(() => tuple).join(", ")}`, values);
    }
    return rows.length;
}

/**
 * Hands out ids before rows are inserted, so related rows (orders → items → payments →
 * movements) can be built in memory and then written in large batches.
 * Do not use the app on the same database while the seeder runs.
 */
class IdAllocator {
    constructor(db) { this.db = db; this.next = new Map(); }
    async take(table, pk = "id") {
        if (!this.next.has(table)) {
            const [rows] = await this.db.query(`SELECT COALESCE(MAX(\`${pk}\`), 0) + 1 AS n FROM \`${table}\``);
            this.next.set(table, Number(rows[0].n));
        }
        const id = this.next.get(table);
        this.next.set(table, id + 1);
        return id;
    }
}

module.exports = { connect, insertMany, columnsOf, IdAllocator };
