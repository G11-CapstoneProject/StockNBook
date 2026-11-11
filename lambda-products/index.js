/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const fs = require("fs");
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
    /* saved in branches.branch_code when the branch is created and      */
    /* never change afterwards, even if the branch is renamed.            */
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
    /* Codes and sequences (stocknbook_v2)                                 */
    /* Store and branch initials are stored in stores.store_code and       */
    /* branches.branch_code. Sequences are derived from the identifiers    */
    /* already saved; a row lock on the branch serializes allocation and   */
    /* the unique keys on each identifier column reject any duplicate.     */
    /* ------------------------------------------------------------------ */

    // stocknbook_v2 already contains every column these identifiers use.
    async function ensureIdentifierSchema() {
        return true;
    }

    async function lockBranch(connection, storeId, branchId) {
        const [rows] = await connection.execute(
            "SELECT id FROM branches WHERE id = ? AND store_id = ? FOR UPDATE",
            [branchId, storeId]
        );
        if (!rows.length) throw new Error("The branch does not belong to this store.");
    }

    async function getIdentifierCodes(connection, storeId, branchId) {
        const [rows] = await connection.execute(
            `SELECT s.store_code AS storeCode, b.branch_code AS branchCode
             FROM branches b
                      JOIN stores s ON s.id = b.store_id
             WHERE b.id = ? AND b.store_id = ?
                 LIMIT 1`,
            [branchId, storeId]
        );
        if (!rows.length) throw new Error("The branch does not belong to this store.");
        const storeCode = String(rows[0].storeCode || "").trim().toUpperCase();
        const branchCode = String(rows[0].branchCode || "").trim().toUpperCase();
        assertCodes(storeCode, branchCode);
        return { storeCode, branchCode };
    }

    // stores.store_code for a newly registered store (unique across StockNBook).
    async function allocateStoreCode(connection, storeName, slug) {
        const [rows] = await connection.execute("SELECT store_code AS code FROM stores");
        const used = new Set(rows.map((row) => String(row.code || "").toUpperCase()));
        const code = storeCodeCandidates(storeName, slug, "").find(
            (candidate) => CODE_PATTERN.test(candidate) && !used.has(candidate)
        );
        if (!code) throw new Error("Unable to allocate a unique store code.");
        return code;
    }

    // branches.branch_code for a new branch (unique within its store).
    async function allocateBranchCode(connection, storeId, branchName) {
        const [rows] = await connection.execute(
            "SELECT branch_code AS code FROM branches WHERE store_id = ?",
            [storeId]
        );
        const used = new Set(rows.map((row) => String(row.code || "").toUpperCase()));
        const code = branchCodeCandidates(branchName).find(
            (candidate) => CODE_PATTERN.test(candidate) && !used.has(candidate)
        );
        if (!code) throw new Error("Unable to allocate unique branch initials.");
        return code;
    }

    async function maxSequenceFrom(connection, sql, params, pattern) {
        const [rows] = await connection.execute(sql, params);
        return rows.reduce((max, row) => {
            const value = String(row.value || "");
            return pattern && !pattern.test(value) ? max : Math.max(max, trailingSequence(value));
        }, 0);
    }

    /*
     * Reserves `count` consecutive numbers after `floor` (the highest number already
     * stored). Callers lock the branch row first so concurrent requests inside a
     * transaction are serialized; the unique keys still reject any duplicate.
     */
    async function reserveSequenceBlock(connection, { storeId, branchId, count = 1, floor = 0 }) {
        const size = Number(count);
        if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid identification sequence request.");
        await lockBranch(connection, storeId, branchId);
        const first = (Number(floor) || 0) + 1;
        return { first, last: first + size - 1 };
    }

    async function generateOrderId(connection, { storeId, branchId, orderDate }) {
        await lockBranch(connection, storeId, branchId);
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const datePart = orderDatePart(orderDate);
        const prefix = `${storeCode}-${branchCode}-${datePart}-`;
        const floor = await maxSequenceFrom(connection,
            "SELECT order_number AS value FROM orders WHERE store_id = ? AND order_number LIKE ?",
            [storeId, `${prefix}%`], PATTERNS.order);
        const { last } = await reserveSequenceBlock(connection, { storeId, branchId, floor });
        return buildOrderId(storeCode, branchCode, orderDate, last);
    }

    // Managers and staff share ONE sequence per branch, so their IDs never overlap.
    async function generateEmployeeCode(connection, { storeId, branchId }) {
        await lockBranch(connection, storeId, branchId);
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const prefix = `${storeCode}-${branchCode}-EMP-`;
        const floor = await maxSequenceFrom(connection,
            "SELECT employee_code AS value FROM users WHERE store_id = ? AND employee_code LIKE ?",
            [storeId, `${prefix}%`], PATTERNS.employee);
        const { last } = await reserveSequenceBlock(connection, { storeId, branchId, floor });
        return buildEmployeeCode(storeCode, branchCode, last);
    }

    // Highest Product No. already issued with this exact prefix (products or rental equipment).
    async function maxProductPrefixSequence(connection, storeCode, branchCode) {
        const prefix = `${storeCode}-${branchCode}-PRD-%`;
        const fromProducts = await maxSequenceFrom(connection,
            "SELECT product_number AS value FROM products WHERE product_number LIKE ?", [prefix], PATTERNS.product);
        const fromRental = await maxSequenceFrom(connection,
            "SELECT equipment_number AS value FROM equipment WHERE equipment_number LIKE ?", [prefix], PATTERNS.product);
        return Math.max(fromProducts, fromRental);
    }

    /*
     * Product Nos. for sales products (products.product_number) and rental
     * equipment (equipment.equipment_number) share one sequence per branch, so a
     * rental item can never reuse a sales product's number. Caller must be inside
     * a transaction; the branch row lock serializes allocation.
     */
    async function allocateProductNumber(connection, { storeId, branchId }) {
        await lockBranch(connection, storeId, branchId);
        const { storeCode, branchCode } = await getIdentifierCodes(connection, storeId, branchId);
        const branchPrefix = `${storeCode}-${branchCode}-%`;
        const fromProducts = await maxSequenceFrom(connection,
            "SELECT product_number AS value FROM products WHERE store_id = ? AND product_number LIKE ?",
            [storeId, branchPrefix]);
        const fromRental = await maxSequenceFrom(connection,
            "SELECT equipment_number AS value FROM equipment WHERE store_id = ? AND equipment_number LIKE ?",
            [storeId, branchPrefix], PATTERNS.product);
        const fromPrefix = await maxProductPrefixSequence(connection, storeCode, branchCode);
        const next = Math.max(fromProducts, fromRental, fromPrefix) + 1;
        return buildProductNumber(storeCode, branchCode, next);
    }

    /*
     * stocknbook_v2 tracks rental equipment by quantity per branch
     * (branch_inventory); individual physical units are not numbered.
     * These helpers are kept so existing callers keep working.
     */
    async function adjustEquipmentUnits() {
        return { issued: [], retired: 0 };
    }

    async function listEquipmentUnitNumbers() {
        return new Map();
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
        allocateStoreCode,
        allocateBranchCode,
        lockBranch,
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
    database: "stocknbook_v2",
    ssl: { rejectUnauthorized: false },
};

// Reuse MySQL connections across requests instead of opening a new TCP/TLS
// connection for every product or dashboard load.
const dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});

// ===== BEGIN StockNBook v2 catalog (identical in lambda-products, lambda-pos, lambda-bookings, lambda-packages) =====
/*
 * stocknbook_v2 keeps ONE catalog row per product (products) and the prices on
 * product_variants. Every product has one hidden default variant
 * (is_default = 1) that carries the product-level price and, for a product
 * without variants, its stock. Real variants have is_default = 0.
 * Physical stock exists only in branch_inventory, and a product belongs to the
 * branch that holds the branch_inventory row of its default variant.
 *
 * Rental equipment follows the same rule with equipment / equipment_variants.
 *
 * The read models below expose the column names this Lambda already returns,
 * so API responses and the UI stay exactly the same.
 */
const V2_PRODUCT_STOCK_SQL = (p, bi) => `CASE WHEN ${p}.has_variants = 1 THEN COALESCE((
        SELECT SUM(vbi.on_hand_quantity)
        FROM product_variants vv
                 JOIN branch_inventory vbi ON vbi.variant_id = vv.id AND vbi.branch_id = ${bi}.branch_id
        WHERE vv.product_id = ${p}.id AND vv.is_default = 0 AND vv.deleted_at IS NULL), 0)
    ELSE ${bi}.on_hand_quantity END`;
const V2_PRODUCT_ALERT_SQL = (p, bi) => `CASE WHEN ${p}.has_variants = 1 THEN COALESCE((
        SELECT SUM(vbi.reorder_level)
        FROM product_variants vv
                 JOIN branch_inventory vbi ON vbi.variant_id = vv.id AND vbi.branch_id = ${bi}.branch_id
        WHERE vv.product_id = ${p}.id AND vv.is_default = 0 AND vv.deleted_at IS NULL), 0)
    ELSE ${bi}.reorder_level END`;

// Product rows exactly as the inventory screens use them (one row per product).
const V2_PRODUCTS = `(SELECT
        p.id, p.store_id, base_bi.branch_id, p.product_number,
        p.product_name AS name, COALESCE(cat.category_name, '') AS category, p.category_id,
        p.description,
        ${V2_PRODUCT_STOCK_SQL("p", "base_bi")} AS stock,
        ${V2_PRODUCT_ALERT_SQL("p", "base_bi")} AS alert_level,
        dv.cost_price AS original_price, dv.selling_price AS sales_price,
        dv.pricing_method, dv.markup_percentage,
        base_bi.expiration_date, p.has_variants, p.next_variant_sequence, p.status,
        p.created_at, p.updated_at, p.deleted_at,
        dv.id AS default_variant_id, base_bi.id AS base_inventory_id
    FROM products p
             JOIN product_variants dv ON dv.product_id = p.id AND dv.is_default = 1
             JOIN branch_inventory base_bi ON base_bi.variant_id = dv.id
             LEFT JOIN categories cat ON cat.id = p.category_id)`;

// Real (selectable) variants with their branch stock.
const V2_PRODUCT_VARIANTS = `(SELECT
        v.id, v.store_id, v.product_id, v.variant_number, v.variant_name,
        v.attributes AS variant_values,
        COALESCE(vbi.on_hand_quantity, 0) AS stock, COALESCE(vbi.reorder_level, 0) AS alert_level,
        v.cost_price AS original_price, v.selling_price AS sales_price,
        v.pricing_method, v.markup_percentage, vbi.expiration_date,
        vbi.branch_id, vbi.id AS inventory_id, v.status, v.created_at, v.updated_at, v.deleted_at
    FROM product_variants v
             LEFT JOIN branch_inventory vbi ON vbi.variant_id = v.id
    WHERE v.is_default = 0)`;

// Consumable branch stock keyed by (product_id, variant_id); variant_id is NULL
// for a product without variants.
const V2_BRANCH_INVENTORY = `(SELECT
        bi.id, bi.store_id, bi.branch_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE v.id END AS variant_id,
        bi.variant_id AS catalog_variant_id,
        bi.on_hand_quantity AS quantity_on_hand, bi.reserved_quantity, bi.unavailable_quantity,
        bi.reorder_level, v.cost_price, v.selling_price AS sales_price, bi.expiration_date,
        bi.status, bi.created_at, bi.updated_at
    FROM branch_inventory bi
             JOIN product_variants v ON v.id = bi.variant_id)`;

// Batch tracking is not part of stocknbook_v2: each branch_inventory row is
// its own (single) batch with one expiration date.
const V2_INVENTORY_BATCHES = `(SELECT
        bi.id, bi.store_id, bi.branch_id, bi.id AS branch_inventory_id,
        CONCAT('INV-', bi.id) AS batch_code, bi.on_hand_quantity AS received_quantity,
        bi.on_hand_quantity AS remaining_quantity, v.cost_price AS unit_cost,
        bi.updated_at AS received_at, bi.expiration_date,
        CASE WHEN bi.on_hand_quantity > 0 THEN 'active' ELSE 'depleted' END AS status
    FROM branch_inventory bi
             JOIN product_variants v ON v.id = bi.variant_id)`;

// Movement history with the legacy reference/actor fields.
const V2_INVENTORY_MOVEMENTS = `(SELECT
        m.id, m.store_id, m.branch_id, m.branch_inventory_id, m.movement_type,
        m.quantity_change AS quantity_delta, m.quantity_before, m.quantity_after, m.unit_cost,
        m.reference_type,
        CASE WHEN m.reason LIKE 'Ref %: %'
                 THEN SUBSTRING_INDEX(SUBSTRING(m.reason, 5), ': ', 1)
             ELSE CAST(m.reference_id AS CHAR) END AS reference_id,
        m.performed_by AS actor_id, mu.role AS actor_role, COALESCE(mu.full_name, 'System') AS actor_name,
        CASE WHEN m.reason LIKE 'Ref %: %'
                 THEN SUBSTRING(m.reason, LOCATE(': ', m.reason) + 2)
             ELSE m.reason END AS notes,
        m.created_at
    FROM inventory_movements m
             LEFT JOIN users mu ON mu.id = m.performed_by)`;

// POS lines keyed by (product_id, variant_id).
const V2_ORDER_ITEMS = `(SELECT
        oi.id, oi.store_id, oi.order_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE oi.variant_id END AS variant_id,
        oi.variant_id AS catalog_variant_id,
        oi.product_name_snapshot AS product_name, oi.quantity, oi.unit_price,
        oi.cost_price_at_sale, oi.discount_amount, oi.line_total
    FROM order_items oi
             JOIN product_variants v ON v.id = oi.variant_id)`;

// Consumable booking lines keyed by (product_id, variant_id).
const V2_PRODUCT_BOOKING_ITEMS = `(SELECT
        bki.id, bki.store_id, bki.booking_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE bki.variant_id END AS variant_id,
        bki.variant_id AS catalog_variant_id, bki.item_type, bki.quantity,
        bki.unit_price_snapshot, bki.line_total, bki.item_status, bki.created_at
    FROM booking_items bki
             JOIN product_variants v ON v.id = bki.variant_id
    WHERE bki.item_type = 'consumable')`;

// Consumable package lines keyed by (product_id, variant_id).
const V2_PRODUCT_PACKAGE_ITEMS = `(SELECT
        pki.id, pki.store_id, pki.package_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE pki.variant_id END AS variant_id,
        pki.variant_id AS catalog_variant_id, pki.quantity, pki.unit_price_snapshot, pki.sort_order
    FROM package_items pki
             JOIN product_variants v ON v.id = pki.variant_id
    WHERE pki.item_type = 'consumable')`;

const V2_ACTIVE_BOOKING_STATUSES_SQL = `('pending review','approved','approved - awaiting payment','awaiting payment','confirmed','preparing','released','return inspection','pending settlement','event in progress')`;

async function v2DefaultVariantId(connection, productId) {
    const [rows] = await connection.execute(
        "SELECT id FROM product_variants WHERE product_id = ? AND is_default = 1 LIMIT 1",
        [productId]
    );
    return rows.length ? Number(rows[0].id) : null;
}

// (product_id, variant_id|null) -> product_variants.id used by stocknbook_v2.
async function v2CatalogVariantId(connection, productId, variantId) {
    if (variantId !== null && variantId !== undefined && variantId !== "") return Number(variantId);
    return v2DefaultVariantId(connection, productId);
}

// Locks the branch stock row of a product/variant (FOR UPDATE).
async function v2LockInventory(connection, { storeId, branchId, productId, variantId = null }) {
    const catalogVariantId = await v2CatalogVariantId(connection, productId, variantId);
    if (!catalogVariantId) return null;
    const [rows] = await connection.execute(
        `SELECT bi.id, bi.variant_id, bi.on_hand_quantity, bi.reserved_quantity,
                bi.unavailable_quantity, bi.reorder_level, bi.expiration_date
         FROM branch_inventory bi
                  JOIN product_variants v ON v.id = bi.variant_id
         WHERE bi.store_id = ? AND bi.branch_id = ? AND bi.variant_id = ?
           AND v.product_id = ? AND bi.status = 'active'
             LIMIT 1
         FOR UPDATE`,
        [storeId, branchId, catalogVariantId, productId]
    );
    if (!rows.length) return null;
    return {
        ...rows[0],
        id: Number(rows[0].id),
        quantity_on_hand: Number(rows[0].on_hand_quantity),
        catalog_variant_id: catalogVariantId,
    };
}

// Creates the branch stock row for a catalog variant when it does not exist yet.
async function v2EnsureInventoryRow(connection, { storeId, branchId, catalogVariantId, reorderLevel = 0, expirationDate = null }) {
    const [found] = await connection.execute(
        "SELECT id FROM branch_inventory WHERE branch_id = ? AND variant_id = ? LIMIT 1",
        [branchId, catalogVariantId]
    );
    if (found.length) return Number(found[0].id);
    const [insert] = await connection.execute(
        `INSERT INTO branch_inventory
         (store_id, branch_id, variant_id, on_hand_quantity, reorder_level, expiration_date, status)
         VALUES (?, ?, ?, 0, ?, ?, 'active')`,
        [storeId, branchId, catalogVariantId, Math.max(0, Number(reorderLevel) || 0), expirationDate || null]
    );
    return Number(insert.insertId);
}

// inventory_movements.performed_by must be a user of the same store.
async function v2ActorUserId(connection, storeId, actorId) {
    const id = Number(actorId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const [rows] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND store_id = ? LIMIT 1",
        [id, storeId]
    );
    return rows.length ? id : null;
}

// A text reference (receipt key, request key ...) is kept at the start of the
// movement reason so it can be read back as reference_id.
function v2MovementReason(reference, notes) {
    const ref = String(reference ?? "").replace(/: /g, " ").trim();
    const text = String(notes ?? "").trim();
    if (!ref) return text || null;
    return `Ref ${ref}: ${text}`;
}

async function v2RecordMovement(connection, {
    storeId, branchId, inventoryId, movementType, delta, before, after,
    referenceType = null, referenceId = null, reference = null, unitCost = null,
    actorId = null, notes = null, bucket = "on_hand",
}) {
    const numericReference = Number(referenceId);
    const [result] = await connection.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type, quantity_bucket, quantity_change,
          quantity_before, quantity_after, unit_cost, reference_type, reference_id, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            storeId, branchId, inventoryId, movementType, bucket, Number(delta),
            Number(before), Number(after),
            unitCost === null || unitCost === undefined ? null : Number(unitCost),
            referenceType,
            Number.isSafeInteger(numericReference) && numericReference > 0 ? numericReference : null,
            v2MovementReason(reference, notes),
            await v2ActorUserId(connection, storeId, actorId),
        ]
    );
    return Number(result.insertId);
}

// Category text -> categories.id (created on first use, like the old free-text category).
async function v2CategoryId(connection, storeId, categoryName, categoryType = "product") {
    const name = String(categoryName || "").trim();
    if (!name) return null;
    const [rows] = await connection.execute(
        `SELECT id FROM categories
         WHERE store_id = ? AND category_type = ? AND LOWER(category_name) = LOWER(?)
             LIMIT 1`,
        [storeId, categoryType, name]
    );
    if (rows.length) return Number(rows[0].id);
    const [insert] = await connection.execute(
        "INSERT INTO categories (store_id, category_name, category_type, status) VALUES (?, ?, ?, 'active')",
        [storeId, name.slice(0, 150), categoryType]
    );
    return Number(insert.insertId);
}

function v2VariantName(values, fallback) {
    const name = Object.values(values || {})
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", ");
    return (name || fallback || "Default").slice(0, 150);
}
// ===== END StockNBook v2 catalog =====

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

function notFound(headers, message) {
    return jsonResponse(404, headers, { error: message });
}

function serverError(headers, err) {
    const message = err instanceof Error ? err.message : "Internal server error";

    console.error("Lambda error:", err);

    return jsonResponse(500, headers, {
        error: message,
    });
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeOptionalDate(value) {
    if (value === undefined || value === null || value === "") return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const text = String(value).trim();

    if (!text) return null;

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!isoMatch) {
        throw new Error(`Invalid expiration date "${text}". Use YYYY-MM-DD.`);
    }

    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
    ) {
        throw new Error(`Invalid expiration date "${text}".`);
    }

    return text;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function parseBooleanFlag(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;

    if (typeof value === "string") {
        const clean = value.trim().toLowerCase();
        return clean === "1" || clean === "true" || clean === "yes";
    }

    return false;
}

function parseVariantValues(value) {
    if (!value) return {};

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === "object" && parsed !== null ? parsed : {};
        } catch {
            return {};
        }
    }

    if (typeof value === "object") return value;

    return {};
}

function cleanVariantValues(value) {
    const rawValues = parseVariantValues(value);
    const cleaned = {};

    Object.entries(rawValues).forEach(([key, val]) => {
        const cleanKey = String(key || "").trim().toLowerCase();
        const cleanValue = String(val || "").trim();

        if (cleanKey && cleanValue) {
            cleaned[cleanKey] = cleanValue;
        }
    });

    return cleaned;
}

/* Save the user's selected pricing rule in addition to the final price. */
function readPricingSelection(input, fallback) {
    const method = String(firstDefined(
        input.pricingMethod, input.pricing_method,
        fallback?.pricingMethod, fallback?.pricing_method,
        "manual"
    )).trim().toLowerCase();
    if (method !== "manual" && method !== "markup") {
        throw new Error("Pricing method must be manual or markup.");
    }
    const raw = firstDefined(
        input.markupPercentage, input.markup_percentage,
        fallback?.markupPercentage, fallback?.markup_percentage
    );
    let percentage = null;
    if (raw !== undefined && raw !== null && raw !== "") {
        percentage = Number(raw);
        if (!Number.isFinite(percentage) || percentage < 0 || percentage > 99999) {
            throw new Error("Markup must be a nonnegative percentage.");
        }
    }
    if (method === "markup" && percentage === null) {
        throw new Error("Enter a markup percentage or choose Manual Selling Price.");
    }
    return { pricingMethod: method, markupPercentage: percentage };
}

function getIncomingVariants(body) {
    const rawVariants =
        body.variants ||
        body.product_variants ||
        body.productVariants ||
        body.variant_details ||
        [];

    if (!Array.isArray(rawVariants)) return [];

    return rawVariants
        .map((variant) => {
            const variantValues = cleanVariantValues(
                firstDefined(
                    variant.variantValues,
                    variant.variant_values,
                    variant.values
                )
            );

            return {
                variantValues,
                id: toNumber(variant.id) || null,
                ...readPricingSelection(variant),
                stock: toNumber(firstDefined(variant.stock, variant.quantity, variant.qty)) ?? 0,
                alertLevel:
                    toNumber(firstDefined(variant.alertLevel, variant.alert_level, variant.alert)) ?? 0,
                originalPrice:
                    toNumber(
                        firstDefined(
                            variant.originalPrice,
                            variant.original_price,
                            variant.costPrice,
                            variant.cost_price,
                            variant.original
                        )
                    ) ?? 0,
                salesPrice:
                    toNumber(
                        firstDefined(
                            variant.salesPrice,
                            variant.sales_price,
                            variant.price,
                            variant.sales
                        )
                    ) ?? 0,
                expirationDate: normalizeOptionalDate(
                    firstDefined(
                        variant.expirationDate,
                        variant.expiration_date,
                        variant.expiryDate,
                        variant.expiry_date
                    )
                ),
            };
        })
        .filter((variant) => Object.keys(variant.variantValues).length > 0);
}

function getVariantTotalStock(variants) {
    return variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function getVariantTotalAlert(variants) {
    return variants.reduce((sum, variant) => sum + Number(variant.alertLevel || 0), 0);
}

function getMinVariantPrice(variants, field) {
    const prices = variants
        .map((variant) => Number(variant[field] || 0))
        .filter((price) => Number.isFinite(price) && price > 0);

    return prices.length > 0 ? Math.min(...prices) : 0;
}

async function safeRollback(connection) {
    try {
        if (connection) await connection.rollback();
    } catch {
        // Ignore rollback error.
    }
}

async function ensureStoreExists(connection, storeId) {
    const parsed = Number(storeId);
    if (!Number.isInteger(parsed) || parsed <= 0) return false;

    const [rows] = await connection.execute(
        "SELECT id FROM stores WHERE id = ? LIMIT 1",
        [parsed]
    );

    return rows.length > 0;
}

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = Number(branchId);
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) return false;
    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) return false;

    const [rows] = await connection.execute(
        "SELECT id FROM branches WHERE id = ? AND store_id = ? LIMIT 1",
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
}

function normalizeVariantRow(row) {
    return {
        id: Number(row.id),
        productId: Number(row.productId ?? row.product_id),
        variantValues: parseVariantValues(row.variantValues ?? row.variant_values),
        variantNumber: row.variantNumber ?? row.variant_number ?? null,
        stock: Number(row.stock ?? 0),
        alertLevel: Number(row.alertLevel ?? row.alert_level ?? 0),
        originalPrice: Number(row.originalPrice ?? row.original_price ?? 0),
        salesPrice: Number(row.salesPrice ?? row.sales_price ?? 0),
        pricingMethod: row.pricingMethod ?? row.pricing_method ?? "manual",
        markupPercentage: row.markupPercentage ?? row.markup_percentage ?? null,
        expirationDate:
            row.expirationDate ??
            row.expiration_date ??
            null,
        createdAt: row.createdAt ?? row.created_at ?? "",
    };
}

