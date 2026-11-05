/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
// ===== BEGIN StockNBook identification numbers (identical in lambda-auth, lambda-pos, lambda-products, lambda-rental-inventory) =====
const identifiers = (() => {
    /*
     * StockNBook standardized identification numbers.
     *
     *   Order      STORE-BRANCH-MMDDYY-XXXX   e.g. SPS-B4-110326-0001
     *   Product    STORE-BRANCH-PRD-XXXX      e.g. SPS-B4-PRD-0001  (one per product type)
     *   Equipment  STORE-BRANCH-EQP-XXXX      e.g. SPS-B4-EQP-0001  (one per physical rental unit)
     *   Employee   STORE-BRANCH-EMP-XXXX      e.g. SPS-B4-EMP-0001  (managers and staff share one sequence)
     *
     * This block is pasted, unchanged, into lambda-auth, lambda-pos, lambda-products
     * and lambda-rental-inventory (each Lambda package stays self-contained).
     * Keep all four copies identical.
     *
     * Existing records are never modified: old Order IDs, Product Nos., equipment
     * numbers, store codes and branch codes stay exactly as they are. Only records
     * created from now on receive these formats.
     *
     * Sequences are at least four digits. They are never truncated: after 9999 the
     * next number is 10000, so an identifier can never repeat.
     */

    const CODE_PATTERN = /^[A-Z0-9]{2,8}$/;
    const SEQUENCE_DIGITS = 4;

    const PATTERNS = Object.freeze({
        order: /^([A-Z0-9]{2,8})-([A-Z0-9]{2,8})-(\d{6})-(\d{4,})$/,
        product: /^([A-Z0-9]{2,8})-([A-Z0-9]{2,8})-PRD-(\d{4,})$/,
        equipment: /^([A-Z0-9]{2,8})-([A-Z0-9]{2,8})-EQP-(\d{4,})$/,
        employee: /^([A-Z0-9]{2,8})-([A-Z0-9]{2,8})-EMP-(\d{4,})$/,
        // Product Nos. created before standardization, e.g. SPS-IMS-001.
        legacyProduct: /^([A-Za-z0-9]{2,8})-([A-Za-z0-9]{2,8})-(\d{3,})$/,
    });

    /* ------------------------------------------------------------------ */
    /* Store initials (unchanged StockNBook rule, e.g. Sparkling Party     */
    /* Supplies - Antipolo City = SPS). Existing store codes are kept.    */
    /* ------------------------------------------------------------------ */

    const STORE_CODE_STOP_WORDS = new Set([
        "THE", "AND", "OF", "STORE", "SHOP", "ENTERPRISE", "ENTERPRISES",
        "TRADING", "COMPANY", "CO", "INC", "CORP", "CORPORATION", "CITY",
    ]);

    function normalizeCodeWords(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    function compactAlpha(value) {
        return normalizeCodeWords(value).join("").replace(/[^A-Z]/g, "");
    }

    function codeFromSingleWord(word) {
        const clean = String(word || "").replace(/[^A-Z]/g, "");
        if (!clean) return "XXX";
        const first = clean.charAt(0);
        const consonants = clean.slice(1).replace(/[AEIOU]/g, "");
        let code = `${first}${consonants}`.slice(0, 3);
        if (code.length < 3) code = `${code}${clean.slice(1)}`.slice(0, 3);
        return code.padEnd(3, "X");
    }

    function buildReadableCode(value, stopWords, fallback = "XXX") {
        const words = normalizeCodeWords(value).filter((word) => !stopWords.has(word));
        if (words.length >= 3) return words.slice(0, 3).map((word) => word.charAt(0)).join("");
        if (words.length === 2) return `${words[0].charAt(0)}${codeFromSingleWord(words[1]).slice(0, 2)}`;
        if (words.length === 1) return codeFromSingleWord(words[0]);
        return codeFromSingleWord(normalizeCodeWords(fallback)[0] || "XXX");
    }

    function storeCodeCandidates(storeName, slug, storeId) {
        const source = storeName || slug || `Store ${storeId}`;
        const base = buildReadableCode(source, STORE_CODE_STOP_WORDS, "STR");
        const compact = compactAlpha(source);
        const candidates = [base];
        for (let length = 4; length <= 7; length += 1) {
            const candidate = `${base}${compact.slice(0, Math.max(0, length - 3))}`.slice(0, length);
            if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
        }
        for (let suffix = 0; suffix < 26; suffix += 1) candidates.push(`${base}${String.fromCharCode(65 + suffix)}`);
        return candidates;
    }

    /* ------------------------------------------------------------------ */
    /* Branch initials, taken from the branch name:                       */
    /*   Moon Walk Branch       -> MW   (initials of the words)           */
    /*   Moonwalk Branch        -> MW   (first letter + next syllable)    */
    /*   Branch 4 Retail Branch -> B4   (numbered branch)                 */
    /*   Main Retail Branch     -> MAIN (one-syllable word kept whole)    */
    /* Generic words such as Branch/Retail/Store are ignored. Initials are */
    /* saved in identifier_prefixes the first time a branch needs an ID   */
    /* and never change afterwards, even if the branch is renamed.        */
    /* ------------------------------------------------------------------ */

    const BRANCH_INITIAL_STOP_WORDS = new Set([
        "THE", "AND", "OF", "BRANCH", "BRANCHES", "BR", "RETAIL", "OUTLET",
        "LOCATION", "STORE", "SHOP",
    ]);
    const VOWELS = new Set(["A", "E", "I", "O", "U"]);
    const CONSONANT_DIGRAPHS = new Set(["CH", "SH", "TH", "PH", "WH", "CK", "GH"]);

    function isVowelAt(word, index) {
        const letter = word.charAt(index);
        if (VOWELS.has(letter)) return true;
        // Y acts as a vowel after a consonant (e.g. "Lyceum").
        return letter === "Y" && index > 0 && !VOWELS.has(word.charAt(index - 1));
    }

    // First letter of the word's second syllable, or "" for one-syllable words.
    function secondSyllableInitial(rawWord) {
        const word = String(rawWord || "").replace(/[^A-Z]/g, "");
        let index = 0;
        while (index < word.length && !isVowelAt(word, index)) index += 1;
        if (index >= word.length) return "";
        while (index < word.length && isVowelAt(word, index)) index += 1;
        const clusterStart = index;
        while (index < word.length && !isVowelAt(word, index)) index += 1;
        if (index >= word.length) return "";
        const cluster = word.slice(clusterStart, index);
        if (cluster.length <= 1) return cluster;
        // Two or more consonants split after the first consonant (moon|walk),
        // keeping common digraphs together (south|west).
        const firstUnit = CONSONANT_DIGRAPHS.has(cluster.slice(0, 2)) ? 2 : 1;
        return cluster.length > firstUnit ? cluster.charAt(firstUnit) : cluster.charAt(0);
    }

    function branchInitials(branchName) {
        const words = normalizeCodeWords(branchName).filter((word) => !BRANCH_INITIAL_STOP_WORDS.has(word));
        const numbers = words.filter((word) => /^\d+$/.test(word)).join("");
        const named = words.filter((word) => !/^\d+$/.test(word));
        let base;
        if (named.length === 0) {
            base = numbers ? `B${numbers}` : "BR";
        } else if (named.length >= 2) {
            base = `${named.map((word) => word.charAt(0)).join("")}${numbers}`;
        } else {
            const word = named[0];
            const next = secondSyllableInitial(word);
            base = `${next ? `${word.charAt(0)}${next}` : word}${numbers}`;
        }
        base = base.replace(/[^A-Z0-9]/g, "").slice(0, 8);
        return base.length >= 2 ? base : `${base}BR`.slice(0, 2);
    }

    // Deterministic fallbacks when two branches of the same store share initials:
    // MW, MW2, MW3 ... or, for codes ending in a digit, B4A, B4B ...
    function branchCodeCandidates(branchName) {
        const base = branchInitials(branchName);
        const candidates = [base];
        const suffixes = /\d$/.test(base)
            ? Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
            : Array.from({ length: 98 }, (_, i) => String(i + 2));
        for (const suffix of suffixes) {
            const candidate = `${base.slice(0, 8 - suffix.length)}${suffix}`;
            if (!candidates.includes(candidate)) candidates.push(candidate);
        }
        return candidates;
    }

    /* ------------------------------------------------------------------ */
    /* Formatting                                                          */
    /* ------------------------------------------------------------------ */

    function formatSequence(sequence) {
        const value = Number(sequence);
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid identification sequence.");
        return String(value).padStart(SEQUENCE_DIGITS, "0"); // never truncates (10000 stays 10000)
    }

    function orderDatePart(orderDate) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(orderDate || ""));
        if (!match) throw new Error("A valid order date (YYYY-MM-DD) is required for the Order ID.");
        return `${match[2]}${match[3]}${match[1].slice(2)}`; // MMDDYY
    }

    function assertCodes(storeCode, branchCode) {
        if (!CODE_PATTERN.test(String(storeCode || "")) || !CODE_PATTERN.test(String(branchCode || ""))) {
            throw new Error("Store/branch initials are missing or invalid for identification numbers.");
        }
    }

    function buildOrderId(storeCode, branchCode, orderDate, sequence) {
        assertCodes(storeCode, branchCode);
        return `${storeCode}-${branchCode}-${orderDatePart(orderDate)}-${formatSequence(sequence)}`;
    }
    function buildProductNumber(storeCode, branchCode, sequence) {
        assertCodes(storeCode, branchCode);
        return `${storeCode}-${branchCode}-PRD-${formatSequence(sequence)}`;
    }
    function buildEquipmentNumber(storeCode, branchCode, sequence) {
        assertCodes(storeCode, branchCode);
        return `${storeCode}-${branchCode}-EQP-${formatSequence(sequence)}`;
    }
    function buildEmployeeCode(storeCode, branchCode, sequence) {
        assertCodes(storeCode, branchCode);
        return `${storeCode}-${branchCode}-EMP-${formatSequence(sequence)}`;
    }

    function trailingSequence(value) {
        const match = /-(\d+)$/.exec(String(value || ""));
        return match ? Number(match[1]) : 0;
    }

    /* ------------------------------------------------------------------ */
    /* Schema (also created by the migration). Runs outside transactions. */
    /* ------------------------------------------------------------------ */

    const SCHEMA_STEPS = [
        {
            table: "id_number_sequences",
            create: `CREATE TABLE IF NOT EXISTS id_number_sequences (
                                                                        store_id BIGINT NOT NULL,
                                                                        branch_id BIGINT NOT NULL,
                                                                        entity_type VARCHAR(10) NOT NULL,
                scope_key VARCHAR(10) NOT NULL DEFAULT '',
                last_sequence INT UNSIGNED NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (store_id, branch_id, entity_type, scope_key)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            table: "identifier_prefixes",
            create: `CREATE TABLE IF NOT EXISTS identifier_prefixes (
                                                                        branch_id BIGINT NOT NULL,
                                                                        store_id BIGINT NOT NULL,
                                                                        store_initials VARCHAR(8) NOT NULL,
                branch_initials VARCHAR(8) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (branch_id),
                UNIQUE KEY uq_identifier_prefixes_initials (store_id, branch_initials)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            table: "rental_equipment_units",
            create: `CREATE TABLE IF NOT EXISTS rental_equipment_units (
                                                                           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                                                           store_id BIGINT NOT NULL,
                                                                           branch_id BIGINT NOT NULL,
                                                                           equipment_id BIGINT NOT NULL,
                                                                           equipment_number VARCHAR(40) NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                retired_at DATETIME NULL DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_rental_equipment_units_number (equipment_number),
                KEY idx_rental_equipment_units_equipment (equipment_id, retired_at),
                KEY idx_rental_equipment_units_branch (store_id, branch_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            table: "managers", column: "employee_code",
            add: "ALTER TABLE managers ADD COLUMN employee_code VARCHAR(40) NULL",
            index: "ALTER TABLE managers ADD UNIQUE INDEX uq_managers_employee_code (employee_code)",
        },
        {
            table: "staff", column: "employee_code",
            add: "ALTER TABLE staff ADD COLUMN employee_code VARCHAR(40) NULL",
            index: "ALTER TABLE staff ADD UNIQUE INDEX uq_staff_employee_code (employee_code)",
        },
    ];

    const schemaState = { ready: false, pending: null };
    const IGNORABLE_DDL_ERRORS = new Set(["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR"]);

    async function probe(connection, sql) {
        try {
            await connection.execute(sql);
            return true;
        } catch (error) {
            if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return false;
            throw error;
        }
    }

    async function runDdl(connection, sql) {
        try {
            await connection.query(sql);
        } catch (error) {
            if (!IGNORABLE_DDL_ERRORS.has(error?.code)) throw error;
        }
    }

    // Idempotent. Never call inside an open transaction: MySQL DDL commits implicitly.
    async function ensureIdentifierSchema(connection) {
        if (schemaState.ready) return true;
        if (!schemaState.pending) {
            schemaState.pending = (async () => {
                for (const step of SCHEMA_STEPS) {
                    if (step.create) {
                        if (!(await probe(connection, `SELECT 1 FROM ${step.table} LIMIT 0`))) await runDdl(connection, step.create);
                    } else if (!(await probe(connection, `SELECT ${step.column} FROM ${step.table} LIMIT 0`))) {
                        await runDdl(connection, step.add);
                        await runDdl(connection, step.index);
                    }
                }
                schemaState.ready = true;
                return true;
            })().catch((error) => {
                console.error("StockNBook identifier schema check failed:", error?.message || error);
                return false;
            }).finally(() => { schemaState.pending = null; });
        }
        return schemaState.pending;
    }

    /* ------------------------------------------------------------------ */
    /* Codes and sequences                                                 */
    /* ------------------------------------------------------------------ */

    // Store + branch initials for a branch. Decided once (first ID for that branch),
    // saved in identifier_prefixes, and reused forever. stores/branches are only read.
    async function getIdentifierCodes(connection, storeId, branchId) {
        const readSaved = async () => {
            const [rows] = await connection.execute(
                "SELECT store_initials AS storeCode, branch_initials AS branchCode FROM identifier_prefixes WHERE branch_id = ? AND store_id = ? LIMIT 1",
                [branchId, storeId]
            );
            return rows[0] || null;
        };
        let saved = await readSaved();
        if (!saved) {
            const [rows] = await connection.execute(
                `SELECT s.store_code AS storeCode, s.store_name AS storeName, s.slug, b.branch_name AS branchName
                 FROM branches b
                          JOIN stores s ON s.id = b.store_id
                 WHERE b.id = ? AND b.store_id = ?
                     LIMIT 1`,
                [branchId, storeId]
            );
            if (!rows.length) throw new Error("The branch does not belong to this store.");
            const info = rows[0];
            // Store initials: this store's saved initials, else its existing store code
            // (e.g. SPS), else derived from the name without writing to the store record.
            const [storeRows] = await connection.execute(
                "SELECT store_initials AS code FROM identifier_prefixes WHERE store_id = ? LIMIT 1", [storeId]);
            let storeCode = String(storeRows[0]?.code || info.storeCode || "").trim().toUpperCase();
            if (!CODE_PATTERN.test(storeCode)) {
                const [usedRows] = await connection.execute(
                    `SELECT store_code AS code FROM stores WHERE id <> ? AND store_code IS NOT NULL
                     UNION SELECT store_initials AS code FROM identifier_prefixes WHERE store_id <> ?`,
                    [storeId, storeId]
                );
                const used = new Set(usedRows.map((row) => String(row.code || "").toUpperCase()));
                storeCode = storeCodeCandidates(info.storeName, info.slug, storeId).find((code) => !used.has(code));
            }
            // INSERT IGNORE + the unique key settles races: when another branch of this
            // store already holds the initials, the next candidate (MW2, MW3 ...) is tried.
            for (const candidate of branchCodeCandidates(info.branchName)) {
                await connection.execute(
                    "INSERT IGNORE INTO identifier_prefixes (branch_id, store_id, store_initials, branch_initials) VALUES (?, ?, ?, ?)",
                    [branchId, storeId, storeCode, candidate]
                );
                saved = await readSaved();
                if (saved) break;
            }
            if (!saved) throw new Error("Unable to allocate unique branch initials.");
        }
        const storeCode = String(saved.storeCode || "").trim().toUpperCase();
        const branchCode = String(saved.branchCode || "").trim().toUpperCase();
        assertCodes(storeCode, branchCode);
        return { storeCode, branchCode };
    }

    async function maxSequenceFrom(connection, sql, params, pattern) {
        const [rows] = await connection.execute(sql, params);
        return rows.reduce((max, row) => {
            const value = String(row.value || "");
            return pattern && !pattern.test(value) ? max : Math.max(max, trailingSequence(value));
        }, 0);
    }

    /*
     * Reserves `count` consecutive numbers atomically. The UPDATE row-locks the
     * sequence row and LAST_INSERT_ID(expr) hands the new value back on this
     * connection only, so concurrent requests can never receive the same number
     * (with or without an open transaction). `floor` self-heals the sequence from
     * identifiers already stored.
     */
    async function reserveSequenceBlock(connection, { storeId, branchId, entityType, scopeKey = "", count = 1, floor = 0 }) {
        const size = Number(count);
        if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid identification sequence request.");
        await connection.execute(
            `INSERT INTO id_number_sequences (store_id, branch_id, entity_type, scope_key, last_sequence)
             VALUES (?, ?, ?, ?, 0)
                 ON DUPLICATE KEY UPDATE last_sequence = last_sequence`,
            [storeId, branchId, entityType, scopeKey]
        );
        await connection.execute(
            `UPDATE id_number_sequences
             SET last_sequence = LAST_INSERT_ID(GREATEST(last_sequence, ?) + ?)
             WHERE store_id = ? AND branch_id = ? AND entity_type = ? AND scope_key = ?`,
            [Number(floor) || 0, size, storeId, branchId, entityType, scopeKey]
        );
        const [rows] = await connection.execute("SELECT LAST_INSERT_ID() AS lastSequence");
        const last = Number(rows[0]?.lastSequence);
        if (!Number.isSafeInteger(last) || last < size) throw new Error("Identification sequence could not be reserved.");
        return { first: last - size + 1, last };
    }

    async function generateOrderId(connection, { storeId, branchId, orderDate }) {
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const datePart = orderDatePart(orderDate);
        const prefix = `${storeCode}-${branchCode}-${datePart}-`;
        const floor = await maxSequenceFrom(connection,
            "SELECT order_id AS value FROM orders WHERE order_id LIKE ?", [`${prefix}%`], PATTERNS.order);
        const { last } = await reserveSequenceBlock(connection,
            { storeId, branchId, entityType: "ORDER", scopeKey: datePart, floor });
        return buildOrderId(storeCode, branchCode, orderDate, last);
    }

    // Managers and staff share ONE sequence per branch, so their IDs never overlap.
    async function generateEmployeeCode(connection, { storeId, branchId }) {
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const prefix = `${storeCode}-${branchCode}-EMP-`;
        const floor = await maxSequenceFrom(connection,
            `SELECT employee_code AS value FROM managers WHERE employee_code LIKE ?
             UNION ALL
            SELECT employee_code AS value FROM staff WHERE employee_code LIKE ?`,
            [`${prefix}%`, `${prefix}%`], PATTERNS.employee);
        const { last } = await reserveSequenceBlock(connection, { storeId, branchId, entityType: "EMP", floor });
        return buildEmployeeCode(storeCode, branchCode, last);
    }

    // Highest Product No. already issued with this exact prefix (products or rental types).
    async function maxProductPrefixSequence(connection, storeCode, branchCode) {
        const prefix = `${storeCode}-${branchCode}-PRD-%`;
        const fromProducts = await maxSequenceFrom(connection,
            "SELECT product_number AS value FROM products WHERE product_number LIKE ?", [prefix], PATTERNS.product);
        let fromRental = 0;
        try {
            fromRental = await maxSequenceFrom(connection,
                "SELECT equipment_number AS value FROM rental_equipment WHERE equipment_number LIKE ?", [prefix], PATTERNS.product);
        } catch (error) {
            if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
        }
        return Math.max(fromProducts, fromRental);
    }

    /*
     * Product Nos. for sales products and rental product types share
     * product_number_sequences, so a rental type can never reuse a sales product's
     * number. Caller must be inside a transaction; the branch row lock serializes
     * allocation exactly like lambda-products create_product.
     */
    async function allocateProductNumber(connection, { storeId, branchId }) {
        await connection.execute("SELECT id FROM branches WHERE id = ? AND store_id = ? FOR UPDATE", [branchId, storeId]);
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const [sequenceRows] = await connection.execute(
            "SELECT last_sequence AS lastSequence FROM product_number_sequences WHERE store_id = ? AND branch_id = ? FOR UPDATE",
            [storeId, branchId]
        );
        const fromProducts = await maxSequenceFrom(connection,
            "SELECT product_number AS value FROM products WHERE store_id = ? AND branch_id = ? AND product_number IS NOT NULL",
            [storeId, branchId]);
        const fromRental = await maxSequenceFrom(connection,
            "SELECT equipment_number AS value FROM rental_equipment WHERE store_id = ? AND branch_id = ? AND equipment_number LIKE '%-PRD-%'",
            [storeId, branchId], PATTERNS.product);
        const fromPrefix = await maxProductPrefixSequence(connection, storeCode, branchCode);
        const next = Math.max(Number(sequenceRows[0]?.lastSequence || 0), fromProducts, fromRental, fromPrefix) + 1;
        await connection.execute(
            `INSERT INTO product_number_sequences (store_id, branch_id, last_sequence)
             VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence))`,
            [storeId, branchId, next]
        );
        return buildProductNumber(storeCode, branchCode, next);
    }

    /*
     * One Equipment No. per physical rental unit ADDED from now on (units that existed
     * before are left exactly as they are). Rental workflows stay quantity-based:
     * delta > 0 issues new numbers; delta < 0 (correction, write-off, retirement)
     * retires the most recently numbered units still active. Numbers are never reused.
     * delta = -Infinity retires all of a rental product's numbers.
     */
    async function adjustEquipmentUnits(connection, { storeId, branchId, equipmentId, delta }) {
        const change = Number(delta);
        if (!change) return { issued: [], retired: 0 };
        if (change < 0) {
            const [active] = await connection.execute(
                "SELECT id FROM rental_equipment_units WHERE equipment_id = ? AND retired_at IS NULL ORDER BY id DESC",
                [equipmentId]
            );
            const count = Number.isFinite(change) ? Math.min(active.length, -change) : active.length;
            const ids = active.slice(0, count).map((row) => Number(row.id));
            for (let i = 0; i < ids.length; i += 500) {
                const chunk = ids.slice(i, i + 500);
                await connection.execute(
                    `UPDATE rental_equipment_units SET retired_at = CURRENT_TIMESTAMP WHERE id IN (${chunk.map(() => "?").join(",")})`,
                    chunk
                );
            }
            return { issued: [], retired: ids.length };
        }
        const needed = Math.trunc(change);
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const prefix = `${storeCode}-${branchCode}-EQP-`;
        const floor = await maxSequenceFrom(connection,
            "SELECT equipment_number AS value FROM rental_equipment_units WHERE equipment_number LIKE ?",
            [`${prefix}%`], PATTERNS.equipment);
        const { first } = await reserveSequenceBlock(connection,
            { storeId, branchId, entityType: "EQP", count: needed, floor });
        const issued = Array.from({ length: needed }, (_, i) => buildEquipmentNumber(storeCode, branchCode, first + i));
        for (let i = 0; i < issued.length; i += 500) {
            const chunk = issued.slice(i, i + 500);
            await connection.execute(
                `INSERT INTO rental_equipment_units (store_id, branch_id, equipment_id, equipment_number)
                 VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}`,
                chunk.flatMap((number) => [storeId, branchId, equipmentId, number])
            );
        }
        return { issued, retired: 0 };
    }

    // Active Equipment Nos. for a branch, grouped by rental product type.
    async function listEquipmentUnitNumbers(connection, { storeId, branchId }) {
        const grouped = new Map();
        try {
            const [rows] = await connection.execute(
                `SELECT equipment_id AS equipmentId, equipment_number AS equipmentNumber
                 FROM rental_equipment_units
                 WHERE store_id = ? AND branch_id = ? AND retired_at IS NULL
                 ORDER BY equipment_id, equipment_number`,
                [storeId, branchId]
            );
            for (const row of rows) {
                const key = Number(row.equipmentId);
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(String(row.equipmentNumber));
            }
        } catch (error) {
            if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
        }
        return grouped;
    }

    return {
        PATTERNS,
        CODE_PATTERN,
        branchInitials,
        branchCodeCandidates,
        secondSyllableInitial,
        storeCodeCandidates,
        formatSequence,
        orderDatePart,
        buildOrderId,
        buildProductNumber,
        buildEquipmentNumber,
        buildEmployeeCode,
        trailingSequence,
        ensureIdentifierSchema,
        getIdentifierCodes,
        reserveSequenceBlock,
        generateOrderId,
        generateEmployeeCode,
        allocateProductNumber,
        adjustEquipmentUnits,
        maxProductPrefixSequence,
        listEquipmentUnitNumbers,
    };
})();
// ===== END StockNBook identification numbers =====

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

// Reuse database connections across warm requests. This avoids paying the
// TCP/TLS/database handshake cost for every dashboard API call.
const dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});

function jsonResponse(statusCode, headers, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body),
    };
}

function badRequest(headers, message) {
    return jsonResponse(400, headers, { error: message });
}

function unauthorized(headers, message) {
    return jsonResponse(401, headers, { error: message });
}

function serverError(headers, error) {
    console.error("POS Lambda error:", error);

    return jsonResponse(500, headers, {
        error:
            error instanceof Error
                ? error.message
                : "Internal server error",
    });
}

// Resolve operational access from the current database row, not a cached browser permission.
// Keep legacy access keys compatible with existing Manager/Staff records.
function normalizeOperationalAccess(permissions, moduleName, role) {
    let values = permissions;
    if (typeof values === "string") {
        try { values = JSON.parse(values); } catch { values = {}; }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) values = {};

    const keys = moduleName === "bookings"
        ? ["bookings", "booking_access", "bookings_access"]
        : ["pos", "pos_access", "sales_access"];
    const selected = keys.find((key) => Object.prototype.hasOwnProperty.call(values, key));
    if (!selected) {
        // Sensible legacy defaults: Manager sees branch sales; Staff runs checkout.
        if (moduleName === "pos") return role === "manager" ? "view" : role === "staff" ? "full" : "none";
        return role === "manager" ? "full" : "none";
    }
    const access = values[selected];
    if (access === true || access === 1 || access === "1" || access === "true" || access === "full") return "full";
    if (access === "view" || access === "view_only" || access === "viewOnly") return "view";
    return "none";
}

async function getOperationalAccess(connection, decoded, moduleName) {
    const role = String(decoded?.role || "").trim().toLowerCase();
    if (role === "owner") return "full";
    if (role !== "manager" && role !== "staff") return "none";

    const storeId = Number(decoded?.store_id);
    const branchId = Number(decoded?.branch_id);
    const employeeId = Number(role === "manager" ? decoded?.manager_id : decoded?.staff_id);
    if (![storeId, branchId, employeeId].every((id) => Number.isSafeInteger(id) && id > 0)) return "none";

    const table = role === "manager" ? "managers" : "staff";
    const [rows] = await connection.execute(
        `SELECT permissions FROM ${table} WHERE id = ? AND store_id = ? AND branch_id = ? AND LOWER(status) = 'active' LIMIT 1`,
        [employeeId, storeId, branchId]
    );
    if (!rows.length) return "none";
    return normalizeOperationalAccess(rows[0].permissions, moduleName, role);
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}


function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function toISODate(value) {
    const raw = toSafeString(value, 40);

    if (!raw) return null;

    const date = new Date(raw);

    if (!Number.isFinite(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}

function getManilaISODate(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);

    const readPart = (type) =>
        parts.find((part) => part.type === type)?.value || "";

    return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}

function shiftMonthStartISO(referenceDate, monthsBack) {
    const [year, month] = String(referenceDate || "")
        .split("-")
        .map(Number);

    const date = new Date(Date.UTC(year, month - 1 - monthsBack, 1));
    return date.toISOString().slice(0, 10);
}

function getOwnerDashboardPeriodStarts(referenceDate) {
    const [year, month] = String(referenceDate || "")
        .split("-")
        .map(Number);

    const monthIndex = Math.max(0, Math.min(11, (month || 1) - 1));
    const quarterStartMonth = Math.floor(monthIndex / 3) * 3;

    const format = (date) => date.toISOString().slice(0, 10);

    return {
        month: format(new Date(Date.UTC(year, monthIndex, 1))),
        quarter: format(new Date(Date.UTC(year, quarterStartMonth, 1))),
        year: format(new Date(Date.UTC(year, 0, 1))),
    };
}

/* Owner-only read-only reporting functions; kept inside the existing Lambda file. */
const getOwnerSalesReport = (() => {
    /*
     * Owner Sales & Revenue, read-only reporting adapter.
     * Does not write, migrate, or create any database records.
     * Booking rows are included ONLY when the existing bookings schema provides:
     *  - a store / branch association,
     *  - a fulfillment/completion timestamp,
     *  - a status verified as COMPLETED or FULFILLED,
     *  - a recorded booking value.
     * Unknown costs/tax are NULL, never invented as 0.
     * A missing/incompatible booking schema makes consolidated KPIs unavailable,
     * rather than incorrectly labelling POS revenue as combined revenue.
     */
    const ALLOWED_SOURCES = new Set(['ALL', 'BOOKING', 'WALK_IN']);
    const SORT_DIRECTIONS = new Set(['NEWEST', 'OLDEST']);
    const id = (name) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid database column.');
        return `\`${name}\``;
    };
    const findColumn = (set, candidates) => candidates.find((value) => set.has(value)) || null;
    const expr = (alias, column, fallback = 'NULL') => column ? `${alias}.${id(column)}` : fallback;
    const money = (value) => Number(Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100);

    async function listColumns(db, table) {
        const [rows] = await db.execute(
            'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
            [table]
        );
        return new Set(rows.map((row) => String(row.name).toLowerCase()));
    }

    async function detectBookingSchema(db) {
        const candidateTables = ['bookings', 'event_bookings', 'customer_bookings'];
        for (const table of candidateTables) {
            const cols = await listColumns(db, table);
            if (!cols.size) continue;
            const fields = {
                storeId: findColumn(cols, ['store_id']),
                branchId: findColumn(cols, ['branch_id']),
                status: findColumn(cols, ['fulfillment_status', 'service_status', 'rental_status', 'status', 'booking_status']),
                completedAt: findColumn(cols, ['fulfilled_at', 'service_completed_at', 'completed_at', 'date_fulfilled', 'date_completed']),
                reference: findColumn(cols, ['booking_number', 'booking_no', 'booking_reference', 'booking_id', 'order_id', 'id']),
                value: findColumn(cols, ['earned_revenue', 'recognized_revenue', 'revenue_amount', 'grand_total', 'total_amount', 'total_price', 'booking_total', 'final_amount', 'total']),
                cost: findColumn(cols, ['direct_cost', 'total_cost', 'cost_of_sales', 'cost_of_goods_sold', 'fulfillment_cost', 'direct_rental_cost', 'actual_cost']),
                vat: findColumn(cols, ['vat_amount', 'tax_amount', 'total_vat']),
                taxType: findColumn(cols, ['tax_type', 'tax_registration']),
                customer: findColumn(cols, ['customer_name', 'client_name', 'full_name']),
                customerContact: findColumn(cols, ['customer_contact_number', 'contact_number', 'customer_phone']),
                posLinkedOrderId: findColumn(cols, ['pos_order_id', 'pos_transaction_id', 'checkout_order_id', 'pos_order_reference']),
                payment: findColumn(cols, ['payment_mode', 'payment_method']),
                processedBy: findColumn(cols, ['processed_by_name', 'fulfilled_by_name', 'completed_by_name', 'staff_name']),
            };
            const refundableDeposit = findColumn(cols, ['refundable_deposit', 'security_deposit']);
            // Some booking grand totals include refundable deposits, which are liabilities, not sales.
            // Without an explicit recognized-revenue column, counting that grand total is unsafe.
            if (refundableDeposit && !['earned_revenue','recognized_revenue','revenue_amount'].includes(fields.value || '')) {
                return { available: false, reason: `${table} has a refundable/security deposit, but no verified earned-revenue field.` };
            }
            if (!fields.storeId || !fields.branchId || !fields.status || !fields.completedAt || !fields.reference || !fields.value) {
                return { available: false, reason: `${table} is present, but its booking completion, identifier, revenue, or branch fields have not been verified.` };
            }
            return { available: true, table, fields, hasCostSnapshot: Boolean(fields.cost), hasTaxData: Boolean(fields.vat || fields.taxType) };
        }
        return { available: false, reason: 'The booking sales table/schema was not supplied or could not be found.' };
    }

    function posSql({ storeId, branchId, dateFrom, dateTo, orderColumns, bookingSchema, exactOrderId }) {
        const where = ["o.store_id = ?", "UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')",
            "(UPPER(TRIM(COALESCE(o.customer_type, ''))) = 'WALK_IN' OR (TRIM(COALESCE(o.customer_type, '')) = '' AND o.order_id LIKE '%-POS-%'))"];
        // One store-specific cost aggregation, avoiding a full cross-tenant GROUP BY.
        // Bind order: item-cost subquery first, followed by orders WHERE predicates.
        const params = [storeId, storeId];
        // A POS payment tied to an existing booking is not a second sale.
        for (const column of ['booking_id', 'booking_reference', 'related_booking_id']) {
            if (orderColumns.has(column)) where.push(`o.${id(column)} IS NULL`);
        }
        if (bookingSchema.available && bookingSchema.fields.posLinkedOrderId) {
            const f = bookingSchema.fields;
            where.push(`NOT EXISTS (SELECT 1 FROM ${id(bookingSchema.table)} booked
           WHERE booked.${id(f.storeId)} = o.store_id
             AND booked.${id(f.posLinkedOrderId)} = o.order_id)`);
        }
        if (branchId) { where.push('o.branch_id = ?'); params.push(branchId); }
        if (dateFrom) { where.push('o.order_date >= ?'); params.push(dateFrom); }
        if (dateTo) { where.push('o.order_date <= ?'); params.push(dateTo); }
        if (exactOrderId) { where.push('o.order_id = ?'); params.push(exactOrderId); }
        const sql = `SELECT
                         o.order_id AS orderId, o.branch_id AS branchId,
                         COALESCE(NULLIF(TRIM(br.branch_name),''), CONCAT('Branch ',o.branch_id)) AS branchName,
                         'Walk-in' AS customerName, NULL AS customerContactNumber, 'WALK_IN' AS salesSource,
                         o.payment_mode AS paymentMode, o.tax_type AS taxType,
                         o.total AS total, o.vat_amount AS vatAmount,
                         CASE WHEN ic.rowCount > 0 AND ic.missingCount = 0 THEN ic.cost ELSE NULL END AS totalCost,
                         CASE WHEN ic.rowCount > 0 AND ic.missingCount = 0
                                  THEN o.total - COALESCE(o.vat_amount,0) - ic.cost ELSE NULL END AS profit,
                         o.item AS item,
                         o.cashier_id AS cashierId,
                         (SELECT ea.employee_name FROM employee_actions ea
                          WHERE ea.store_id=o.store_id AND ea.reference_id COLLATE utf8mb4_unicode_ci = o.order_id
                            AND ea.action = 'Completed POS transaction' ORDER BY ea.id DESC LIMIT 1) AS cashierName,
        (SELECT ea.employee_role FROM employee_actions ea
         WHERE ea.store_id=o.store_id AND ea.reference_id COLLATE utf8mb4_unicode_ci = o.order_id
         AND ea.action = 'Completed POS transaction' ORDER BY ea.id DESC LIMIT 1) AS cashierRole,
        DATE_FORMAT(o.order_date, '%Y-%m-%d') AS reportDate,
        DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS transactionAt
                     FROM orders o
                         LEFT JOIN branches br ON br.store_id=o.store_id AND br.id=o.branch_id
                         LEFT JOIN (
                         SELECT store_id, order_id, COUNT(*) AS rowCount,
                         SUM(CASE WHEN cost_price_at_sale IS NULL THEN 1 ELSE 0 END) AS missingCount,
                         SUM(cost_price_at_sale * quantity) AS cost
                         FROM order_items WHERE store_id = ? GROUP BY store_id, order_id
                         ) ic ON ic.store_id=o.store_id AND ic.order_id=o.order_id
                     WHERE ${where.join(' AND ')}`;
        return { sql, params };
    }

    function bookingSql(schema, { storeId, branchId, dateFrom, dateTo, exactOrderId }) {
        const f = schema.fields;
        const ref = expr('bk', f.reference);
        const value = expr('bk', f.value);
        const cost = expr('bk', f.cost);
        const vat = f.vat ? expr('bk', f.vat) : f.taxType
            ? `CASE WHEN UPPER(${expr('bk', f.taxType)}) IN ('NON_VAT','NON_VAT_REGISTERED') THEN 0 ELSE NULL END`
            : 'NULL';
        const profit = `CASE WHEN ${cost} IS NOT NULL AND ${vat} IS NOT NULL THEN (${value}) - (${cost}) - (${vat}) ELSE NULL END`;
        const completed = expr('bk', f.completedAt);
        const where = [`bk.${id(f.storeId)} = ?`, `UPPER(TRIM(COALESCE(${expr('bk',f.status)},''))) IN ('COMPLETED','FULFILLED')`,
            `${completed} IS NOT NULL`, `${value} IS NOT NULL`];
        const params = [storeId];
        if (branchId) { where.push(`bk.${id(f.branchId)} = ?`); params.push(branchId); }
        if (dateFrom) { where.push(`DATE(${completed}) >= ?`); params.push(dateFrom); }
        if (dateTo) { where.push(`DATE(${completed}) <= ?`); params.push(dateTo); }
        if (exactOrderId) { where.push(`CAST(${ref} AS CHAR) = ?`); params.push(exactOrderId); }
        // The original booking reference/PK is used; no new booking order is generated.
        const sql = `SELECT CAST(${ref} AS CHAR) AS orderId, bk.${id(f.branchId)} AS branchId,
                            COALESCE(NULLIF(TRIM(br.branch_name),''), CONCAT('Branch ',bk.${id(f.branchId)})) AS branchName,
                            ${expr('bk',f.customer)} AS customerName, ${expr('bk',f.customerContact)} AS customerContactNumber, 'BOOKING' AS salesSource,
                            ${expr('bk',f.payment)} AS paymentMode, ${expr('bk',f.taxType)} AS taxType,
                            ${value} AS total, ${vat} AS vatAmount,
                            ${cost} AS totalCost, ${profit} AS profit,
                            NULL AS item, NULL AS cashierId, ${expr('bk',f.processedBy)} AS cashierName,
                            NULL AS cashierRole, DATE_FORMAT(${completed}, '%Y-%m-%d') AS reportDate,
                            DATE_FORMAT(${completed}, '%Y-%m-%d %H:%i:%s') AS transactionAt
                     FROM ${id(schema.table)} bk
                              LEFT JOIN branches br ON br.store_id=bk.${id(f.storeId)} AND br.id=bk.${id(f.branchId)}
                     WHERE ${where.join(' AND ')}`;
        return { sql, params };
    }

    async function getOwnerSalesReport(db, storeId, branchId, body) {
        const dateFrom = String(body.date_from || body.dateFrom || '').slice(0,10);
        const dateTo = String(body.date_to || body.dateTo || '').slice(0,10);
        if ((dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) || (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) ||
            (dateFrom && dateTo && dateFrom > dateTo)) {
            const error = new Error('Invalid report date range.'); error.statusCode = 400; throw error;
        }
        const source = String(body.sales_source || 'ALL').toUpperCase();
        const sort = String(body.sort || 'NEWEST').toUpperCase();
        if (!ALLOWED_SOURCES.has(source) || !SORT_DIRECTIONS.has(sort)) {
            const error = new Error('Invalid sales source or sorting option.'); error.statusCode = 400; throw error;
        }
        const page = Math.max(1, Math.min(100000, Math.floor(Number(body.page) || 1)));
        const pageSize = Math.max(10, Math.min(100, Math.floor(Number(body.page_size) || 50)));
        const search = String(body.search || '').trim().slice(0,120);
        const payment = String(body.payment_method || '').trim().toUpperCase().slice(0,50);
        const bookingSchema = await detectBookingSchema(db);
        const orderColumns = await listColumns(db,'orders');
        const walk = posSql({ storeId, branchId, dateFrom, dateTo, orderColumns, bookingSchema });
        const sources = [walk];
        if (bookingSchema.available) sources.push(bookingSql(bookingSchema, {storeId,branchId,dateFrom,dateTo}));
        const unionSql = sources.map((s) => `(${s.sql})`).join(' UNION ALL ');
        const unionParams = sources.flatMap((s) => s.params);

        // Only the persisted store registration determines whether the Owner VAT
        // panel is shown. Historical order VAT snapshots are never recomputed.
        const [registrationRows] = await db.execute(
            'SELECT tax_registration AS taxRegistration FROM stores WHERE id = ? LIMIT 1', [storeId]
        );
        const registration = String(registrationRows[0]?.taxRegistration || '').trim().toUpperCase();
        const vatRegistered = registration === 'VAT_REGISTERED' || registration === 'VAT';
        const taxRegistration = vatRegistered ? 'VAT_REGISTERED' : (
            registration === 'NON_VAT' || registration === 'NON_VAT_REGISTERED' ? 'NON_VAT' : 'UNKNOWN'
        );

        // VAT figures follow branch, dates and Sales Source; they cover every
        // matching transaction, not only the paginated Orders table.
        const vatSourceWhere = source === 'ALL' ? '' : 'WHERE v.salesSource = ?';
        const vatParams = source === 'ALL' ? unionParams : [...unionParams, source];
        const taxSql = "UPPER(TRIM(COALESCE(v.taxType,'')))";
        const vatEligibleSql = `(${taxSql} IN ('VAT','VAT_REGISTERED') OR
        (${taxSql} = '' AND v.vatAmount > 0))`;
        const nonVatSql = `(${taxSql} IN ('NON_VAT','NON_VAT_REGISTERED') AND
        (v.vatAmount IS NULL OR v.vatAmount = 0))`;
        const vatVerifiedSql = `(${vatEligibleSql} AND v.vatAmount IS NOT NULL)`;
        const vatUnverifiedSql = `(NOT ${vatVerifiedSql} AND NOT ${nonVatSql})`;
        let vatSummary = null;
        if (vatRegistered && body.vat_export !== true) {
            const [[vatTotals]] = await db.execute(`
                SELECT
                    COALESCE(SUM(CASE WHEN ${vatVerifiedSql} THEN v.total - v.vatAmount ELSE 0 END),0) AS vatableSales,
                    COALESCE(SUM(CASE WHEN ${vatVerifiedSql} THEN v.vatAmount ELSE 0 END),0) AS outputVat,
                    COALESCE(SUM(CASE WHEN ${vatVerifiedSql} THEN v.total ELSE 0 END),0) AS customerTotal,
                    SUM(CASE WHEN ${vatUnverifiedSql} THEN 1 ELSE 0 END) AS unverifiedRecords,
                    COUNT(*) AS transactionCount
                FROM (${unionSql}) v ${vatSourceWhere}`, vatParams);
            const unverifiedRecords = Number(vatTotals.unverifiedRecords || 0);
            const complete = (source === 'WALK_IN' || bookingSchema.available) && unverifiedRecords === 0;
            vatSummary = {
                vatableSales: money(vatTotals.vatableSales),
                outputVat: money(vatTotals.outputVat),
                customerTotal: money(vatTotals.customerTotal),
                transactionCount: Number(vatTotals.transactionCount || 0),
                unverifiedRecords,
                complete,
                // Verified amounts may be PARTIAL when booking data is unavailable.
                // Never silently substitute them for a full store-wide tax declaration.
                coverage: complete ? 'COMPLETE' : 'PARTIAL',
                coverageReason: !complete
                    ? (!bookingSchema.available && source !== 'WALK_IN'
                        ? 'Booking VAT records could not be verified; only known transactions are included.'
                        : `${unverifiedRecords} transaction(s) have missing or inconsistent VAT records.`)
                    : null,
            };
        }

        if (body.vat_export === true) {
            if (!vatRegistered) {
                const error = new Error('VAT download is available only for VAT-registered stores.');
                error.statusCode = 400; throw error;
            }
            // Return a complete filtered extract, never a silently truncated file.
            // Limit JSON response size; owners can narrow the date range if needed.
            const MAX_EXPORT_ROWS = 5000;
            // Match the Orders table filters. Branch and dates are already applied
            // inside each source query; these remaining filters combine with them.
            const exportWhere = [];
            const exportParams = [...unionParams];
            if (source !== 'ALL') {
                exportWhere.push('v.salesSource = ?');
                exportParams.push(source);
            }
            if (search) {
                exportWhere.push('(v.orderId LIKE ? OR v.customerName LIKE ?)');
                exportParams.push(`%${search}%`, `%${search}%`);
            }
            const exportWhereSql = exportWhere.length
                ? `WHERE ${exportWhere.join(' AND ')}`
                : '';
            const [vatRows] = await db.execute(`
                SELECT v.orderId, v.branchName, v.reportDate, v.transactionAt,
                       v.salesSource, v.paymentMode, v.taxType, v.total, v.vatAmount
                FROM (${unionSql}) v ${exportWhereSql}
                ORDER BY v.transactionAt DESC, v.orderId DESC
                    LIMIT ${MAX_EXPORT_ROWS + 1}`, exportParams);
            if (vatRows.length > MAX_EXPORT_ROWS) {
                const error = new Error('VAT export exceeds 5,000 transactions. Select a shorter date range and download again.');
                error.statusCode = 400; throw error;
            }
            const normalizeVatRow = (row) => {
                const rowTax = String(row.taxType || '').trim().toUpperCase();
                const vatNumber = row.vatAmount == null ? null : Number(row.vatAmount);
                const amount = Number(row.total || 0);
                const vatType = rowTax === 'VAT' || rowTax === 'VAT_REGISTERED' || (!rowTax && vatNumber != null && vatNumber > 0);
                const nonVatType = (rowTax === 'NON_VAT' || rowTax === 'NON_VAT_REGISTERED') &&
                    (vatNumber == null || vatNumber === 0);
                const status = vatType && vatNumber != null && Number.isFinite(vatNumber)
                    ? 'VAT_RECORDED' : nonVatType ? 'NON_VAT' : 'UNVERIFIED';
                const reportDate = row.reportDate instanceof Date
                    ? row.reportDate.toISOString().slice(0,10) : String(row.reportDate || '').slice(0,10);
                return {
                    orderId: String(row.orderId || ''),
                    branchName: String(row.branchName || ''),
                    salesSource: row.salesSource === 'BOOKING' ? 'Booking' : 'Walk-in',
                    date: reportDate,
                    paymentMode: String(row.paymentMode || ''),
                    taxType: rowTax,
                    totalInclusive: money(amount),
                    vatableSales: status === 'VAT_RECORDED' ? money(amount - vatNumber) : null,
                    outputVat: status === 'VAT_RECORDED' ? money(vatNumber) : null,
                    vatStatus: status,
                };
            };
            const exportRows = vatRows.map(normalizeVatRow);
            // Use the actual exported rows to calculate the PDF's displayed VAT totals;
            // summary cards elsewhere on the page must remain unaffected by search.
            const recorded = exportRows.filter((row) => row.vatStatus === 'VAT_RECORDED');
            const unverifiedRecords = exportRows.filter((row) => row.vatStatus === 'UNVERIFIED').length;
            const exportComplete = (source === 'WALK_IN' || bookingSchema.available) && unverifiedRecords === 0;
            const sum = (key) => money(recorded.reduce(
                (total, row) => total + Number(row[key] || 0), 0
            ));
            const exportVatSummary = {
                vatableSales: sum('vatableSales'),
                outputVat: sum('outputVat'),
                customerTotal: sum('totalInclusive'),
                transactionCount: exportRows.length,
                unverifiedRecords,
                complete: exportComplete,
                coverage: exportComplete ? 'COMPLETE' : 'PARTIAL',
                coverageReason: exportComplete ? null :
                    (!bookingSchema.available && source !== 'WALK_IN'
                        ? 'Booking VAT records could not be verified; only known transactions are included.'
                        : `${unverifiedRecords} transaction(s) have missing or inconsistent VAT records.`),
            };
            return {
                export: true,
                taxRegistration,
                vatSummary: exportVatSummary,
                scope: { branchId: branchId || null, dateFrom, dateTo, salesSource: source, search },
                bookingIntegration: {
                    available: bookingSchema.available,
                    reason: bookingSchema.available ? null : bookingSchema.reason,
                },
                rows: exportRows,
            };
        }

        const [totals] = await db.execute(`SELECT salesSource, COUNT(*) AS transactions, COALESCE(SUM(total),0) AS sales,
                                                  SUM(CASE WHEN profit IS NULL THEN 1 ELSE 0 END) AS unknownProfitRows,
                                                  SUM(profit) AS grossProfit FROM (${unionSql}) totals GROUP BY salesSource`, unionParams);
        const bySource = new Map(totals.map((r) => [r.salesSource,r]));
        const walkSales = money(bySource.get('WALK_IN')?.sales);
        const bookingSales = money(bySource.get('BOOKING')?.sales);
        const missingCosts = totals.reduce((sum,r) => sum+Number(r.unknownProfitRows||0),0);
        const grossProfit = totals.reduce((sum,r) => sum+Number(r.grossProfit||0),0);
        // If bookings are missing, never present walk-in totals as a complete combined total.
        const summary = {
            walkInSales: walkSales,
            bookingSales: bookingSchema.available ? bookingSales : null,
            totalSales: bookingSchema.available ? money(walkSales+bookingSales) : null,
            grossProfit: bookingSchema.available && missingCosts === 0 ? money(grossProfit) : null,
            missingCostRecords: missingCosts,
            transactionCount: totals.reduce((sum,r) => sum+Number(r.transactions||0),0)
        };

        // Table filters combine consistently on the already branch/date-scoped source.
        const outerWhere = [];
        const outerParams = [];
        if (source !== 'ALL') { outerWhere.push('r.salesSource = ?'); outerParams.push(source); }
        if (payment) { outerWhere.push('UPPER(COALESCE(r.paymentMode,\'\')) = ?'); outerParams.push(payment); }
        if (search) { outerWhere.push('(r.orderId LIKE ? OR r.customerName LIKE ?)'); outerParams.push(`%${search}%`,`%${search}%`); }
        const filterSql = outerWhere.length ? `WHERE ${outerWhere.join(' AND ')}` : '';
        const [[count]] = await db.execute(`SELECT COUNT(*) AS total FROM (${unionSql}) r ${filterSql}`, [...unionParams,...outerParams]);
        const total = Number(count.total || 0);
        const totalPages = Math.max(1,Math.ceil(total/pageSize));
        const sortOrder = sort==='OLDEST' ? 'ASC' : 'DESC';
        const offset=(page-1)*pageSize;
        const [rows] = await db.execute(`SELECT r.* FROM (${unionSql}) r ${filterSql}
                                         ORDER BY r.transactionAt ${sortOrder}, r.orderId ${sortOrder}
                                             LIMIT ${pageSize} OFFSET ${offset}`, [...unionParams,...outerParams]);
        const [methods] = await db.execute(`SELECT DISTINCT r.paymentMode AS method FROM (${unionSql}) r
                                            WHERE r.paymentMode IS NOT NULL AND TRIM(r.paymentMode) <> '' ORDER BY method`,unionParams);
        return {
            orders: rows.map(r=>({
                orderId: String(r.orderId), branchId: r.branchId, branchName: r.branchName,
                customerName: r.customerName || (r.salesSource === 'WALK_IN' ? 'Walk-in' : null),
                customerContactNumber: r.customerContactNumber || null,
                salesSource: r.salesSource, customerType: r.salesSource,
                paymentMode: r.paymentMode || null, taxType: r.taxType || null,
                total: r.total, totalCost: r.totalCost, profit: r.profit,
                vatAmount: r.vatAmount, item: r.item, cashierId: r.cashierId,
                cashierName: r.cashierName, cashierRole: r.cashierRole,
                orderDate: r.reportDate instanceof Date ? r.reportDate.toISOString().slice(0,10) : String(r.reportDate || '').slice(0,10),
                createdAt: r.transactionAt instanceof Date ?
                    `${r.transactionAt.getFullYear()}-${String(r.transactionAt.getMonth()+1).padStart(2,'0')}-${String(r.transactionAt.getDate()).padStart(2,'0')} ${String(r.transactionAt.getHours()).padStart(2,'0')}:${String(r.transactionAt.getMinutes()).padStart(2,'0')}:${String(r.transactionAt.getSeconds()).padStart(2,'0')}` : String(r.transactionAt || ''),
            })),
            pagination: {page,pageSize,total,totalPages,hasPrevious:page>1,hasMore:page<totalPages},
            summary, paymentMethods: methods.map(m=>String(m.method)),
            taxRegistration, vatSummary,
            bookingIntegration: {
                available: bookingSchema.available,
                reason: bookingSchema.available ? null : bookingSchema.reason,
                costComplete: bookingSchema.available && missingCosts===0,
                revenueRecognition: 'Only COMPLETED/FULFILLED bookings with a fulfillment timestamp; booking payments are not added as sales.'
            }
        };
    }

    /**
     * Fetch one owner-visible transaction with its historical line items.
     * Read only. Uses the same walk-in / fulfilled-booking eligibility as the
     * owner report. Never fabricates item names, unit prices or invoice numbers.
     */
    async function getOwnerOrderDetail(db, storeId, body) {
        const orderId = String(body.order_id ?? body.orderId ?? '').trim();
        const source = String(body.sales_source ?? body.salesSource ?? '').trim().toUpperCase();
        if (!orderId || orderId.length > 100 || !['WALK_IN', 'BOOKING'].includes(source)) {
            const error = new Error('A valid Order ID and Sales Source are required.');
            error.statusCode = 400;
            throw error;
        }

        const bookingSchema = await detectBookingSchema(db);
        if (source === 'BOOKING' && !bookingSchema.available) {
            const error = new Error('Verified booking transaction details are unavailable.');
            error.statusCode = 404;
            throw error;
        }
        const query = source === 'BOOKING'
            ? bookingSql(bookingSchema, { storeId, exactOrderId: orderId })
            : posSql({
                storeId,
                orderColumns: await listColumns(db, 'orders'),
                bookingSchema,
                exactOrderId: orderId,
            });
        const [matchingRows] = await db.execute(
            `SELECT r.* FROM (${query.sql}) r LIMIT 2`, query.params
        );
        if (matchingRows.length !== 1) {
            const error = new Error(matchingRows.length > 1
                ? 'This order reference is not unique; details cannot be issued safely.'
                : 'The transaction was not found in this store.');
            error.statusCode = matchingRows.length > 1 ? 409 : 404;
            throw error;
        }
        const row = matchingRows[0];
        const [storeRows] = await db.execute(
            'SELECT store_name AS storeName FROM stores WHERE id = ? LIMIT 1',
            [storeId]
        );
        let items = [];
        let itemsAvailable = false;
        let detailNotice = null;

        if (source === 'WALK_IN') {
            // Use the immutable order_items snapshots, not current catalog prices.
            // Preserve missing prices as NULL rather than silently converting to 0.
            const [stored] = await db.execute(
                `SELECT product_name AS name, quantity, unit_price AS unitPrice,
                        line_total AS lineTotal
                 FROM order_items WHERE store_id = ? AND order_id = ?
                 ORDER BY id ASC LIMIT 501`,
                [storeId, orderId]
            );
            items = stored.slice(0, 500).map((line) => ({
                name: String(line.name || ''),
                quantity: Number(line.quantity),
                unitPrice: line.unitPrice == null ? null : Number(line.unitPrice),
                lineTotal: line.lineTotal == null ? null : Number(line.lineTotal),
            }));
            itemsAvailable = stored.length <= 500 && items.length > 0 && items.every((line) =>
                line.name.trim() && line.quantity > 0 &&
                line.unitPrice != null && Number.isFinite(line.unitPrice) &&
                line.lineTotal != null && Number.isFinite(line.lineTotal)
            );
            if (!itemsAvailable) {
                detailNotice = 'Historical POS item details are incomplete or unavailable.';
            }
        } else {
            // Only match booking item rows using a verifiable parent primary key.
            // Do not infer rental/package items or costs from today's inventory.
            const f = bookingSchema.fields;
            const parentColumns = await listColumns(db, bookingSchema.table);
            let bookingKey = null;
            if (parentColumns.has('id')) {
                const [parentRows] = await db.execute(
                    `SELECT id FROM ${id(bookingSchema.table)}
                     WHERE ${id(f.storeId)} = ? AND CAST(${id(f.reference)} AS CHAR) = ? LIMIT 2`,
                    [storeId, orderId]
                );
                if (parentRows.length === 1) bookingKey = parentRows[0].id;
            }
            if (bookingKey != null) {
                for (const table of ['booking_items', 'booking_order_items', 'booking_services']) {
                    const cols = await listColumns(db, table);
                    const fk = findColumn(cols, ['booking_id']);
                    const name = findColumn(cols, ['item_name', 'product_name', 'service_name', 'equipment_name', 'name', 'description']);
                    const qty = findColumn(cols, ['quantity', 'qty']);
                    const unitPrice = findColumn(cols, ['unit_price', 'price_per_unit', 'unit_amount', 'rate']);
                    const lineTotal = findColumn(cols, ['line_total', 'total_price', 'total_amount', 'amount']);
                    if (!fk || !name || !qty || (!unitPrice && !lineTotal)) continue;
                    const where = [`bi.${id(fk)} = ?`];
                    const args = [bookingKey];
                    if (cols.has('store_id')) { where.push('bi.store_id = ?'); args.push(storeId); }
                    const [lines] = await db.execute(
                        `SELECT ${id(name)} AS itemName, ${id(qty)} AS quantity,
                         ${expr('bi', unitPrice)} AS unitPrice,
                         ${expr('bi', lineTotal)} AS lineTotal
                         FROM ${id(table)} bi WHERE ${where.join(' AND ')} LIMIT 501`, args
                    );
                    if (!lines.length) continue;
                    if (lines.length > 500) {
                        detailNotice = 'Too many booking items to verify safely.';
                        break;
                    }
                    items = lines.map((line) => {
                        const quantity = Number(line.quantity);
                        const storedUnit = line.unitPrice == null ? null : Number(line.unitPrice);
                        const storedTotal = line.lineTotal == null ? null : Number(line.lineTotal);
                        const computedTotal = storedTotal ?? (storedUnit != null ? money(storedUnit * quantity) : null);
                        const computedUnit = storedUnit ?? (computedTotal != null && quantity > 0
                            ? money(computedTotal / quantity) : null);
                        return {
                            name: String(line.itemName || ''), quantity,
                            unitPrice: computedUnit, lineTotal: computedTotal,
                        };
                    });
                    itemsAvailable = items.length > 0 && items.every((line) =>
                        line.name.trim() && line.quantity > 0 &&
                        line.unitPrice != null && Number.isFinite(line.unitPrice) &&
                        line.lineTotal != null && Number.isFinite(line.lineTotal)
                    );
                    break;
                }
            }
            if (!itemsAvailable && !detailNotice) {
                detailNotice = 'Itemized booking products/services could not be verified from the existing booking records.';
            }
        }

        const valueOrNull = (value) => value == null || !Number.isFinite(Number(value))
            ? null : money(Number(value));
        const dateStr = (value) => value instanceof Date
            ? value.toISOString().replace('T', ' ').slice(0, 19) : String(value || '');
        return {
            orderId: String(row.orderId),
            storeName: String(storeRows[0]?.storeName || 'StockNBook Store'),
            branchName: String(row.branchName || ''),
            salesSource: source,
            customerName: String(row.customerName || 'Walk-in'),
            date: dateStr(row.reportDate).slice(0, 10),
            createdAt: dateStr(row.transactionAt),
            paymentMode: String(row.paymentMode || ''),
            taxType: row.taxType == null ? null : String(row.taxType),
            vatAmount: valueOrNull(row.vatAmount),
            total: valueOrNull(row.total),
            items,
            itemsAvailable,
            detailNotice,
            // These are order details for the owner, not a BIR-registered invoice.
            officialInvoiceNumber: null,
        };
    }

    getOwnerSalesReport.getOrderDetail = getOwnerOrderDetail;
    return getOwnerSalesReport;

})();