async function attachVariants(connection, products) {
    if (!Array.isArray(products) || products.length === 0) return [];
    const productIds = products.map((product) => Number(product.id)).filter(Boolean);
    if (productIds.length === 0) {
        return products.map((product) => ({
            ...product,
            hasVariants: false,
            has_variants: 0,
            variants: [],
        }));
    }
    const placeholders = productIds.map(() => "?").join(",");
    const [variantRows] = await connection.execute(
        `SELECT
             product_variants.id,
             product_variants.product_id AS productId,
             product_variants.variant_values AS variantValues,
             product_variants.variant_number AS variantNumber,
             product_variants.stock,
             product_variants.alert_level AS alertLevel,
             product_variants.original_price AS originalPrice,
             product_variants.sales_price AS salesPrice,
             product_variants.pricing_method AS pricingMethod,
             product_variants.markup_percentage AS markupPercentage,
             product_variants.expiration_date AS expirationDate,
             product_variants.created_at AS createdAt
         FROM ${V2_PRODUCT_VARIANTS} product_variants
         WHERE product_variants.product_id IN (${placeholders})
           AND product_variants.deleted_at IS NULL
         ORDER BY product_variants.id ASC`,
        productIds
    );

    const variantsByProductId = {};

    variantRows.forEach((row) => {
        const variant = normalizeVariantRow(row);
        const key = String(variant.productId);

        if (!variantsByProductId[key]) {
            variantsByProductId[key] = [];
        }

        variantsByProductId[key].push(variant);
    });

    return products.map((product) => {
        const variants = variantsByProductId[String(product.id)] || [];
        const hasVariants =
            Number(product.hasVariants ?? product.has_variants ?? 0) === 1 ||
            variants.length > 0;

        return {
            ...product,
            hasVariants,
            has_variants: hasVariants ? 1 : 0,
            variants,
        };
    });
}

function hideProductCostsForNonOwners(products, tokenRole) {
    if (tokenRole === "owner") return products;

    return products.map((product) => ({
        ...product,
        originalPrice: 0,
        variants: Array.isArray(product.variants)
            ? product.variants.map((variant) => ({
                ...variant,
                originalPrice: 0,
            }))
            : [],
    }));
}

async function getOpeningVariantRows(connection, productId, incomingVariants) {
    const [rows] = await connection.execute(
        `SELECT id FROM product_variants
         WHERE product_id=? AND is_default=0 AND deleted_at IS NULL ORDER BY id`,
        [productId]);
    return rows.map((row, index) => {
        const source = incomingVariants[index] || {};
        return {
            id: Number(row.id),
            stock: Number(source.stock || 0),
            alertLevel: Number(source.alertLevel || 0),
            originalPrice: Number(source.originalPrice || 0),
            salesPrice: Number(source.salesPrice || 0),
            expirationDate: source.expirationDate || null,
        };
    });
}

async function insertProductRecord(connection, {
    storeId, branchId, productNumber, name, category, alertLevel, originalPrice, salesPrice,
    pricingMethod, markupPercentage, expirationDate, hasVariants,
}) {
    const categoryId = await v2CategoryId(connection, storeId, category, "product");
    const [product] = await connection.execute(
        `INSERT INTO products
         (store_id, category_id, product_number, product_name, has_variants, next_variant_sequence, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`,
        [storeId, categoryId, productNumber, name, hasVariants ? 1 : 0]
    );
    const productId = Number(product.insertId);
    const [variant] = await connection.execute(
        `INSERT INTO product_variants
         (store_id, product_id, variant_number, variant_name, attributes, is_default,
          selling_price, cost_price, pricing_method, markup_percentage, status)
         VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, 'active')`,
        [storeId, productId, productNumber, String(name).slice(0, 150),
            Number(salesPrice || 0), Number(originalPrice || 0), pricingMethod || "manual",
            markupPercentage ?? null]
    );
    await v2EnsureInventoryRow(connection, {
        storeId, branchId, catalogVariantId: Number(variant.insertId),
        reorderLevel: hasVariants ? 0 : alertLevel,
        expirationDate: hasVariants ? null : expirationDate,
    });
    return [{insertId: productId, affectedRows: 1}];
}

async function updateProductRecord(connection, {
    productId, storeId, branchId, name, category, alertLevel, originalPrice, salesPrice,
    pricingMethod, markupPercentage, expirationDate, hasVariants,
}) {
    const categoryId = await v2CategoryId(connection, storeId, category, "product");
    let sql = `UPDATE products p
                   JOIN product_variants dv ON dv.product_id = p.id AND dv.is_default = 1
                   JOIN branch_inventory base_bi ON base_bi.variant_id = dv.id
                   SET p.product_name = ?,
                       p.category_id = ?,
                       p.has_variants = ?,
                       dv.variant_name = ?,
                       dv.cost_price = ?,
                       dv.selling_price = ?,
                       dv.pricing_method = ?,
                       dv.markup_percentage = ?,
                       base_bi.reorder_level = ?,
                       base_bi.expiration_date = ?
               WHERE p.id = ?
                 AND p.store_id = ?`;
    const params = [name, categoryId, hasVariants ? 1 : 0, String(name).slice(0, 150),
        Number(originalPrice || 0), Number(salesPrice || 0), pricingMethod || "manual",
        markupPercentage ?? null, hasVariants ? 0 : Math.max(0, Number(alertLevel) || 0),
        hasVariants ? null : expirationDate || null, productId, storeId];
    if (branchId) {
        sql += " AND base_bi.branch_id = ?";
        params.push(branchId);
    }
    const [result] = await connection.execute(sql, params);
    return [{affectedRows: Number(result.affectedRows || 0) > 0 ? 1 : 0}];
}

async function updateVariantRecord(connection, {productId, variant}) {
    await connection.execute(
        `UPDATE product_variants v
             LEFT JOIN branch_inventory vbi ON vbi.variant_id = v.id
             SET v.attributes = ?,
                 v.variant_name = ?,
                 v.cost_price = ?,
                 v.selling_price = ?,
                 v.pricing_method = ?,
                 v.markup_percentage = ?,
                 vbi.reorder_level = ?,
                 vbi.expiration_date = ?
         WHERE v.id = ? AND v.product_id = ? AND v.is_default = 0 AND v.deleted_at IS NULL`,
        [JSON.stringify(variant.variantValues), v2VariantName(variant.variantValues),
            Number(variant.originalPrice || 0), Number(variant.salesPrice || 0),
            variant.pricingMethod || "manual", variant.markupPercentage ?? null,
            Math.max(0, Number(variant.alertLevel) || 0), variant.expirationDate || null,
            variant.id, productId]);
}

async function lockProductForUpdate(connection, storeId, branchId, productId) {
    const [locked] = await connection.execute(
        `SELECT p.id FROM products p
                              JOIN product_variants dv ON dv.product_id = p.id AND dv.is_default = 1
                              JOIN branch_inventory base_bi ON base_bi.variant_id = dv.id
         WHERE p.id = ? AND p.store_id = ? AND p.deleted_at IS NULL
             ${branchId ? "AND base_bi.branch_id = ?" : ""}
         FOR UPDATE`,
        branchId ? [productId, storeId, branchId] : [productId, storeId]);
    if (!locked.length) return null;
    const [rows] = await connection.execute(
        `SELECT products.id, products.name, products.product_number, products.has_variants,
                products.stock, products.alert_level, products.original_price, products.sales_price,
                products.pricing_method, products.markup_percentage, products.expiration_date,
                products.branch_id
         FROM ${V2_PRODUCTS} products
         WHERE products.id = ?`,
        [productId]);
    return rows[0] || null;
}

async function lockVariantsForUpdate(connection, productId, variantId = null) {
    await connection.execute(
        `SELECT v.id FROM product_variants v
                              LEFT JOIN branch_inventory vbi ON vbi.variant_id = v.id
         WHERE v.product_id = ? AND v.is_default = 0 AND v.deleted_at IS NULL
             ${variantId ? "AND v.id = ?" : ""}
         FOR UPDATE`,
        variantId ? [productId, variantId] : [productId]);
    const [rows] = await connection.execute(
        `SELECT pv.id, pv.stock, pv.variant_values, pv.variant_number, pv.original_price,
                pv.sales_price, pv.alert_level, pv.pricing_method, pv.markup_percentage, pv.expiration_date
         FROM ${V2_PRODUCT_VARIANTS} pv
         WHERE pv.product_id = ? AND pv.deleted_at IS NULL ${variantId ? "AND pv.id = ?" : ""}
         ORDER BY pv.id`,
        variantId ? [productId, variantId] : [productId]);
    return rows;
}



// V2 branch inventory is authoritative for sales/booking availability. This helper
// runs inside the SAME SQL transaction as a catalog creation or supplier receipt.
// Never repair pre-existing drift by copying products.stock into V2 balances.
async function creditBranchInventoryBatch(connection, {
    storeId, branchId, productId, variantId = null, quantity, expectedBefore,
    reorderLevel, costPrice, salesPrice, expirationDate = null, reference,
    actorId = null, actorRole = "system", actorName = "System", isOpening = false,
    allowVerifiedReceiptWithCatalogDrift = false,
}) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isSafeInteger(expectedBefore) || expectedBefore < 0 ||
        expectedBefore + quantity > 2147483647) {
        throw new Error("Invalid stock quantity for synchronized receipt.");
    }
    let inventory = await v2LockInventory(connection, {storeId, branchId, productId, variantId});
    if (!inventory) {
        if (!isOpening || expectedBefore !== 0) {
            throw new Error("Branch inventory row is missing. Reconcile this product before receiving additional stock.");
        }
        const catalogVariantId = await v2CatalogVariantId(connection, productId, variantId);
        if (!catalogVariantId) throw new Error("Product variant is missing for this stock receipt.");
        await v2EnsureInventoryRow(connection, {storeId, branchId, catalogVariantId, reorderLevel});
        inventory = await v2LockInventory(connection, {storeId, branchId, productId, variantId});
    }
    const before = Number(inventory.quantity_on_hand);
    const catalogDrift = expectedBefore - before;
    if (!Number.isSafeInteger(before) || before < 0 || before + quantity > 2147483647 ||
        (catalogDrift !== 0 && (!allowVerifiedReceiptWithCatalogDrift || catalogDrift < 0))) {
        throw new Error(
            `Stock ledger mismatch for product ${productId}${variantId ? ` variant ${variantId}` : ""}: `+
            `expected=${expectedBefore}, branch=${before}. Refresh inventory before receiving stock.`);
    }
    const after = before + quantity;
    // One expiration date per branch stock row: keep the earliest date that
    // still has stock; a fresh delivery into an empty row replaces it.
    const currentExpiry = inventory.expiration_date
        ? (inventory.expiration_date instanceof Date
            ? inventory.expiration_date.toISOString().slice(0, 10)
            : String(inventory.expiration_date).slice(0, 10))
        : null;
    const nextExpiry = before === 0
        ? (expirationDate || null)
        : expirationDate && (!currentExpiry || expirationDate < currentExpiry)
            ? expirationDate : currentExpiry;
    await connection.execute(
        `UPDATE branch_inventory SET on_hand_quantity=?, reorder_level=?, expiration_date=?
         WHERE id=?`,
        [after, Math.max(0, Number(reorderLevel) || 0), nextExpiry, inventory.id]);
    const movementId = await v2RecordMovement(connection, {
        storeId, branchId, inventoryId: inventory.id,
        movementType: isOpening ? "OPENING_STOCK" : "MANAGER_RECEIPT",
        delta: quantity, before, after, unitCost: costPrice,
        referenceType: isOpening ? "PRODUCT_OPENING" : "STOCK_RECEIPT",
        referenceId: productId, reference: String(reference).slice(0, 100), actorId,
        notes: isOpening ? "New product opening stock" : "Manager-authorized stock receipt",
    });
    return {inventoryId: inventory.id, before, after, catalogDrift, movementId};
}

// Physical stock corrections must also update V2 batches, not only products.stock.
// A correction is not a supplier receipt and does not create an invoice.
async function adjustSynchronizedStock(connection, {storeId,branchId,productId,variantId,
    before,target,requestKey,costPrice,expirationDate,employee,reason}) {
    const inventory = await v2LockInventory(connection, {storeId, branchId, productId, variantId});
    if(!inventory) throw new Error('Active branch inventory is missing. Reconcile before correcting stock.');
    const branchBefore = Number(inventory.quantity_on_hand);
    if(before!==branchBefore) throw new Error(
        `Stock mismatch: expected ${before}, branch ${branchBefore}. Reconcile before correcting.`);
    const [duplicates]=await connection.execute(
        `SELECT id FROM inventory_movements WHERE store_id=? AND branch_id=?
                                              AND reference_type='STOCK_ADJUSTMENT' AND reason LIKE ? LIMIT 1`,
        [storeId,branchId,`Ref ${String(requestKey).replace(/: /g, " ")}: %`]);
    if(duplicates.length) throw new Error('This stock correction was already processed. Refresh stock.');
    const delta=target-before;
    await connection.execute(
        `UPDATE branch_inventory
         SET on_hand_quantity=?,
             expiration_date=CASE WHEN ? > 0 AND ? IS NOT NULL THEN ? ELSE expiration_date END,
             last_counted_at=NOW()
         WHERE id=?`,
        [target, delta, expirationDate || null, expirationDate || null, inventory.id]);
    await v2RecordMovement(connection, {
        storeId, branchId, inventoryId: inventory.id, movementType: "STOCK_ADJUSTMENT",
        delta, before, after: target, unitCost: delta > 0 ? costPrice : null,
        referenceType: "STOCK_ADJUSTMENT", referenceId: productId, reference: requestKey,
        actorId: employee?.id, notes: reason,
    });
}

// End-of-transaction verification catches unexpected DB triggers that would
// otherwise update a ledger a second time after the catalog UPDATE.
async function assertInventoryLineSynchronized(connection,{
    storeId,branchId,productId,variantId=null,expected,
}) {
    const catalogVariantId = await v2CatalogVariantId(connection, productId, variantId);
    const [rows]=await connection.execute(
        `SELECT on_hand_quantity AS branchStock FROM branch_inventory
         WHERE store_id=? AND branch_id=? AND variant_id=? AND status='active' LIMIT 1`,
        [storeId,branchId,catalogVariantId]);
    if(!rows.length || Number(rows[0].branchStock)!==expected) {
        throw new Error(`Inventory synchronization check failed for product ${productId} variant ${variantId ?? 'regular'}; transaction rolled back.`);
    }
}

async function requireSynchronizedInventoryTables() {
    return true;
}

// Product creation and imports require a V2 row and one batch per stocked variant.
// Products with zero opening stock remain zero, and can receive their first batch later.
async function createOpeningBranchStock(connection, {storeId,branchId,productId,variants,stock,
    reorderLevel,costPrice,salesPrice,expirationDate,actorName}) {
    if (variants && variants.length) {
        for (const variant of variants) {
            const catalogVariantId = Number(variant.id);
            await v2EnsureInventoryRow(connection, {storeId, branchId, catalogVariantId,
                reorderLevel: Number(variant.alertLevel), expirationDate: variant.expirationDate || null});
            if (Number(variant.stock) <= 0) continue;
            await creditBranchInventoryBatch(connection,{
                storeId,branchId,productId,variantId:catalogVariantId,
                quantity:Number(variant.stock),expectedBefore:0,
                reorderLevel:Number(variant.alertLevel),costPrice:Number(variant.originalPrice),
                salesPrice:Number(variant.salesPrice),expirationDate:variant.expirationDate||null,
                reference:`OPEN-${productId}-${variant.id}`,actorName,isOpening:true});
        }
    } else if (Number(stock) > 0) {
        await creditBranchInventoryBatch(connection,{
            storeId,branchId,productId,quantity:Number(stock),expectedBefore:0,
            reorderLevel:Number(reorderLevel),costPrice:Number(costPrice),salesPrice:Number(salesPrice),
            expirationDate:expirationDate||null,reference:`OPEN-${productId}-BASE`,
            actorName,isOpening:true});
    }
}

async function getProducts(connection, storeId, activeBranchId, productId = null) {
    let query = `
        SELECT
            products.id,
            products.product_number AS productNumber,
            products.store_id AS storeId,
            products.branch_id AS branchId,
            branches.branch_name AS branchName,
            products.name,
            products.category,
            products.stock,
            products.alert_level AS alertLevel,
            products.original_price AS originalPrice,
            products.sales_price AS salesPrice,
            products.pricing_method AS pricingMethod,
            products.markup_percentage AS markupPercentage,
            products.expiration_date AS expirationDate,
            products.has_variants AS hasVariants,
            products.created_at AS createdAt
        FROM ${V2_PRODUCTS} products
                 LEFT JOIN branches
                           ON products.branch_id = branches.id
                               AND products.store_id = branches.store_id
        WHERE products.store_id = ?
          AND products.deleted_at IS NULL
    `;

    const params = [storeId];

    if (activeBranchId) {
        query += " AND products.branch_id = ?";
        params.push(activeBranchId);
    }

    if (productId) {
        query += " AND products.id = ?";
        params.push(productId);
    }

    query += " ORDER BY products.created_at DESC";

    const [rows] = await connection.execute(query, params);

    // UI-only sellable quantity: physical branch stock that is not expired,
    // reserved for a booking, or unusable. Keep `stock` as the physical count
    // used by stock receipts and corrections.
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(new Date());
    const [balances] = await connection.execute(
        `SELECT bi.branch_id AS branchId, bi.product_id AS productId,
                bi.variant_id AS variantId, bi.quantity_on_hand AS onHand,
                CASE WHEN bi.expiration_date IS NULL OR bi.expiration_date>=?
                         THEN GREATEST(bi.quantity_on_hand-bi.reserved_quantity-bi.unavailable_quantity,0)
                     ELSE 0 END AS eligibleBatches,
                bi.quantity_on_hand AS allBatches,
                CASE WHEN bi.quantity_on_hand>0 AND bi.expiration_date IS NOT NULL AND bi.expiration_date<?
                         THEN bi.quantity_on_hand ELSE 0 END AS expiredBatches
         FROM ${V2_BRANCH_INVENTORY} bi
         WHERE bi.store_id=? AND bi.status='active'
             ${activeBranchId ? 'AND bi.branch_id=?' : ''}`,
        activeBranchId ? [today,today,storeId,activeBranchId] : [today,today,storeId]);
    const ledgerByKey = new Map(balances.map(row => [
        `${Number(row.branchId)}:${Number(row.productId)}:${row.variantId==null?'regular':Number(row.variantId)}`,
        {physical:Math.max(0,Number(row.onHand||0)),
            batches:Math.max(0,Number(row.allBatches||0)),
            eligible:Math.max(0,Number(row.eligibleBatches||0)),
            expired:Math.max(0,Number(row.expiredBatches||0))}
    ]));

    const enriched = await attachVariants(connection, rows);
    return enriched.map(product=>{
        const branchId=Number(product.branchId);
        const baseKey=`${branchId}:${Number(product.id)}`;
        const variants=(product.variants||[]).map(variant=>{
            const ledger=ledgerByKey.get(`${baseKey}:${Number(variant.id)}`)
                || {physical:0,batches:0,eligible:0,expired:0};
            const catalog=Math.max(0,Number(variant.stock||0));
            return {...variant,
                // Once the stock is gone, the old expiry is historical, not an
                // active expired-stock warning.
                expirationDate:ledger.batches===0 ? null : variant.expirationDate,
                sellableStock:Math.max(0,Math.min(catalog,ledger.physical,ledger.eligible)),
                branchStock:ledger.physical,batchStock:ledger.batches,
                expiredBatchUnits:ledger.expired,
                ledgerMismatch:catalog!==ledger.physical||ledger.physical!==ledger.batches};
        });
        const base=ledgerByKey.get(`${baseKey}:regular`)
            || {physical:0,batches:0,eligible:0,expired:0};
        const sellableStock=product.hasVariants
            ? variants.reduce((total,variant)=>total+variant.sellableStock,0)
            : Math.max(0,Math.min(Number(product.stock||0),base.physical,base.eligible));
        const branchStock=product.hasVariants
            ? variants.reduce((total,variant)=>total+variant.branchStock,0):base.physical;
        const batchStock=product.hasVariants
            ? variants.reduce((total,variant)=>total+variant.batchStock,0):base.batches;
        const expiredBatchUnits=product.hasVariants
            ? variants.reduce((total,variant)=>total+variant.expiredBatchUnits,0):base.expired;
        const ledgerMismatch=Number(product.stock||0)!==branchStock ||
            branchStock!==batchStock || variants.some(variant=>variant.ledgerMismatch);
        return {...product,variants,
            expirationDate:!product.hasVariants && base.batches===0 ? null : product.expirationDate,
            sellableStock,branchStock,batchStock,expiredBatchUnits,ledgerMismatch};
    });
}

async function getProductById(connection, storeId, activeBranchId, productId) {
    const products = await getProducts(connection, storeId, activeBranchId, productId);
    return products[0] || null;
}

// Caller holds the parent product row lock (new product creation is branch-locked).
// The never-decreasing counter prevents reuse even after a variant is archived.
function validateProductInventoryInputs(body, stock, alertLevel, originalPrice, salesPrice, variants) {
    const validQuantity=n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647;
    const validAmount=n=>Number.isFinite(n)&&n>=0&&n<=100000000;
    if (!validQuantity(stock)||!validQuantity(alertLevel)||!validAmount(originalPrice)||!validAmount(salesPrice)) {
        throw new Error("Stock and Reorder Point must be nonnegative whole numbers; prices must be nonnegative.");
    }
    for (const v of variants) {
        if (!validQuantity(v.stock)||!validQuantity(v.alertLevel)||!validAmount(v.originalPrice)||!validAmount(v.salesPrice)) {
            throw new Error("Each variant needs a valid quantity, reorder point, and price.");
        }
    }
    const isMarkupValid=(entry)=>{
        const selection=readPricingSelection(entry);
        if (selection.pricingMethod!=="markup")return true;
        return Math.abs(roundMoney(Number(entry.originalPrice)*(1+selection.markupPercentage/100))-
            Number(entry.salesPrice))<0.011;
    };
    if (!variants.length && !isMarkupValid({...body,originalPrice,salesPrice})) {
        throw new Error("Selling price must match the configured markup calculation.");
    }
    if (variants.some(v=>!isMarkupValid(v))) throw new Error("One or more variant markup prices are incorrect.");
}

async function insertProductVariants(connection, productId, variants) {
    if (!Array.isArray(variants) || variants.length === 0) return [];
    const [counterRows] = await connection.execute(
        `SELECT p.store_id AS storeId, p.product_number AS productNumber,
                p.next_variant_sequence AS nextSequence, base_bi.branch_id AS branchId
         FROM products p
                  JOIN product_variants dv ON dv.product_id = p.id AND dv.is_default = 1
                  JOIN branch_inventory base_bi ON base_bi.variant_id = dv.id
         WHERE p.id = ?
             LIMIT 1
         FOR UPDATE`,
        [productId]
    );
    if (!counterRows.length || !counterRows[0].productNumber) throw new Error("Parent Product Number is missing.");
    const {storeId, branchId} = counterRows[0];
    let sequence = Number(counterRows[0].nextSequence || 1);
    const generated = [];
    for (const variant of variants) {
        if (!variant.variantValues || !Object.keys(variant.variantValues).length) throw new Error("Variant values are required.");
        const variantNumber = `${counterRows[0].productNumber}-V${String(sequence++).padStart(3, "0")}`;
        const [result] = await connection.execute(
            `INSERT INTO product_variants
             (store_id, product_id, variant_number, variant_name, attributes, is_default,
              selling_price, cost_price, pricing_method, markup_percentage, status)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active')`,
            [storeId, productId, variantNumber, v2VariantName(variant.variantValues),
                JSON.stringify(variant.variantValues), Number(variant.salesPrice || 0),
                Number(variant.originalPrice || 0), variant.pricingMethod || "manual",
                variant.markupPercentage ?? null]
        );
        const variantId = Number(result.insertId);
        await v2EnsureInventoryRow(connection, {
            storeId, branchId: Number(branchId), catalogVariantId: variantId,
            reorderLevel: Number(variant.alertLevel || 0), expirationDate: variant.expirationDate || null,
        });
        generated.push({id: variantId, variantNumber});
    }
    await connection.execute("UPDATE products SET next_variant_sequence = ? WHERE id = ?", [sequence, productId]);
    return generated;
}

/* DUPLICATE VALIDATION HELPERS */