const POS_CASHIER_NAME_SQL = `(SELECT ea.employee_name FROM employee_actions ea
    WHERE ea.store_id = o.store_id AND ea.reference_id COLLATE utf8mb4_unicode_ci = o.order_id
      AND ea.action = 'Completed POS transaction'
    ORDER BY ea.id DESC LIMIT 1)`;
const POS_CASHIER_ROLE_SQL = `(SELECT ea.employee_role FROM employee_actions ea
    WHERE ea.store_id = o.store_id AND ea.reference_id COLLATE utf8mb4_unicode_ci = o.order_id
      AND ea.action = 'Completed POS transaction'
    ORDER BY ea.id DESC LIMIT 1)`;

// Older POS rows with a legacy -POS- Order ID remain visible. The SQL migration
// marks older INV-only sales as WALK_IN before dropping orders.control_number.
const POS_WALKIN_ORDER_FILTER_SQL = `(
    UPPER(TRIM(COALESCE(o.customer_type, ''))) = 'WALK_IN'
    OR o.order_id LIKE '%-POS-%'
)`;

// All POS sales are paid at checkout and stored in orders/order_items.
// Extra POS status and credit tables are not used by this module.
const POS_SALE_FILTER_SQL = `
    ${POS_WALKIN_ORDER_FILTER_SQL}
    AND UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')
`;

function normalizeDashboardNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildTopDashboardRows(rows, salesKey, unitsKey, limit = 8) {
    return rows
        .map((row) => ({
            key: `product:${String(row.name || "").trim().toLowerCase()}`,
            name: String(row.name || "Unnamed Product").trim() || "Unnamed Product",
            sales: normalizeDashboardNumber(row[salesKey]),
            units: normalizeDashboardNumber(row[unitsKey]),
        }))
        .filter((row) => row.sales > 0 || row.units > 0)
        .sort((a, b) => b.sales - a.sales)
        .slice(0, limit);
}

function monthStartFromISODate(value) {
    const date = toISODate(value);
    return date ? `${date.slice(0, 7)}-01` : null;
}

function nextMonthStartFromISODate(value) {
    const monthStart = monthStartFromISODate(value);
    if (!monthStart) return null;
    const [year, month] = monthStart.split("-").map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function addDaysToISODate(isoDate, days) {
    const parsed = new Date(`${isoDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime())) return null;
    parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
    return parsed.toISOString().slice(0, 10);
}

function normalizeAction(value) {
    return toSafeString(value, 80)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

function getOrderLines(body) {
    const items =
        body.items ||
        body.order_items ||
        body.orderItems ||
        body.cart ||
        body.cartItems;

    if (Array.isArray(items)) {
        return items;
    }

    if (
        body.product_id ||
        body.productId ||
        body.variant_id ||
        body.variantId ||
        body.item
    ) {
        return [body];
    }

    return [];
}

function getProductId(line) {
    return toPositiveInteger(
        line.product_id ??
        line.productId ??
        line.product?.id
    );
}

function getVariantId(line) {
    return toPositiveInteger(
        line.variant_id ??
        line.variantId ??
        line.product_variant_id ??
        line.productVariantId ??
        line.variant?.id
    );
}

function getProductName(line) {
    return toSafeString(
        line.product_name ??
        line.productName ??
        line.item_name ??
        line.product?.name ??
        line.name ??
        line.item ??
        "",
        150
    );
}

function getVariantName(line) {
    return toSafeString(
        line.variant_name ??
        line.variantName ??
        line.variant_label ??
        line.variantLabel ??
        line.variant ??
        line.option ??
        line.size ??
        "",
        150
    );
}

function formatOrderItems(items) {
    if (!Array.isArray(items)) {
        return "";
    }

    return items
        .map((line) => {
            const productName =
                getProductName(line) ||
                `Product #${getProductId(line) || ""}`;

            const variantName = getVariantName(line);

            const quantity =
                toPositiveInteger(line.quantity ?? line.qty) || 1;

            return `${productName}${variantName ? ` - ${variantName}` : ""} x${quantity}`;
        })
        .filter(Boolean)
        .join(", ");
}