function normalizeDuplicateText(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function getVariantSignature(values) {
    const entries = Object.entries(values || {})
        .map(([key, value]) => [
            normalizeDuplicateText(key),
            normalizeDuplicateText(value),
        ])
        .filter(([, value]) => value.length > 0)
        .sort(([keyA, valueA], [keyB, valueB]) => {
            const keyCompare = keyA.localeCompare(keyB);
            return keyCompare !== 0 ? keyCompare : valueA.localeCompare(valueB);
        });

    if (entries.length === 0) return "";

    return entries.map(([key, value]) => `${key}:${value}`).join("|");
}

function getVariantDisplayName(values) {
    return (
        Object.values(values || {})
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(", ") || "Unnamed variant"
    );
}

function getDuplicateVariantLabel(variants) {
    const seen = new Map();

    for (const variant of variants || []) {
        const signature = getVariantSignature(variant.variantValues);

        if (!signature) continue;

        const displayName = getVariantDisplayName(variant.variantValues);

        if (seen.has(signature)) {
            return displayName;
        }

        seen.set(signature, displayName);
    }

    return "";
}

async function findExistingProductByName(
    connection,
    storeId,
    branchId,
    productName,
    excludeProductId = null
) {
    const [rows] = await connection.execute(
        `SELECT products.id, products.name
         FROM ${V2_PRODUCTS} products
         WHERE products.store_id = ?
           AND products.branch_id = ?
           AND products.deleted_at IS NULL`,
        [storeId, branchId]
    );

    const cleanName = normalizeDuplicateText(productName);

    return (
        rows.find((row) => {
            const sameName = normalizeDuplicateText(row.name) === cleanName;
            const notCurrentProduct =
                !excludeProductId || Number(row.id) !== Number(excludeProductId);

            return sameName && notCurrentProduct;
        }) || null
    );
}


/* -------------------------------------------------------------------------- */
/*         INITIAL PURCHASE: SUPPLIER AND CASH / CREDIT RECORD ONLY           */
/* -------------------------------------------------------------------------- */

function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizedPurchaseDate(value) {
    // Reuses the project's existing strict YYYY-MM-DD validation.
    return normalizeOptionalDate(value);
}

function getInitialPurchaseInput(body, stock, originalPrice, variants, storedTotal = null) {
    const source = body.initialPurchase ?? body.initial_purchase;
    if (source === undefined || source === null) return null; // existing clients continue working
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("Invalid initial purchase information.");
    }
    if (storedTotal === null && Number(stock) <= 0) {
        throw new Error("Initial purchase details require stock greater than zero.");
    }
    const supplier = toSafeString(source.supplier, 150);
    const supplierInvoiceNumber = toSafeString(source.supplierInvoiceNumber ?? source.supplier_invoice_number, 80) || null;
    const purchaseDate = normalizedPurchaseDate(source.purchaseDate ?? source.purchase_date);
    const paymentMethod = String(source.paymentMethod ?? source.payment_method ?? "").trim().toLowerCase();
    if (!supplier || !purchaseDate) {
        throw new Error("Supplier and purchase date are required for initial stock.");
    }
    if (!["cash", "credit"].includes(paymentMethod)) {
        throw new Error("Payment method must be cash or credit.");
    }

    const rawCost = Array.isArray(variants) && variants.length > 0
        ? variants.reduce((sum, variant) =>
            sum + Number(variant.stock || 0) * Number(variant.originalPrice || 0), 0)
        : Number(stock) * Number(originalPrice);
    if (!Number.isFinite(rawCost) || rawCost < 0) {
        throw new Error("Invalid initial inventory purchase cost.");
    }
    // Edit never rewrites the original supplier purchase total just because
    // product stock or replacement costs changed in a later period.
    const purchaseTotal = storedTotal === null ? roundMoney(rawCost) : roundMoney(storedTotal);
    const paidCandidate = toNumber(source.amountPaid ?? source.amount_paid ?? 0);
    if (paidCandidate === null || paidCandidate < 0) {
        throw new Error("Amount paid must be a valid nonnegative number.");
    }
    if (paymentMethod === "credit" && roundMoney(paidCandidate) > purchaseTotal) {
        throw new Error("Amount paid cannot exceed the initial purchase cost.");
    }
    const amountPaid = paymentMethod === "cash" ? purchaseTotal : roundMoney(paidCandidate);
    const outstandingBalance = roundMoney(Math.max(0, purchaseTotal - amountPaid));
    const paymentDueDate = paymentMethod === "credit"
        ? normalizedPurchaseDate(source.paymentDueDate ?? source.payment_due_date)
        : null;
    if (outstandingBalance > 0 && !paymentDueDate) {
        throw new Error("Payment due date is required for an outstanding credit purchase.");
    }
    if (paymentDueDate && paymentDueDate < purchaseDate) {
        throw new Error("Payment due date cannot be before the purchase date.");
    }
    return { supplier, supplierInvoiceNumber, purchaseDate, paymentMethod, purchaseTotal,
        amountPaid, outstandingBalance, paymentDueDate };
}

async function recordInitialPurchase() {
    return null;
}

async function findInitialPurchase() {
    return null;
}

async function updateInitialPurchase() {
    return null;
}

/* STOCKNBOOK PURCHASE LEDGER: canonical financial transactions, distinct from stock. */
function exactMoney(value, label) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw < 0 || Math.abs(raw * 100 - Math.round(raw * 100)) > 0.00001) {
        throw new Error(`${label} must be a nonnegative amount with at most 2 decimal places.`);
    }
    return Math.round(raw * 100);
}
// Correct one selected purchase without updating products, stock, or receipt history.
async function updateSupplierPurchaseDetails() {
    const error = new Error("Supplier purchases are no longer recorded in StockNBook.");
    error.purchaseEditStatus = 410;
    throw error;
}


function validatePurchaseHeader(input, lines) {
    const supplier = toSafeString(input.supplier, 150);
    const purchaseDate = normalizeOptionalDate(input.purchaseDate ?? input.receivedDate);
    const supplierInvoiceNumber = toSafeString(input.supplierInvoiceNumber ?? input.supplier_invoice_number, 80) || null;
    const paymentMethod = String(input.paymentMethod || "").toLowerCase();
    if (!supplier || !purchaseDate || !["cash", "credit"].includes(paymentMethod)) {
        throw new Error("Supplier, purchase date, and Cash/Credit are required.");
    }
    if (!lines.length || lines.some(l => !Number.isSafeInteger(l.quantity) || l.quantity <= 0 ||
        !Number.isInteger(l.productId) || l.productId <= 0 ||
        (l.variantId !== null && (!Number.isInteger(l.variantId) || l.variantId <= 0)))) {
        throw new Error("A purchase needs one or more positive product or variant lines.");
    }
    const totalCents = lines.reduce((total, line) => total + line.quantity * exactMoney(line.unitPurchaseCost, "Unit purchase cost"), 0);
    if (!Number.isSafeInteger(totalCents)) throw new Error("Purchase amount is too large.");
    const amountPaidCents = paymentMethod === "cash" ? totalCents : exactMoney(input.amountPaid ?? 0, "Amount paid");
    if (amountPaidCents > totalCents) throw new Error("Amount paid cannot exceed purchase total.");
    const dueDate = paymentMethod === "credit" ? normalizeOptionalDate(input.paymentDueDate) : null;
    if (totalCents > amountPaidCents && !dueDate) throw new Error("Due date is required for unpaid credit.");
    if (dueDate && dueDate < purchaseDate) throw new Error("Due date cannot precede purchase date.");
    return {supplier, purchaseDate, supplierInvoiceNumber, paymentMethod, dueDate,
        totalCents, amountPaidCents, outstandingCents: totalCents - amountPaidCents};
}
async function createStockReceipt() {
    return null;
}
// CREATE purchase once; record its financial payment once even if the purchase has many variants/products.
async function createPurchaseLedger(connection, {input, lines}) {
    const p = validatePurchaseHeader(input, lines);
    return {purchaseId: null, receiptId: null, purchaseTotal: p.totalCents/100,
        amountPaid: p.amountPaidCents/100, outstandingBalance: p.outstandingCents/100};
}
async function findCanonicalInitialPurchase() {
    return null;
}

async function getRestockReceivedBy(
    connection,
    decoded,
    tokenRole,
    storeId
) {
    try {
        if (tokenRole === "manager" && decoded?.manager_id) {
            const [rows] = await connection.execute(
                `SELECT full_name AS manager_name
                 FROM users
                 WHERE id = ?
                   AND store_id = ?
                   AND role = 'manager'
                     LIMIT 1`,
                [Number(decoded.manager_id), storeId]
            );

            if (rows.length > 0) {
                return (
                    toSafeString(rows[0].manager_name, 255) ||
                    toSafeString(decoded.email, 255) ||
                    "Manager"
                );
            }
        }

        if (tokenRole === "staff" && decoded?.staff_id) {
            const [rows] = await connection.execute(
                `SELECT full_name AS staff_name
                 FROM users
                 WHERE id = ?
                   AND store_id = ?
                   AND role = 'staff'
                     LIMIT 1`,
                [Number(decoded.staff_id), storeId]
            );

            if (rows.length > 0) {
                return (
                    toSafeString(rows[0].staff_name, 255) ||
                    toSafeString(decoded.email, 255) ||
                    "Staff"
                );
            }
        }

        if (tokenRole === "owner") {
            const [rows] = await connection.execute(
                `SELECT full_name AS owner_name
                 FROM users
                 WHERE store_id = ?
                   AND role = 'owner'
                     LIMIT 1`,
                [storeId]
            );

            if (rows.length > 0) {
                return (
                    toSafeString(rows[0].owner_name, 255) ||
                    toSafeString(decoded?.email, 255) ||
                    "Owner"
                );
            }
        }
    } catch (error) {
        console.error("Unable to resolve restock receiver:", error);
    }

    return (
        toSafeString(decoded?.email, 255) ||
        toSafeString(tokenRole, 80) ||
        "User"
    );
}

async function recordRestockHistory() {
    return null;
}

/*
 * The JWT issued at login only carries ids (store_id / manager_id /
 * staff_id) and an email — never a display name. To log a real,
 * human-readable employee_actions row we look the acting user's name up
 * from their own table using the id that's already in the token.
 */
async function getActingEmployee(connection, decoded, tokenRole, storeId) {
    const role = String(tokenRole || "").toLowerCase();

    if (role === "manager" && decoded?.manager_id) {
        const [rows] = await connection.execute(
            `SELECT full_name AS manager_name FROM users WHERE id = ? AND store_id = ? AND role = 'manager' LIMIT 1`,
            [Number(decoded.manager_id), storeId]
        );

        return {
            id: Number(decoded.manager_id),
            name: toSafeString(rows[0]?.manager_name, 255) || "Manager",
            role: "Manager",
        };
    }

    if (role === "staff" && decoded?.staff_id) {
        const [rows] = await connection.execute(
            `SELECT full_name AS staff_name FROM users WHERE id = ? AND store_id = ? AND role = 'staff' LIMIT 1`,
            [Number(decoded.staff_id), storeId]
        );

        return {
            id: Number(decoded.staff_id),
            name: toSafeString(rows[0]?.staff_name, 255) || "Staff",
            role: "Staff",
        };
    }

    if (role === "owner") {
        const [rows] = await connection.execute(
            `SELECT id AS owner_user_id, full_name AS owner_name FROM users WHERE store_id = ? AND role = 'owner' ORDER BY id ASC LIMIT 1`,
            [storeId]
        );

        return {
            id: rows[0]?.owner_user_id ? Number(rows[0].owner_user_id) : null,
            name: toSafeString(rows[0]?.owner_name, 255) || "Owner",
            role: "Owner",
        };
    }

    return { id: null, name: "Unknown", role: "Staff" };
}

/*
 * Writes one row to employee_actions. Called from inside the same DB
 * transaction as the product action it's logging, so the log and the
 * action succeed or fail together.
 */