function formatVariantValues(value) {
    if (!value) return "";

    let parsed = value;

    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return toSafeString(parsed, 150);
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "";
    }

    return Object.values(parsed)
        .map((entry) => toSafeString(entry, 80))
        .filter(Boolean)
        .join(" / ")
        .slice(0, 150);
}

async function getSellableBatchQuantity(
    connection,
    inventoryId,
    saleDate
) {
    const [rows] = await connection.execute(
        `SELECT COALESCE(SUM(remaining_quantity), 0) AS sellableQuantity
         FROM inventory_batches
         WHERE branch_inventory_id = ?
           AND remaining_quantity > 0
           AND status = 'active'
           AND (expiration_date IS NULL OR expiration_date >= ?)`,
        [inventoryId, saleDate]
    );

    return Math.max(0, Number(rows[0]?.sellableQuantity || 0));
}

async function resolveAuthoritativeOrderLines(
    connection,
    storeId,
    branchId,
    rawItems,
    saleDate
) {
    const resolved = [];

    for (const rawLine of rawItems) {
        const productId = getProductId(rawLine);
        const variantId = getVariantId(rawLine);
        const quantity = toPositiveInteger(rawLine.quantity ?? rawLine.qty);

        if (!productId) {
            throw new Error("Each POS item must include a valid product_id.");
        }

        if (!quantity) {
            throw new Error("Each POS item must include a valid quantity.");
        }

        let rows;

        if (variantId) {
            [rows] = await connection.execute(
                `SELECT
                     p.id AS productId,
                     p.name AS productName,
                     pv.id AS variantId,
                     pv.variant_values AS variantValues,
                     COALESCE(NULLIF(bi.sales_price, 0), NULLIF(pv.sales_price, 0), NULLIF(p.sales_price, 0), 0) AS salesPrice,
                     bi.id AS inventoryId,
                     bi.quantity_on_hand AS quantityOnHand
                 FROM products p
                          INNER JOIN product_variants pv
                                     ON pv.product_id = p.id
                                         AND pv.id = ?
                          LEFT JOIN branch_inventory bi
                                    ON bi.store_id = p.store_id
                                        AND bi.branch_id = p.branch_id
                                        AND bi.product_id = p.id
                                        AND bi.variant_id = pv.id
                                        AND bi.status = 'active'
                 WHERE p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?
                     LIMIT 1`,
                [variantId, productId, storeId, branchId]
            );
        } else {
            [rows] = await connection.execute(
                `SELECT
                     p.id AS productId,
                     p.name AS productName,
                     NULL AS variantId,
                     NULL AS variantValues,
                     COALESCE(NULLIF(bi.sales_price, 0), NULLIF(p.sales_price, 0), 0) AS salesPrice,
                     bi.id AS inventoryId,
                     bi.quantity_on_hand AS quantityOnHand
                 FROM products p
                          LEFT JOIN branch_inventory bi
                                    ON bi.store_id = p.store_id
                                        AND bi.branch_id = p.branch_id
                                        AND bi.product_id = p.id
                                        AND bi.variant_id IS NULL
                                        AND bi.status = 'active'
                 WHERE p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?
                     LIMIT 1`,
                [productId, storeId, branchId]
            );
        }

        if (!rows.length) {
            throw new Error(
                `Product ${productId}${variantId ? ` variant ${variantId}` : ""} is not available in this branch.`
            );
        }

        const row = rows[0];
        const inventoryId = toPositiveInteger(row.inventoryId);

        if (!inventoryId) {
            throw new Error(
                `Database V2 inventory is missing for ${row.productName || `product ${productId}`}. Run the V2 backfill/verification.`
            );
        }

        const quantityOnHand = Math.max(0, Number(row.quantityOnHand || 0));
        if (quantityOnHand < quantity) {
            throw new Error(
                `Not enough stock for ${row.productName || `product ${productId}`}. Available: ${quantityOnHand}, needed: ${quantity}.`
            );
        }

        const sellableQuantity = await getSellableBatchQuantity(
            connection,
            inventoryId,
            saleDate
        );

        if (sellableQuantity < quantity) {
            throw new Error(
                `Not enough non-expired stock for ${row.productName || `product ${productId}`}. Sellable: ${sellableQuantity}, needed: ${quantity}.`
            );
        }

        const unitPrice = roundMoney(row.salesPrice);
        const variantName = variantId
            ? formatVariantValues(row.variantValues) || getVariantName(rawLine) || `Variant #${variantId}`
            : "";

        resolved.push({
            product_id: productId,
            variant_id: variantId || null,
            product_name: toSafeString(row.productName, 150) || `Product #${productId}`,
            variant_name: variantName,
            quantity,
            unit_price: unitPrice,
            item_name: `${toSafeString(row.productName, 150) || `Product #${productId}`}${variantName ? `/${variantName}` : ""}`,
        });
    }

    return resolved;
}

async function ensureStoreExists(connection, storeId) {
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
        return false;
    }

    const [rows] = await connection.execute(
        "SELECT id FROM stores WHERE id = ? LIMIT 1",
        [parsedStoreId]
    );

    return rows.length > 0;
}

async function ensureBranchBelongsToStore(
    connection,
    branchId,
    storeId
) {
    const parsedBranchId = Number(branchId);
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) {
        return false;
    }

    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
        return false;
    }

    const [rows] = await connection.execute(
        "SELECT id FROM branches WHERE id = ? AND store_id = ? LIMIT 1",
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
}

async function insertOrderItems(
    connection,
    orderId,
    storeId,
    branchId,
    items
) {
    const dashboardItems = [];
    let totalCost = 0;

    for (const line of items) {
        const productId = getProductId(line);
        const variantId = getVariantId(line);
        const quantity = toPositiveInteger(line.quantity ?? line.qty);
        const productName = getProductName(line) || `Product #${productId || ""}`;
        const unitPrice =
            toNumber(
                line.unit_price ??
                line.unitPrice ??
                line.price ??
                line.sales_price ??
                line.salesPrice
            ) ?? 0;

        if (!productId) {
            throw new Error("Each POS item must include a valid product_id.");
        }
        if (!quantity) {
            throw new Error("Each POS item must include a valid quantity.");
        }

        let costPriceAtSale = 0;

        if (variantId) {
            const [costRows] = await connection.execute(
                `SELECT COALESCE(pv.original_price, p.original_price, 0) AS costPrice
                 FROM product_variants pv
                          INNER JOIN products p
                                     ON p.id = pv.product_id
                                         AND p.store_id = ?
                                         AND p.branch_id = ?
                 WHERE pv.id = ?
                   AND pv.product_id = ?
                     LIMIT 1`,
                [storeId, branchId, variantId, productId]
            );
            costPriceAtSale = roundMoney(costRows[0]?.costPrice ?? 0);
        } else {
            const [costRows] = await connection.execute(
                `SELECT COALESCE(original_price, 0) AS costPrice
                 FROM products
                 WHERE id = ? AND store_id = ? AND branch_id = ?
                     LIMIT 1`,
                [productId, storeId, branchId]
            );
            costPriceAtSale = roundMoney(costRows[0]?.costPrice ?? 0);
        }

        const lineTotal = roundMoney(unitPrice * quantity);

        await connection.execute(
            `INSERT INTO order_items
             (order_id, store_id, branch_id, product_id, variant_id, product_name,
              quantity, unit_price, line_total, cost_price_at_sale)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderId,
                storeId,
                branchId,
                productId,
                variantId || null,
                productName,
                quantity,
                unitPrice,
                lineTotal,
                costPriceAtSale,
            ]
        );

        const lineCost = roundMoney(costPriceAtSale * quantity);
        totalCost = roundMoney(totalCost + lineCost);
        dashboardItems.push({
            productId,
            productName,
            quantity,
            lineTotal,
        });
    }

    return {
        totalCost,
        items: dashboardItems,
    };
}


async function loadOrderItemsForOrders(connection, storeId, orderIds) {
    const safeOrderIds = Array.from(
        new Set(
            (Array.isArray(orderIds) ? orderIds : [])
                .map((value) => toSafeString(value, 100))
                .filter(Boolean)
        )
    );

    if (safeOrderIds.length === 0) {
        return new Map();
    }

    const byOrderId = new Map();

    /*
     * IMPORTANT:
     * Do not send thousands of order IDs in one huge IN (...) query.
     * MySQL may create large temporary files for that query and can fail
     * with OS errno 28: "No space left on device".
     *
     * Loading the items in small batches keeps the SQL statement and
     * MySQL temporary-file usage under control while preserving the
     * exact same result.
     */
    const CHUNK_SIZE = 200;

    for (
        let start = 0;
        start < safeOrderIds.length;
        start += CHUNK_SIZE
    ) {
        const chunk = safeOrderIds.slice(
            start,
            start + CHUNK_SIZE
        );

        const placeholders = chunk
            .map(() => "?")
            .join(",");

        const [rows] = await connection.execute(
            `SELECT
                 oi.order_id AS orderId,
                 oi.product_id AS productId,
                 oi.variant_id AS variantId,
                 oi.product_name AS name,
                 oi.quantity,
                 oi.unit_price AS unitPrice,
                 oi.line_total AS lineTotal,
                 COALESCE(
                         oi.cost_price_at_sale,
                         CASE
                             WHEN oi.variant_id IS NOT NULL
                                 THEN COALESCE(pv.original_price, p.original_price, 0)
                             ELSE COALESCE(p.original_price, 0)
                             END,
                         0
                 ) AS costPrice
             FROM order_items oi
                      LEFT JOIN products p
                                ON p.id = oi.product_id
                                    AND p.store_id = oi.store_id
                      LEFT JOIN product_variants pv
                                ON pv.id = oi.variant_id
                                    AND pv.product_id = oi.product_id
             WHERE oi.store_id = ?
               AND oi.order_id IN (${placeholders})
             ORDER BY oi.order_id ASC, oi.id ASC`,
            [storeId, ...chunk]
        );

        for (const row of rows) {
            const orderId = String(
                row.orderId || ""
            );

            if (!byOrderId.has(orderId)) {
                byOrderId.set(
                    orderId,
                    []
                );
            }

            byOrderId.get(orderId).push({
                productId:
                    row.productId == null
                        ? null
                        : Number(row.productId),

                variantId:
                    row.variantId == null
                        ? null
                        : Number(row.variantId),

                name: String(
                    row.name || ""
                ),

                quantity: Number(
                    row.quantity || 0
                ),

                unitPrice: Number(
                    row.unitPrice || 0
                ),

                lineTotal: Number(
                    row.lineTotal || 0
                ),

                costPrice: Number(
                    row.costPrice || 0
                ),
            });
        }
    }

    return byOrderId;
}


async function getV2InventoryForUpdate(connection, storeId, branchId, productId, variantId) {
    const [rows] = await connection.execute(
        `SELECT id, store_id, branch_id, product_id, variant_id,
                quantity_on_hand, cost_price
         FROM branch_inventory
         WHERE store_id = ?
           AND branch_id = ?
           AND product_id = ?
           AND variant_id <=> ?
           AND status = 'active'
         LIMIT 1
         FOR UPDATE`,
        [storeId, branchId, productId, variantId || null]
    );

    return rows[0] || null;
}

async function consumeV2Batches(connection, inventoryId, quantity, saleDate) {
    let remaining = Math.max(0, Number(quantity || 0));
    if (remaining <= 0) return;

    const [batches] = await connection.execute(
        `SELECT id, remaining_quantity
         FROM inventory_batches
         WHERE branch_inventory_id = ?
           AND remaining_quantity > 0
           AND status = 'active'
           AND (expiration_date IS NULL OR expiration_date >= ?)
         ORDER BY (expiration_date IS NULL) ASC,
                  expiration_date ASC,
                  received_at ASC,
                  id ASC
             FOR UPDATE`,
        [inventoryId, saleDate]
    );

    for (const batch of batches) {
        if (remaining <= 0) break;
        const available = Math.max(0, Number(batch.remaining_quantity || 0));
        const take = Math.min(available, remaining);
        if (take <= 0) continue;

        await connection.execute(
            `UPDATE inventory_batches
             SET remaining_quantity = remaining_quantity - ?,
                 status = CASE WHEN remaining_quantity - ? <= 0 THEN 'depleted' ELSE status END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [take, take, batch.id]
        );
        remaining -= take;
    }

    if (remaining > 0) {
        throw new Error(
            `Database V2 batch balance is short by ${remaining} unit(s) for inventory #${inventoryId}. ` +
            `Run the V2 verification/backfill before processing POS transactions.`
        );
    }
}