async function logEmployeeAction(connection, entry) {
    // employee_actions.user_id references users.id (owners included).
    const userId = Number(entry?.employee?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    const entityId = Number(entry.referenceId);
    await connection.execute(
        `INSERT INTO employee_actions
         (store_id, branch_id, user_id, user_name, user_role,
          module, reference_number, action, entity_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.storeId,
            entry.branchId ?? null,
            userId,
            String(entry.employee.name || "Unknown").slice(0, 150),
            entry.employee.role,
            entry.module,
            entry.referenceNumber ?? null,
            entry.action,
            Number.isSafeInteger(entityId) && entityId > 0 ? entityId : null,
            entry.details === undefined || entry.details === null
                ? null
                : JSON.stringify(entry.details),
        ]
    );
}

const STORE_CODE_STOP_WORDS = new Set([
    "THE", "AND", "OF", "STORE", "SHOP", "ENTERPRISE", "ENTERPRISES",
    "TRADING", "COMPANY", "CO", "INC", "CORP", "CORPORATION", "CITY"
]);

const BRANCH_CODE_STOP_WORDS = new Set([
    "THE", "AND", "OF", "BRANCH", "RETAIL", "OUTLET", "LOCATION",
    "STORE", "SHOP", "MAIN", "NORTH", "SOUTH", "EAST", "WEST",
    "CENTRAL", "CITY", "MUNICIPALITY"
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

    if (code.length < 3) {
        code = `${code}${clean.slice(1)}`.slice(0, 3);
    }

    return code.padEnd(3, "X");
}

function buildReadableCode(value, stopWords, fallback = "XXX") {
    const rawWords = normalizeCodeWords(value);
    const words = rawWords.filter((word) => !stopWords.has(word));

    if (words.length >= 3) {
        return words.slice(0, 3).map((word) => word.charAt(0)).join("");
    }

    if (words.length === 2) {
        const second = codeFromSingleWord(words[1]);
        return `${words[0].charAt(0)}${second.slice(0, 2)}`;
    }

    if (words.length === 1) {
        return codeFromSingleWord(words[0]);
    }

    const fallbackWords = normalizeCodeWords(fallback);
    return codeFromSingleWord(fallbackWords[0] || "XXX");
}

function getBranchCodeSource(branchName, address) {
    const meaningfulBranchWords = normalizeCodeWords(branchName).filter(
        (word) => !BRANCH_CODE_STOP_WORDS.has(word) && !/^\d+$/.test(word)
    );

    // If the branch name itself contains a real location/name (for example
    // "Mandaluyong Branch"), use it. Generic labels such as
    // "Branch 4 Retail Branch" fall back to the address location.
    if (meaningfulBranchWords.length > 0) {
        return meaningfulBranchWords.join(" ");
    }

    const addressParts = String(address || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    if (addressParts.length >= 2) {
        return addressParts[addressParts.length - 2];
    }

    return addressParts[0] || branchName || "Branch";
}

function buildProductNumber(storeCode, branchCode, sequence) {
    return `${storeCode}-${branchCode}-${String(sequence).padStart(3, "0")}`;
}

async function getProductCodeContext(connection, storeId, branchId) {
    const [rows] = await connection.execute(
        `SELECT
             stores.store_code AS storeCode,
             branches.branch_code AS branchCode
         FROM stores
                  INNER JOIN branches
                             ON branches.store_id = stores.id
                                 AND branches.id = ?
         WHERE stores.id = ?
             LIMIT 1`,
        [branchId, storeId]
    );

    if (!rows.length || !rows[0].storeCode || !rows[0].branchCode) {
        throw new Error("Store/branch code is not available for product numbering.");
    }

    return {
        storeCode: String(rows[0].storeCode),
        branchCode: String(rows[0].branchCode),
    };
}

async function reserveNextProductSequence(connection, storeId, branchId) {
    const prefix = await identifiers.getIdentifierCodes(connection, storeId, branchId);
    const [rows] = await connection.execute(
        `SELECT product_number AS value FROM products
         WHERE store_id = ? AND product_number LIKE ?
         UNION ALL
        SELECT equipment_number AS value FROM equipment
        WHERE store_id = ? AND equipment_number LIKE ?`,
        [storeId, `${prefix.storeCode}-${prefix.branchCode}-%`, storeId, `${prefix.storeCode}-${prefix.branchCode}-PRD-%`]
    );
    const fromRows = rows.reduce((max, row) => Math.max(max, identifiers.trailingSequence(row.value)), 0);
    const prefixValue = await identifiers.maxProductPrefixSequence(connection, prefix.storeCode, prefix.branchCode);
    return Math.max(fromRows, prefixValue, 0) + 1;
}

async function commitProductSequence() {
    return null;
}

function getTotalStock(product) {
    if (!product) return 0;

    if (product.hasVariants && Array.isArray(product.variants)) {
        return product.variants.reduce(
            (sum, variant) => sum + Number(variant.stock || 0),
            0
        );
    }

    return Number(product.stock || 0);
}


/* -------------------------------------------------------------------------- */
/*                    SAFE PRODUCT REMOVAL / ARCHIVE LOGIC                    */
/* -------------------------------------------------------------------------- */

/* stocknbook_v2 schema, used where this Lambda previously probed
 * INFORMATION_SCHEMA. Tables that are not part of stocknbook_v2 report false. */
const V2_SCHEMA_COLUMNS = {
    stores: ["id", "store_code", "slug", "store_name", "business_name", "email", "phone", "address", "tax_registration", "tin", "status", "created_at", "updated_at"],
    branches: ["id", "store_id", "branch_code", "branch_name", "address", "phone", "email", "status", "created_at", "updated_at"],
    users: ["id", "store_id", "branch_id", "manager_id", "employee_code", "full_name", "role", "email", "password_hash", "phone", "permissions", "status", "invite_token_hash", "invited_by", "email_verified_at", "last_login_at", "created_at", "updated_at"],
    categories: ["id", "store_id", "category_name", "category_type", "status", "created_at", "updated_at"],
    products: ["id", "store_id", "category_id", "product_number", "product_name", "description", "has_variants", "next_variant_sequence", "status", "created_at", "updated_at", "deleted_at"],
    product_variants: ["id", "store_id", "product_id", "variant_number", "variant_name", "attributes", "unit_of_measure", "is_default", "selling_price", "cost_price", "pricing_method", "markup_percentage", "status", "created_at", "updated_at", "deleted_at"],
    equipment: ["id", "store_id", "category_id", "equipment_number", "equipment_name", "description", "has_variants", "next_variant_sequence", "status", "created_at", "updated_at", "deleted_at"],
    equipment_variants: ["id", "store_id", "equipment_id", "variant_number", "variant_name", "attributes", "is_default", "rental_rate_per_day", "cost_price", "status", "created_at", "updated_at", "deleted_at"],
    branch_inventory: ["id", "store_id", "branch_id", "variant_id", "equipment_variant_id", "on_hand_quantity", "reserved_quantity", "unavailable_quantity", "reorder_level", "expiration_date", "status", "last_counted_at", "created_at", "updated_at"],
    inventory_movements: ["id", "store_id", "branch_id", "branch_inventory_id", "movement_type", "quantity_bucket", "quantity_change", "quantity_before", "quantity_after", "unit_cost", "reference_type", "reference_id", "reason", "performed_by", "created_at"],
    inventory_batches: ["id", "store_id", "branch_id", "branch_inventory_id", "batch_code", "received_quantity", "remaining_quantity", "unit_cost", "received_at", "expiration_date", "status"],
    stock_issues: ["id", "store_id", "branch_id", "branch_inventory_id", "booking_id", "issue_type", "quantity", "quantity_resolved", "reason", "status", "estimated_completion_date", "reported_by", "approved_by", "approved_at", "resolved_by", "resolved_at", "resolution_notes", "created_at", "updated_at"],
    packages: ["id", "store_id", "branch_id", "package_code", "package_name", "description", "category", "discount_type", "discount_value", "package_price", "down_payment_amount", "duration", "cover_image_url", "status", "updated_by", "created_at", "updated_at"],
    package_items: ["id", "store_id", "package_id", "product_id", "variant_id", "quantity"],
    bookings: ["id", "store_id", "branch_id", "booking_reference", "customer_id", "package_id", "booking_type", "status", "created_at", "updated_at"],
    booking_items: ["id", "store_id", "booking_id", "product_id", "variant_id", "quantity"],
    orders: ["order_id", "order_number", "store_id", "branch_id", "customer_id", "order_date", "subtotal", "discount_amount", "vatable_sales", "vat_amount", "total", "tax_type", "payment_mode", "amount_tendered", "change_due", "status", "processed_by", "created_at"],
    order_items: ["id", "store_id", "order_id", "product_id", "variant_id", "product_name", "quantity", "unit_price", "cost_price_at_sale", "discount_amount", "line_total"],
};

async function tableExists(connection, tableName) {
    return Object.prototype.hasOwnProperty.call(V2_SCHEMA_COLUMNS, String(tableName));
}

async function tableHasColumn(connection, tableName, columnName) {
    return (V2_SCHEMA_COLUMNS[String(tableName)] || []).includes(String(columnName));
}

async function tableHasIndex() {
    return true;
}

function normalizeRemovalStatus(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function parsePackageInclusions(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

function packageIncludesProduct(inclusions, productId) {
    return (Array.isArray(inclusions) ? inclusions : []).some((item) => {
        if (!item || typeof item !== "object") return false;

        const candidateId = Number(
            item.productId ??
            item.product_id ??
            item.id ??
            0
        );

        return Number.isInteger(candidateId) && candidateId === Number(productId);
    });
}

function isExpiredInventoryDate(value) {
    if (!value) return false;

    const dateText = value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;

    const today = new Date();
    const todayText = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
    ].join("-");

    return dateText < todayText;
}

async function getProductRemovalImpact(
    connection,
    storeId,
    activeBranchId,
    product
) {
    const productId = Number(product.id);
    const blockers = [];
    const history = [];
    const counts = {
        posSales: 0,
        bookings: 0,
        activeBookings: 0,
        packages: 0,
        activePackages: 0,
        restocks: 0,
    };

    // POS history. Any order item referencing the product is historical data
    // that should survive product removal.
    const [posRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM ${V2_ORDER_ITEMS} order_items
         WHERE order_items.product_id = ?`,
        [productId]
    );
    counts.posSales = Number(posRows[0]?.total || 0);
    if (counts.posSales > 0) {
        history.push("POS sales history");
    }

    // Booking history and unresolved bookings.
    const [historyRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM ${V2_PRODUCT_BOOKING_ITEMS} booking_items
         WHERE booking_items.product_id = ?`,
        [productId]
    );
    counts.bookings = Number(historyRows[0]?.total || 0);
    if (counts.bookings > 0) {
        history.push("booking history");
    }
    const [activeRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM ${V2_PRODUCT_BOOKING_ITEMS} bi
                  INNER JOIN bookings b
                             ON b.id = bi.booking_id
         WHERE bi.product_id = ?
           AND LOWER(TRIM(COALESCE(b.status, ''))) IN ${V2_ACTIVE_BOOKING_STATUSES_SQL}`,
        [productId]
    );
    counts.activeBookings = Number(activeRows[0]?.total || 0);
    if (counts.activeBookings > 0) {
        blockers.push(
            "This product is used by an active booking. Complete or cancel the booking before removing the product."
        );
    }

    // Packages list their contents in package_items.
    const [packageRows] = await connection.execute(
        `SELECT p.id, p.package_name AS name, p.status
         FROM ${V2_PRODUCT_PACKAGE_ITEMS} pi
                  INNER JOIN packages p ON p.id = pi.package_id
         WHERE pi.product_id = ?
           AND p.store_id = ?
             ${activeBranchId ? "AND p.branch_id = ?" : ""}
         GROUP BY p.id, p.package_name, p.status`,
        activeBranchId ? [productId, storeId, activeBranchId] : [productId, storeId]
    );
    for (const pkg of packageRows) {
        counts.packages += 1;
        if (normalizeRemovalStatus(pkg.status) === "active") {
            counts.activePackages += 1;
            blockers.push(
                `This product is included in the active package “${toSafeString(pkg.name, 120) || `Package #${pkg.id}`}”. Remove it from that package first.`
            );
        }
    }
    if (counts.packages > 0) {
        history.push("package history");
    }

    // Stock-in history (inventory_movements).
    const [restockRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM inventory_movements m
                  JOIN branch_inventory bi ON bi.id = m.branch_inventory_id
                  JOIN product_variants v ON v.id = bi.variant_id
         WHERE v.product_id = ?
           AND m.quantity_change > 0
           AND m.movement_type IN ('MANAGER_RECEIPT','STAFF_RECEIPT','RESTOCK','STOCK_IN')`,
        [productId]
    );
    counts.restocks = Number(restockRows[0]?.total || 0);
    if (counts.restocks > 0) {
        history.push("restock history");
    }

    // Any recorded stock movement must be preserved with the product.
    const [movementRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM inventory_movements m
                  JOIN branch_inventory bi ON bi.id = m.branch_inventory_id
                  JOIN product_variants v ON v.id = bi.variant_id
         WHERE v.product_id = ?`,
        [productId]
    );
    if (Number(movementRows[0]?.total || 0) > 0) {
        history.push("stock movement history");
    }

    // Expiration by itself is not a reason for permanent deletion. Preserve the
    // record by archiving it, matching StockNBook's inventory-history policy.
    const productExpired = isExpiredInventoryDate(product.expirationDate);
    const variantExpired = Array.isArray(product.variants)
        ? product.variants.some((variant) =>
            isExpiredInventoryDate(variant.expirationDate)
        )
        : false;

    if (productExpired || variantExpired) {
        history.push("expired inventory record");
    }

    const uniqueBlockers = Array.from(new Set(blockers));
    const uniqueHistory = Array.from(new Set(history));

    let mode = "permanent";

    if (uniqueBlockers.length > 0) {
        mode = "blocked";
    } else if (uniqueHistory.length > 0) {
        mode = "archive";
    }

    return {
        mode,
        blockers: uniqueBlockers,
        history: uniqueHistory,
        counts,
    };
}

function isVariantExpiryRemovalEligible(variant) {
    const raw = variant.expiration_date ?? variant.expirationDate;
    const text = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const todayParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const part = kind => todayParts.find(item => item.type === kind)?.value || "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const diffDays = (Date.parse(`${text}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
    return Number.isFinite(diffDays) && diffDays <= 30;
}

/* Only the selected variant is removed. Parent-level references are handled
   conservatively when older StockNBook records do not identify a variant. */
async function getVariantRemovalImpact(connection, storeId, activeBranchId, product, variant) {
    const productId = Number(product.id);
    const variantId = Number(variant.id);
    const blockers = [];
    const history = [];
    const counts = {};
    const referenceCount = async (sql, params, name) => {
        const [rows] = await connection.execute(sql, params);
        const count = Number(rows[0]?.total || 0);
        counts[name] = count;
        if (count > 0) history.push(name);
        return count;
    };
    await referenceCount(
        `SELECT COUNT(*) AS total FROM order_items WHERE variant_id=?`,
        [variantId], "POS sales history");
    await referenceCount(
        `SELECT COUNT(*) AS total FROM inventory_movements m
                                           JOIN branch_inventory bi ON bi.id = m.branch_inventory_id
         WHERE bi.variant_id=?`,
        [variantId], "stock movement history");

    const [bookingRows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM booking_items bi WHERE bi.variant_id=?`, [variantId]
    );
    counts.bookings = Number(bookingRows[0]?.total || 0);
    if (counts.bookings > 0) history.push("booking history");
    const [activeRows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM booking_items bi
                                           JOIN bookings b ON b.id=bi.booking_id
         WHERE bi.variant_id=?
           AND LOWER(TRIM(COALESCE(b.status,''))) IN ${V2_ACTIVE_BOOKING_STATUSES_SQL}`,
        [variantId]
    );
    if (Number(activeRows[0]?.total || 0) > 0) {
        blockers.push("This variant may be needed for an active booking. Complete or cancel the booking first.");
    }

    const [packageRows] = await connection.execute(
        `SELECT p.id, p.package_name AS name, p.status
         FROM package_items pi
                  JOIN packages p ON p.id=pi.package_id
         WHERE pi.variant_id=?
         GROUP BY p.id, p.package_name, p.status`,
        [variantId]
    );
    for (const pkg of packageRows) {
        history.push("package history");
        if (normalizeRemovalStatus(pkg.status) === "active") {
            blockers.push(`This variant may be used in active package "${toSafeString(pkg.name, 120) || pkg.id}". Remove it from the package first.`);
        }
    }
    void productId;
    void storeId;
    void activeBranchId;

    // Expiration records are retained under StockNBook's established archive policy.
    if (isExpiredInventoryDate(variant.expiration_date ?? variant.expirationDate)) {
        history.push("expired inventory record");
    }

    return {
        mode: blockers.length ? "blocked" : history.length ? "archive" : "permanent",
        blockers: [...new Set(blockers)],
        history: [...new Set(history)],
        counts,
    };
}

// Must run inside a transaction after locking the parent to serialize against
// stock receipts, stock adjustments, and edits to that same product.
async function applyVariantRemoval(connection, storeId, activeBranchId, productId, variantId, employee, forceArchive = false) {
    const locked = await lockProductForUpdate(connection, storeId, activeBranchId, productId);
    if (!locked || !Number(locked.has_variants)) {
        const err = new Error("Active variant product not found.");
        err.removalStatus = 404;
        throw err;
    }
    const product = {
        id: Number(locked.id),
        name: locked.name,
        productNumber: locked.product_number,
        hasVariants: locked.has_variants,
        branchId: locked.branch_id,
    };
    const variants = await lockVariantsForUpdate(connection, productId, variantId);
    if (!variants.length) {
        const err = new Error("The selected variant is no longer active. Refresh inventory.");
        err.removalStatus = 404;
        throw err;
    }
    const variant = {
        ...variants[0],
        variantNumber: variants[0].variant_number,
        variantValues: variants[0].variant_values,
    };
    if (!isVariantExpiryRemovalEligible(variant)) {
        const err = new Error("Only expired or expiring-soon variants can be removed from this review action.");
        err.removalStatus = 409;
        throw err;
    }
    const impact = await getVariantRemovalImpact(connection, storeId, activeBranchId, product, variant);
    if (impact.mode === "blocked") {
        const err = new Error(impact.blockers[0] || "Active commitments prevent variant removal.");
        err.removalStatus = 409;
        err.impact = impact;
        throw err;
    }
    const mode = forceArchive ? "archive" : impact.mode;
    if (mode === "archive") {
        const [result] = await connection.execute(
            `UPDATE product_variants SET deleted_at=NOW(), status='inactive'
             WHERE id=? AND product_id=? AND is_default=0 AND deleted_at IS NULL`, [variantId, productId]
        );
        if (!Number(result.affectedRows)) throw new Error("Variant was not archived.");
        await connection.execute(
            `UPDATE branch_inventory SET status='inactive' WHERE variant_id=?`, [variantId]
        );
    } else {
        await connection.execute(
            `DELETE FROM branch_inventory WHERE variant_id=? AND on_hand_quantity=0`, [variantId]
        );
        const [result] = await connection.execute(
            `DELETE FROM product_variants WHERE id=? AND product_id=? AND is_default=0 AND deleted_at IS NULL`,
            [variantId, productId]
        );
        if (!Number(result.affectedRows)) throw new Error("Variant was not deleted.");
    }

    // Never remove or change sibling variants. Keep the parent's display price
    // in line with the remaining ACTIVE variants; archive an empty parent.
    const [remaining] = await connection.execute(
        `SELECT pv.stock, pv.alert_level AS alertLevel, pv.original_price AS originalPrice,
                pv.sales_price AS salesPrice
         FROM ${V2_PRODUCT_VARIANTS} pv WHERE pv.product_id=? AND pv.deleted_at IS NULL`, [productId]
    );
    if (remaining.length) {
        const cost = getMinVariantPrice(remaining, "originalPrice");
        const price = getMinVariantPrice(remaining, "salesPrice");
        await connection.execute(
            `UPDATE product_variants SET cost_price=?, selling_price=?
             WHERE product_id=? AND is_default=1`,
            [cost, price, productId]
        );
    } else {
        await connection.execute(
            `UPDATE products SET deleted_at=NOW(), status='inactive'
             WHERE id=? AND store_id=? AND deleted_at IS NULL`,
            [productId, storeId]
        );
    }

    await logEmployeeAction(connection, {
        storeId, branchId: Number(product.branchId), employee,
        module: "Inventory", referenceNumber: variant.variantNumber || product.productNumber || String(variantId),
        action: mode === "archive" ? "Archived variant" : "Permanently deleted variant",
        referenceId: String(productId),
        details: `${mode === "archive" ? "Archived" : "Deleted"} variant ${getVariantDisplayName(parseVariantValues(variant.variantValues))} (${variant.variantNumber || variantId}) of ${product.name}; sibling variants were not changed`,
    });

    return { mode, impact: { ...impact, mode } };
}

async function archiveProduct(connection, storeId, activeBranchId, productId) {
    const locked = await lockProductForUpdate(connection, storeId, activeBranchId, productId);
    if (!locked) return 0;
    await connection.execute(
        `UPDATE product_variants
         SET deleted_at = COALESCE(deleted_at, NOW()), status = 'inactive'
         WHERE product_id = ? AND is_default = 0`,
        [productId]
    );
    const [result] = await connection.execute(
        `UPDATE products
         SET deleted_at = NOW(), status = 'inactive'
         WHERE id = ?
           AND store_id = ?
           AND deleted_at IS NULL`,
        [productId, storeId]
    );
    return Number(result.affectedRows || 0);
}

async function permanentlyDeleteProduct(
    connection,
    storeId,
    activeBranchId,
    productId
) {
    const locked = await lockProductForUpdate(connection, storeId, activeBranchId, productId);
    if (!locked) return 0;
    // Only an unused product reaches this point (the impact check found no
    // sales, booking, package or stock history), so its rows can be removed.
    await connection.execute(
        `DELETE bi FROM branch_inventory bi
                            JOIN product_variants v ON v.id = bi.variant_id
         WHERE v.product_id = ?`,
        [productId]
    );
    await connection.execute(
        "DELETE FROM product_variants WHERE product_id = ?",
        [productId]
    );
    const [result] = await connection.execute(
        `DELETE FROM products
         WHERE id = ?
           AND store_id = ?
           AND deleted_at IS NULL`,
        [productId, storeId]
    );
    return Number(result.affectedRows || 0);
}

/* OWNER STOCK CONDITION: live Sales + Rental item types, counted ONCE per branch.
 * Important: no demo quantities, no purchase-cost-based revenue, no stock writes.
 * Priority: equipment on hold -> expiring/expired -> low availability -> slow -> healthy.
 */
// Keep inventory's paid-POS filter aligned with lambda-pos/index.js, but do
// not reference optional order columns that may be absent in an older schema.
// The mandatory payment_mode column identifies completed checkout payments.
function ownerRecordedPosFilterSql() {
    return "LOWER(COALESCE(o.status,'completed')) <> 'voided' AND UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')";
}

async function loadOwnerStockCondition(connection, {storeId, branchId, asOfDate}) {
    const cutoff = new Date(`${asOfDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const slowStart = cutoff.toISOString().slice(0, 10);
    const expires = new Date(`${asOfDate}T00:00:00Z`);
    expires.setUTCDate(expires.getUTCDate() + 30);
    const expiryLimit = expires.toISOString().slice(0, 10);
    const counts = {healthy:0, expiring:0, low:0, slow:0, maintenance:0};
    const conditions = new Set();
    const status = ({maintenance=false,expiring=false,low=false,slow=false}) =>
        maintenance ? 'maintenance' : expiring ? 'expiring' : low ? 'low' : slow ? 'slow' : 'healthy';
    const date = v => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
    const args = [storeId, ...(branchId ? [branchId] : [])];

    const [rows] = await connection.execute(`SELECT p.id,p.branch_id AS branchId,p.stock,
                                                    p.alert_level AS alertLevel,DATE_FORMAT(p.expiration_date,'%Y-%m-%d') AS expiresAt,p.has_variants AS hasVariants,
                                                    DATE_FORMAT(p.created_at,'%Y-%m-%d') AS createdDate,
                                                    v.id AS variantId,v.stock AS variantStock,v.alert_level AS variantAlert,DATE_FORMAT(v.expiration_date,'%Y-%m-%d') AS variantExpiry
                                             FROM ${V2_PRODUCTS} p LEFT JOIN ${V2_PRODUCT_VARIANTS} v ON v.product_id=p.id AND v.deleted_at IS NULL
                                             WHERE p.store_id=? AND p.deleted_at IS NULL ${branchId ? 'AND p.branch_id=?' : ''}
                                             ORDER BY p.id`, args);
    const products = new Map();
    for (const row of rows) {
        const id = Number(row.id);
        if (!products.has(id)) products.set(id,{...row,variants:[]});
        if (row.variantId != null) products.get(id).variants.push(row);
    }
    const recentlySold = new Set();
    const productHistory = true;
    const [sales] = await connection.execute(`SELECT DISTINCT oi.product_id AS productId
                                              FROM orders o JOIN ${V2_ORDER_ITEMS} oi ON oi.order_id=o.order_id AND oi.store_id=o.store_id
                                              WHERE o.store_id=? ${branchId ? 'AND o.branch_id=?' : ''} AND o.order_date>=?
                                                AND ${ownerRecordedPosFilterSql()}`,
        [...args,slowStart]);
    sales.forEach(row=>recentlySold.add(Number(row.productId)));
    for (const product of products.values()) {
        const variants = product.variants;
        const useVariants = Boolean(Number(product.hasVariants)) || variants.length > 0;
        const quantity = useVariants
            ? variants.reduce((sum,row)=>sum+Number(row.variantStock||0),0)
            : Number(product.stock||0);
        const low = quantity <= 0 || (useVariants
            ? variants.some(row=>Number(row.variantStock)<=Number(row.variantAlert||0))
            : Number(product.alertLevel)>0 && quantity<=Number(product.alertLevel));
        const expiring = useVariants
            ? variants.some(row=>Number(row.variantStock)>0 && date(row.variantExpiry) && date(row.variantExpiry)<=expiryLimit)
            : quantity>0 && Boolean(date(product.expiresAt)) && date(product.expiresAt)<=expiryLimit;
        const slow = productHistory && quantity>0 && date(product.createdDate) &&
            date(product.createdDate)<=slowStart && !recentlySold.has(Number(product.id));
        conditions.add(`sale:${Number(product.branchId)}:${Number(product.id)}`);
        counts[status({expiring,low,slow})]++;
    }

    // Rental equipment: branch stock of each equipment item, units currently
    // released to bookings, and units recorded as unavailable (damaged/repair).
    const recentlyRented = new Set();
    const rentalHistory = true;
    const [moves] = await connection.execute(`SELECT DISTINCT ev.equipment_id AS equipmentId
                                              FROM booking_items bki
                                                       JOIN bookings b ON b.id=bki.booking_id
                                                       JOIN equipment_variants ev ON ev.id=bki.equipment_variant_id
                                              WHERE b.store_id=? ${branchId ? 'AND b.branch_id=?' : ''}
                                                AND bki.item_type='rental' AND bki.released_at>=?`, [...args,slowStart]);
    moves.forEach(row=>recentlyRented.add(Number(row.equipmentId)));
    const [rentals] = await connection.execute(`SELECT e.id,bi.branch_id AS branchId,bi.on_hand_quantity AS totalUnits,
                                                       COALESCE((SELECT SUM(bki.quantity-bki.returned_quantity) FROM booking_items bki
                                                                 JOIN bookings b ON b.id=bki.booking_id
                                                                 WHERE bki.equipment_variant_id=ev.id AND b.branch_id=bi.branch_id
                                                                   AND bki.item_type='rental' AND bki.item_status='released'),0) AS rentedOut,
                                                       bi.unavailable_quantity AS maintenanceUnits,
                                                       0 AS missingUnits,bi.reorder_level AS alertLevel,
                                                       DATE_FORMAT(e.created_at,'%Y-%m-%d') AS createdDate
                                                FROM equipment e
                                                         JOIN equipment_variants ev ON ev.equipment_id=e.id AND ev.is_default=1
                                                         JOIN branch_inventory bi ON bi.equipment_variant_id=ev.id
                                                WHERE e.store_id=? ${branchId ? 'AND bi.branch_id=?' : ''}
                                                  AND e.deleted_at IS NULL`, args);
    for(const row of rentals) {
        const available = Math.max(0, Number(row.totalUnits||0)-Number(row.rentedOut||0)-
            Number(row.maintenanceUnits||0)-Number(row.missingUnits||0));
        const maintenance = Number(row.maintenanceUnits)>0 || Number(row.missingUnits)>0;
        const low = available===0 || (Number(row.alertLevel)>0 && available<=Number(row.alertLevel));
        const slow = rentalHistory && Number(row.totalUnits)>0 && date(row.createdDate) &&
            date(row.createdDate)<=slowStart && !recentlyRented.has(Number(row.id));
        conditions.add(`rental:${Number(row.branchId)}:${Number(row.id)}`);
        counts[status({maintenance,low,slow})]++;
    }
    return {counts,total:conditions.size,asOfDate};
}

/* Only posted/recorded rental-item charges are revenue. The live rental rate,
 * supplier purchases and physical releases are NOT revenue evidence.
 * Supports an explicit booking allocation charge snapshot or an itemized ledger.
 */
async function loadOwnerRecordedRentalRevenue(connection,{storeId,branchId,dateFrom,dateTo}) {
    const args = [storeId,...(branchId?[branchId]:[]),dateFrom,dateTo];
    const [rows] = await connection.execute(`SELECT b.branch_id AS branchId,ev.equipment_id AS equipmentId,
                                                    COALESCE(e.equipment_name,bki.item_name_snapshot,'Archived rental equipment') AS equipmentName,
                                                    DATE_FORMAT(DATE(COALESCE(bki.returned_at,b.rental_end_date,b.event_date)),'%Y-%m-%d') AS revenueDate,
                                                    bki.line_total AS revenueAmount
                                             FROM booking_items bki
                                                      JOIN bookings b ON b.id=bki.booking_id AND b.store_id=bki.store_id
                                                      JOIN equipment_variants ev ON ev.id=bki.equipment_variant_id
                                                      LEFT JOIN equipment e ON e.id=ev.equipment_id
                                             WHERE b.store_id=? ${branchId ? 'AND b.branch_id=?' : ''}
                                               AND bki.item_type='rental' AND bki.item_status IN ('returned','cleaning','damaged','cleared')
                                               AND DATE(COALESCE(bki.returned_at,b.rental_end_date,b.event_date))>=?
                                               AND DATE(COALESCE(bki.returned_at,b.rental_end_date,b.event_date))<=?`,args);
    const normalized=[];
    for (const row of rows) {
        const amount=Number(row.revenueAmount);
        if(row.revenueAmount===null || row.revenueAmount==='' || !Number.isFinite(amount) ||
            !Number.isSafeInteger(Math.round(amount*100))) return {available:false,rows:[],warnings:[
                'Some recorded rental charges are invalid or missing; revenue is unavailable until those records are corrected.'
            ]};
        normalized.push({...row,branchId:Number(row.branchId),equipmentId:Number(row.equipmentId),
            revenueAmount:Math.round(amount*100)/100});
    }
    return {available:true,rows:normalized,warnings:[],method:'allocation'};
}

/* OWNER INVENTORY: read-only recorded sales, separate from stock valuation. */
function ownerInventoryReportDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
}

function ownerInventoryMoneyCents(value) {
    if (value === null || value === undefined || value === "") return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) return null;
    return Math.round(amount * 100);
}

// Pure aggregation is intentionally independent of live inventory prices. A
// missing historical cost stays unknown rather than becoming an estimated profit.
function buildOwnerInventoryPerformance({dateFrom, dateTo, asOfDate, storeName, branches,
                                            rows, selectedBranchId = null, posAvailable = true,
                                            rentalReport = {available:false,rows:[],warnings:[]}}) {
    const warnings = [...rentalReport.warnings];
    const orders = new Map();
    const consumables = new Map();
    const branchTotals = new Map();
    const trendTotals = new Map();
    const dates = [];
    let totalCents = 0;
    let totalProfitCents = 0;
    let missingCost = false;
    let invalidTotal = false;
    let hasAdjustments = false;

    for (let timestamp = Date.parse(`${dateFrom}T00:00:00Z`);
         timestamp <= Date.parse(`${dateTo}T00:00:00Z`); timestamp += 86400000) {
        const date = new Date(timestamp).toISOString().slice(0, 10);
        dates.push(date);
        trendTotals.set(date, {cents: 0, invalid: false});
    }
    const normalizedBranches = branches.map(branch => ({
        id: Number(branch.id), branchName: String(branch.branchName || `Branch ${branch.id}`),
    }));
    normalizedBranches.forEach(branch => {
        if (!selectedBranchId || branch.id === selectedBranchId) {
            branchTotals.set(branch.id, {branchId: branch.id, branchName: branch.branchName, cents: 0, invalid: false});
        }
    });

    rows.forEach(row => {
        const key = `${row.branchId ?? "unassigned"}:${row.orderId}`;
        if (!orders.has(key)) orders.set(key, {row, items: []});
        if (row.itemId !== null && row.itemId !== undefined) orders.get(key).items.push(row);
    });

    orders.forEach(({row, items}) => {
        const branchId = row.branchId === null || row.branchId === undefined ? null : Number(row.branchId);
        const branch = branchTotals.get(branchId) || {
            branchId, branchName: String(row.branchName || "Unassigned branch"), cents: 0, invalid: false,
        };
        branchTotals.set(branchId, branch);
        const daily = trendTotals.get(String(row.orderDate));
        const orderCents = ownerInventoryMoneyCents(row.orderTotal);
        if (orderCents === null) {
            invalidTotal = true;
            branch.invalid = true;
            if (daily) daily.invalid = true;
        } else {
            totalCents += orderCents;
            branch.cents += orderCents;
            if (daily) daily.cents += orderCents;
        }
        let itemSalesCents = 0;
        let orderProfitCents = 0;
        let orderCostKnown = items.length > 0;

        items.forEach(item => {
            const name = String(item.productName || "Unnamed recorded item");
            const key = item.productId === null || item.productId === undefined
                ? `recorded:${name}` : `product:${item.productId}`;
            const product = consumables.get(key) || {key, name, unitsSold: 0, cents: 0, profitCents: 0, costKnown: true};
            consumables.set(key, product);
            const quantity = item.quantity === null || item.quantity === undefined || item.quantity === ""
                ? NaN : Number(item.quantity);
            const validQuantity = Number.isFinite(quantity) && quantity > 0;
            const salesCents = ownerInventoryMoneyCents(item.lineTotal);
            const unitCostCents = ownerInventoryMoneyCents(item.costPriceAtSale);
            if (validQuantity) product.unitsSold += quantity;
            if (salesCents !== null) {
                product.cents += salesCents;
                itemSalesCents += salesCents;
            }
            if (!validQuantity || salesCents === null || unitCostCents === null) {
                product.costKnown = false;
                orderCostKnown = false;
                missingCost = true;
            } else {
                const profitCents = salesCents - Math.round(Number(item.costPriceAtSale) * quantity * 100);
                product.profitCents += profitCents;
                orderProfitCents += profitCents;
            }
        });

        // Legacy totals can include a discount, surcharge, or sales without item
        // rows. Keep their recorded difference visible; never invent allocations.
        const difference = orderCents === null ? null : orderCents - itemSalesCents;
        if (difference !== null && difference !== 0) {
            const key = "unallocated-sales";
            const unallocated = consumables.get(key) || {
                key, name: "Order adjustments / unallocated sales", unitsSold: 0, cents: 0, profitCents: 0, costKnown: false,
            };
            unallocated.cents += difference;
            consumables.set(key, unallocated);
            hasAdjustments = true;
            orderCostKnown = false;
        }
        if (!orderCostKnown || orderCents === null) missingCost = true;
        else totalProfitCents += orderProfitCents;
    });

    // Each rental line must have its own saved, charged amount. Never infer revenue
    // from a catalog price, inventory movement, future reservation, or supplier bill.
    const rentalItems = new Map();
    let rentalCents = 0;
    if (rentalReport.available) {
        for (const row of rentalReport.rows) {
            const cents = Math.round(Number(row.revenueAmount) * 100);
            rentalCents += cents;
            const branch = branchTotals.get(row.branchId) || {
                branchId:row.branchId,
                branchName:normalizedBranches.find(b=>b.id===row.branchId)?.branchName || `Branch ${row.branchId}`,
                cents:0,invalid:false};
            branch.rentalCents = (branch.rentalCents || 0) + cents;
            branchTotals.set(row.branchId,branch);
            const trend = trendTotals.get(row.revenueDate);
            if (trend) trend.rentalCents = (trend.rentalCents || 0) + cents;
            const key = `equipment:${row.equipmentId}`;
            const item = rentalItems.get(key) || {key,name:String(row.equipmentName),cents:0};
            item.cents += cents;
            rentalItems.set(key,item);
        }
    }
    if (!posAvailable) warnings.push("Recorded POS sales are unavailable because the required sales tables or fields are missing.");
    if (missingCost) warnings.push("Gross profit is unavailable where historical item costs or complete sales details were not recorded.");
    if (hasAdjustments) warnings.push("Differences between recorded order totals and item sales appear as order adjustments / unallocated sales.");
    if (invalidTotal) warnings.push("Some recorded order totals are invalid; affected revenue totals are unavailable.");

    return {
        dateRange: {startDate: dateFrom, endDate: dateTo}, asOfDate, storeName,
        branches: normalizedBranches,
        totals: {
            consumableSales: posAvailable && !invalidTotal ? totalCents / 100 : null,
            consumableGrossProfit: posAvailable && !invalidTotal && !missingCost ? totalProfitCents / 100 : null,
            rentalRevenue: rentalReport.available ? rentalCents/100 : null,
            totalRevenue: posAvailable && !invalidTotal && rentalReport.available ? (totalCents+rentalCents)/100 : null,
        },
        trend: dates.map(date => ({date,
            consumableSales: posAvailable && !trendTotals.get(date).invalid ? trendTotals.get(date).cents / 100 : null,
            rentalRevenue: rentalReport.available ? (trendTotals.get(date).rentalCents || 0)/100 : null,
        })),
        branchRevenue: [...branchTotals.values()].map(branch => ({
            branchId: branch.branchId, branchName: branch.branchName,
            consumableSales: posAvailable && !branch.invalid ? branch.cents / 100 : null,
            rentalRevenue: rentalReport.available ? (branch.rentalCents || 0)/100 : null,
        })).sort((left, right) => (right.consumableSales || 0) - (left.consumableSales || 0)),
        consumables: [...consumables.values()].map(product => ({
            key: product.key, name: product.name, unitsSold: product.unitsSold,
            sales: product.cents / 100, grossProfit: product.costKnown ? product.profitCents / 100 : null,
        })).sort((left, right) => right.sales - left.sales || left.name.localeCompare(right.name)),
        rentals: [...rentalItems.values()].map(item=>({key:item.key,name:item.name,
            revenue:item.cents/100,share:rentalCents>0?Math.round(item.cents/rentalCents*10000)/100:0}))
            .sort((a,b)=>b.revenue-a.revenue||a.name.localeCompare(b.name)), warnings,
    };
}

async function loadOwnerInventoryPerformance(connection, {storeId, branchId, dateFrom, dateTo, asOfDate}) {
    const [storeRows] = await connection.execute("SELECT store_name AS storeName FROM stores WHERE id=? LIMIT 1", [storeId]);
    const [branches] = await connection.execute(
        "SELECT id,branch_name AS branchName FROM branches WHERE store_id=? ORDER BY branch_name,id", [storeId]);
    const posAvailable = true;
    const [salesRows] = await connection.execute(
        `SELECT o.order_number AS orderId,o.branch_id AS branchId,b.branch_name AS branchName,
                DATE_FORMAT(o.order_date,'%Y-%m-%d') AS orderDate,o.total AS orderTotal,
                oi.id AS itemId,oi.product_id AS productId,
                oi.product_name AS productName,oi.quantity AS quantity,
                oi.line_total AS lineTotal,oi.cost_price_at_sale AS costPriceAtSale
         FROM orders o LEFT JOIN branches b ON b.id=o.branch_id AND b.store_id=o.store_id
                       LEFT JOIN ${V2_ORDER_ITEMS} oi ON oi.order_id=o.order_id AND oi.store_id=o.store_id
         WHERE o.store_id=? AND DATE(o.order_date)>=? AND DATE(o.order_date)<=?${branchId ? " AND o.branch_id=?" : ""}
           AND ${ownerRecordedPosFilterSql()}
         ORDER BY o.order_date,o.order_id,oi.id LIMIT 100001`,
        [storeId, dateFrom, dateTo, ...(branchId ? [branchId] : [])]);
    if (salesRows.length > 100000) {
        const error = new Error("This report contains too many sales items. Choose a shorter date range or one branch.");
        error.ownerInventoryStatus = 400;
        throw error;
    }
    const rows = salesRows;
    const rentalReport = await loadOwnerRecordedRentalRevenue(connection,
        {storeId,branchId,dateFrom,dateTo});
    return buildOwnerInventoryPerformance({
        dateFrom, dateTo, asOfDate, storeName: String(storeRows[0]?.storeName || ""),
        branches, rows, selectedBranchId: branchId, posAvailable, rentalReport,
    });
}


exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return { statusCode: 204, headers, body: "" };
    }

    let body = {};

    try {
        body = JSON.parse(event?.body || "{}");
    } catch {
        return badRequest(headers, "Invalid JSON body");
    }

    const action = body.action;
    let connection;

    try {
        connection = await dbPool.getConnection();

        // Only this catalog action is public. Every other operation still uses
        // authenticated Owner/Manager/Staff permissions below.
        if (action === "get_public_products") {
            const sid = Number(body.store_id ?? body.storeId);
            const bid = Number(body.branch_id ?? body.branchId);
            if (!Number.isSafeInteger(sid) || sid <= 0 || !Number.isSafeInteger(bid) || bid <= 0)
                return badRequest(headers,"Choose a valid branch to browse products.");
            const [matchingBranches] = await connection.execute(
                'SELECT id FROM branches WHERE store_id=? AND id=? LIMIT 1',[sid,bid]);
            if (!matchingBranches.length) return notFound(headers,"Branch not found for this store.");
            const today = new Intl.DateTimeFormat('en-CA', {
                timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
            }).format(new Date());
            const requestedDate=String(body.eventDate ?? body.event_date ?? '').trim();
            const validCalendarDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value) &&
                !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
                new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
            if(requestedDate && !validCalendarDate(requestedDate))
                return badRequest(headers,'Choose a valid event date.');
            const eligibleOn=requestedDate||today;
            // The public quantity must not exceed ANY balance needed to fulfill a
            // booking: catalog/variant, active branch row, or eligible batches.
            // Legacy catalog expiry is not authoritative when a fresh batch exists.
            // Reservations/POS already decrease these balances transactionally.
            const [balances]=await connection.execute(
                `SELECT bi.product_id AS productId, bi.variant_id AS variantId,
                        bi.quantity_on_hand AS onHand,
                        CASE WHEN bi.expiration_date IS NULL OR bi.expiration_date>=?
                                 THEN GREATEST(bi.quantity_on_hand-bi.reserved_quantity-bi.unavailable_quantity,0)
                             ELSE 0 END AS eligibleBatches
                 FROM ${V2_BRANCH_INVENTORY} bi
                 WHERE bi.store_id=? AND bi.branch_id=? AND bi.status='active'`,
                [eligibleOn,sid,bid]);
            const available=new Map(balances.map(row=>[
                `${Number(row.productId)}:${row.variantId==null?'regular':Number(row.variantId)}`,
                Math.max(0,Math.floor(Math.min(Number(row.onHand||0),Number(row.eligibleBatches||0))))
            ]));
            const products=await getProducts(connection,sid,bid);
            // Use an explicit allowlist: never expose supplier costs, batch details,
            // employee activity, or other nonpublic inventory records.
            const safeProducts=products.map(pr=>({
                id:Number(pr.id),branchId:bid,name:String(pr.name),category:String(pr.category||'Other'),
                stock:Math.max(0,Math.min(Number(pr.stock||0),available.get(`${Number(pr.id)}:regular`)||0)),
                salesPrice:Number(pr.salesPrice||0),hasVariants:Boolean(pr.hasVariants),
                variants:(Array.isArray(pr.variants)?pr.variants:[]).map(v=>({
                    id:Number(v.id),stock:Math.max(0,Math.min(Number(v.stock||0),available.get(`${Number(pr.id)}:${Number(v.id)}`)||0)),
                    salesPrice:Number(v.salesPrice||0),variantValues:v.variantValues||{}
                }))
            }));
            return jsonResponse(200,headers,{products:safeProducts,branchId:bid,availabilityDate:eligibleOn});
        }

        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(headers, "No token provided");
        }

        let decoded;
        let storeId;
        let tokenBranchId;
        let tokenRole;

        try {
            const token = authHeader.replace("Bearer ", "");
            decoded = jwt.verify(token, JWT_SECRET);

            storeId = Number(decoded.store_id);
            tokenBranchId = decoded.branch_id ? Number(decoded.branch_id) : null;
            tokenRole = String(decoded.role || "").toLowerCase();
        } catch {
            return unauthorized(headers, "Invalid token");
        }

        if (!Number.isInteger(storeId) || storeId <= 0) {
            return unauthorized(headers, "Invalid store in token");
        }

        const storeExists = await ensureStoreExists(connection, storeId);

        if (!storeExists) {
            return badRequest(headers, "Store account not found");
        }

        if (!["owner", "manager", "staff"].includes(tokenRole)) {
            return jsonResponse(403, headers, {error: "A business account role is required."});
        }

        // Recheck current employee status, branch and Inventory permission on
        // EVERY request. Session-storage permissions are UI hints, not security.
        const inventoryReadActions = new Set([
            "get_products", "get_recent_purchased_stock_in", "get_last_stock_in",
            "get_stock_suppliers", "get_supplier_payables", "get_supplier_purchase_items",
            "get_product_editor_details", "get_product_initial_purchase",
            "get_product_removal_impact", "get_variant_removal_impact",
            "get_staff_receiving_permissions", "get_staff_inventory_workspace", "get_staff_inventory_activity",
        ]);
        const ownerFinancialActions = new Set([
            "get_owner_stock_condition", "get_owner_inventory_performance", "get_products",
            "get_supplier_payables", "get_supplier_purchase_items", "get_stock_suppliers",
            "get_recent_purchased_stock_in", "get_last_stock_in", "get_product_initial_purchase",
            "pay_supplier_purchase",
        ]);
        if (tokenRole === "owner" && !ownerFinancialActions.has(action)) {
            return jsonResponse(403, headers, {error: "Owner Inventory access is limited to financial oversight and supplier payments."});
        }
        if (tokenRole === "manager") {
            const managerId = Number(decoded.manager_id);
            if (!Number.isSafeInteger(managerId) || managerId < 1) {
                return jsonResponse(403, headers, {error: "Manager account is invalid."});
            }
            const [managerRows] = await connection.execute(
                `SELECT branch_id,status,permissions FROM users WHERE id=? AND store_id=? AND role='manager' LIMIT 1`,
                [managerId,storeId]);
            const manager = managerRows[0];
            if (!manager || !["active","accepted"].includes(String(manager.status).toLowerCase())) {
                return jsonResponse(403, headers, {error: "An active Manager account is required."});
            }
            if (Number(manager.branch_id) !== tokenBranchId) {
                return jsonResponse(403, headers, {error: "Branch assignment changed. Please sign in again."});
            }
            let permissions = {};
            try { permissions = typeof manager.permissions === "string" ? JSON.parse(manager.permissions) : manager.permissions || {}; }
            catch { permissions = {}; }
            const value = permissions.inventory_access !== undefined ? permissions.inventory_access : permissions.inventory;
            const access = value === undefined || value === null || value === true || value === "true" || value === "full"
                ? "full" : ["view","view_only","viewOnly"].includes(value) ? "view" : "none";
            if (access === "none" || (access !== "full" && !inventoryReadActions.has(action))) {
                return jsonResponse(403, headers, {error: "Insufficient Manager Inventory permission."});
            }
        }

        const isBranchUser = tokenRole === "manager" || tokenRole === "staff";

        const rawRequestedBranchId = firstDefined(body.branch_id, body.branchId);

        const requestedBranchId =
            rawRequestedBranchId !== undefined &&
            rawRequestedBranchId !== null &&
            rawRequestedBranchId !== ""
                ? Number(rawRequestedBranchId)
                : null;

        const activeBranchId = isBranchUser
            ? tokenBranchId
            : requestedBranchId || null;

        if (isBranchUser && !activeBranchId) {
            return badRequest(headers, "Missing branch_id for branch user");
        }

        if (activeBranchId) {
            const branchOk = await ensureBranchBelongsToStore(
                connection,
                activeBranchId,
                storeId
            );

            if (!branchOk) {
                return badRequest(headers, "Invalid branch for this store");
            }
        }

        // The owner stock chart is computed from active, branch-scoped Sales
        // products and rental equipment; it never needs or changes stock values.
        if (action === "get_owner_stock_condition") {
            if (tokenRole !== "owner") {
                return jsonResponse(403, headers, {error:"Only owners can view store-wide stock conditions."});
            }
            if (rawRequestedBranchId !== undefined && rawRequestedBranchId !== null && rawRequestedBranchId !== "" &&
                (!Number.isSafeInteger(requestedBranchId) || requestedBranchId <= 0)) {
                return badRequest(headers,"Choose a valid branch.");
            }
            const asOfDate = new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Manila"});
            return jsonResponse(200,headers,{success:true,stockCondition:await loadOwnerStockCondition(connection,
                    {storeId,branchId:activeBranchId,asOfDate})});
        }

        // Owner-only reporting never changes products, stock, or supplier ledgers.
        if (action === "get_owner_inventory_performance") {
            if (tokenRole !== "owner") {
                return jsonResponse(403, headers, {error: "Only the owner can view inventory financial performance."});
            }
            if (rawRequestedBranchId !== undefined && rawRequestedBranchId !== null && rawRequestedBranchId !== "" &&
                (!Number.isSafeInteger(requestedBranchId) || requestedBranchId <= 0)) {
                return badRequest(headers, "Choose a valid branch.");
            }
            const asOfDate = new Date().toLocaleDateString("sv-SE", {timeZone: "Asia/Manila"});
            const dateFrom = ownerInventoryReportDate(body.date_from ?? body.dateFrom ?? `${asOfDate.slice(0, 7)}-01`);
            const dateTo = ownerInventoryReportDate(body.date_to ?? body.dateTo ?? asOfDate);
            if (!dateFrom || !dateTo || dateFrom > dateTo) {
                return badRequest(headers, "Choose valid start and end dates in YYYY-MM-DD order.");
            }
            // At most 366 calendar days, inclusive, per interactive report.
            if ((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000 > 365) {
                return badRequest(headers, "Choose a date range of 366 days or fewer.");
            }
            try {
                const performance = await loadOwnerInventoryPerformance(connection, {
                    storeId, branchId: activeBranchId, dateFrom, dateTo, asOfDate,
                });
                return jsonResponse(200, headers, {success: true, performance});
            } catch (error) {
                if (error.ownerInventoryStatus) return jsonResponse(error.ownerInventoryStatus, headers, {error: error.message});
                throw error;
            }
        }


        // Revalidate active staff/branch/module membership on EVERY staff inventory request.
        // JWT branch claims and browser-visible controls are not a substitute for current DB grants.
        if (tokenRole === "staff") {
            const currentStaffId = Number(decoded?.staff_id);
            if (!Number.isSafeInteger(currentStaffId) || currentStaffId < 1) {
                return unauthorized(headers, "Staff account is not valid.");
            }
            const [currentStaff] = await connection.execute(
                `SELECT branch_id,status,permissions FROM users WHERE id=? AND store_id=? AND role='staff' LIMIT 1`,
                [currentStaffId,storeId]);
            if (!currentStaff.length || Number(currentStaff[0].branch_id) !== activeBranchId ||
                !["active", "accepted"].includes(String(currentStaff[0].status).toLowerCase())) {
                return unauthorized(headers,"Staff account or assigned branch is no longer active.");
            }
            let access = {};
            try { access = typeof currentStaff[0].permissions === "string" ? JSON.parse(currentStaff[0].permissions) : (currentStaff[0].permissions || {}); } catch {}
            const inventoryLevel = access.inventory_access !== undefined ? access.inventory_access : access.inventory;
            if (![true, "true", "full", "view", "view_only", "viewOnly"].includes(inventoryLevel)) {
                return unauthorized(headers,"Inventory permission is not assigned to this staff member.");
            }
        }

        // Staff inventory access includes the Receive Stock dialog and its
        // transaction, but not unrelated catalog, import, supplier settlement,
        // stock adjustment, or product deletion operations.
        if (tokenRole === "staff" && !new Set([
            "get_products", "get_staff_inventory_workspace", "get_staff_inventory_activity",
            "complete_staff_stock_receipt", "report_staff_stock_shortage", "report_staff_stock_condition",
        ]).has(action)) {
            return unauthorized(headers, "This product operation is not permitted for staff.");
        }
        if (tokenRole === "staff" && ["complete_staff_stock_receipt", "report_staff_stock_shortage", "report_staff_stock_condition"].includes(action)) {
            const [rows] = await connection.execute(
                `SELECT permissions FROM users WHERE id=? AND store_id=? AND branch_id=? AND role='staff' LIMIT 1`,
                [Number(decoded.staff_id),storeId,activeBranchId]);
            let permissions = {};
            try { permissions = typeof rows[0]?.permissions === "string" ? JSON.parse(rows[0].permissions) : rows[0]?.permissions || {}; }
            catch { permissions = {}; }
            const level = permissions.inventory_access !== undefined ? permissions.inventory_access : permissions.inventory;
            if (![true, "true", "full"].includes(level)) {
                return jsonResponse(403, headers, {error: "Full Inventory permission is required for physical stock operations."});
            }
        }

        // Keep Product No. as a real, unique database field. This also
        // backfills products created before the product_number column existed.
        // New tables/columns for standardized IDs (outside any transaction).
        await identifiers.ensureIdentifierSchema(connection);

        /* STAFF INVENTORY: branch-scoped operational workflow, separate from purchasing.
         * Shortage and condition reports are stored in stock_issues.
         */
        if (["get_staff_inventory_workspace", "get_staff_inventory_activity", "get_staff_receiving_permissions", "set_staff_receiving_permission", "authorize_staff_stock_receipt",
            "complete_staff_stock_receipt", "cancel_staff_stock_receipt", "report_staff_stock_shortage", "resolve_staff_stock_shortage", "report_staff_stock_condition", "resolve_staff_stock_condition"].includes(action)) {
            if (!activeBranchId) return badRequest(headers, "An assigned branch is required.");
            if (!["owner", "manager", "staff"].includes(tokenRole)) return unauthorized(headers, "Inventory access denied.");
            if (tokenRole === "manager") {
                const managerId=Number(decoded?.manager_id);
                const [managers]= await connection.execute(
                    `SELECT permissions,status FROM users WHERE id=? AND store_id=? AND branch_id=? AND role='manager' LIMIT 1`,
                    [managerId,storeId,activeBranchId]);
                if (!managers.length || !["active","accepted"].includes(String(managers[0].status).toLowerCase())) {
                    return unauthorized(headers,"Active branch Manager required.");
                }
                let managerPermissions={};
                try {managerPermissions=typeof managers[0].permissions==="string" ? JSON.parse(managers[0].permissions) : (managers[0].permissions||{});}
                catch { managerPermissions={}; }
                if (["set_staff_receiving_permission","get_staff_receiving_permissions"].includes(action)) {
                    if (managerPermissions.staff_management!==true) return unauthorized(headers,"Staff management access required.");
                } else if (managerPermissions.inventory!==true && managerPermissions.inventory_access!=="full") {
                    return unauthorized(headers,"Manager inventory access required.");
                }
            }
            const staffId = Number(decoded?.staff_id);
            let staffRow = null;
            let staffPermissions = {};
            if (tokenRole === "staff") {
                if (!Number.isInteger(staffId) || staffId <= 0) return unauthorized(headers, "Invalid staff account.");
                const [rows] = await connection.execute(
                    `SELECT id, permissions, status FROM users WHERE id=? AND store_id=? AND branch_id=? AND role='staff' LIMIT 1`,
                    [staffId, storeId, activeBranchId]);
                staffRow = rows[0];
                if (!staffRow || !["active", "accepted"].includes(String(staffRow.status).toLowerCase())) {
                    return unauthorized(headers, "Active branch staff account required.");
                }
                try { staffPermissions = typeof staffRow.permissions === "string" ? JSON.parse(staffRow.permissions) : (staffRow.permissions || {}); }
                catch { staffPermissions = {}; }
                const staffAccess = staffPermissions.inventory_access !== undefined
                    ? staffPermissions.inventory_access : staffPermissions.inventory;
                if (![true, "true", "full", "view", "view_only", "viewOnly"].includes(staffAccess)) {
                    return unauthorized(headers, "Inventory access is not assigned to this staff account.");
                }
            }
            const allowedReceiving = tokenRole !== "staff" || staffPermissions.inventory_stock_receive === true && staffPermissions.inventory_access === "full";
            const employee = await getActingEmployee(connection, decoded, tokenRole, storeId);
            const itemIdentity = () => {
                const productId = Number(body.productId ?? body.product_id);
                const variantId = body.variantId == null || body.variantId === "" ? null : Number(body.variantId);
                return { productId, variantId, valid: Number.isSafeInteger(productId) && productId > 0 &&
                        (variantId === null || Number.isSafeInteger(variantId) && variantId > 0) };
            };
            if (action === "get_staff_receiving_permissions") {
                if (!["owner","manager"].includes(tokenRole)) return unauthorized(headers,"Only supervisors may view receiving grants.");
                const [rows] = await connection.execute(
                    `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(permissions,'$.inventory_stock_receive')) AS stockReceiving
                     FROM users WHERE store_id=? AND branch_id=? AND role='staff'`,[storeId,activeBranchId]);
                return jsonResponse(200,headers,{success:true, grants:rows.map(row=>({staffId:row.id,allowed:row.stockReceiving==='true'}))});
            }
            // Calculate an Asia/Manila calendar-day range as UTC Unix seconds.
            // MySQL FROM_UNIXTIME converts the bounds to the session's local
            // representation of TIMESTAMP, avoiding server time zone assumptions.
            const manilaToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
            const manilaDayStartEpoch = Math.floor(Date.parse(`${manilaToday}T00:00:00Z`) / 1000) - 8 * 3600;
            const operationalMovementsOnly = `m.movement_type <> 'OPENING_BALANCE'
                    AND (m.reference_type IS NULL OR m.reference_type <> 'DEMO_SEED')`;
            if (action === "get_staff_inventory_activity") {
                const filter = ["all","sales","receiving","adjustments"].includes(body.filter) ? body.filter : "all";
                const period = ["today","week","all"].includes(body.period) ? body.period : "week";
                const page = Math.min(100, Math.max(1, Number.isSafeInteger(Number(body.page)) ? Number(body.page) : 1));
                const limit = 20;
                const where = [`m.store_id=?`, `m.branch_id=?`, operationalMovementsOnly];
                const params = [storeId,activeBranchId];
                const saleKinds = ['SALE','POS_VOID'];
                const receivingKinds = ['STAFF_RECEIPT','PURCHASE_RECEIPT','RECEIVE','RECEIPT','RESTOCK','STOCK_IN'];
                if (filter === "sales") { where.push(`m.movement_type IN (${saleKinds.map(()=>'?').join(',')})`); params.push(...saleKinds); }
                if (filter === "receiving") { where.push(`m.movement_type IN (${receivingKinds.map(()=>'?').join(',')})`); params.push(...receivingKinds); }
                if (filter === "adjustments") { where.push(`m.movement_type NOT IN (${[...saleKinds,...receivingKinds].map(()=>'?').join(',')})`); params.push(...saleKinds,...receivingKinds); }
                if (period === "today" || period === "week") {
                    where.push(`m.created_at >= FROM_UNIXTIME(?) AND m.created_at < FROM_UNIXTIME(?)`);
                    params.push(manilaDayStartEpoch - (period === "week" ? 6*86400 : 0), manilaDayStartEpoch + 86400);
                }
                const [rows] = await connection.execute(
                    `SELECT m.id, m.created_at AS at, p.name AS productName,
                            pv.variant_values AS variantValues, m.movement_type AS kind,
                            m.quantity_delta AS quantity, m.reference_id AS reference,
                            m.actor_name AS actorName
                     FROM ${V2_INVENTORY_MOVEMENTS} m
                         JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id=m.branch_inventory_id AND bi.store_id=m.store_id AND bi.branch_id=m.branch_id
                         JOIN ${V2_PRODUCTS} p ON p.id=bi.product_id
                         LEFT JOIN ${V2_PRODUCT_VARIANTS} pv ON pv.id=bi.variant_id AND pv.product_id=p.id
                     WHERE ${where.join(' AND ')}
                     ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
                    [...params, limit+1, (page-1)*limit]);
                return jsonResponse(200,headers,{success:true,movements:rows.slice(0,limit),hasMore:rows.length>limit,page});
            }
            if (action === "get_staff_inventory_workspace") {
                // Staff stock receiving tasks are not part of stocknbook_v2.
                const receivingTasks = [];
                const [shortages] = await connection.execute(
                    `SELECT r.id, bi.product_id AS productId, bi.variant_id AS variantId,
                            p.name AS productName, bi.quantity_on_hand AS stockSnapshot,
                            bi.reorder_level AS reorderSnapshot, r.reason AS notes,
                            r.created_at AS createdAt
                     FROM stock_issues r
                              JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id=r.branch_inventory_id
                              JOIN ${V2_PRODUCTS} p ON p.id=bi.product_id
                     WHERE r.store_id=? AND r.branch_id=? AND r.issue_type='shortage' AND r.status='open'
                     ORDER BY r.created_at DESC LIMIT 100`, [storeId,activeBranchId]);
                const [conditionReports] = await connection.execute(
                    `SELECT r.id, bi.product_id AS productId, bi.variant_id AS variantId,
                            p.name AS productName, r.issue_type AS issueType, r.reason AS notes,
                            bi.expiration_date AS expirationDate,
                            r.created_at AS createdAt
                     FROM stock_issues r
                              JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id=r.branch_inventory_id
                              JOIN ${V2_PRODUCTS} p ON p.id=bi.product_id
                     WHERE r.store_id=? AND r.branch_id=? AND r.status='open'
                       AND r.issue_type IN ('expired','expiring','damaged')
                     ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
                    [storeId,activeBranchId]);
                const [movements] = await connection.execute(
                    `SELECT m.id, m.created_at AS at, p.name AS productName,
                            pv.variant_values AS variantValues, m.movement_type AS kind,
                            m.quantity_delta AS quantity, m.reference_type AS referenceType,
                            m.reference_id AS reference, m.actor_name AS actorName
                     FROM ${V2_INVENTORY_MOVEMENTS} m
                         JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id=m.branch_inventory_id AND bi.store_id=m.store_id AND bi.branch_id=m.branch_id
                         JOIN ${V2_PRODUCTS} p ON p.id=bi.product_id
                         LEFT JOIN ${V2_PRODUCT_VARIANTS} pv ON pv.id=bi.variant_id AND pv.product_id=p.id
                     WHERE m.store_id=? AND m.branch_id=? AND ${operationalMovementsOnly}
                     ORDER BY m.created_at DESC, m.id DESC LIMIT 8`, [storeId,activeBranchId]);
                // A proper daily count, independent of list limits and previous days.
                // Count actual movement rows, not unique POS orders or stock units.
                const [todayRows] = await connection.execute(
                    `SELECT COUNT(*) AS total
                     FROM inventory_movements m
                     WHERE m.store_id=? AND m.branch_id=? AND ${operationalMovementsOnly}
                       AND m.created_at >= FROM_UNIXTIME(?) AND m.created_at < FROM_UNIXTIME(?)`,
                    [storeId,activeBranchId,manilaDayStartEpoch,manilaDayStartEpoch+86400]);
                return jsonResponse(200, headers, {
                    success:true, canReceiveStock:allowedReceiving, supportsPartialReceiving:true,
                    receivingTasks, shortages, conditionReports, supportsConditionReports:true, movements,
                    todayMovementCount:Number(todayRows[0]?.total || 0),
                });
            }
            if (action === "set_staff_receiving_permission") {
                if (tokenRole !== "manager" && tokenRole !== "owner") return unauthorized(headers,"Only authorized supervisors may grant stock receiving.");
                const targetStaffId = Number(body.staffId ?? body.staff_id);
                if (!Number.isSafeInteger(targetStaffId) || targetStaffId <= 0 || typeof body.allowed !== "boolean") {
                    return badRequest(headers,"A staff account and explicit permission are required.");
                }
                await connection.beginTransaction();
                const [matches] = await connection.execute(
                    `SELECT id, permissions FROM users WHERE id=? AND store_id=? AND branch_id=? AND role='staff' LIMIT 1 FOR UPDATE`,
                    [targetStaffId,storeId,activeBranchId]);
                if (!matches.length) {await safeRollback(connection);return notFound(headers,"Staff account not found in this branch.");}
                let current = {};
                try { current = typeof matches[0].permissions === "string" ? JSON.parse(matches[0].permissions) : (matches[0].permissions || {}); }
                catch { current = {}; }
                // Stock receiving also requires full inventory module access.
                if (body.allowed && current.inventory_access !== "full") {
                    await safeRollback(connection);return badRequest(headers,"Grant full Inventory access before enabling stock receiving.");
                }
                await connection.execute(
                    `UPDATE users SET permissions = JSON_SET(COALESCE(permissions,JSON_OBJECT()),'$.inventory_stock_receive', JSON_EXTRACT(?, '$')) WHERE id=? AND store_id=? AND branch_id=? AND role='staff'`,
                    [String(body.allowed), targetStaffId, storeId, activeBranchId]);
                await logEmployeeAction(connection, {storeId,branchId:activeBranchId,employee,module:"Inventory",
                    action:body.allowed ? "Granted staff receiving access" : "Revoked staff receiving access",
                    referenceId:String(targetStaffId),details:"Staff receiving permission updated"});
                await connection.commit();
                return jsonResponse(200,headers,{success:true,allowed:body.allowed});
            }
            if (action === "authorize_staff_stock_receipt") {
                // Staff stock receiving tasks are not part of stocknbook_v2.
                // Managers record deliveries directly with Receive Stock.
                return jsonResponse(410,headers,{error:"Staff receiving tasks are no longer available. Use Receive Stock to record the delivery."});
            }
            if (action === "cancel_staff_stock_receipt") {
                return jsonResponse(410,headers,{error:"Staff receiving tasks are no longer available."});
            }
            if (action === "complete_staff_stock_receipt") {
                return jsonResponse(410,headers,{error:"Staff receiving tasks are no longer available. Ask the Manager to record the delivery with Receive Stock."});
            }

            if (action === "report_staff_stock_condition") {
                if (!["staff","manager"].includes(tokenRole)) return unauthorized(headers,"Only branch operations may report product conditions.");
                const {productId,variantId,valid}=itemIdentity();
                const issueType=String(body.issueType || "").trim().toLowerCase();
                const notes=toSafeString(body.notes,500);
                if (!valid || !["expired","expiring","damaged"].includes(issueType) || notes.length<5)
                    return badRequest(headers,"Select a product, valid issue type, and at least 5 characters of notes.");
                await connection.beginTransaction();
                const locked = await lockProductForUpdate(connection,storeId,activeBranchId,productId);
                if (!locked) {await safeRollback(connection);return notFound(headers,"Product not in this branch.");}
                const products = [locked];
                if (Boolean(products[0].has_variants)!==(variantId!==null)) {await safeRollback(connection);return badRequest(headers,"Select the correct product variant.");}
                let expiry=products[0].expiration_date;
                if (variantId!==null) {
                    const variants=await lockVariantsForUpdate(connection,productId,variantId);
                    if (!variants.length) {await safeRollback(connection);return notFound(headers,"Variant unavailable.");}
                    expiry=variants[0].expiration_date;
                }
                const nowParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
                const bit=key=>nowParts.find(p=>p.type===key)?.value||"";
                const today=`${bit("year")}-${bit("month")}-${bit("day")}`;
                const thirty=new Date(`${today}T00:00:00Z`);
                thirty.setUTCDate(thirty.getUTCDate()+30);
                const soon=thirty.toISOString().slice(0,10);
                const expiryKey=expiry instanceof Date ? expiry.toISOString().slice(0,10) : (expiry ? String(expiry).slice(0,10) : "");
                if ((issueType==="expired" && (!expiryKey || expiryKey>=today)) ||
                    (issueType==="expiring" && (!expiryKey || expiryKey<today || expiryKey>soon))) {
                    await safeRollback(connection);return badRequest(headers,"The recorded expiration date does not match this report type.");
                }
                const inventory = await v2LockInventory(connection,{storeId,branchId:activeBranchId,productId,variantId});
                if (!inventory) {await safeRollback(connection);return notFound(headers,"Branch inventory record is missing.");}
                const [duplicate]=await connection.execute(
                    `SELECT id FROM stock_issues WHERE store_id=? AND branch_id=? AND branch_inventory_id=?
                                                   AND issue_type=? AND status='open' LIMIT 1`,
                    [storeId,activeBranchId,inventory.id,issueType]);
                if (duplicate.length) {await safeRollback(connection);return jsonResponse(409,headers,{error:"This product condition is already reported and awaiting review."});}
                const [created] = await connection.execute(
                    `INSERT INTO stock_issues
                     (store_id,branch_id,branch_inventory_id,issue_type,quantity,reason,status,reported_by)
                     VALUES (?,?,?,?,?,?,'open',?)`,
                    [storeId,activeBranchId,inventory.id,issueType,Math.max(1,Number(inventory.quantity_on_hand)||0),
                        notes,await v2ActorUserId(connection,storeId,employee.id)]);
                await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,module:"Inventory",
                    referenceNumber:products[0].product_number,action:`Reported product condition: ${issueType}`,
                    referenceId:String(created.insertId),details:notes});
                await connection.commit();
                return jsonResponse(201,headers,{success:true});
            }
            if (action === "resolve_staff_stock_condition") {
                if (!["manager","owner"].includes(tokenRole)) return unauthorized(headers,"Manager review required.");
                const reportId=Number(body.reportId);
                if (!Number.isSafeInteger(reportId)||reportId<1) return badRequest(headers,"Invalid condition report.");
                const [updated]=await connection.execute(
                    `UPDATE stock_issues SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP
                     WHERE id=? AND store_id=? AND branch_id=? AND status='open'
                       AND issue_type IN ('expired','expiring','damaged')`,
                    [await v2ActorUserId(connection,storeId,employee.id),reportId,storeId,activeBranchId]);
                if (!updated.affectedRows) return notFound(headers,"Report already resolved or unavailable.");
                return jsonResponse(200,headers,{success:true});
            }
            if (action === "report_staff_stock_shortage") {
                if (tokenRole !== "staff" && tokenRole !== "manager") return unauthorized(headers,"Not permitted.");
                const {productId,variantId,valid} = itemIdentity();
                const notes=toSafeString(body.notes,500);
                if (!valid || notes.length < 5) return badRequest(headers,"Select an item and enter at least 5 characters of notes.");
                const [products] = await connection.execute(`SELECT products.id,products.stock,products.alert_level,products.has_variants,
                                                                    products.product_number,products.name
                                                             FROM ${V2_PRODUCTS} products
                                                             WHERE products.id=? AND products.store_id=? AND products.branch_id=? AND products.deleted_at IS NULL`,[productId,storeId,activeBranchId]);
                if (!products.length) return notFound(headers,"Product not in your branch.");
                let stock=Number(products[0].stock),reorder=Number(products[0].alert_level);
                if (products[0].has_variants) {
                    if (variantId == null) return badRequest(headers,"Select the specific variant.");
                    const [v] = await connection.execute(`SELECT pv.stock,pv.alert_level FROM ${V2_PRODUCT_VARIANTS} pv
                                                          WHERE pv.id=? AND pv.product_id=? AND pv.deleted_at IS NULL`,[variantId,productId]);
                    if (!v.length) return badRequest(headers,"Variant unavailable.");
                    stock=Number(v[0].stock);reorder=Number(v[0].alert_level);
                } else if (variantId != null) return badRequest(headers,"This product does not have variants.");
                try {
                    await connection.beginTransaction();
                    const inventory = await v2LockInventory(connection,{storeId,branchId:activeBranchId,productId,variantId});
                    if (!inventory) {await safeRollback(connection);return notFound(headers,"Branch inventory record is missing.");}
                    const [open] = await connection.execute(
                        `SELECT id FROM stock_issues WHERE branch_inventory_id=? AND issue_type='shortage' AND status='open' LIMIT 1`,
                        [inventory.id]);
                    if (open.length) {await safeRollback(connection);return jsonResponse(409,headers,{error:"A shortage report is already open for this item."});}
                    const [insert] = await connection.execute(`INSERT INTO stock_issues
                                                               (store_id,branch_id,branch_inventory_id,issue_type,quantity,reason,status,reported_by)
                                                               VALUES (?,?,?,'shortage',?,?,'open',?)`,
                        [storeId,activeBranchId,inventory.id,Math.max(1,reorder-stock),notes,
                            await v2ActorUserId(connection,storeId,employee.id)]);
                    await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,module:"Inventory",
                        referenceNumber:products[0].product_number,action:"Reported stock shortage",referenceId:String(insert.insertId),details:notes});
                    await connection.commit();
                } catch(err) {await safeRollback(connection);throw err;}
                return jsonResponse(201,headers,{success:true});
            }
            if (action === "resolve_staff_stock_shortage") {
                if (!["manager","owner"].includes(tokenRole)) return unauthorized(headers,"Manager authorization required.");
                const reportId=Number(body.reportId);
                if (!Number.isSafeInteger(reportId)||reportId<1) return badRequest(headers,"A valid shortage report is required.");
                const [result] = await connection.execute(`UPDATE stock_issues SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP
                                                           WHERE id=? AND store_id=? AND branch_id=? AND issue_type='shortage' AND status='open'`,
                    [await v2ActorUserId(connection,storeId,employee.id),reportId,storeId,activeBranchId]);
                if (!result.affectedRows) return notFound(headers,"Report already resolved or unavailable.");
                return jsonResponse(200,headers,{success:true});
            }
        }

        if (action === "get_products") {
            const products = await getProducts(connection, storeId, activeBranchId);
            const visibleProducts = hideProductCostsForNonOwners(products, tokenRole);
            return jsonResponse(200, headers, { products: visibleProducts });
        }

        // Read-only purchase references for the existing Recent Stock Activity rows.
        // The manager's branch is derived from the token; IDs are never fabricated.
        if (action === "get_recent_purchased_stock_in") {
            if (!["owner", "manager"].includes(tokenRole)) {
                return unauthorized(headers, "Only owners and managers may view purchase references.");
            }
            if (!activeBranchId) return badRequest(headers, "A branch is required.");
            // Stock-in movements of the last 30 days (no supplier purchase records in stocknbook_v2).
            const [rows] = await connection.execute(
                `SELECT bi.product_id AS productId,
                        COALESCE(p.name, 'Archived Product') AS productName,
                        pv.variant_name AS variantName,
                        m.quantity_delta AS quantity,
                        m.created_at AS recordedAt,
                        NULL AS purchaseNumber,
                        CASE WHEN m.movement_type='OPENING_STOCK' THEN 'add' ELSE 'receive' END AS purchaseSource
                 FROM ${V2_INVENTORY_MOVEMENTS} m
                          JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id = m.branch_inventory_id
                          LEFT JOIN ${V2_PRODUCTS} p ON p.id = bi.product_id
                          LEFT JOIN ${V2_PRODUCT_VARIANTS} pv ON pv.id = bi.variant_id
                 WHERE m.store_id = ? AND m.branch_id = ?
                   AND m.quantity_delta > 0
                   AND m.movement_type IN ('OPENING_STOCK','MANAGER_RECEIPT','STAFF_RECEIPT')
                   AND m.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                 ORDER BY m.created_at DESC, m.id DESC
                     LIMIT 500`,
                [storeId, activeBranchId]
            );
            return jsonResponse(200, headers, { success: true, stockInMovements: rows });
        }

        // Read-only, branch-scoped date lookup for Manager Inventory's
        // "Last Stock In" column. Only positive stock increases qualify.
        if (action === "get_last_stock_in") {
            if (!activeBranchId) return badRequest(headers, "A branch is required.");
            const [rows] = await connection.execute(
                `SELECT bi.product_id AS productId, bi.variant_id AS variantId,
                        pv.variant_name AS variantName,
                        DATE_FORMAT(MAX(m.created_at),'%Y-%m-%d') AS stockInDate
                 FROM ${V2_INVENTORY_MOVEMENTS} m
                          JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id = m.branch_inventory_id
                          JOIN ${V2_PRODUCTS} p ON p.id = bi.product_id AND p.deleted_at IS NULL
                          LEFT JOIN ${V2_PRODUCT_VARIANTS} pv ON pv.id = bi.variant_id
                 WHERE m.store_id = ? AND m.branch_id = ?
                   AND m.quantity_delta > 0
                   AND m.movement_type IN ('OPENING_STOCK','MANAGER_RECEIPT','STAFF_RECEIPT')
                   AND DATE(m.created_at) <= CURRENT_DATE()
                 GROUP BY bi.product_id, bi.variant_id, pv.variant_name`,
                [storeId, activeBranchId]
            );
            // The quantity actually received when the product was created.
            const [initialStockQuantities] = await connection.execute(
                `SELECT bi.product_id AS productId,
                        SUM(m.quantity_delta) AS initialQuantity
                 FROM ${V2_INVENTORY_MOVEMENTS} m
                          JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id = m.branch_inventory_id
                          JOIN ${V2_PRODUCTS} p ON p.id = bi.product_id AND p.deleted_at IS NULL
                 WHERE m.store_id = ? AND m.branch_id = ?
                   AND m.movement_type = 'OPENING_STOCK'
                 GROUP BY bi.product_id`,
                [storeId, activeBranchId]
            );
            return jsonResponse(200, headers, { success: true, stockInRecords: rows, initialStockQuantities });
        }


        if (action === "get_stock_suppliers") {
            if (!["owner", "manager"].includes(tokenRole)) {
                return unauthorized(headers, "Supplier purchasing information is restricted to Managers and Owners.");
            }
            if (!activeBranchId) return badRequest(headers, "A branch is required.");
            // Supplier records are not part of stocknbook_v2.
            return jsonResponse(200, headers, { success: true, suppliers: [] });
        }

        /* Dedicated stock receipt: updates quantities and moving-average unit costs,
           applying the manager's chosen selling price within the same transaction.
           Earlier supplier purchase amounts and variant definitions are untouched. */
        if (action === "receive_stock") {
            // This action creates supplier purchases, changes costs and can reprice stock.
            // Staff may only complete a Manager-authorized physical receipt through
            // complete_staff_stock_receipt; never permit the general purchasing path.
            if (!["owner", "manager"].includes(tokenRole)) {
                return unauthorized(headers, "Only a Manager or Owner may record supplier purchases and change pricing. Staff must use an authorized receiving task.");
            }
            const productId = Number(body.product_id ?? body.productId);
            if (!activeBranchId || !Number.isInteger(productId) || productId <= 0) {
                return badRequest(headers, "A valid product and branch are required.");
            }
            const supplier = toSafeString(body.supplier, 150);
            const invoiceNumber = toSafeString(body.supplierInvoiceNumber ?? body.supplier_invoice_number, 80) || null;
            let receivedDate;
            let dueDate;
            try {
                receivedDate = normalizeOptionalDate(body.receivedDate);
                dueDate = normalizeOptionalDate(body.paymentDueDate);
            } catch (error) { return badRequest(headers, error.message); }
            const paymentMethod = String(body.paymentMethod || "").trim().toLowerCase();
            const todayParts = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
            }).formatToParts(new Date());
            const datePart = (kind) => todayParts.find(p => p.type === kind)?.value || "";
            const todayInPhilippines = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
            if (receivedDate && receivedDate > todayInPhilippines) {
                return badRequest(headers, "Date Received cannot be in the future.");
            }
            if (!supplier || !receivedDate || !["cash", "credit"].includes(paymentMethod)) {
                return badRequest(headers, "Supplier, Date Received and Cash/Credit are required.");
            }
            const rawLines = body.lines;
            if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 200) {
                return badRequest(headers, "Select between 1 and 200 receiving lines.");
            }
            const cleanLines = [];
            const seen = new Set();
            for (const raw of rawLines) {
                const variantId = raw.variantId == null ? null : Number(raw.variantId);
                const quantity = Number(raw.quantity);
                const unitPurchaseCost = Number(raw.unitPurchaseCost);
                let expirationDate;
                try { expirationDate = normalizeOptionalDate(raw.expirationDate); }
                catch (error) { return badRequest(headers, error.message); }
                if ((variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) ||
                    !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000 ||
                    !Number.isFinite(unitPurchaseCost) || unitPurchaseCost < 0 || unitPurchaseCost > 100000000 ||
                    Math.round(unitPurchaseCost * 100) !== unitPurchaseCost * 100 &&
                    Math.abs(Math.round(unitPurchaseCost * 100) - unitPurchaseCost * 100) > 0.00001) {
                    return badRequest(headers, "Each line requires a positive whole quantity and a valid unit purchase cost (2 decimal places max).");
                }
                if (expirationDate && expirationDate < receivedDate) {
                    return badRequest(headers, "An incoming batch cannot be expired before Date Received.");
                }
                if (expirationDate && expirationDate < todayInPhilippines) {
                    return badRequest(headers, "Do not receive an already expired batch into sellable stock.");
                }
                const key = String(variantId ?? "regular");
                if (seen.has(key)) return badRequest(headers, "Duplicate receiving variant line.");
                seen.add(key);
                if (raw.orderedQuantity !== undefined && Number(raw.orderedQuantity) !== quantity) {
                    return badRequest(headers, "Receive Stock accepts only quantities received now. Create another purchase for a separate delivery.");
                }
                // Pricing choice is optional for older clients; default to keeping
                // the existing retail price. The server always calculates average cost.
                const pricingDecision = String(raw.pricingDecision || "keep").trim().toLowerCase();
                if (!["keep", "suggested", "manual"].includes(pricingDecision)) {
                    return badRequest(headers, "Selling price decision must be Keep, Suggested, or Manual.");
                }
                let manualSellingPrice = null;
                if (pricingDecision === "manual") {
                    try {
                        manualSellingPrice = exactMoney(raw.manualSellingPrice, "Manual Selling Price") / 100;
                    } catch (error) { return badRequest(headers, error.message); }
                    if (manualSellingPrice > 100000000) {
                        return badRequest(headers, "Manual Selling Price is too large.");
                    }
                }
                // An explicit markup is used for newly priced zero-stock items
                // and for applying the weighted-average suggestion to remaining stock.
                let pricingMarkupPercentage = null;
                if (pricingDecision === "suggested" && raw.pricingMarkupPercentage !== undefined) {
                    const markupInput = raw.pricingMarkupPercentage;
                    if (markupInput === null || markupInput === "" ||
                        !Number.isFinite(Number(markupInput)) || Number(markupInput) < 0 ||
                        Number(markupInput) > 99999 ||
                        Math.abs(Number(markupInput) * 10000 - Math.round(Number(markupInput) * 10000)) > 0.00001) {
                        return badRequest(headers, "Markup Percentage must be between 0 and 99999 (up to four decimal places).");
                    }
                    pricingMarkupPercentage = Number(markupInput);
                }
                cleanLines.push({ variantId, quantity, unitPurchaseCost, expirationDate,
                    pricingDecision, manualSellingPrice, pricingMarkupPercentage,
                    expectedPricing:raw.expectedPricing ?? null });
            }
            const costCents = cleanLines.reduce((sum, line) =>
                sum + line.quantity * Math.round(line.unitPurchaseCost * 100), 0);
            if (!Number.isSafeInteger(costCents)) return badRequest(headers, "Purchase cost is too large.");
            const purchaseTotal = costCents / 100;
            const inputPaid = Number(body.amountPaid ?? 0);
            if (!Number.isFinite(inputPaid) || inputPaid < 0 || inputPaid > purchaseTotal ||
                Math.abs(Math.round(inputPaid * 100) - inputPaid * 100) > 0.00001) {
                return badRequest(headers, "Amount Paid must be between zero and the total purchase cost.");
            }
            const amountPaid = paymentMethod === "cash" ? purchaseTotal : Math.round(inputPaid * 100) / 100;
            const outstandingBalance = (costCents - Math.round(amountPaid * 100)) / 100;
            if (body.purchaseId != null && String(body.purchaseId).trim() !== "") {
                return badRequest(headers, "Each Receive Stock submission creates one new supplier purchase. Existing-purchase deliveries are not supported.");
            }
            if (outstandingBalance > 0 && (!dueDate || dueDate < receivedDate)) {
                return badRequest(headers, "A valid Payment Due Date is required for unpaid credit.");
            }
            const requestKey = toSafeString(body.requestKey, 80);
            if (!requestKey) return badRequest(headers, "Receiving request key is required to prevent duplicate stock receipts.");
            await connection.beginTransaction();
            // Lock the parent product to serialize concurrent receives for it.
            const lockedProduct = await lockProductForUpdate(connection, storeId, activeBranchId, productId);
            if (!lockedProduct) { await safeRollback(connection); return notFound(headers, "Product not found."); }
            // The same request key is answered from the stock movement it created.
            const receiptReference = `RCV-${requestKey}`;
            const [previous] = await connection.execute(
                `SELECT id FROM inventory_movements
                 WHERE store_id=? AND branch_id=? AND reference_type='STOCK_RECEIPT' AND reason LIKE ?
                 ORDER BY id LIMIT 1`,
                [storeId, activeBranchId, `Ref ${receiptReference.replace(/: /g, " ")}-%`]);
            if (previous.length) {
                await connection.commit();
                return jsonResponse(200, headers, {success:true, alreadyProcessed:true,
                    receiptId:previous[0].id, purchaseId:null});
            }
            const current = lockedProduct;
            const isVariantProduct = Number(current.has_variants) === 1;
            const variants = new Map();
            if (isVariantProduct) {
                const rows = await lockVariantsForUpdate(connection, productId);
                for (const variant of rows) variants.set(Number(variant.id), variant);
            }
            const receiptLines = [];
            for (const line of cleanLines) {
                if (isVariantProduct && (line.variantId === null || !variants.has(line.variantId))) {
                    await safeRollback(connection);
                    return badRequest(headers, "One receiving variant no longer belongs to this product.");
                }
                if (!isVariantProduct && line.variantId !== null) {
                    await safeRollback(connection);
                    return badRequest(headers, "Regular products cannot receive variant lines.");
                }
                const variant = isVariantProduct ? variants.get(line.variantId) : null;
                const variantName = variant ? getVariantDisplayName(parseVariantValues(variant.variant_values)) : null;
                const pricingRow = variant || current;
                const currentStock = Number(pricingRow.stock);
                const oldAverageCost = Number(pricingRow.original_price);
                const oldSellingPrice = Number(pricingRow.sales_price);
                const oldPricingMethod = String(pricingRow.pricing_method || "manual").toLowerCase();
                const oldMarkupRaw = pricingRow.markup_percentage;
                const oldMarkup = oldMarkupRaw === null || oldMarkupRaw === undefined ? null : Number(oldMarkupRaw);
                if (!Number.isSafeInteger(currentStock) || currentStock < 0 ||
                    !Number.isFinite(oldAverageCost) || oldAverageCost < 0 ||
                    !Number.isFinite(oldSellingPrice) || oldSellingPrice < 0 ||
                    (oldMarkup !== null && (!Number.isFinite(oldMarkup) || oldMarkup < 0))) {
                    await safeRollback(connection);
                    return badRequest(headers, "The saved inventory cost, price, or quantity is invalid.");
                }
                // Prevent overwriting changes made by another manager after the dialog loaded.
                const expected = line.expectedPricing;
                if (expected && typeof expected === "object") {
                    const matches = Number(expected.stock) === currentStock &&
                        Math.abs(Number(expected.averageCost) - oldAverageCost) < 0.011 &&
                        Math.abs(Number(expected.sellingPrice) - oldSellingPrice) < 0.011 &&
                        String(expected.pricingMethod || "manual").toLowerCase() === oldPricingMethod &&
                        (expected.markupPercentage == null && oldMarkup === null ||
                            expected.markupPercentage != null && oldMarkup !== null &&
                            Math.abs(Number(expected.markupPercentage) - oldMarkup) < 0.0001);
                    if (!matches) {
                        await safeRollback(connection);
                        return jsonResponse(409, headers, {error:
                                "Stock, cost, or pricing changed since Receive Stock was opened. Close and reopen the dialog before confirming."});
                    }
                }
                // Use the branch balance for weighted-average receiving cost.
                // A legacy catalog-only discrepancy is not physical stock and
                // must not inflate the cost weighting of a new supplier receipt.
                const valuationInventory = await v2LockInventory(connection,
                    {storeId,branchId:activeBranchId,productId,variantId:line.variantId});
                const valuationRows = valuationInventory ? [valuationInventory] : [];
                if (!valuationRows.length) {
                    await safeRollback(connection);
                    return jsonResponse(409,headers,{error:'Active branch inventory is missing. Reconcile before receiving stock.'});
                }
                const valuationStock = Number(valuationRows[0].quantity_on_hand);
                if (!Number.isSafeInteger(valuationStock) || valuationStock < 0) {
                    await safeRollback(connection);
                    return jsonResponse(409,headers,{error:'Invalid branch inventory balance. Reconcile before receiving stock.'});
                }
                // Original receipt unit costs remain recorded separately for audit.
                const averageCost = roundMoney((valuationStock * oldAverageCost +
                    line.quantity * line.unitPurchaseCost) / (valuationStock + line.quantity));
                const impliedMarkup = oldAverageCost > 0
                    ? Math.max(0, (oldSellingPrice / oldAverageCost - 1) * 100) : 0;
                const targetMarkup = line.pricingMarkupPercentage !== null
                    ? line.pricingMarkupPercentage
                    : oldPricingMethod === "markup" && oldMarkup !== null
                        ? oldMarkup : Math.round(impliedMarkup * 10000) / 10000;
                const suggestedPrice = roundMoney(averageCost * (1 + targetMarkup / 100));
                // Validate only a price which the user actually chose. An extreme
                // implied markup must not prevent Keep/Manual stock receiving.
                if (line.pricingDecision === "suggested" &&
                    (!Number.isFinite(suggestedPrice) || suggestedPrice > 100000000 ||
                        !Number.isFinite(targetMarkup) || targetMarkup < 0 || targetMarkup > 99999)) {
                    await safeRollback(connection);
                    return badRequest(headers, "The suggested selling price exceeds the allowed pricing range.");
                }
                // Every receiving line, including stock that had reached zero,
                // can now choose Manual or Percentage Markup explicitly.
                // Legacy requests without a choice retain their current retail price.
                const selectedPrice = line.pricingDecision === "suggested"
                    ? suggestedPrice
                    : line.pricingDecision === "manual"
                        ? line.manualSellingPrice : oldSellingPrice;
                const selectedMethod = line.pricingDecision === "suggested"
                    ? "markup"
                    : oldPricingMethod === "markup" && oldMarkup !== null &&
                    line.pricingDecision === "keep" &&
                    Math.abs(selectedPrice - roundMoney(averageCost * (1 + oldMarkup / 100))) < 0.011
                        ? "markup" : "manual";
                // Retain saved markup for manual pricing so Edit Product can
                // still display the previous target if the manager needs it.
                const selectedMarkup = selectedMethod === "markup"
                    ? (line.pricingDecision === "suggested" ? targetMarkup : oldMarkup)
                    : oldMarkup;
                if (!Number.isFinite(selectedPrice) || selectedPrice < 0 || selectedPrice > 100000000) {
                    await safeRollback(connection);
                    return badRequest(headers, "The selected selling price is invalid.");
                }
                receiptLines.push({ ...line, variantName, stockBefore: currentStock,
                    averageCost, selectedPrice, selectedMethod, selectedMarkup });
            }
            const receivedBy = await getRestockReceivedBy(connection, decoded, tokenRole, storeId);
            // Every Receive Stock submission is a single fully received supplier purchase.
            const ledger = await createPurchaseLedger(connection, {
                storeId, branchId:activeBranchId, input:{supplier, supplierInvoiceNumber:invoiceNumber,
                    purchaseDate:receivedDate, paymentMethod, amountPaid, paymentDueDate:dueDate},
                lines:receiptLines.map(line=>({...line, productId})),
                source:"receive", requestKey, receivedBy, receivedDate});
            let receiptId = ledger.receiptId;
            const purchaseId = ledger.purchaseId;
            const totalQuantity = cleanLines.reduce((sum, line) => sum + line.quantity, 0);
            // Credit the NEW verified delivery into branch and batch records.
            // An older positive catalog-only discrepancy is retained for a
            // separate physical audit, not treated as available stock.
            const actingEmployee = await getActingEmployee(connection, decoded, tokenRole, storeId);
            const creditResults = [];
            for (const [lineIndex,line] of receiptLines.entries()) {
                const match = isVariantProduct ? variants.get(line.variantId) : current;
                creditResults.push(await creditBranchInventoryBatch(connection,{
                    storeId,branchId:activeBranchId,productId,variantId:line.variantId,
                    quantity:line.quantity,expectedBefore:line.stockBefore,
                    reorderLevel:Number(match.alert_level ?? match.alertLevel ?? current.alert_level ?? 0),
                    costPrice:line.averageCost,salesPrice:line.selectedPrice,
                    expirationDate:line.expirationDate,
                    reference:`${receiptReference}-${lineIndex + 1}`,
                    actorId:Number(decoded?.manager_id||decoded?.user_id||0)||null,
                    actorRole:tokenRole,actorName:actingEmployee.name,
                    allowVerifiedReceiptWithCatalogDrift:true,
                }));
            }
            // The first stock movement of this delivery is its receipt number.
            receiptId = creditResults[0]?.movementId || receiptId;
            // Stock was credited above; save the new average cost and the chosen selling price.
            for (const line of receiptLines) {
                if (line.variantId !== null) {
                    await connection.execute(
                        `UPDATE product_variants
                         SET cost_price = ?, selling_price = ?,
                             pricing_method = ?, markup_percentage = ?
                         WHERE id = ? AND product_id = ? AND is_default = 0 AND deleted_at IS NULL`,
                        [line.averageCost, line.selectedPrice,
                            line.selectedMethod, line.selectedMarkup, line.variantId, productId]);
                }
            }
            if (isVariantProduct) {
                // Parent product's display prices follow the updated variant rows.
                // Preserve its existing pricing method: variant pricing is individual.
                const [updatedVariants] = await connection.execute(
                    `SELECT cost_price AS original_price, selling_price AS sales_price FROM product_variants
                     WHERE product_id = ? AND is_default = 0 AND deleted_at IS NULL`, [productId]);
                const minimumPositive = (field) => {
                    const prices = updatedVariants.map(row => Number(row[field]))
                        .filter(price => Number.isFinite(price) && price > 0);
                    return prices.length ? Math.min(...prices) : 0;
                };
                await connection.execute(
                    `UPDATE product_variants SET cost_price = ?, selling_price = ?
                     WHERE product_id = ? AND is_default = 1`,
                    [minimumPositive("original_price"), minimumPositive("sales_price"), productId]);
            } else {
                const line = receiptLines[0];
                await connection.execute(
                    `UPDATE product_variants SET cost_price = ?, selling_price = ?,
                                                 pricing_method = ?, markup_percentage = ?
                     WHERE product_id = ? AND is_default = 1`,
                    [line.averageCost, line.selectedPrice, line.selectedMethod,
                        line.selectedMarkup, productId]);
            }
            for (const [index,line] of receiptLines.entries()) {
                await assertInventoryLineSynchronized(connection,{
                    storeId,branchId:activeBranchId,productId,variantId:line.variantId,
                    expected:creditResults[index].after,
                    expectedCatalog:line.stockBefore+line.quantity});
            }
            const reconciliationWarnings = creditResults.flatMap((result,index) =>
                result.catalogDrift > 0 ? [{
                    productId,variantId:receiptLines[index].variantId,
                    catalogMinusBranch:result.catalogDrift,
                    message:'Historical catalog-only units remain unverified and unavailable. Reconcile separately.',
                }] : []);
            await logEmployeeAction(connection, {
                storeId, branchId: activeBranchId, employee: actingEmployee,
                module: "Inventory", referenceNumber: current.product_number || String(productId),
                action: "Restocked inventory", referenceId: String(productId),
                details: `Received ${totalQuantity} unit(s) of ${current.name} from ${supplier} (Receipt #${receiptId})`+
                    (reconciliationWarnings.length ? `; pre-existing catalog discrepancies preserved: ${JSON.stringify(reconciliationWarnings)}` : ''),
            });
            await connection.commit();
            return jsonResponse(200, headers, {
                success: true, receiptId, purchaseId, receivingNumber:`RCV-${String(receiptId).padStart(6,"0")}`,
                totalQuantity, purchaseTotal: ledger.purchaseTotal,
                amountPaid: ledger.amountPaid,
                outstandingBalance: ledger.outstandingBalance,
                reconciliationRequired:reconciliationWarnings.length>0,
                reconciliationWarnings,
            });
        }

        if (action === "get_supplier_payables") {
            if (!["owner", "manager"].includes(tokenRole)) return unauthorized(headers, "Not permitted.");
            // Supplier payables are not part of stocknbook_v2.
            return jsonResponse(200,headers,{success:true,payables:[]});
        }
        if (action === "update_supplier_purchase") {
            if (!["owner", "manager"].includes(tokenRole)) return unauthorized(headers,"Not permitted.");
            try {
                const result = await updateSupplierPurchaseDetails(connection, {
                    purchaseId:Number(body.purchaseId),storeId,activeBranchId,
                    details:body.details,expected:body.expected,decoded,tokenRole,
                });
                return jsonResponse(200,headers,result);
            } catch (error) {
                if (error.purchaseEditStatus) return jsonResponse(error.purchaseEditStatus,headers,{error:error.message});
                throw error;
            }
        }
        if (action === "get_supplier_purchase_items") {
            if (!["owner", "manager"].includes(tokenRole)) return unauthorized(headers,"Not permitted.");
            return notFound(headers,"Purchase not found in this store/branch.");
        }
        if (action === "pay_supplier_purchase") {
            if (!["owner", "manager"].includes(tokenRole)) return unauthorized(headers,"Not permitted.");
            return jsonResponse(410,headers,{error:"Supplier payments are no longer recorded in StockNBook."});
        }

        // Expired goods are excluded from availability automatically. The physical
        // ledger changes only after a Manager confirms actual disposal. Retain
        // the batch, product, receiving documents, and audited movement history.
        if (action === "get_expired_batches") {
            if (tokenRole !== "manager" || !activeBranchId) return unauthorized(headers,"Manager Inventory permission required.");
            const productId = Number(body.productId);
            const variantId = body.variantId == null ? null : Number(body.variantId);
            if (!Number.isSafeInteger(productId) || productId < 1 ||
                (variantId !== null && (!Number.isSafeInteger(variantId) || variantId < 1))) {
                return badRequest(headers,"Choose a valid product or variant.");
            }
            const catalogVariantId = await v2CatalogVariantId(connection, productId, variantId);
            const [rows] = await connection.execute(
                `SELECT bi.id AS batchId,CONCAT('INV-',bi.id) AS batchCode,bi.on_hand_quantity AS remainingQuantity,
                        DATE_FORMAT(bi.expiration_date,'%Y-%m-%d') AS expirationDate,'expired' AS status
                 FROM branch_inventory bi
                          JOIN product_variants v ON v.id=bi.variant_id
                          JOIN products p ON p.id=v.product_id
                 WHERE p.id=? AND p.store_id=? AND p.deleted_at IS NULL
                   AND bi.store_id=? AND bi.branch_id=? AND bi.status='active'
                   AND bi.variant_id=?
                   AND bi.on_hand_quantity>0
                   AND bi.expiration_date IS NOT NULL
                   AND bi.expiration_date < DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR)
                 ORDER BY bi.expiration_date ASC,bi.id ASC`,
                [productId,storeId,storeId,activeBranchId,catalogVariantId]);
            return jsonResponse(200,headers,{success:true,batches:rows});
        }
        // Read the already-audited expired-stock removals for the Manager's
        // Recent Stock Activity. Never recalculate or change stock here.
        if (action === "get_recent_expired_disposals") {
            if (tokenRole !== "manager" || !activeBranchId) {
                return unauthorized(headers, "Manager Inventory permission required.");
            }
            const manilaToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
            const dayStartEpoch = Math.floor(Date.parse(`${manilaToday}T00:00:00Z`) / 1000) - 8 * 3600;
            const [rows] = await connection.execute(
                `SELECT m.id, m.created_at AS recordedAt, p.name AS productName,
                        pv.variant_values AS variantValues, m.quantity_delta AS quantity
                 FROM ${V2_INVENTORY_MOVEMENTS} m
                          JOIN ${V2_BRANCH_INVENTORY} bi ON bi.id = m.branch_inventory_id
                     AND bi.store_id = m.store_id AND bi.branch_id = m.branch_id
                          JOIN ${V2_PRODUCTS} p ON p.id = bi.product_id
                          LEFT JOIN ${V2_PRODUCT_VARIANTS} pv ON pv.id = bi.variant_id AND pv.product_id = p.id
                 WHERE m.store_id = ? AND m.branch_id = ?
                   AND m.movement_type = 'EXPIRED_DISPOSAL'
                   AND m.created_at >= FROM_UNIXTIME(?)
                   AND m.created_at < FROM_UNIXTIME(?)
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
                [storeId, activeBranchId, dayStartEpoch, dayStartEpoch + 86400]
            );
            return jsonResponse(200, headers, { success: true, disposals: rows });
        }
        if (action === "dispose_expired_batch") {
            if (tokenRole !== "manager" || !activeBranchId) return unauthorized(headers,"Manager authorization is required to record disposal.");
            const productId=Number(body.productId);
            const variantId=body.variantId==null?null:Number(body.variantId);
            const batchId=Number(body.batchId),quantity=Number(body.quantity);
            const reason=toSafeString(body.reason,500);
            const requestKey=toSafeString(body.requestKey,80);
            if(!Number.isSafeInteger(productId)||productId<1||
                (variantId!==null&&(!Number.isSafeInteger(variantId)||variantId<1))||
                !Number.isSafeInteger(batchId)||batchId<1||
                !Number.isSafeInteger(quantity)||quantity<1||quantity>2147483647||
                reason.length<8||!requestKey||!parseBooleanFlag(body.physicallyRemoved)) {
                return badRequest(headers,"Select an expired batch, enter the physically removed quantity and reason (8+ characters), and confirm physical removal.");
            }
            await connection.beginTransaction();
            // Lock the parent product first so independent stock operations on
            // this product cannot race this disposal. No new receipt is created.
            const product=await lockProductForUpdate(connection,storeId,activeBranchId,productId);
            if(!product){await safeRollback(connection);return notFound(headers,"Product not found in this branch.");}
            if(Boolean(Number(product.has_variants))!==(variantId!==null)){
                await safeRollback(connection);return badRequest(headers,"Choose the correct variant for this product.");
            }
            const inventory=await v2LockInventory(connection,{storeId,branchId:activeBranchId,productId,variantId});
            if(!inventory){await safeRollback(connection);return notFound(headers,"Branch inventory record is missing.");}
            const [existing]=await connection.execute(
                `SELECT id FROM inventory_movements WHERE store_id=? AND branch_id=?
                                                      AND branch_inventory_id=? AND reference_type='EXPIRED_DISPOSAL' AND reason LIKE ? LIMIT 1`,
                [storeId,activeBranchId,inventory.id,`Ref ${requestKey.replace(/: /g," ")}: %`]);
            if(existing.length){await connection.commit();return jsonResponse(200,headers,{success:true,alreadyProcessed:true});}
            const before=Number(inventory.quantity_on_hand);
            const available=before-Number(inventory.reserved_quantity||0)-Number(inventory.unavailable_quantity||0);
            const exp=inventory.expiration_date instanceof Date
                ?inventory.expiration_date.toISOString().slice(0,10)
                :String(inventory.expiration_date||'').slice(0,10);
            const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Manila'});
            if(batchId!==Number(inventory.id)||!Number.isSafeInteger(before)||available<quantity||!exp||exp>=today){
                await safeRollback(connection);return badRequest(headers,"The selected batch is not expired, already disposed, or has insufficient remaining units.");
            }
            await connection.execute(
                `UPDATE branch_inventory SET on_hand_quantity=on_hand_quantity-? WHERE id=?`,[quantity,inventory.id]);
            const employee=await getActingEmployee(connection,decoded,tokenRole,storeId);
            await v2RecordMovement(connection,{storeId,branchId:activeBranchId,inventoryId:inventory.id,
                movementType:'EXPIRED_DISPOSAL',delta:-quantity,before,after:before-quantity,
                referenceType:'EXPIRED_DISPOSAL',referenceId:productId,reference:requestKey,actorId:employee.id,
                notes:`Batch ${batchId}, expiry ${exp}; ${reason}`.slice(0,500)});
            // Resolve an expired-condition report once no expired units remain.
            if(before-quantity===0){
                await connection.execute(
                    `UPDATE stock_issues
                     SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP
                     WHERE store_id=? AND branch_id=? AND branch_inventory_id=?
                       AND issue_type='expired' AND status='open'`,
                    [await v2ActorUserId(connection,storeId,employee.id),storeId,activeBranchId,inventory.id]);
            }
            await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,
                module:'Inventory',referenceNumber:product.product_number||String(productId),
                action:'Disposed expired batch',referenceId:String(batchId),
                details:`Removed ${quantity} expired units from batch ${batchId} (${exp}); reason: ${reason}`});
            await connection.commit();
            return jsonResponse(200,headers,{success:true,productId,variantId,batchId,disposedQuantity:quantity,
                remainingBranchStock:before-quantity});
        }

        if (action === "adjust_stock") {
            if (!["owner","manager"].includes(tokenRole) || !activeBranchId) return unauthorized(headers,"Not permitted.");
            const productId=Number(body.productId), variantId=body.variantId==null?null:Number(body.variantId);
            const expected=Number(body.expectedStock), target=Number(body.newStock);
            const reason=toSafeString(body.reason,500),requestKey=toSafeString(body.requestKey,80);
            if(!Number.isInteger(productId)||productId<=0 || (variantId!==null && (!Number.isInteger(variantId)||variantId<=0)) ||
                !Number.isInteger(expected)||expected<0||!Number.isInteger(target)||target<0 || target>2147483647 ||
                reason.length<8 || !requestKey) return badRequest(headers,"Provide valid current/corrected stock, a reason of at least 8 characters, and a request reference.");
            await connection.beginTransaction();
            const p=await lockProductForUpdate(connection,storeId,activeBranchId,productId);
            if(!p){await safeRollback(connection);return notFound(headers,"Product not found in this branch.");}
            // A repeated request (same request reference) is answered from the stock movement.
            const [duplicates] = await connection.execute(
                `SELECT m.quantity_after AS newStock FROM inventory_movements m
                 WHERE m.store_id=? AND m.branch_id=? AND m.reference_type='STOCK_ADJUSTMENT' AND m.reason LIKE ? LIMIT 1`,
                [storeId,activeBranchId,`Ref ${requestKey.replace(/: /g," ")}: %`]);
            if (duplicates.length) {await connection.commit();return jsonResponse(200,headers,{success:true,alreadyProcessed:true,newStock:Number(duplicates[0].newStock)});}
            let current, aggregateStock=target;
            if(Boolean(Number(p.has_variants))) {
                if(variantId===null){await safeRollback(connection);return badRequest(headers,"Select a specific variant to adjust.");}
                const variants=await lockVariantsForUpdate(connection,productId);
                const selected=variants.find(row=>Number(row.id)===variantId);
                if(!selected){await safeRollback(connection);return badRequest(headers,"Variant not found.");}
                current=Number(selected.stock);
                aggregateStock=variants.reduce((sum,row)=>sum+Number(Number(row.id)===variantId?target:row.stock),0);
            }else{
                if(variantId!==null){await safeRollback(connection);return badRequest(headers,"This product has no variants.");}
                current=Number(p.stock);
            }
            if(current!==expected){await safeRollback(connection);return badRequest(headers,`Stock changed since opening this dialog (now ${current}). Reopen and retry.`);}
            if(target===current){await safeRollback(connection);return badRequest(headers,"Corrected quantity must differ from current stock.");}
            if(aggregateStock>2147483647){await safeRollback(connection);return badRequest(headers,"Total stock would exceed the supported limit.");}
            const employee=await getActingEmployee(connection,decoded,tokenRole,storeId);
            const [priceInfo]=await connection.execute(
                `SELECT cost_price AS cost FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`,
                [await v2CatalogVariantId(connection,productId,variantId),productId]);
            if(!priceInfo.length){await safeRollback(connection);return notFound(headers,"Product/variant pricing unavailable.");}
            let correctionExpiry;
            try {correctionExpiry=normalizeOptionalDate(body.expirationDate);}
            catch(error){await safeRollback(connection);return badRequest(headers,error.message);}
            const correctionDateParts=new Intl.DateTimeFormat('en-GB',{
                timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',
            }).formatToParts(new Date());
            const correctionDayPart=kind=>correctionDateParts.find(piece=>piece.type===kind)?.value||'';
            const correctionToday=`${correctionDayPart('year')}-${correctionDayPart('month')}-${correctionDayPart('day')}`;
            if(correctionExpiry && correctionExpiry<correctionToday && target>current){
                await safeRollback(connection);return badRequest(headers,"Do not increase sellable stock with an expired date.");
            }
            // The correction and its audited movement are written together.
            await adjustSynchronizedStock(connection,{storeId,branchId:activeBranchId,productId,variantId,
                before:current,target,requestKey,costPrice:Number(priceInfo[0].cost),
                expirationDate:correctionExpiry||null,employee,reason});
            await assertInventoryLineSynchronized(connection,{
                storeId,branchId:activeBranchId,productId,variantId,expected:target});
            await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,
                module:"Inventory",referenceNumber:p.product_number||String(productId),action:"Corrected stock level",referenceId:String(productId),
                details:`Corrected ${variantId?`variant ${variantId}`:"regular product"} stock ${current} -> ${target} (${target-current>=0?"+":""}${target-current}); reason: ${reason}`});
            await connection.commit();
            return jsonResponse(200,headers,{success:true,productId,variantId,previousStock:current,newStock:target,totalStock:aggregateStock});
        }
        if (action === "get_product_editor_details") {
            // Cost and pricing editor details are financial management data;
            // Staff Inventory uses get_products with costs redacted.
            if (!["owner", "manager"].includes(tokenRole)) {
                return unauthorized(headers, "Only a Manager or Owner may access product cost and pricing editor details.");
            }
            const productId = Number(body.id);
            if (!Number.isInteger(productId) || productId <= 0) {
                return badRequest(headers, "Invalid product id");
            }
            const product = await getProductById(connection, storeId, activeBranchId, productId);
            if (!product) return notFound(headers, "Product not found");
            const canonical = await findCanonicalInitialPurchase(connection, storeId, Number(product.branchId), productId);
            const raw = canonical || await findInitialPurchase(connection, storeId, Number(product.branchId), productId);
            const purchase = raw ? {
                supplier: raw.supplier,
                supplierInvoiceNumber: raw.supplierInvoiceNumber || null,
                purchaseDate: raw.purchaseDate,
                paymentMethod: raw.paymentMethod,
                purchaseTotal: Number(raw.purchaseTotal),
                amountPaid: Number(raw.amountPaid),
                outstandingBalance: Number(raw.outstandingBalance),
                paymentDueDate: raw.paymentDueDate,
                productCount: Number(raw.productCount || 1),
            } : null;
            return jsonResponse(200, headers, { product, purchase });
        }

        if (action === "get_product_initial_purchase") {
            if (tokenRole !== "owner" && tokenRole !== "manager") {
                return unauthorized(headers, "Insufficient permission to view supplier purchases.");
            }
            const productId = Number(body.id);
            if (!Number.isInteger(productId) || productId <= 0) {
                return badRequest(headers, "Invalid product id");
            }
            const product = await getProductById(connection, storeId, activeBranchId, productId);
            if (!product) return notFound(headers, "Product not found");
            // Supplier purchases are not part of stocknbook_v2.
            return jsonResponse(200, headers, { purchase: null });
        }

        /* ATOMIC IMPORT FOR THE THREE-SHEET STOCKNBOOK TEMPLATE.
         * Existing create/update/delete actions and their handlers stay unchanged.
         * A shared Purchase Ref is allocated across its products without
         * duplicating an invoice payment across every variant/product.
         */
        if (action === "import_products_bulk") {
            if (tokenRole !== "owner" && tokenRole !== "manager") {
                return unauthorized(headers, "Only owners and managers can import supplier purchase records.");
            }
            if (!activeBranchId) return badRequest(headers, "branch_id is required");
            const incoming = body.products;
            const singlePurchaseMode = body.importMode === "single_purchase";
            // New Excel flow: one server-controlled purchase grouping for all
            // products. Older API clients still use the existing purchases array.
            const rawPurchases = singlePurchaseMode ? [body.purchase] : (body.purchases || []);
            if (!Array.isArray(incoming) || !incoming.length || incoming.length > 500 ||
                !Array.isArray(rawPurchases) || (singlePurchaseMode &&
                    (!body.purchase || typeof body.purchase !== "object" || Array.isArray(body.purchase)))) {
                return badRequest(headers, "Provide 1–500 import products and a purchase list.");
            }
            try {
                // Validate data BEFORE writing any rows, then repeat duplicate
                // checks under the branch lock in the transaction below.
                const clean = [];
                const names = new Set();
                for (const raw of incoming) {
                    const name = toSafeString(raw.name, 120);
                    const category = toSafeString(raw.category, 120);
                    if (!name || !category) throw new Error("Every imported product needs a name and category.");
                    const key = name.trim().toLowerCase().replace(/\s+/g, " ");
                    if (names.has(key)) throw new Error(`Duplicate product "${name}" in import.`);
                    names.add(key);
                    const variants = getIncomingVariants(raw);
                    const hasVariants = parseBooleanFlag(raw.hasVariants ?? raw.has_variants) || variants.length > 0;
                    if (hasVariants && !variants.length) throw new Error(`Product "${name}" needs variants.`);
                    if (hasVariants && getDuplicateVariantLabel(variants)) throw new Error(`Duplicate variant in product "${name}".`);
                    const stock = hasVariants ? getVariantTotalStock(variants) : Number(raw.stock);
                    const alertLevel = hasVariants ? getVariantTotalAlert(variants) : Number(raw.alertLevel);
                    const cost = hasVariants ? getMinVariantPrice(variants, "originalPrice") : Number(raw.originalPrice);
                    const price = hasVariants ? getMinVariantPrice(variants, "salesPrice") : Number(raw.salesPrice);
                    if (![stock, alertLevel, cost, price].every(n => Number.isFinite(n) && n >= 0) ||
                        !Number.isInteger(stock) || !Number.isInteger(alertLevel) ||
                        variants.some(v => !Number.isInteger(v.stock) || !Number.isInteger(v.alertLevel) ||
                            v.stock < 0 || v.alertLevel < 0 || v.originalPrice < 0 || v.salesPrice < 0)) {
                        throw new Error(`Invalid stock/reorder/pricing numbers in "${name}".`);
                    }
                    const pricing = readPricingSelection(raw);
                    const isPriceConsistent = (record, recordPricing) =>
                        recordPricing.pricingMethod !== "markup" ||
                        Math.abs(roundMoney(record.originalPrice * (1 + recordPricing.markupPercentage / 100)) - Number(record.salesPrice)) < 0.011;
                    if (!hasVariants && !isPriceConsistent({originalPrice: cost, salesPrice: price}, pricing)) {
                        throw new Error(`Markup selling price is incorrect for "${name}".`);
                    }
                    if (variants.some(variant => !isPriceConsistent(variant, readPricingSelection(variant)))) {
                        throw new Error(`A variant has an incorrect markup price in "${name}".`);
                    }
                    const purchaseRef = singlePurchaseMode ? "SINGLE_FILE_PURCHASE" : toSafeString(raw.purchaseRef ?? raw.purchase_ref, 80);
                    const itemCost = roundMoney(hasVariants
                        ? variants.reduce((sum, v) => sum + v.stock * v.originalPrice, 0)
                        : stock * cost);
                    clean.push({ name, category, variants, hasVariants, stock, alertLevel,
                        cost, price, pricing, itemCost, purchaseRef,
                        expirationDate: hasVariants ? null : normalizeOptionalDate(raw.expirationDate ?? raw.expiration_date) });
                }
                if (singlePurchaseMode && rawPurchases.length !== 1) {
                    throw new Error("One Excel file must contain exactly one supplier purchase.");
                }
                const purchases = new Map();
                for (const raw of rawPurchases) {
                    const ref = singlePurchaseMode ? "SINGLE_FILE_PURCHASE" : toSafeString(raw.purchaseRef ?? raw.purchase_ref, 80);
                    const refKey = ref.toLowerCase();
                    if (!ref || purchases.has(refKey)) throw new Error(`Duplicate or empty purchase reference: ${ref}.`);
                    const supplier = toSafeString(raw.supplier, 150);
                    const purchaseDate = normalizeOptionalDate(raw.purchaseDate);
                    const method = String(raw.paymentMethod || "").trim().toLowerCase();
                    const due = normalizeOptionalDate(raw.paymentDueDate);
                    const amountPaid = Number(raw.amountPaid);
                    const supplierInvoiceNumber = toSafeString(raw.supplierInvoiceNumber ?? raw.supplier_invoice_number,80) || null;
                    if (!supplier || !purchaseDate || !["cash", "credit"].includes(method) ||
                        !Number.isFinite(amountPaid) || amountPaid < 0) throw new Error(`Invalid supplier/payment data for ${ref}.`);
                    const lines = clean.filter(product => product.purchaseRef.toLowerCase() === refKey);
                    if (!lines.length) throw new Error(`Unused purchase reference ${ref}.`);
                    const total = roundMoney(lines.reduce((sum, item) => sum + item.itemCost, 0));
                    if (lines.some(item => item.stock <= 0)) throw new Error(`Purchase ${ref} contains a product with no initial stock.`);
                    const paid = method === "cash" ? total : roundMoney(amountPaid);
                    if (method === "credit" && paid > total) throw new Error(`Amount Paid exceeds invoice total for ${ref}.`);
                    if (method === "cash" && amountPaid !== 0 && roundMoney(amountPaid) !== total) throw new Error(`Cash payment must equal invoice total for ${ref}.`);
                    if (method === "credit" && paid < total && !due) throw new Error(`Due date required for unpaid purchase ${ref}.`);
                    if (due && due < purchaseDate) throw new Error(`Due date cannot precede purchase date for ${ref}.`);
                    purchases.set(refKey, {ref, supplier, supplierInvoiceNumber, purchaseDate, method,
                        due: method === "credit" ? due : null, paid, total,
                        lineCosts: lines.map(item => item.itemCost) });
                }
                for (const item of clean) {
                    if (item.purchaseRef && !purchases.has(item.purchaseRef.toLowerCase())) {
                        throw new Error(`No PURCHASE DETAILS entry for ${item.purchaseRef}.`);
                    }
                }
                await connection.beginTransaction();
                await connection.execute("SELECT id FROM branches WHERE id = ? AND store_id = ? FOR UPDATE", [activeBranchId, storeId]);
                const {storeCode, branchCode} = await getProductCodeContext(connection, storeId, activeBranchId);
                const actingEmployee = await getActingEmployee(connection, decoded, tokenRole, storeId);
                const created = [];
                const pendingInvoices = new Map();
                for (const item of clean) {
                    if (await findExistingProductByName(connection, storeId, activeBranchId, item.name)) {
                        throw new Error(`Product "${item.name}" already exists in this branch.`);
                    }
                    const sequence = await reserveNextProductSequence(connection, storeId, activeBranchId);
                    // New Product No.: STORE-BRANCH-PRD-XXXX (existing products keep theirs).
                    const idPrefix = await identifiers.getIdentifierCodes(connection, storeId, activeBranchId);
                    const productNumber = identifiers.buildProductNumber(idPrefix.storeCode, idPrefix.branchCode, sequence);
                    const [insert] = await insertProductRecord(connection, {
                        storeId, branchId: activeBranchId, productNumber, name: item.name,
                        category: item.category, alertLevel: item.alertLevel, originalPrice: item.cost,
                        salesPrice: item.price, pricingMethod: item.pricing.pricingMethod,
                        markupPercentage: item.pricing.markupPercentage, expirationDate: item.expirationDate,
                        hasVariants: item.hasVariants,
                    });
                    const productId = insert.insertId;
                    await commitProductSequence(connection, storeId, activeBranchId, sequence);
                    const variantKeys = item.hasVariants ? await insertProductVariants(connection, productId, item.variants) : [];
                    if (item.purchaseRef) {
                        const refKey=item.purchaseRef.toLowerCase();
                        const purchaseLines=pendingInvoices.get(refKey) || [];
                        if (item.hasVariants) item.variants.forEach((variant,i)=>{
                            if (variant.stock>0) purchaseLines.push({productId,variantId:variantKeys[i].id,quantity:variant.stock,
                                unitPurchaseCost:variant.originalPrice,expirationDate:variant.expirationDate});
                        });
                        else if (item.stock>0) purchaseLines.push({productId,variantId:null,quantity:item.stock,
                            unitPurchaseCost:item.cost,expirationDate:item.expirationDate});
                        pendingInvoices.set(refKey,purchaseLines);
                    }
                    await logEmployeeAction(connection, {storeId, branchId: activeBranchId,
                        employee: actingEmployee, module:"Inventory", referenceNumber:productNumber,
                        action:"Added product", referenceId:String(productId),
                        details:`Added ${item.name}${item.hasVariants?` with ${item.variants.length} variant(s)`:""} to inventory`});
                    created.push({id:productId, productNumber, name:item.name});
                }
                for (const [refKey, invoice] of purchases) {
                    const purchaseLines=pendingInvoices.get(refKey) || [];
                    if (!purchaseLines.length) throw new Error(`Purchase ${invoice.ref} has no received units.`);
                    const ledger=await createPurchaseLedger(connection,{
                        storeId,branchId:activeBranchId, source:"import",
                        purchaseRef:singlePurchaseMode ? null : invoice.ref,
                        input:{supplier:invoice.supplier,supplierInvoiceNumber:invoice.supplierInvoiceNumber,
                            purchaseDate:invoice.purchaseDate,paymentMethod:invoice.method,
                            amountPaid:invoice.paid,paymentDueDate:invoice.due},
                        lines:purchaseLines,receivedBy:actingEmployee.name,
                    });
                }
                // Seed V2 for every imported product and its stocked variants.
                // This runs atomically with the existing invoice creation.
                await requireSynchronizedInventoryTables(connection);
                for (const saved of created) {
                    const sourceItem=clean.find(item=>item.name===saved.name);
                    if (!sourceItem) throw new Error("Imported product stock source was not found.");
                    const variantRows=sourceItem.hasVariants
                        ? await getOpeningVariantRows(connection, saved.id, sourceItem.variants) : [];
                    await createOpeningBranchStock(connection,{
                        storeId,branchId:activeBranchId,productId:saved.id,
                        variants:variantRows,stock:sourceItem.stock,
                        reorderLevel:sourceItem.alertLevel,costPrice:sourceItem.cost,
                        salesPrice:sourceItem.price,expirationDate:sourceItem.expirationDate,
                        actorName:actingEmployee.name});
                }
                await connection.commit();
                return jsonResponse(201, headers, {success:true, products:created});
            } catch (error) {
                await safeRollback(connection);
                return badRequest(headers, error instanceof Error ? error.message : "Unable to import products.");
            }
        }

        if (action === "create_product") {
            const name = toSafeString(body.name, 120);
            const category = toSafeString(body.category, 120);
            const packageId = toNumber(firstDefined(body.packageId, body.package_id));
            const packageName = toSafeString(firstDefined(body.packageName, body.package_name), 255);

            const incomingVariants = getIncomingVariants(body);
            const hasVariants =
                parseBooleanFlag(firstDefined(body.hasVariants, body.has_variants)) ||
                incomingVariants.length > 0;

            if (!name || !category) {
                return badRequest(headers, "name and category are required");
            }

            if (!activeBranchId) {
                return badRequest(headers, "branch_id is required");
            }

            if (hasVariants && incomingVariants.length === 0) {
                return badRequest(headers, "Please add at least one valid variant");
            }

            const existingProduct = await findExistingProductByName(
                connection,
                storeId,
                activeBranchId,
                name
            );

            if (existingProduct) {
                return badRequest(
                    headers,
                    `Product "${name}" already exists in this branch.`
                );
            }

            const duplicateVariantLabel = hasVariants
                ? getDuplicateVariantLabel(incomingVariants)
                : "";

            if (duplicateVariantLabel) {
                return badRequest(
                    headers,
                    `Variant "${duplicateVariantLabel}" already exists in this product.`
                );
            }

            const stock = hasVariants
                ? getVariantTotalStock(incomingVariants)
                : toNumber(firstDefined(body.stock, body.quantity, body.qty)) ?? 0;

            const alertLevel = hasVariants
                ? getVariantTotalAlert(incomingVariants)
                : toNumber(firstDefined(body.alertLevel, body.alert_level, body.alert)) ?? 0;

            const originalPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "originalPrice")
                : toNumber(firstDefined(body.originalPrice, body.original_price, body.cost_price)) ?? 0;

            const salesPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "salesPrice")
                : toNumber(firstDefined(body.salesPrice, body.sales_price, body.price)) ?? 0;
            const pricing = readPricingSelection(body);
            try {validateProductInventoryInputs(body,stock,alertLevel,originalPrice,salesPrice,incomingVariants);}
            catch(error){return badRequest(headers,error.message);}

            let initialPurchase;
            try {
                initialPurchase = getInitialPurchaseInput(body, stock, originalPrice, incomingVariants);
            } catch (purchaseError) {
                return badRequest(headers, purchaseError.message);
            }
            if (stock>0 && !initialPurchase && !parseBooleanFlag(body.openingStock ?? body.opening_stock)) {
                return badRequest(headers,"Initial stock requires supplier purchase details or explicit Opening Stock.");
            }
            if (initialPurchase && tokenRole !== "owner" && tokenRole !== "manager") {
                return unauthorized(headers, "Only owners and managers may record supplier purchases.");
            }

            const expirationDate = hasVariants
                ? null
                : normalizeOptionalDate(
                    firstDefined(
                        body.expirationDate,
                        body.expiration_date,
                        body.expiryDate,
                        body.expiry_date
                    )
                );

            await connection.beginTransaction();

            // Lock the branch row while allocating the next branch-local product
            // sequence so two simultaneous product creations cannot receive the
            // same STORE-BRANCH-NUMBEROFPRODUCT value.
            await connection.execute(
                `SELECT id
                 FROM branches
                 WHERE id = ?
                   AND store_id = ?
                     FOR UPDATE`,
                [activeBranchId, storeId]
            );

            // Re-check under the branch lock: concurrent saves cannot create duplicate products.
            if (await findExistingProductByName(connection,storeId,activeBranchId,name)) {
                await safeRollback(connection);
                return badRequest(headers,`Product "${name}" already exists in this branch.`);
            }

            const { storeCode, branchCode } = await getProductCodeContext(
                connection,
                storeId,
                activeBranchId
            );
            const nextProductSequence = await reserveNextProductSequence(
                connection,
                storeId,
                activeBranchId
            );
            // New Product No.: STORE-BRANCH-PRD-XXXX (existing products keep theirs).
            const idPrefix = await identifiers.getIdentifierCodes(connection, storeId, activeBranchId);
            const productNumber = identifiers.buildProductNumber(
                idPrefix.storeCode,
                idPrefix.branchCode,
                nextProductSequence
            );

            // packageId / packageName are not stored on products in stocknbook_v2.
            void packageId;
            void packageName;
            const [result] = await insertProductRecord(connection, {
                storeId,
                branchId: activeBranchId,
                productNumber,
                name,
                category,
                alertLevel,
                originalPrice,
                salesPrice,
                pricingMethod: pricing.pricingMethod,
                markupPercentage: pricing.markupPercentage,
                expirationDate,
                hasVariants,
            });

            const productId = result.insertId;

            await commitProductSequence(
                connection,
                storeId,
                activeBranchId,
                nextProductSequence
            );

            if (hasVariants) {
                await insertProductVariants(connection, productId, incomingVariants);
            }

            // One normalized supplier transaction for every initial supplier purchase;
            // zero-stock/opening balances never create a payable.
            if (initialPurchase) {
                const savedVariants=hasVariants ? (await getProductById(connection,storeId,activeBranchId,productId)).variants : [];
                const lines=hasVariants ? incomingVariants.map((variant,i)=>({
                    productId,variantId:savedVariants[i].id,quantity:variant.stock,
                    unitPurchaseCost:variant.originalPrice, expirationDate:variant.expirationDate,
                })).filter(line=>line.quantity>0) : [{productId,variantId:null,quantity:stock,
                    unitPurchaseCost:originalPrice,expirationDate}];
                await createPurchaseLedger(connection,{storeId,branchId:activeBranchId,source:"add",
                    input:initialPurchase,lines,receivedBy:decoded?.email || "System"});
            }

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await logEmployeeAction(connection, {
                storeId,
                branchId: activeBranchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: productNumber,
                action: "Added product",
                referenceId: String(productId),
                details: `Added ${name}${hasVariants ? ` with ${incomingVariants.length} variant(s)` : ""} to inventory`,
            });

            await requireSynchronizedInventoryTables(connection);
            const savedOpeningVariants=hasVariants
                ? await getOpeningVariantRows(connection, productId, incomingVariants) : [];
            await createOpeningBranchStock(connection,{
                storeId,branchId:activeBranchId,productId,
                variants:savedOpeningVariants,stock,alertLevel,costPrice:originalPrice,
                reorderLevel:alertLevel,salesPrice,expirationDate,
                actorName:actingEmployee.name});
            await connection.commit();

            const product = await getProductById(
                connection,
                storeId,
                activeBranchId,
                productId
            );

            return jsonResponse(201, headers, {
                success: true,
                product,
            });
        }

        if (action === "update_product") {
            const id = Number(body.id);

            if (!Number.isInteger(id) || id <= 0) {
                return badRequest(headers, "Invalid product id");
            }

            const existing = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            if (!existing) {
                return notFound(headers, "Product not found");
            }

            const name = toSafeString(body.name, 120);
            const category = toSafeString(body.category, 120);
            const packageId = toNumber(firstDefined(body.packageId, body.package_id));
            const packageName = toSafeString(firstDefined(body.packageName, body.package_name), 255);

            const incomingVariants = getIncomingVariants(body);
            const hasVariants =
                parseBooleanFlag(firstDefined(body.hasVariants, body.has_variants)) ||
                incomingVariants.length > 0;

            if (!name || !category) {
                return badRequest(headers, "name and category are required");
            }

            if (hasVariants && incomingVariants.length === 0) {
                return badRequest(headers, "Please add at least one valid variant");
            }

            const duplicateProduct = await findExistingProductByName(
                connection,
                storeId,
                activeBranchId,
                name,
                id
            );

            if (duplicateProduct) {
                return badRequest(
                    headers,
                    `Product "${name}" already exists in this branch.`
                );
            }

            const duplicateVariantLabel = hasVariants
                ? getDuplicateVariantLabel(incomingVariants)
                : "";

            if (duplicateVariantLabel) {
                return badRequest(
                    headers,
                    `Variant "${duplicateVariantLabel}" already exists in this product.`
                );
            }

            const stock = hasVariants
                ? getVariantTotalStock(incomingVariants)
                : toNumber(firstDefined(body.stock, body.quantity, body.qty)) ?? 0;

            const alertLevel = hasVariants
                ? getVariantTotalAlert(incomingVariants)
                : toNumber(firstDefined(body.alertLevel, body.alert_level, body.alert)) ?? 0;

            const originalPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "originalPrice")
                : toNumber(firstDefined(body.originalPrice, body.original_price, body.cost_price)) ?? 0;

            const salesPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "salesPrice")
                : toNumber(firstDefined(body.salesPrice, body.sales_price, body.price)) ?? 0;
            const pricing = readPricingSelection(body);
            try {validateProductInventoryInputs(body,stock,alertLevel,originalPrice,salesPrice,incomingVariants);}
            catch(error){return badRequest(headers,error.message);}

            const expirationDate = hasVariants
                ? null
                : normalizeOptionalDate(
                    firstDefined(
                        body.expirationDate,
                        body.expiration_date,
                        body.expiryDate,
                        body.expiry_date
                    )
                );

            // Changes to an existing supplier purchase are validated and audited below.
            const editPurchaseDetails = body.initialPurchase ?? body.initial_purchase;
            if (editPurchaseDetails != null && !["owner","manager"].includes(tokenRole)) {
                return unauthorized(headers,"Only owners and managers may correct purchase details.");
            }
            const existingVariants=Array.isArray(existing.variants)?existing.variants:[];
            if (Boolean(existing.hasVariants) !== hasVariants) {
                return badRequest(headers,"Changing a product between regular and variant types requires a separate migration.");
            }
            const existingById=new Map(existingVariants.map(v=>[Number(v.id),v]));
            if (hasVariants) {
                const submittedIds=incomingVariants.filter(v=>v.id).map(v=>Number(v.id));
                if (new Set(submittedIds).size!==submittedIds.length || submittedIds.some(id=>!existingById.has(id)) ||
                    existingVariants.some(v=>!submittedIds.includes(Number(v.id)))) {
                    return badRequest(headers,"Editing must preserve existing Variant IDs; archiving variants requires a separate action.");
                }
                for (const v of incomingVariants) {
                    if (v.id && Number(v.stock)!==Number(existingById.get(Number(v.id)).stock)) {
                        return badRequest(headers,"Use Receive Stock or Stock Adjustment to change variant quantity.");
                    }
                    if (!v.id && Number(v.stock)!==0) return badRequest(headers,"New variants must start at 0 stock.");
                }
            } else if (stock !== Number(existing.stock)) {
                return badRequest(headers,"Use Receive Stock or Stock Adjustment to change quantity.");
            }
            const stableStock=Number(existing.stock);
            await connection.beginTransaction();
            // Serialize edits and receives to avoid overwriting changes to inventory quantities.
            const lockedProduct=await lockProductForUpdate(connection,storeId,Number(existing.branchId),id);
            if (hasVariants) {
                const lockedVariants=await lockVariantsForUpdate(connection,id);
                const lockedMap=new Map(lockedVariants.map(v=>[Number(v.id),Number(v.stock)]));
                if (existingVariants.some(v=>lockedMap.get(Number(v.id))!==Number(v.stock))) {
                    await safeRollback(connection);
                    return badRequest(headers,"Stock changed while you were editing. Reload and try again.");
                }
            } else {
                const lockedProducts=lockedProduct ? [lockedProduct] : [];
                if (!lockedProducts.length || Number(lockedProducts[0].stock)!==stableStock) {
                    await safeRollback(connection);
                    return badRequest(headers,"Stock changed while you were editing. Reload and try again.");
                }
            }

            let purchaseChangeLog = "";
            if (editPurchaseDetails != null) {
                // Supplier purchases are not part of stocknbook_v2; the submitted
                // purchase details are accepted but there is no record to correct.
                purchaseChangeLog = "";
            }

            // packageId / packageName are not stored on products in stocknbook_v2.
            void packageId;
            void packageName;
            const [result] = await updateProductRecord(connection, {
                productId: id,
                storeId,
                branchId: activeBranchId,
                name,
                category,
                alertLevel,
                originalPrice,
                salesPrice,
                pricingMethod: pricing.pricingMethod,
                markupPercentage: pricing.markupPercentage,
                expirationDate,
                hasVariants,
            });

            if (result.affectedRows === 0) {
                await safeRollback(connection);
                return notFound(headers, "Product not found");
            }

            // Never DELETE+INSERT existing variants. Their IDs/variant numbers anchor POS,
            // purchases, receipts, bookings, and audit references.
            if (hasVariants) {
                for (const v of incomingVariants) {
                    if (v.id) {
                        await updateVariantRecord(connection, {productId: id, variant: v});
                    }
                }
                const added=incomingVariants.filter(v=>!v.id);
                if (added.length) {
                    // New variants start at zero stock; their branch rows are created with them.
                    await insertProductVariants(connection,id,added);
                }
            }
            const product = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await logEmployeeAction(connection, {
                storeId,
                branchId: activeBranchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: existing.productNumber || existing.product_number || String(id),
                action: "Updated product",
                referenceId: String(id),
                details: `Updated details for ${name}${purchaseChangeLog ? "; "+purchaseChangeLog : ""}`,
            });

            await connection.commit();

            return jsonResponse(200, headers, {
                success: true,
                product,
            });
        }

        // Manager Stock Action Center: review and remove only the selected variant.
        // Do not delegate these actions to delete_product (which is parent-wide).
        if (action === "get_variant_removal_impact" || action === "delete_variant") {
            if (!["owner", "manager"].includes(tokenRole)) {
                return unauthorized(headers, "Only owners and managers may remove inventory variants.");
            }
            const productId = Number(body.id ?? body.productId);
            const variantId = Number(body.variantId ?? body.variant_id);
            if (!Number.isInteger(productId) || productId <= 0 ||
                !Number.isInteger(variantId) || variantId <= 0) {
                return badRequest(headers, "Valid Product ID and Variant ID are required.");
            }
            const existing = await getProductById(connection, storeId, activeBranchId, productId);
            if (!existing || !existing.hasVariants) return notFound(headers, "Variant product not found.");
            const variant = (existing.variants || []).find(item => Number(item.id) === variantId);
            if (!variant) return notFound(headers, "Selected variant not found in this branch.");
            if (!isVariantExpiryRemovalEligible(variant)) {
                return jsonResponse(409, headers, {
                    success: false, error: "Only expired or expiring-soon variants can be removed from this review action.",
                });
            }

            if (action === "get_variant_removal_impact") {
                const impact = await getVariantRemovalImpact(connection, storeId, activeBranchId, existing, variant);
                return jsonResponse(200, headers, { success: true, impact });
            }

            const employee = await getActingEmployee(connection, decoded, tokenRole, storeId);
            const attempt = async (forceArchive) => {
                await connection.beginTransaction();
                try {
                    const result = await applyVariantRemoval(
                        connection, storeId, activeBranchId, productId, variantId, employee, forceArchive
                    );
                    await connection.commit();
                    return result;
                } catch (error) {
                    await safeRollback(connection);
                    throw error;
                }
            };
            let result;
            try {
                result = await attempt(false);
            } catch (error) {
                if (error.removalStatus) {
                    return jsonResponse(error.removalStatus, headers, {
                        success: false, error: error.message, impact: error.impact || null,
                    });
                }
                // An unforeseen FK reference may prevent physical deletion;
                // retry safely as an archive, never delete history.
                if (!["ER_ROW_IS_REFERENCED", "ER_ROW_IS_REFERENCED_2"].includes(error.code)) {
                    throw error;
                }
                try {
                    result = await attempt(true);
                } catch (retryError) {
                    if (retryError.removalStatus) {
                        return jsonResponse(retryError.removalStatus, headers, {
                            success: false, error: retryError.message, impact: retryError.impact || null,
                        });
                    }
                    throw retryError;
                }
            }
            return jsonResponse(200, headers, {
                success: true,
                mode: result.mode,
                impact: result.impact,
                message: result.mode === "archive"
                    ? "Selected variant archived. Other variants remain active."
                    : "Selected unused variant deleted. Other variants remain active.",
            });
        }

        if (action === "get_product_removal_impact") {
            const id = Number(body.id);

            if (!Number.isInteger(id) || id <= 0) {
                return badRequest(headers, "Invalid product id");
            }

            const existing = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            if (!existing) {
                return notFound(headers, "Product not found");
            }

            const impact = await getProductRemovalImpact(
                connection,
                storeId,
                activeBranchId,
                existing
            );

            return jsonResponse(200, headers, {
                success: true,
                impact,
            });
        }

        if (action === "delete_product") {
            const id = Number(body.id);

            if (!Number.isInteger(id) || id <= 0) {
                return badRequest(headers, "Invalid product id");
            }

            const existing = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            if (!existing) {
                return notFound(headers, "Product not found");
            }

            // Re-check on the server when the user confirms. The UI preview is
            // informative only; the backend remains the source of truth.
            const impact = await getProductRemovalImpact(
                connection,
                storeId,
                activeBranchId,
                existing
            );

            if (impact.mode === "blocked") {
                return jsonResponse(409, headers, {
                    success: false,
                    mode: "blocked",
                    error: impact.blockers[0] || "This product cannot be removed yet.",
                    impact,
                });
            }

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await connection.beginTransaction();

            let finalMode = impact.mode;

            try {
                // Serialize removal with bookings, stock receipts and corrections.
                // A pending booking may become Confirmed after the impact preview.
                const lockedProduct=await lockProductForUpdate(connection,storeId,Number(existing.branchId),id);
                if (!lockedProduct) {
                    const stale=new Error("Product changed or was removed. Refresh Inventory.");
                    stale.statusCode=409; throw stale;
                }
                const liveImpact=await getProductRemovalImpact(connection,storeId,activeBranchId,existing);
                if (liveImpact.mode === "blocked") {
                    const blocked=new Error(liveImpact.blockers[0] || "This product now has an active booking.");
                    blocked.statusCode=409;throw blocked;
                }
                if (liveImpact.mode !== impact.mode) {
                    const stale=new Error("Product usage changed since the deletion preview. Reopen Delete and review its impact.");
                    stale.statusCode=409;throw stale;
                }
                if (impact.mode === "archive") {
                    const affectedRows = await archiveProduct(
                        connection,
                        storeId,
                        activeBranchId,
                        id
                    );

                    if (affectedRows === 0) {
                        throw new Error("Product could not be archived because it is no longer active.");
                    }

                    await logEmployeeAction(connection, {
                        storeId,
                        branchId: activeBranchId,
                        employee: actingEmployee,
                        module: "Inventory",
                        referenceNumber: existing.productNumber || existing.product_number || String(id),
                        action: "Archived product",
                        referenceId: String(id),
                        details: `Archived ${existing.name} to preserve historical business records`,
                    });
                } else {
                    const affectedRows = await permanentlyDeleteProduct(
                        connection,
                        storeId,
                        activeBranchId,
                        id
                    );

                    if (affectedRows === 0) {
                        throw new Error("Product could not be permanently deleted.");
                    }

                    await logEmployeeAction(connection, {
                        storeId,
                        branchId: activeBranchId,
                        employee: actingEmployee,
                        module: "Inventory",
                        referenceNumber: existing.productNumber || existing.product_number || String(id),
                        action: "Permanently deleted product",
                        referenceId: String(id),
                        details: `Permanently deleted unused product ${existing.name}`,
                    });
                }

                await connection.commit();
            } catch (removalError) {
                await safeRollback(connection);

                // A foreign-key relationship unknown to this Lambda may still
                // prevent a physical delete. In that situation, never destroy
                // history: safely archive instead.
                if (impact.mode !== "permanent" || !["ER_ROW_IS_REFERENCED","ER_ROW_IS_REFERENCED_2"].includes(removalError.code)) {
                    throw removalError;
                }

                await connection.beginTransaction();
                // Retry may race with another confirmation: protect bookings before archiving.
                await lockProductForUpdate(connection,storeId,Number(existing.branchId),id);
                const retryImpact=await getProductRemovalImpact(connection,storeId,activeBranchId,existing);
                if (retryImpact.mode === "blocked") {
                    await safeRollback(connection);
                    const blocked=new Error(retryImpact.blockers[0]||"This product now has an active booking.");
                    blocked.statusCode=409;throw blocked;
                }
                const archivedRows = await archiveProduct(
                    connection,
                    storeId,
                    activeBranchId,
                    id
                );

                if (archivedRows === 0) {
                    throw removalError;
                }

                finalMode = "archive";

                await logEmployeeAction(connection, {
                    storeId,
                    branchId: activeBranchId,
                    employee: actingEmployee,
                    module: "Inventory",
                    referenceNumber: existing.productNumber || existing.product_number || String(id),
                    action: "Archived product",
                    referenceId: String(id),
                    details: `Archived ${existing.name} because a related system record prevented permanent deletion`,
                });

                await connection.commit();
            }

            return jsonResponse(200, headers, {
                success: true,
                mode: finalMode,
                impact: {
                    ...impact,
                    mode: finalMode,
                },
                message:
                    finalMode === "archive"
                        ? "Product archived successfully. Historical records were preserved."
                        : "Unused product permanently deleted successfully.",
            });
        }

        return badRequest(headers, "Invalid action");
    } catch (err) {
        await safeRollback(connection);
        // A booking becoming active while deletion is being confirmed is an
        // expected conflict, not a server failure.
        if (err?.statusCode === 409) return jsonResponse(409,headers,{error:err.message});
        return serverError(headers, err);
    } finally {
        if (connection) {
            connection.release();
        }
    }
};