async function decreaseV2Inventory(connection, options) {
    const row = await getV2InventoryForUpdate(
        connection,
        options.storeId,
        options.branchId,
        options.productId,
        options.variantId
    );

    if (!row) {
        throw new Error(
            `Database V2 inventory row is missing for product ${options.productId}` +
            `${options.variantId ? ` variant ${options.variantId}` : ""}. Run the V2 backfill/verification.`
        );
    }

    const before = Number(row.quantity_on_hand || 0);
    const quantity = Math.max(0, Number(options.quantity || 0));

    if (before < quantity) {
        throw new Error(
            `Database V2 stock mismatch for product ${options.productId}. Available: ${before}, needed: ${quantity}.`
        );
    }

    const after = before - quantity;
    const saleDate =
        toISODate(options.saleDate) || getManilaISODate();

    await consumeV2Batches(
        connection,
        row.id,
        quantity,
        saleDate
    );

    await connection.execute(
        `UPDATE branch_inventory
         SET quantity_on_hand = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [after, row.id]
    );

    const actor = options.actor || { id: null, role: "SYSTEM", name: "StockNBook" };
    await connection.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, actor_id, actor_role, actor_name, notes)
         VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            options.storeId,
            options.branchId,
            row.id,
            -quantity,
            before,
            after,
            options.referenceType || "POS_ORDER",
            options.referenceId != null ? String(options.referenceId) : null,
            actor.id ?? null,
            actor.role || null,
            actor.name || null,
            options.notes || "POS inventory deduction during Database V2 dual-write.",
        ]
    );
}

async function decreaseStockForOrder(
    connection,
    storeId,
    branchId,
    items,
    movementContext = {}
) {
    for (const line of items) {
        const quantity =
            toPositiveInteger(line.quantity ?? line.qty) || 1;

        const productId = getProductId(line);
        const variantId = getVariantId(line);
        const productName = getProductName(line);

        if (!productId) {
            throw new Error(
                `Missing product_id for "${productName || "POS item"}".`
            );
        }

        if (variantId) {
            const [result] = await connection.execute(
                `UPDATE product_variants pv
                     INNER JOIN products p
                 ON p.id = pv.product_id
                     SET
                         pv.stock = pv.stock - ?,
                         p.stock = p.stock - ?
                 WHERE pv.id = ?
                   AND p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?
                   AND pv.stock >= ?
                   AND p.stock >= ?`,
                [
                    quantity,
                    quantity,
                    variantId,
                    productId,
                    storeId,
                    branchId,
                    quantity,
                    quantity,
                ]
            );

            if (result.affectedRows === 0) {
                throw new Error(
                    `Insufficient stock or invalid variant for "${productName}".`
                );
            }

            await decreaseV2Inventory(connection, {
                storeId,
                branchId,
                productId,
                variantId,
                quantity,
                saleDate: movementContext.saleDate,
                ...movementContext,
                notes: `POS sale: ${productName || `Product #${productId}`} (variant ${variantId}) x${quantity}`,
            });

            continue;
        }

        const [result] = await connection.execute(
            `UPDATE products
             SET stock = stock - ?
             WHERE id = ?
               AND store_id = ?
               AND branch_id = ?
               AND stock >= ?`,
            [
                quantity,
                productId,
                storeId,
                branchId,
                quantity,
            ]
        );

        if (result.affectedRows === 0) {
            throw new Error(
                `Insufficient stock or invalid product for "${productName || productId}".`
            );
        }

        await decreaseV2Inventory(connection, {
            storeId,
            branchId,
            productId,
            variantId: null,
            quantity,
            saleDate: movementContext.saleDate,
            ...movementContext,
            notes: `POS sale: ${productName || `Product #${productId}`} x${quantity}`,
        });
    }
}

/*
 * The JWT issued at login only carries ids (store_id / manager_id /
 * staff_id) and an email — never a display name. To log a real,
 * human-readable employee_actions row we look the acting user's name up
 * from their own table using the id that's already in the token.
 */
async function getActingEmployee(connection, decoded) {
    const role = String(decoded?.role || "").toLowerCase();
    const storeId = toPositiveInteger(decoded?.store_id);

    if (role === "manager" && toPositiveInteger(decoded?.manager_id)) {
        const [rows] = await connection.execute(
            `SELECT manager_name FROM managers WHERE id = ? AND store_id = ? LIMIT 1`,
            [toPositiveInteger(decoded.manager_id), storeId]
        );

        return {
            id: toPositiveInteger(decoded.manager_id),
            name: toSafeString(rows[0]?.manager_name, 255) || "Manager",
            role: "Manager",
        };
    }

    if (role === "staff" && toPositiveInteger(decoded?.staff_id)) {
        const [rows] = await connection.execute(
            `SELECT staff_name FROM staff WHERE id = ? AND store_id = ? LIMIT 1`,
            [toPositiveInteger(decoded.staff_id), storeId]
        );

        return {
            id: toPositiveInteger(decoded.staff_id),
            name: toSafeString(rows[0]?.staff_name, 255) || "Staff",
            role: "Staff",
        };
    }

    if (role === "owner" && storeId) {
        const [rows] = await connection.execute(
            `SELECT owner_name FROM stores WHERE id = ? LIMIT 1`,
            [storeId]
        );

        return {
            id: null,
            name: toSafeString(rows[0]?.owner_name, 255) || "Owner",
            role: "Owner",
        };
    }

    return { id: null, name: "Unknown", role: "Staff" };
}

/*
 * Writes one row to employee_actions. Callers decide whether this runs
 * inside the same DB transaction as the action it's logging (so the log
 * and the action succeed/fail together) or as a best-effort call after
 * the action already committed.
 */
async function logEmployeeAction(connection, entry) {
    await connection.execute(
        `INSERT INTO employee_actions
         (store_id, branch_id, employee_id, employee_name, employee_role,
          module, reference_number, action, reference_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.storeId,
            entry.branchId ?? null,
            entry.employee.id,
            entry.employee.name,
            entry.employee.role,
            entry.module,
            entry.referenceNumber ?? null,
            entry.action,
            entry.referenceId ?? null,
            entry.details ?? null,
        ]
    );
}

async function getStoreTaxType(connection, storeId, lock = false) {
    const [rows] = await connection.execute(
        `SELECT tax_registration AS taxRegistration FROM stores WHERE id = ? LIMIT 1${lock ? " FOR SHARE" : ""}`,
        [storeId]
    );

    if (rows.length === 0) {
        throw new Error("Store tax registration could not be determined.");
    }

    const registration = String(rows[0]?.taxRegistration || "").toUpperCase();

    if (registration === "NON_VAT" || registration === "NON_VAT_REGISTERED") {
        return "NON_VAT";
    }

    if (registration === "VAT_REGISTERED" || registration === "VAT") {
        return "VAT";
    }

    throw new Error(
        "Store tax registration is missing or invalid. Update the store tax profile before processing POS transactions."
    );
}

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "Content-Type, Authorization",
        "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",
        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    let body = {};

    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return badRequest(
            headers,
            "Invalid JSON body."
        );
    }

    const rawAction = toSafeString(
        body.action,
        80
    );

    const normalizedAction =
        normalizeAction(rawAction);

    const actionAliases = {
        place_order: "create_order",
        create_pos_order: "create_order",
        create_sale: "create_order",
        checkout: "create_order",

        deduct_stock: "decrease_stock",
        reduce_stock: "decrease_stock",
        update_stock: "decrease_stock",
        decrement_stock: "decrease_stock",

    };

    const action =
        actionAliases[normalizedAction] ||
        normalizedAction;

    let connection;

    try {
        connection = await dbPool.getConnection();

        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(
                headers,
                "No token provided."
            );
        }

        let storeId;
        let tokenBranchId = null;
        let tokenRole = "";
        let decodedToken = null;

        try {
            const token =
                authHeader.replace(/^Bearer\s+/i, "");

            const decoded =
                jwt.verify(token, JWT_SECRET);

            decodedToken = decoded;

            storeId =
                Number(decoded.store_id);

            tokenBranchId =
                decoded.branch_id
                    ? Number(decoded.branch_id)
                    : null;

            tokenRole =
                String(decoded.role || "")
                    .toLowerCase();
        } catch {
            return unauthorized(
                headers,
                "Invalid token."
            );
        }

        if (
            !Number.isInteger(storeId) ||
            storeId <= 0
        ) {
            return unauthorized(
                headers,
                "Invalid store in token."
            );
        }

        const storeExists =
            await ensureStoreExists(
                connection,
                storeId
            );

        if (!storeExists) {
            return badRequest(
                headers,
                "Store account not found."
            );
        }

        const isBranchUser =
            tokenRole === "manager" ||
            tokenRole === "staff";

        // Full/Read-only POS access comes from the current active employee row.
        // Manager defaults only apply to legacy records missing a POS permission;
        // an explicit 'none' or 'view' always wins.
        if (!["owner", "manager", "staff"].includes(tokenRole)) {
            return jsonResponse(403, headers, { error: "Business account role required." });
        }
        const posAccess = await getOperationalAccess(connection, decodedToken, "pos");
        if (posAccess === "none") {
            return jsonResponse(403, headers, { error: "POS access is not permitted for this account." });
        }
        const posReadActions = new Set([
            "get_orders", "get_owner_dashboard_summary", "get_owner_sales_report", "get_owner_order_detail", "get_tax_registration",
        ]);
        if (posAccess !== "full" && !posReadActions.has(action)) {
            return jsonResponse(403, headers, { error: "Full POS access is required for this action." });
        }

        const requestedBranchId =
            toPositiveInteger(
                body.branch_id ??
                body.branchId
            );

        if (
            tokenRole === "owner" &&
            requestedBranchId
        ) {
            const ownerBranchExists =
                await ensureBranchBelongsToStore(
                    connection,
                    requestedBranchId,
                    storeId
                );

            if (!ownerBranchExists) {
                return badRequest(
                    headers,
                    "Invalid branch for this store."
                );
            }
        }

        if (isBranchUser) {
            if (
                !Number.isInteger(tokenBranchId) ||
                tokenBranchId <= 0
            ) {
                return badRequest(
                    headers,
                    "Missing branch_id in token for this user."
                );
            }

            const branchExists =
                await ensureBranchBelongsToStore(
                    connection,
                    tokenBranchId,
                    storeId
                );

            if (!branchExists) {
                return badRequest(
                    headers,
                    "Invalid branch for this store."
                );
            }
        }

        if (action === "get_tax_registration") {
            const taxType = await getStoreTaxType(connection, storeId);
            return jsonResponse(200, headers, {
                success: true,
                taxType,
                taxRegistration: taxType === "VAT" ? "VAT_REGISTERED" : "NON_VAT",
            });
        }

        if (action === "create_order") {
            // Order IDs are generated by the server (STORE-BRANCH-MMDDYY-XXXX).
            // Any order_id sent by the browser is ignored.
            const paymentMode =
                toSafeString(body.payment_mode, 20).toUpperCase() || "CASH";
            const orderDate =
                toISODate(body.order_date) || getManilaISODate();
            const rawOrderLines = getOrderLines(body);
            const customerPayment = roundMoney(
                toNumber(body.customer_payment) ?? 0
            );

            if (tokenRole !== "staff" || !tokenBranchId) {
                return jsonResponse(403, headers, { error: "Only assigned Staff can create POS transactions." });
            }

            if (rawOrderLines.length === 0) {
                return badRequest(headers, "At least one POS item is required.");
            }

            if (!["CASH", "GCASH", "BANK_TRANSFER"].includes(paymentMode)) {
                return badRequest(headers, "Invalid payment mode.");
            }

            // This checkout accepts walk-in sales only. Customer names, addresses,
            // no personal customer information or deferred payments are collected.
            if (customerPayment < 0) {
                return badRequest(headers, "Customer payment cannot be negative.");
            }

            // Creates the sequence table/columns if the migration has not run yet.
            // Must run before the transaction (MySQL DDL commits implicitly).
            if (!(await identifiers.ensureIdentifierSchema(connection))) {
                throw new Error("Order ID numbering is not set up. Run scripts/standardize-identifiers.js.");
            }

            let orderId = "";
            const MAX_ORDER_ID_ATTEMPTS = 5;

            for (
                let attempt = 0;
                attempt < MAX_ORDER_ID_ATTEMPTS;
                attempt += 1
            ) {
                await connection.beginTransaction();

                try {
                    // Reserved inside this transaction from a locked per-branch, per-day
                    // sequence. A rollback releases nothing that another sale could reuse.
                    orderId = await identifiers.generateOrderId(connection, {
                        storeId,
                        branchId: tokenBranchId,
                        orderDate,
                    });

                    // Lock tax registration for the sale; owner edits wait until checkout commits.
                    const taxType = await getStoreTaxType(connection, storeId, true);
                    /*
                     * Product IDs and quantities come from the browser, but all
                     * prices, stock, tenant/branch ownership, and sellable batch
                     * availability are re-read from the database. This keeps the
                     * database authoritative and prevents client-side price edits.
                     */
                    const orderLines = await resolveAuthoritativeOrderLines(
                        connection,
                        storeId,
                        tokenBranchId,
                        rawOrderLines,
                        orderDate
                    );

                    const total = roundMoney(
                        orderLines.reduce(
                            (sum, line) =>
                                sum + Number(line.unit_price || 0) * Number(line.quantity || 0),
                            0
                        )
                    );

                    if (["GCASH", "BANK_TRANSFER"].includes(paymentMode) && customerPayment !== total) {
                        await connection.rollback();
                        return badRequest(headers, "GCash and bank-transfer amounts must equal the POS order total.");
                    }

                    if (paymentMode === "CASH" && customerPayment < total) {
                        await connection.rollback();
                        return badRequest(
                            headers,
                            "Cash payment must be equal to or greater than the order total."
                        );
                    }

                    // total is the VAT-INCLUSIVE GRAND TOTAL, not a pre-tax subtotal.
                    // Never add the VAT amount on top of total a second time.
                    // NON_VAT stores retain the full sales amount as total with 0 VAT.
                    const vatableSales =
                        taxType === "VAT" ? roundMoney(total / 1.12) : 0;
                    const vatAmount =
                        taxType === "VAT" ? roundMoney(total - vatableSales) : 0;
                    const changeDue =
                        paymentMode === "CASH"
                            ? roundMoney(customerPayment - total)
                            : 0;
                    const item = toSafeString(
                        formatOrderItems(orderLines),
                        255
                    );
                    // Record the cashier once when creating the sales header.
                    const actingEmployee = await getActingEmployee(
                        connection,
                        decodedToken
                    );

                    // One completed sales header and itemized product lines.
                    // Record checkout in the shared employee_actions audit log.
                    await connection.execute(
                        `INSERT INTO orders
                         (
                             order_id, store_id, branch_id,
                             cashier_id, customer_type, payment_mode, tax_type,
                             vatable_sales, vat_amount, customer_payment, change_due,
                             item, total, order_date
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            orderId,
                            storeId,
                            tokenBranchId,
                            actingEmployee.id,
                            "WALK_IN",
                            paymentMode,
                            taxType,
                            vatableSales,
                            vatAmount,
                            customerPayment,
                            changeDue,
                            item,
                            total,
                            orderDate,
                        ]
                    );

                    const orderItemSummary = await insertOrderItems(
                        connection,
                        orderId,
                        storeId,
                        tokenBranchId,
                        orderLines
                    );

                    await decreaseStockForOrder(
                        connection,
                        storeId,
                        tokenBranchId,
                        orderLines,
                        {
                            referenceType: "POS_ORDER",
                            referenceId: orderId,
                            actor: actingEmployee,
                            saleDate: orderDate,
                        }
                    );

                    await logEmployeeAction(connection, {
                        storeId,
                        branchId: tokenBranchId,
                        employee: actingEmployee,
                        module: "Sales / POS",
                        referenceNumber: orderId,
                        action: "Completed POS transaction",
                        referenceId: orderId,
                        details: `${item} — Grand Total ₱${total} — ${paymentMode} — ${taxType} — VATable ₱${vatableSales} — VAT ₱${vatAmount}`,
                    });

                    await connection.commit();

                    const [rows] = await connection.execute(
                        `SELECT
                             o.order_id AS orderId,
                             o.store_id AS storeId,
                             o.branch_id AS branchId,
                             COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branchName,
                             COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branch,
                             'Walk-in' AS customerName,
                             o.customer_type AS customerType,
                             NULL AS customerAddress,
                             NULL AS customerContactNumber,
                             o.payment_mode AS paymentMode,
                             NULL AS creditTerm,
                             NULL AS creditDueDate,
                             'PAID' AS collectionStatus,
                             o.tax_type AS taxType,
                             o.vatable_sales AS vatableSales,
                             o.vat_amount AS vatAmount,
                             o.customer_payment AS customerPayment,
                             o.customer_payment AS totalPaid,
                             GREATEST(0, o.total - o.customer_payment) AS balance,
                             o.change_due AS changeDue,
                             o.cashier_id AS cashierId,
                             NULL AS cashierName,
                             NULL AS cashierRole,
                             o.item,
                             o.total,
                             o.total AS grandTotal,
                             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                             DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
                         FROM orders o
                                  LEFT JOIN branches b
                                            ON b.id = o.branch_id
                                                AND b.store_id = o.store_id
                         WHERE o.order_id = ? AND o.store_id = ?
                             LIMIT 1`,
                        [orderId, storeId]
                    );

                    const orderItemsById = await loadOrderItemsForOrders(
                        connection,
                        storeId,
                        [orderId]
                    );

                    return jsonResponse(201, headers, {
                        success: true,
                        order: {
                            ...rows[0],
                            cashierName: actingEmployee.name,
                            cashierRole: actingEmployee.role,
                            orderItems:
                                orderItemsById.get(String(orderId)) || [],
                        },
                    });
                } catch (error) {
                    await connection.rollback();

                    if (
                        error?.code === "ER_DUP_ENTRY" &&
                        attempt < MAX_ORDER_ID_ATTEMPTS - 1
                    ) {
                        // The next attempt reserves a fresh Order ID in its own transaction.
                        continue;
                    }

                    throw error;
                }
            }

            throw new Error(
                "Unable to generate a unique POS Order ID."
            );
        }

        if (action === "decrease_stock") {
            const orderLines =
                getOrderLines(body);

            if (orderLines.length === 0) {
                return badRequest(
                    headers,
                    "No items found for stock update."
                );
            }

            if (!isBranchUser || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager or Staff branch can update POS stock."
                );
            }

            await connection.beginTransaction();

            try {
                const actingEmployee = await getActingEmployee(
                    connection,
                    decodedToken
                );

                await decreaseStockForOrder(
                    connection,
                    storeId,
                    tokenBranchId,
                    orderLines,
                    {
                        referenceType: "POS_STOCK_UPDATE",
                        referenceId: body.order_id || body.orderId || body.reference_id || null,
                        actor: actingEmployee,
                    }
                );

                await connection.commit();

                return jsonResponse(
                    200,
                    headers,
                    {
                        success: true,
                    }
                );
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        if (action === "get_owner_order_detail") {
            if (tokenRole !== "owner") {
                return jsonResponse(403, headers, { error: "Only the store owner may view owner order details." });
            }
            try {
                const detail = await getOwnerSalesReport.getOrderDetail(connection, storeId, body);
                return jsonResponse(200, headers, { success: true, detail });
            } catch (error) {
                if ([400, 404, 409].includes(error?.statusCode)) {
                    return jsonResponse(error.statusCode, headers, { error: error.message });
                }
                throw error;
            }
        }

        if (action === "get_owner_sales_report") {
            if (tokenRole !== "owner") {
                return jsonResponse(403, headers, { error: "Only the store owner may access consolidated revenue." });
            }
            try {
                const report = await getOwnerSalesReport(connection, storeId, requestedBranchId, body);
                return jsonResponse(200, headers, { success: true, ...report });
            } catch (error) {
                if (error?.statusCode === 400) return badRequest(headers, error.message);
                throw error;
            }
        }

        if (action === "get_owner_dashboard_summary") {
            if (tokenRole !== "owner") {
                return jsonResponse(403, headers, {
                    error: "Only the store owner can load the owner dashboard summary.",
                });
            }

            const requestedDateTo =
                toISODate(
                    body.date_to ??
                    body.dateTo ??
                    body.end_date ??
                    body.endDate
                ) || getManilaISODate();

            const requestedDateFrom =
                toISODate(
                    body.date_from ??
                    body.dateFrom ??
                    body.start_date ??
                    body.startDate
                ) || shiftMonthStartISO(requestedDateTo, 12);

            if (requestedDateFrom > requestedDateTo) {
                return badRequest(
                    headers,
                    "date_from cannot be later than date_to."
                );
            }

            const periodStarts =
                getOwnerDashboardPeriodStarts(requestedDateTo);

            const requestStartedAt = Date.now();
            const timings = {};

            /*
             * Dashboard-only POS summary.
             *
             * The former Owner dashboard called get_orders with order items for
             * roughly 13 months. That forced the API to build thousands of full
             * transaction objects, run per-order financial joins, serialize a
             * very large JSON payload, and make React aggregate it again.
             *
             * These queries return only the aggregates the Owner dashboard uses:
             * daily sales/cost, branch totals for the current periods, and top
             * product totals. The normal get_orders action remains untouched for
             * the Sales/POS screens that actually need detailed transactions.
             */
            const dailyStartedAt = Date.now();
            const [dailyRows] = await connection.execute(
                `SELECT
                     DATE_FORMAT(costed.order_date, '%Y-%m-%d') AS date,
                     SUM(costed.sales) AS sales,
                     SUM(costed.cost) AS cost
                 FROM (
                     SELECT
                     o.order_id,
                     o.order_date,
                     o.total AS sales,
                     COALESCE(SUM(COALESCE(oi.cost_price_at_sale,0) * COALESCE(oi.quantity,0)),0) AS cost
                     FROM orders o
                     LEFT JOIN order_items oi
                     ON oi.order_id = o.order_id
                     AND oi.store_id = o.store_id
                     WHERE o.store_id = ?
                     AND o.order_date >= ?
                     AND o.order_date <= ?
                     AND ${POS_SALE_FILTER_SQL}
                     GROUP BY
                     o.order_id,
                     o.order_date,
                     o.total
                     ) AS costed
                 GROUP BY costed.order_date
                 ORDER BY costed.order_date ASC`,
                [storeId, requestedDateFrom, requestedDateTo]
            );
            timings.daily = Date.now() - dailyStartedAt;

            const branchStartedAt = Date.now();
            const [branchRows] = await connection.execute(
                `SELECT
                     o.branch_id AS branchId,
                     COALESCE(
                             NULLIF(TRIM(b.branch_name), ''),
                             CONCAT('Branch ', o.branch_id),
                             'Unassigned'
                     ) AS name,
                     SUM(CASE WHEN o.order_date >= ? THEN o.total ELSE 0 END) AS monthSales,
                     SUM(CASE WHEN o.order_date >= ? THEN o.total ELSE 0 END) AS quarterSales,
                     SUM(CASE WHEN o.order_date >= ? THEN o.total ELSE 0 END) AS yearSales
                 FROM orders o
                          LEFT JOIN branches b
                                    ON b.id = o.branch_id
                                        AND b.store_id = o.store_id
                 WHERE o.store_id = ?
                   AND o.order_date >= ?
                   AND o.order_date <= ?
                   AND ${POS_SALE_FILTER_SQL}
                 GROUP BY o.branch_id, b.branch_name`,
                [
                    periodStarts.month,
                    periodStarts.quarter,
                    periodStarts.year,
                    storeId,
                    periodStarts.year,
                    requestedDateTo,
                ]
            );
            timings.branches = Date.now() - branchStartedAt;

            const productsStartedAt = Date.now();
            const [productRows] = await connection.execute(
                `SELECT
                     oi.product_name AS name,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.line_total ELSE 0 END) AS monthSales,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.quantity ELSE 0 END) AS monthUnits,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.line_total ELSE 0 END) AS quarterSales,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.quantity ELSE 0 END) AS quarterUnits,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.line_total ELSE 0 END) AS yearSales,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.quantity ELSE 0 END) AS yearUnits
                 FROM order_items oi
                          INNER JOIN orders o
                                     ON o.order_id = oi.order_id
                                         AND o.store_id = oi.store_id
                 WHERE o.store_id = ?
                   AND o.order_date >= ?
                   AND o.order_date <= ?
                   AND ${POS_SALE_FILTER_SQL}
                 GROUP BY oi.product_name`,
                [
                    periodStarts.month,
                    periodStarts.month,
                    periodStarts.quarter,
                    periodStarts.quarter,
                    periodStarts.year,
                    periodStarts.year,
                    storeId,
                    periodStarts.year,
                    requestedDateTo,
                ]
            );
            timings.products = Date.now() - productsStartedAt;

            const normalizedBranches = branchRows.map((row) => ({
                key:
                    row.branchId === null || row.branchId === undefined
                        ? "unassigned"
                        : String(row.branchId),
                name: String(row.name || "Unassigned"),
                month: normalizeDashboardNumber(row.monthSales),
                quarter: normalizeDashboardNumber(row.quarterSales),
                year: normalizeDashboardNumber(row.yearSales),
            }));

            const branchPerformance = {
                month: normalizedBranches
                    .map((row) => ({
                        key: row.key,
                        name: row.name,
                        amount: row.month,
                    }))
                    .filter((row) => row.amount > 0)
                    .sort((a, b) => b.amount - a.amount),
                quarter: normalizedBranches
                    .map((row) => ({
                        key: row.key,
                        name: row.name,
                        amount: row.quarter,
                    }))
                    .filter((row) => row.amount > 0)
                    .sort((a, b) => b.amount - a.amount),
                year: normalizedBranches
                    .map((row) => ({
                        key: row.key,
                        name: row.name,
                        amount: row.year,
                    }))
                    .filter((row) => row.amount > 0)
                    .sort((a, b) => b.amount - a.amount),
            };

            const summary = {
                dateRange: {
                    startDate: requestedDateFrom,
                    endDate: requestedDateTo,
                },
                daily: dailyRows.map((row) => ({
                    date: String(row.date || ""),
                    sales: normalizeDashboardNumber(row.sales),
                    cost: normalizeDashboardNumber(row.cost),
                })),
                branchPerformance,
                topProducts: {
                    month: buildTopDashboardRows(
                        productRows,
                        "monthSales",
                        "monthUnits"
                    ),
                    quarter: buildTopDashboardRows(
                        productRows,
                        "quarterSales",
                        "quarterUnits"
                    ),
                    year: buildTopDashboardRows(
                        productRows,
                        "yearSales",
                        "yearUnits"
                    ),
                },
            };

            timings.total = Date.now() - requestStartedAt;

            console.info("Owner POS dashboard summary timings:", {
                mode: "live_fallback",
                storeId,
                dateFrom: requestedDateFrom,
                dateTo: requestedDateTo,
                ...timings,
                dailyRows: summary.daily.length,
                productGroups: productRows.length,
            });

            return jsonResponse(200, headers, {
                success: true,
                summary,
                meta: {
                    mode: "live_fallback",
                    queryTimingsMs: timings,
                },
            });
        }

        if (action === "get_orders") {
            const dateFrom = toISODate(body.date_from ?? body.dateFrom ?? body.start_date ?? body.startDate);
            const dateTo = toISODate(body.date_to ?? body.dateTo ?? body.end_date ?? body.endDate);
            if (dateFrom && dateTo && dateFrom > dateTo) {
                return badRequest(headers, "date_from cannot be later than date_to.");
            }
            // Exclude historical credit rows; POS only supports immediate payments.
            const where = ["o.store_id = ?", POS_WALKIN_ORDER_FILTER_SQL,
                "UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')"];
            const params = [storeId];
            if (isBranchUser) {
                where.push("o.branch_id = ?");
                params.push(tokenBranchId);
            } else if (requestedBranchId) {
                where.push("o.branch_id = ?");
                params.push(requestedBranchId);
            }
            if (dateFrom) { where.push("o.order_date >= ?"); params.push(dateFrom); }
            if (dateTo) { where.push("o.order_date <= ?"); params.push(dateTo); }
            const search = toSafeString(body.search ?? body.query ?? body.order_search ?? body.orderSearch, 120);
            if (search) {
                where.push("o.order_id LIKE ?");
                params.push(`%${search}%`);
            }
            const whereSql = where.join(' AND ');
            const includeFinancials = tokenRole === 'owner';
            const paginate = body.paginate === true || includeFinancials;
            const page = Math.max(1, toPositiveInteger(body.page) || 1);
            const pageSize = paginate ? Math.min(100, Math.max(10, toPositiveInteger(body.page_size ?? body.pageSize) || 50)) : null;
            const offset = paginate ? (page - 1) * pageSize : 0;

            // Cost & profit are only visible to Owner; cost snapshot is stored in order_items.
            const metrics = includeFinancials ? `
                COALESCE(item_cost.cost, 0) AS totalCost,
                (o.total - COALESCE(o.vat_amount, 0) - COALESCE(item_cost.cost, 0)) AS profit,`
                : 'NULL AS totalCost, NULL AS profit,';
            const joinMetrics = includeFinancials ? `LEFT JOIN (
                SELECT store_id, order_id,
                    SUM(COALESCE(cost_price_at_sale,0) * quantity) AS cost
                FROM order_items GROUP BY store_id, order_id
            ) AS item_cost ON item_cost.order_id = o.order_id AND item_cost.store_id = o.store_id` : '';
            let query = `SELECT
                             o.order_id AS orderId, o.store_id AS storeId, o.branch_id AS branchId,
                             COALESCE(NULLIF(TRIM(b.branch_name),''), CONCAT('Branch ', o.branch_id)) AS branchName,
                             'Walk-in' AS customerName,
                             o.customer_type AS customerType, o.payment_mode AS paymentMode,
                             o.tax_type AS taxType, o.vatable_sales AS vatableSales,
                             o.vat_amount AS vatAmount, o.customer_payment AS customerPayment,
                             o.customer_payment AS totalPaid, GREATEST(0,o.total-COALESCE(o.customer_payment,0)) AS balance,
                             'PAID' AS collectionStatus, o.change_due AS changeDue,
                             o.cashier_id AS cashierId,
                             ${POS_CASHIER_NAME_SQL} AS cashierName,
                             ${POS_CASHIER_ROLE_SQL} AS cashierRole,
                             o.item, o.total, o.total AS grandTotal,
                             CASE WHEN UPPER(o.tax_type)='VAT' THEN 'VAT_REGISTERED' ELSE 'NON_VAT' END AS taxRegistration,
                             ${metrics}
                                 DATE_FORMAT(o.order_date,'%Y-%m-%d') AS orderDate,
                             DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
                         FROM orders o
                                  LEFT JOIN branches b ON b.id=o.branch_id AND b.store_id=o.store_id
                             ${joinMetrics}
                         WHERE ${whereSql}
                         ORDER BY o.created_at DESC, o.order_id DESC`;
            if (paginate) query += ` LIMIT ${pageSize} OFFSET ${offset}`;
            const [rows] = await connection.execute(query, params);
            const includeItems = body.include_order_items === true || body.includeOrderItems === true || isBranchUser;
            let orders = rows;
            if (includeItems && rows.length) {
                const byId = await loadOrderItemsForOrders(connection, storeId, rows.map(r => r.orderId));
                orders = rows.map(r => ({...r, orderItems: byId.get(String(r.orderId)) || []}));
            }
            let pagination = null;
            if (paginate) {
                const [[count]] = await connection.execute(`SELECT COUNT(*) AS total FROM orders o WHERE ${whereSql}`,params);
                const total = Number(count.total || 0), totalPages = Math.max(1,Math.ceil(total/pageSize));
                pagination = {page,pageSize,total,totalPages,hasPrevious:page>1,hasMore:page<totalPages};
            }
            let summary = null;
            if (tokenRole === 'manager') {
                // Server-scoped totals for all matching branch transactions,
                // not just the 50 rows on the current page. Never expose cost.
                const [[totals]] = await connection.execute(`SELECT
                                                                 COUNT(*) AS transactions,
                                                                 COALESCE(SUM(o.total), 0) AS sales,
                                                                 COALESCE(SUM(o.vat_amount), 0) AS vat
                                                             FROM orders o WHERE ${whereSql} AND ${POS_SALE_FILTER_SQL}`, params);
                summary = {
                    transactions: Number(totals.transactions || 0),
                    sales: roundMoney(totals.sales),
                    vat: roundMoney(totals.vat),
                };
            }
            if (includeFinancials) {
                const [[totals]] = await connection.execute(`SELECT
                                                                 COUNT(*) AS transactions, COALESCE(SUM(o.total),0) AS sales,
                                                                 COALESCE(SUM(COALESCE(c.cost,0)),0) AS cost,
                                                                 COALESCE(SUM(o.total-COALESCE(o.vat_amount,0)-COALESCE(c.cost,0)),0) AS profit
                                                             FROM orders o LEFT JOIN (
                                                                 SELECT store_id,order_id,SUM(COALESCE(cost_price_at_sale,0)*quantity) AS cost
                                                                 FROM order_items GROUP BY store_id,order_id
                                                             ) c ON c.order_id=o.order_id AND c.store_id=o.store_id
                                                             WHERE ${whereSql} AND ${POS_SALE_FILTER_SQL}`,params);
                summary = {transactions:Number(totals.transactions||0),sales:roundMoney(totals.sales),
                    cost:roundMoney(totals.cost), profit:roundMoney(totals.profit)};
            }
            const taxType = await getStoreTaxType(connection,storeId);
            return jsonResponse(200,headers,{success:true,orders,pagination,summary,
                taxType,taxRegistration:taxType==='VAT'?'VAT_REGISTERED':'NON_VAT'});
        }

        if (action === "update_tax_registration") {
            if (tokenRole !== "owner") {
                return badRequest(headers, "Only the Owner can change business tax registration.");
            }

            const registration =
                toSafeString(body.tax_registration ?? body.taxRegistration, 30).toUpperCase();

            if (!["VAT_REGISTERED", "NON_VAT"].includes(registration)) {
                return badRequest(headers, "Invalid tax registration.");
            }

            // Commit the owner setting and audit trail together. A concurrent
            // sale locks the store record while taking its tax snapshot.
            await connection.beginTransaction();
            try {
                await connection.execute(
                    `UPDATE stores SET tax_registration = ? WHERE id = ?`,
                    [registration, storeId]
                );
                const actingEmployee = await getActingEmployee(connection, decodedToken);
                await logEmployeeAction(connection, {
                    storeId,
                    branchId: null,
                    employee: actingEmployee,
                    module: "Sales / POS",
                    referenceNumber: null,
                    action: "Updated business tax registration",
                    referenceId: String(storeId),
                    details: registration,
                });
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            }

            return jsonResponse(200, headers, {
                success: true,
                taxRegistration: registration,
                taxType: registration === "NON_VAT" ? "NON_VAT" : "VAT",
            });
        }

        if (["check_customer_credit", "record_collection", "get_collection_history"].includes(action)) {
            return badRequest(headers, "Customer credit is not supported by StockNBook POS.");
        }

        // Unsupported operations, including legacy transaction mutations,
        // are rejected here. Completed POS sales are read-only.
        return badRequest(
            headers,
            "Invalid action."
        );
    } catch (error) {
        return serverError(
            headers,
            error
        );
    } finally {
        if (connection) {
            connection.release();
        }
    }
};