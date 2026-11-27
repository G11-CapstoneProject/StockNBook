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

// ===== BEGIN StockNBook v2 POS read models =====
/*
 * POS sales live in orders (Order No. = orders.order_number) and order_items
 * (one line per product_variants row; a product without variants uses its
 * default variant). The read models below return the legacy column names, with
 * order_id = the Order No. text shown in the app, so reports stay unchanged.
 */
const V2_POS_ORDERS = `(SELECT
        po.order_id AS order_pk, po.order_number AS order_id, po.store_id, po.branch_id,
        po.processed_by AS cashier_id, 'WALK_IN' AS customer_type, po.customer_id,
        po.payment_mode, po.tax_type, po.subtotal, po.discount_amount,
        po.vatable_sales, po.vat_amount, po.amount_tendered AS customer_payment, po.change_due,
        po.total, DATE(po.order_date) AS order_date, po.created_at, po.status
    FROM orders po)`;

// Same as V2_POS_ORDERS plus the item summary text ("Name - Variant xQty, ...").
const V2_POS_ORDERS_WITH_ITEM = `(SELECT
        po.order_id AS order_pk, po.order_number AS order_id, po.store_id, po.branch_id,
        po.processed_by AS cashier_id, 'WALK_IN' AS customer_type, po.customer_id,
        po.payment_mode, po.tax_type, po.subtotal, po.discount_amount,
        po.vatable_sales, po.vat_amount, po.amount_tendered AS customer_payment, po.change_due,
        po.total, DATE(po.order_date) AS order_date, po.created_at, po.status,
        (SELECT LEFT(GROUP_CONCAT(CONCAT(poi.product_name_snapshot,
                    CASE WHEN piv.is_default = 1 THEN '' ELSE CONCAT(' - ', piv.variant_name) END,
                    ' x', poi.quantity) ORDER BY poi.id SEPARATOR ', '), 255)
         FROM order_items poi
                  JOIN product_variants piv ON piv.id = poi.variant_id
         WHERE poi.order_id = po.order_id) AS item
    FROM orders po)`;

const V2_POS_ORDER_ITEMS = `(SELECT
        poi.id, poi.store_id, pio.branch_id, pio.order_number AS order_id, poi.order_id AS order_pk,
        piv.product_id, CASE WHEN piv.is_default = 1 THEN NULL ELSE poi.variant_id END AS variant_id,
        poi.variant_id AS catalog_variant_id,
        poi.product_name_snapshot AS product_name, poi.quantity, poi.unit_price, poi.line_total,
        poi.cost_price_at_sale, poi.discount_amount
    FROM order_items poi
             JOIN orders pio ON pio.order_id = poi.order_id
             JOIN product_variants piv ON piv.id = poi.variant_id)`;
// ===== END StockNBook v2 POS read models =====

// Configure these in AWS Lambda environment variables; do not hardcode credentials.
function requirePosEnv(name, alias) {
    const value = process.env[name] ?? (alias ? process.env[alias] : undefined);
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing required Lambda environment variable: ${name}`);
    }
    return value;
}

// ===== ENV SECURITY CHANGE: Required JWT environment variable BEGIN =====
// MERGE FIX: Use the existing POS environment validator.
const JWT_SECRET = requirePosEnv("JWT_SECRET");
// ===== ENV SECURITY CHANGE: Required JWT environment variable END =====



const dbConfig = {
    // ===== ENV SECURITY CHANGE: MySQL environment configuration BEGIN =====
    // MERGE FIX: Use the existing POS environment validator.
    host: requirePosEnv("DB_HOST"),
    user: requirePosEnv("DB_USER"),
    password: requirePosEnv("DB_PASSWORD"),
    database: requirePosEnv("DB_NAME"),
    port: Number(process.env.DB_PORT || 3306),
    // ===== ENV SECURITY CHANGE: MySQL environment configuration END =====
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
        // Unspecified grants must not create employee privileges.
        return "none";
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
    const [rows] = await connection.execute(
        `SELECT permissions FROM users WHERE id = ? AND store_id = ? AND branch_id = ? AND role = ? AND LOWER(status) = 'active' LIMIT 1`,
        [employeeId, storeId, branchId, role]
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
    // Read-only v2 POS reporting. Completed bookings use the saved Philippine completion time; legacy rows use event date only.
    // Booking receipts and refundable deposits are not additional sales; unknown costs remain NULL.
    const ALLOWED_SOURCES = new Set(['ALL', 'BOOKING', 'WALK_IN']);
    const SORT_DIRECTIONS = new Set(['NEWEST', 'OLDEST']);
    const id = (name) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid database column.');
        return `\`${name}\``;
    };
    const findColumn = (set, candidates) => candidates.find((value) => set.has(value)) || null;
    const expr = (alias, column, fallback = 'NULL') => column ? `${alias}.${id(column)}` : fallback;
    const money = (value) => Number(Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100);

    // stocknbook_v2 columns of the tables this report inspects.
    const V2_REPORT_COLUMNS = {
        orders: ['order_id', 'order_number', 'store_id', 'branch_id', 'customer_id', 'order_date', 'subtotal',
            'discount_amount', 'vatable_sales', 'vat_amount', 'total', 'tax_type', 'payment_mode',
            'amount_tendered', 'change_due', 'status', 'processed_by', 'created_at'],
        bookings: ['id', 'store_id', 'branch_id', 'booking_reference', 'customer_id', 'package_id', 'booking_type',
            'event_type', 'theme', 'event_date', 'event_end_date', 'event_time', 'venue', 'rental_start_date',
            'rental_end_date', 'custom_order', 'notes', 'status', 'package_price_snapshot', 'agreed_price',
            'required_down_payment', 'down_payment_deadline', 'refundable_deposit_required', 'vat_amount',
            'approved_by', 'approved_at', 'final_additional_charges', 'deposit_applied_amount',
            'approved_refund_amount', 'settlement_status', 'settlement_notes', 'settlement_reviewed_by',
            'settlement_reviewed_at', 'cancellation_reason', 'created_by', 'created_at', 'updated_at', 'completed_at'],
    };
    async function listColumns(db, table) {
        return new Set(V2_REPORT_COLUMNS[table] || []);
    }

    async function detectBookingSchema(db) {
        // Run the completion timestamp migration before deploying this POS Lambda.
        return { available: true, table: 'bookings', fields: {}, hasCostSnapshot: false, hasTaxData: true };
    }

    // PERFORMANCE FIX: withCost=false skips the cost lookup for queries that never read cost/profit.
    // item, cashierName and cashierRole are filled in afterwards for the returned page only.
    function posSql({ storeId, branchId, dateFrom, dateTo, orderColumns, bookingSchema, exactOrderId, withCost = true }) {
        const where = ["o.store_id = ?", "LOWER(TRIM(o.status)) = 'completed'", "UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')",
            "(UPPER(TRIM(COALESCE(o.customer_type, ''))) = 'WALK_IN' OR (TRIM(COALESCE(o.customer_type, '')) = '' AND o.order_id LIKE '%-POS-%'))"];
        // One store-specific cost aggregation, avoiding a full cross-tenant GROUP BY.
        // Bind order: item-cost subquery first, followed by orders WHERE predicates.
        const params = withCost ? [storeId, storeId] : [storeId];
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
                         ${withCost ? `CASE WHEN ic.rowCount > 0 AND ic.missingCount = 0 THEN ic.cost ELSE NULL END AS totalCost,
                         CASE WHEN ic.rowCount > 0 AND ic.missingCount = 0
                                  THEN o.total - COALESCE(o.vat_amount,0) - ic.cost ELSE NULL END AS profit,` : 'NULL AS totalCost, NULL AS profit,'}
                         NULL AS item,
                         o.cashier_id AS cashierId,
                         NULL AS cashierName,
                         NULL AS cashierRole,
        DATE_FORMAT(o.order_date, '%Y-%m-%d') AS reportDate,
        DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS transactionAt,
                         NULL AS additionalCharges, NULL AS depositRefunded, NULL AS bookingKey,
                         NULL AS bookingPaid, NULL AS bookingRefunded, NULL AS depositCollected,
                         NULL AS depositApplied, NULL AS chargePaid, NULL AS depositRequired,
                         NULL AS settlementStatus
                     FROM ${V2_POS_ORDERS} o
                         LEFT JOIN branches br ON br.store_id=o.store_id AND br.id=o.branch_id
                         ${withCost ? `LEFT JOIN (
                         SELECT order_id AS order_pk, COUNT(*) AS rowCount,
                         SUM(CASE WHEN cost_price_at_sale IS NULL THEN 1 ELSE 0 END) AS missingCount,
                         SUM(cost_price_at_sale * quantity) AS cost
                         FROM order_items WHERE store_id = ? GROUP BY order_id
                         ) ic ON ic.order_pk=o.order_pk` : ''}
                     WHERE ${where.join(' AND ')}`;
        return { sql, params };
    }

    function bookingSql(schema, { storeId, branchId, dateFrom, dateTo, exactOrderId }) {
        // Match lambda-bookings: bookingTotal, getBookingMoney and depositFigures.
        const where = ["bk.store_id = ?", "LOWER(TRIM(bk.status)) = 'completed'"];
        const params = [storeId, storeId, storeId]; // payment aggregate, refund aggregate, booking scope
        if (branchId) { where.push('bk.branch_id = ?'); params.push(branchId); }
        if (dateFrom) { where.push('COALESCE(DATE(bk.completed_at), bk.event_date) >= ?'); params.push(dateFrom); }
        if (dateTo) { where.push('COALESCE(DATE(bk.completed_at), bk.event_date) <= ?'); params.push(dateTo); }
        if (exactOrderId) { where.push('bk.booking_reference = ?'); params.push(exactOrderId); }
        const sql = `SELECT bk.booking_reference AS orderId, bk.branch_id AS branchId,
                            COALESCE(NULLIF(TRIM(br.branch_name),''), CONCAT('Branch ',bk.branch_id)) AS branchName,
                            c.full_name AS customerName, c.phone AS customerContactNumber, 'BOOKING' AS salesSource,
                            pay.methods AS paymentMode,
                            CASE WHEN UPPER(TRIM(bk.tax_type)) IN ('VAT','VAT_REGISTERED','NON_VAT','NON_VAT_REGISTERED') THEN UPPER(TRIM(bk.tax_type))
                                 WHEN bk.vat_amount > 0 THEN 'VAT' ELSE NULL END AS taxType,
                            CASE WHEN bk.agreed_price > 0 THEN bk.agreed_price ELSE COALESCE(bk.package_price_snapshot,0) END AS total,
                            bk.vat_amount AS vatAmount, NULL AS totalCost, NULL AS profit,
                            NULL AS item, NULL AS cashierId,
                            u.full_name AS cashierName, NULL AS cashierRole,
                            DATE_FORMAT(COALESCE(DATE(bk.completed_at), bk.event_date), '%Y-%m-%d') AS reportDate,
                            COALESCE(DATE_FORMAT(bk.completed_at, '%Y-%m-%d %H:%i:%s'), DATE_FORMAT(bk.event_date, '%Y-%m-%d')) AS transactionAt,
                            COALESCE(bk.final_additional_charges,0) AS additionalCharges,
                            COALESCE(rf.depositRefunded,0) AS depositRefunded, bk.id AS bookingKey,
                            COALESCE(pay.bookingPaid,0) AS bookingPaid, COALESCE(rf.bookingRefunded,0) AS bookingRefunded,
                            COALESCE(pay.depositCollected,0) AS depositCollected,
                            COALESCE(bk.deposit_applied_amount,0) AS depositApplied,
                            COALESCE(pay.chargePaid,0) AS chargePaid,
                            COALESCE(bk.refundable_deposit_required,0) AS depositRequired, bk.settlement_status AS settlementStatus
                     FROM bookings bk
                              LEFT JOIN branches br ON br.store_id=bk.store_id AND br.id=bk.branch_id
                              LEFT JOIN customers c ON c.store_id=bk.store_id AND c.id=bk.customer_id
                              LEFT JOIN users u ON u.store_id=bk.store_id AND u.id=bk.settlement_reviewed_by
                              LEFT JOIN (
                         SELECT booking_id, store_id, branch_id,
                                SUM(CASE WHEN payment_type='booking_payment' THEN amount ELSE 0 END) AS bookingPaid,
                                SUM(CASE WHEN payment_type='security_deposit' THEN amount ELSE 0 END) AS depositCollected,
                                SUM(CASE WHEN payment_type='additional_charge' THEN amount ELSE 0 END) AS chargePaid,
                                GROUP_CONCAT(DISTINCT CASE WHEN payment_type='booking_payment' THEN
                                     REPLACE(UPPER(TRIM(payment_method)), ' ', '_') END SEPARATOR ',') AS methods
                         FROM payments WHERE store_id=? AND booking_id IS NOT NULL AND status='recorded'
                         GROUP BY booking_id, store_id, branch_id
                     ) pay ON pay.booking_id=bk.id AND pay.store_id=bk.store_id AND pay.branch_id=bk.branch_id
                              LEFT JOIN (
                         SELECT p.booking_id, p.store_id, p.branch_id,
                                SUM(CASE WHEN r.refund_type='deposit_refund' THEN r.amount ELSE 0 END) AS depositRefunded,
                                SUM(CASE WHEN r.refund_type='booking_refund' THEN r.amount ELSE 0 END) AS bookingRefunded
                         FROM refunds r JOIN payments p ON p.id=r.payment_id AND p.store_id=r.store_id
                         WHERE r.store_id=? AND p.booking_id IS NOT NULL AND LOWER(r.status) IN ('completed','processed')
                         GROUP BY p.booking_id, p.store_id, p.branch_id
                     ) rf ON rf.booking_id=bk.id AND rf.store_id=bk.store_id AND rf.branch_id=bk.branch_id
                     WHERE ${where.join(' AND ')}`;
        return { sql, params };
    }

    function bookingBilling(row) {
        const total = money(row.total), bookingPaid = money(row.bookingPaid),
            depositCollected = money(row.depositCollected), depositApplied = money(row.depositApplied),
            depositRefunded = money(row.depositRefunded), additionalCharges = money(row.additionalCharges),
            chargePaid = money(row.chargePaid);
        return { bookingPaid, bookingRefunded: money(row.bookingRefunded),
            balance: Math.max(0, money(total - bookingPaid)),
            depositRequired: money(row.depositRequired), depositCollected, depositApplied, depositRefunded,
            depositHeld: Math.max(0, money(depositCollected - depositApplied - depositRefunded)),
            additionalCharges, chargePaid,
            claimBalance: Math.max(0, money(additionalCharges - chargePaid - depositApplied)),
            settlementStatus: row.settlementStatus || null };
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
        // PERFORMANCE FIX: same rows without the cost lookup, for VAT, counts, export and payment methods.
        const lightSources = [posSql({ storeId, branchId, dateFrom, dateTo, orderColumns, bookingSchema, withCost: false }), ...sources.slice(1)];
        const lightSql = lightSources.map((s) => `(${s.sql})`).join(' UNION ALL ');
        const lightParams = lightSources.flatMap((s) => s.params);

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
        const vatParams = source === 'ALL' ? lightParams : [...lightParams, source];
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
                FROM (${lightSql}) v ${vatSourceWhere}`, vatParams);
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
            // Return a complete filtered extract, never a silently truncated file.
            // Limit JSON response size; owners can narrow the date range if needed.
            const MAX_EXPORT_ROWS = 5000;
            // Match the Orders table filters. Branch and dates are already applied
            // inside each source query; these remaining filters combine with them.
            const exportWhere = [];
            const exportParams = [...lightParams];
            if (source !== 'ALL') {
                exportWhere.push('v.salesSource = ?');
                exportParams.push(source);
            }
            if (search) {
                exportWhere.push('(v.orderId LIKE ? OR v.customerName LIKE ?)');
                exportParams.push(`%${search}%`, `%${search}%`);
            }
            if (payment) {
                exportWhere.push("FIND_IN_SET(?, UPPER(COALESCE(v.paymentMode,''))) > 0");
                exportParams.push(payment);
            }
            const exportWhereSql = exportWhere.length
                ? `WHERE ${exportWhere.join(' AND ')}`
                : '';
            const [vatRows] = await db.execute(`
                SELECT v.orderId, v.branchName, v.reportDate, v.transactionAt,
                       v.salesSource, v.paymentMode, v.taxType, v.total, v.vatAmount
                FROM (${lightSql}) v ${exportWhereSql}
                ORDER BY v.transactionAt DESC, v.orderId DESC
                    LIMIT ${MAX_EXPORT_ROWS + 1}`, exportParams);
            if (vatRows.length > MAX_EXPORT_ROWS) {
                const error = new Error('Transaction export exceeds 5,000 records. Select a shorter date range and download again.');
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
                    createdAt: row.transactionAt instanceof Date
                        ? `${row.transactionAt.getFullYear()}-${String(row.transactionAt.getMonth()+1).padStart(2,'0')}-${String(row.transactionAt.getDate()).padStart(2,'0')} ${String(row.transactionAt.getHours()).padStart(2,'0')}:${String(row.transactionAt.getMinutes()).padStart(2,'0')}`
                        : String(row.transactionAt || '').slice(0,16),
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
                vatSummary: vatRegistered ? exportVatSummary : null,
                transactionSummary: {
                    count: exportRows.length,
                    totalSales: money(exportRows.reduce((sum, row) => sum + Number(row.totalInclusive || 0), 0)),
                },
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
        if (payment) { outerWhere.push('FIND_IN_SET(?, UPPER(COALESCE(r.paymentMode,\'\'))) > 0'); outerParams.push(payment); }
        if (search) { outerWhere.push('(r.orderId LIKE ? OR r.customerName LIKE ?)'); outerParams.push(`%${search}%`,`%${search}%`); }
        const filterSql = outerWhere.length ? `WHERE ${outerWhere.join(' AND ')}` : '';
        const [[count]] = await db.execute(`SELECT COUNT(*) AS total FROM (${lightSql}) r ${filterSql}`, [...lightParams,...outerParams]);
        let filteredSummary = null;
        if (body.branch_reporting === true) {
            const [[branchTotals]] = await db.execute(`
                SELECT COUNT(*) AS transactions, COALESCE(SUM(r.total), 0) AS sales,
                       COALESCE(SUM(r.vatAmount), 0) AS vat,
                       COALESCE(SUM(CASE WHEN r.salesSource = 'BOOKING' THEN r.total ELSE 0 END), 0) AS bookingSales,
                       COALESCE(SUM(CASE WHEN r.salesSource = 'WALK_IN' THEN r.total ELSE 0 END), 0) AS walkInSales
                FROM (${lightSql}) r ${filterSql}`, [...lightParams, ...outerParams]);
            filteredSummary = {
                transactions: Number(branchTotals.transactions || 0),
                sales: money(branchTotals.sales), vat: money(branchTotals.vat),
                bookingSales: bookingSchema.available ? money(branchTotals.bookingSales) : null,
                walkInSales: money(branchTotals.walkInSales),
            };
        }
        const total = Number(count.total || 0);
        const totalPages = Math.max(1,Math.ceil(total/pageSize));
        const sortOrder = sort==='OLDEST' ? 'ASC' : 'DESC';
        const offset=(page-1)*pageSize;
        const [rows] = await db.execute(`SELECT r.* FROM (${unionSql}) r ${filterSql}
                                         ORDER BY r.transactionAt ${sortOrder}, r.orderId ${sortOrder}
                                             LIMIT ${pageSize} OFFSET ${offset}`, [...unionParams,...outerParams]);
        // PERFORMANCE FIX: item summary and cashier for the walk-in rows on this page only.
        await fillPosItemAndCashier(db, storeId, rows.filter((r) => r.salesSource === 'WALK_IN'));
        const [methods] = await db.execute(`SELECT DISTINCT r.paymentMode AS method FROM (${lightSql}) r
                                            WHERE r.paymentMode IS NOT NULL AND TRIM(r.paymentMode) <> '' ORDER BY method`,lightParams);
        return {
            orders: rows.map(r=>({
                orderId: String(r.orderId), branchId: r.branchId, branchName: r.branchName,
                customerName: r.customerName || (r.salesSource === 'WALK_IN' ? 'Walk-in' : null),
                customerContactNumber: r.customerContactNumber || null,
                salesSource: r.salesSource, customerType: r.salesSource,
                paymentMode: r.paymentMode || null, taxType: r.taxType || null,
                total: r.total, totalCost: r.totalCost, profit: r.profit,
                additionalCharges: r.additionalCharges, depositRefunded: r.depositRefunded,
                vatAmount: r.vatAmount, item: r.item, cashierId: r.cashierId,
                cashierName: r.cashierName, cashierRole: r.cashierRole,
                orderDate: r.reportDate instanceof Date ? r.reportDate.toISOString().slice(0,10) : String(r.reportDate || '').slice(0,10),
                createdAt: r.transactionAt instanceof Date ?
                    `${r.transactionAt.getFullYear()}-${String(r.transactionAt.getMonth()+1).padStart(2,'0')}-${String(r.transactionAt.getDate()).padStart(2,'0')} ${String(r.transactionAt.getHours()).padStart(2,'0')}:${String(r.transactionAt.getMinutes()).padStart(2,'0')}:${String(r.transactionAt.getSeconds()).padStart(2,'0')}` : String(r.transactionAt || ''),
            })),
            pagination: {page,pageSize,total,totalPages,hasPrevious:page>1,hasMore:page<totalPages},
            filteredSummary,
            summary, paymentMethods: [...new Set(methods.flatMap(m=>String(m.method).split(',')))].sort(),
            taxRegistration, vatSummary,
            bookingIntegration: {
                available: bookingSchema.available,
                reason: bookingSchema.available ? null : bookingSchema.reason,
                costComplete: bookingSchema.available && missingCosts===0,
                revenueRecognition: 'Only Completed bookings, reported by recorded completion date (legacy event-date fallback); payments and security deposits are not added as sales.'
            }
        };
    }

    /**
     * Fetch one owner-visible transaction with its historical line items.
     * Read only. Uses the same walk-in / fulfilled-booking eligibility as the
     * owner report. Never fabricates item names, unit prices or invoice numbers.
     */
    async function getOwnerOrderDetail(db, storeId, body, scopedBranchId = null) {
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
            ? bookingSql(bookingSchema, { storeId, branchId: scopedBranchId, exactOrderId: orderId })
            : posSql({
                storeId,
                branchId: scopedBranchId,
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
            // PERFORMANCE FIX: look the order up by its store + Order No. (indexed).
            const [stored] = await db.execute(
                `SELECT poi.product_name_snapshot AS name, poi.quantity, poi.unit_price AS unitPrice,
                        poi.line_total AS lineTotal
                 FROM orders pio
                          JOIN order_items poi ON poi.order_id = pio.order_id AND poi.store_id = pio.store_id
                 WHERE pio.store_id = ? AND pio.order_number = ?
                 ORDER BY poi.id ASC LIMIT 501`,
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
            const [stored] = await db.execute(`SELECT item_name_snapshot AS name, variant_name_snapshot AS variantName,
                                                      quantity, unit_price_snapshot AS unitPrice, line_total AS lineTotal,
                                                      parent_item_id AS parentItemId, item_type AS itemType, rental_days AS rentalDays
                                               FROM booking_items WHERE store_id=? AND booking_id=? AND item_status NOT LIKE 'claim%'
                                                                    AND (item_type='package' OR item_status <> 'cancelled') ORDER BY id LIMIT 501`, [storeId, row.bookingKey]);
            items = stored.slice(0,500).map(line => {
                // Package inclusions carry zero line_total; never bill their catalog rate twice.
                const included = line.parentItemId != null && Number(line.lineTotal) === 0;
                const rental = line.itemType === 'rental' && Number(line.rentalDays) > 0;
                return { name: String(line.name || '') + (line.variantName ? ` - ${line.variantName}` : '') +
                        (rental && !included ? ` (${line.rentalDays} day(s), daily rate)` : ''),
                    quantity: Number(line.quantity), unitPrice: included ? 0 : Number(line.unitPrice),
                    lineTotal: Number(line.lineTotal), included };
            });
            itemsAvailable = stored.length <= 500 && items.length > 0 && items.every(line =>
                line.name.trim() && Number.isSafeInteger(line.quantity) && line.quantity > 0 &&
                Number.isFinite(line.unitPrice) && line.unitPrice >= 0 && Number.isFinite(line.lineTotal) && line.lineTotal >= 0);
            if (!itemsAvailable) detailNotice = 'Itemized booking products/services could not be verified from the saved booking records.';
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
            ...(source === 'BOOKING' ? { bookingBilling: bookingBilling(row), cashierName: row.cashierName || null,
                paymentStatus: bookingBilling(row).balance <= 0 ? 'PAID' : Number(row.bookingPaid) > 0 ? 'PARTIAL' : 'UNPAID',
                vatableSales: Number(row.vatAmount) > 0 ? money(Number(row.total) - Number(row.vatAmount)) : null } : {}),
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

const POS_CASHIER_NAME_SQL = `(SELECT ea.user_name FROM employee_actions ea
    WHERE ea.store_id = o.store_id AND ea.reference_number = o.order_id
      AND ea.action = 'Completed POS transaction'
    ORDER BY ea.id DESC LIMIT 1)`;
const POS_CASHIER_ROLE_SQL = `(SELECT ea.user_role FROM employee_actions ea
    WHERE ea.store_id = o.store_id AND ea.reference_number = o.order_id
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

// Owner dashboard v2: compact, tenant-scoped branch/day financial totals.
// Booking reporting follows the existing dashboard's completed/event-date basis.
async function loadOwnerDashboardV2(connection, storeId, dateFrom, dateTo) {
    const [walkRows] = await connection.execute(`
        SELECT DATE_FORMAT(t.orderDate,'%Y-%m-%d') AS date, t.branchId,
               SUM(t.sales) AS sales,
               CASE WHEN SUM(t.missingCost)>0 THEN NULL ELSE SUM(t.cost) END AS cost
        FROM (
            SELECT o.order_id, o.order_date AS orderDate, o.branch_id AS branchId, o.total AS sales,
                   SUM(oi.cost_price_at_sale * oi.quantity) AS cost,
                   CASE WHEN COUNT(oi.id)=0 OR SUM(CASE WHEN oi.cost_price_at_sale IS NULL
                     OR oi.cost_price_at_sale<0 OR oi.quantity<=0 THEN 1 ELSE 0 END)>0 THEN 1 ELSE 0 END AS missingCost
            FROM ${V2_POS_ORDERS} o
        LEFT JOIN ${V2_POS_ORDER_ITEMS} oi ON oi.order_pk=o.order_pk AND oi.store_id=o.store_id
        WHERE o.store_id=? AND o.order_date BETWEEN ? AND ? AND ${POS_SALE_FILTER_SQL}
        AND LOWER(TRIM(o.status))='completed'
        GROUP BY o.order_id,o.order_date,o.branch_id,o.total
        ) t GROUP BY t.orderDate,t.branchId`, [storeId,dateFrom,dateTo]);
    const [bookingRows] = await connection.execute(`
        SELECT DATE_FORMAT(t.eventDate,'%Y-%m-%d') AS date,t.branchId,
               CASE WHEN SUM(t.sales IS NULL)>0 THEN NULL ELSE SUM(t.sales) END AS sales,
               CASE WHEN SUM(t.missingCost)>0 THEN NULL ELSE SUM(t.cost) END AS cost
        FROM (
            SELECT b.id,b.event_date AS eventDate,b.branch_id AS branchId,
                   COALESCE(b.agreed_price,b.package_price_snapshot) AS sales,
                   SUM(CASE WHEN i.item_type='consumable' THEN ROUND(v.cost_price*i.used_quantity,2)
                            WHEN i.item_type='rental' THEN ROUND(e.cost_price*i.quantity,2)
                            ELSE 0 END) AS cost,
                   CASE WHEN COUNT(CASE WHEN i.item_type IN ('consumable','rental') THEN 1 END)=0
                        OR SUM(CASE WHEN i.item_type='consumable' AND
                               (v.cost_price IS NULL OR v.cost_price<=0 OR i.released_at IS NULL OR i.used_quantity>i.quantity) THEN 1
                             WHEN i.item_type='rental' AND
                               (e.cost_price IS NULL OR e.cost_price<=0 OR i.quantity IS NULL OR i.quantity<=0) THEN 1
                             ELSE 0 END)>0 THEN 1 ELSE 0 END AS missingCost
            FROM bookings b
            LEFT JOIN booking_items i ON i.booking_id=b.id AND i.store_id=b.store_id
                 AND i.item_type IN ('consumable','rental') AND i.item_status NOT LIKE 'claim%'
            LEFT JOIN product_variants v ON v.id=i.variant_id AND v.store_id=i.store_id
            LEFT JOIN equipment e ON e.id=i.equipment_id AND e.store_id=i.store_id
            WHERE b.store_id=? AND b.event_date BETWEEN ? AND ? AND LOWER(TRIM(b.status))='completed'
            GROUP BY b.id,b.event_date,b.branch_id,b.agreed_price,b.package_price_snapshot
        ) t GROUP BY t.eventDate,t.branchId`, [storeId,dateFrom,dateTo]);
    const starts = getOwnerDashboardPeriodStarts(dateTo);
    const [productRows] = await connection.execute(`
                SELECT oi.product_name AS name,
                       SUM(CASE WHEN o.order_date>=? THEN oi.line_total ELSE 0 END) AS monthSales,
                       SUM(CASE WHEN o.order_date>=? THEN oi.quantity ELSE 0 END) AS monthUnits,
                       SUM(CASE WHEN o.order_date>=? THEN oi.line_total ELSE 0 END) AS quarterSales,
                       SUM(CASE WHEN o.order_date>=? THEN oi.quantity ELSE 0 END) AS quarterUnits,
                       SUM(CASE WHEN o.order_date>=? THEN oi.line_total ELSE 0 END) AS yearSales,
                       SUM(CASE WHEN o.order_date>=? THEN oi.quantity ELSE 0 END) AS yearUnits
                FROM ${V2_POS_ORDER_ITEMS} oi JOIN ${V2_POS_ORDERS} o ON o.order_pk=oi.order_pk AND o.store_id=oi.store_id
                WHERE o.store_id=? AND o.order_date BETWEEN ? AND ? AND ${POS_SALE_FILTER_SQL}
                  AND LOWER(TRIM(o.status))='completed' GROUP BY oi.product_name`,
        [starts.month,starts.month,starts.quarter,starts.quarter,starts.year,starts.year,storeId,starts.year,dateTo]);
    const [branches] = await connection.execute('SELECT id, branch_name AS branchName FROM branches WHERE store_id=? ORDER BY branch_name,id',[storeId]);
    const normalize = rows => rows.map(row=>({date:String(row.date),branchId:String(row.branchId),
        sales:row.sales==null?null:Number(row.sales),cost:row.cost==null?null:Number(row.cost)}));
    return {dateRange:{startDate:dateFrom,endDate:dateTo},branches,walkDaily:normalize(walkRows),bookingDaily:normalize(bookingRows),
        rentalCostMethod:'manual_unit_cost_per_rental',
        topProducts:{month:buildTopDashboardRows(productRows,'monthSales','monthUnits',5),
            quarter:buildTopDashboardRows(productRows,'quarterSales','quarterUnits',5),year:buildTopDashboardRows(productRows,'yearSales','yearUnits',5)}};
}

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
        `SELECT CASE WHEN expiration_date IS NULL OR expiration_date >= ?
                         THEN GREATEST(on_hand_quantity - reserved_quantity - unavailable_quantity, 0)
                     ELSE 0 END AS sellableQuantity
         FROM branch_inventory
         WHERE id = ?
           AND status = 'active'`,
        [saleDate, inventoryId]
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
                     p.product_name AS productName,
                     pv.id AS variantId,
                     pv.attributes AS variantValues,
                     COALESCE(NULLIF(pv.selling_price, 0), NULLIF(dv.selling_price, 0), 0) AS salesPrice,
                     bi.id AS inventoryId,
                     bi.on_hand_quantity AS quantityOnHand
                 FROM products p
                          INNER JOIN product_variants dv
                                     ON dv.product_id = p.id
                                         AND dv.is_default = 1
                          INNER JOIN branch_inventory base_bi
                                     ON base_bi.variant_id = dv.id
                                         AND base_bi.branch_id = ?
                          INNER JOIN product_variants pv
                                     ON pv.product_id = p.id
                                         AND pv.id = ?
                                         AND pv.is_default = 0
                                         AND pv.deleted_at IS NULL
                          LEFT JOIN branch_inventory bi
                                    ON bi.store_id = p.store_id
                                        AND bi.branch_id = base_bi.branch_id
                                        AND bi.variant_id = pv.id
                                        AND bi.status = 'active'
                 WHERE p.id = ?
                   AND p.store_id = ?
                   AND p.deleted_at IS NULL
                     LIMIT 1`,
                [branchId, variantId, productId, storeId]
            );
        } else {
            [rows] = await connection.execute(
                `SELECT
                     p.id AS productId,
                     p.product_name AS productName,
                     NULL AS variantId,
                     NULL AS variantValues,
                     COALESCE(NULLIF(dv.selling_price, 0), 0) AS salesPrice,
                     bi.id AS inventoryId,
                     bi.on_hand_quantity AS quantityOnHand
                 FROM products p
                          INNER JOIN product_variants dv
                                     ON dv.product_id = p.id
                                         AND dv.is_default = 1
                          INNER JOIN branch_inventory bi
                                     ON bi.store_id = p.store_id
                                         AND bi.branch_id = ?
                                         AND bi.variant_id = dv.id
                                         AND bi.status = 'active'
                 WHERE p.id = ?
                   AND p.store_id = ?
                   AND p.deleted_at IS NULL
                   AND p.has_variants = 0
                     LIMIT 1`,
                [branchId, productId, storeId]
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
                `Branch inventory is missing for ${row.productName || `product ${productId}`}.`
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
    // order_items.order_id references orders.order_id (the numeric key of the Order No.).
    const [orderRows] = await connection.execute(
        `SELECT order_id AS orderPk FROM orders WHERE store_id = ? AND order_number = ? LIMIT 1`,
        [storeId, orderId]
    );
    if (!orderRows.length) {
        throw new Error("POS order header was not found for its items.");
    }
    const orderPk = Number(orderRows[0].orderPk);
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
        const catalogVariantId = await v2CatalogVariantId(connection, productId, variantId);
        if (!catalogVariantId) {
            throw new Error(`Product ${productId} is not available in this branch.`);
        }
        const [costRows] = await connection.execute(
            `SELECT COALESCE(NULLIF(pv.cost_price, 0), dv.cost_price, 0) AS costPrice
             FROM product_variants pv
                      INNER JOIN product_variants dv
                                 ON dv.product_id = pv.product_id
                                     AND dv.is_default = 1
             WHERE pv.id = ?
               AND pv.product_id = ?
               AND pv.store_id = ?
                 LIMIT 1`,
            [catalogVariantId, productId, storeId]
        );
        const costPriceAtSale = roundMoney(costRows[0]?.costPrice ?? 0);
        const lineTotal = roundMoney(unitPrice * quantity);
        await connection.execute(
            `INSERT INTO order_items
             (store_id, order_id, variant_id, product_name_snapshot,
              quantity, unit_price, cost_price_at_sale, discount_amount, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [
                storeId,
                orderPk,
                catalogVariantId,
                String(productName).slice(0, 180),
                quantity,
                unitPrice,
                costPriceAtSale,
                lineTotal,
            ]
        );
        void branchId;
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


// ===== PERFORMANCE FIX: item summary + cashier for returned rows only BEGIN =====
/*
 * The item summary ("Name - Variant xQty, ...") and the cashier name used to be
 * worked out inside the SQL for EVERY order in the database before filtering.
 * With years of sales that took many minutes and POS stopped loading.
 * They are now loaded only for the rows being returned, with the same values.
 * Cashier comes from the 'Completed POS transaction' log as before; when an order
 * has no log row, the user who processed the order is shown instead.
 */
async function fillPosItemAndCashier(connection, storeId, rows) {
    const list = (Array.isArray(rows) ? rows : []).filter((row) => row && row.orderId != null);
    if (list.length === 0) return;
    const keyOf = (value) => String(value ?? "").trim().toLowerCase();
    const ids = Array.from(new Set(list.map((row) => String(row.orderId).trim()).filter(Boolean)));
    const items = new Map();
    const cashiers = new Map();
    const CHUNK_SIZE = 500;
    for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
        const chunk = ids.slice(start, start + CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        const [itemRows] = await connection.execute(
            `SELECT po.order_number AS orderId,
                    LEFT(GROUP_CONCAT(CONCAT(poi.product_name_snapshot,
                        CASE WHEN piv.is_default = 1 THEN '' ELSE CONCAT(' - ', piv.variant_name) END,
                        ' x', poi.quantity) ORDER BY poi.id SEPARATOR ', '), 255) AS item,
                    MAX(pu.full_name) AS userName, MAX(pu.role) AS userRole
             FROM orders po
                      LEFT JOIN order_items poi ON poi.order_id = po.order_id
                      LEFT JOIN product_variants piv ON piv.id = poi.variant_id
                      LEFT JOIN users pu ON pu.id = po.processed_by AND pu.store_id = po.store_id
             WHERE po.store_id = ? AND po.order_number IN (${placeholders})
             GROUP BY po.order_id, po.order_number`,
            [storeId, ...chunk]
        );
        for (const row of itemRows) items.set(keyOf(row.orderId), row);
        if (ids.length > CHUNK_SIZE) continue; // long lists read the log once, below
        const [logRows] = await connection.execute(
            `SELECT ea.reference_number AS orderId, ea.user_name AS cashierName, ea.user_role AS cashierRole
             FROM employee_actions ea
             WHERE ea.store_id = ? AND ea.action = 'Completed POS transaction'
               AND ea.reference_number IN (${placeholders})
             ORDER BY ea.id DESC`,
            [storeId, ...chunk]
        );
        // Newest log row per order, exactly like the old ORDER BY id DESC LIMIT 1.
        for (const row of logRows) {
            const key = keyOf(row.orderId);
            if (!cashiers.has(key)) cashiers.set(key, row);
        }
    }
    if (ids.length > CHUNK_SIZE) {
        const wanted = new Set(ids.map(keyOf));
        const [logRows] = await connection.execute(
            `SELECT ea.reference_number AS orderId, ea.user_name AS cashierName, ea.user_role AS cashierRole
             FROM employee_actions ea
             WHERE ea.store_id = ? AND ea.action = 'Completed POS transaction'
             ORDER BY ea.id DESC`,
            [storeId]
        );
        for (const row of logRows) {
            const key = keyOf(row.orderId);
            if (wanted.has(key) && !cashiers.has(key)) cashiers.set(key, row);
        }
    }
    const roleLabel = (role) => {
        const text = String(role || "").trim().toLowerCase();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
    };
    for (const row of list) {
        const key = keyOf(row.orderId);
        const itemRow = items.get(key);
        const logRow = cashiers.get(key);
        row.item = itemRow?.item ?? null;
        row.cashierName = logRow ? logRow.cashierName : (itemRow?.userName ?? null);
        row.cashierRole = logRow ? logRow.cashierRole : roleLabel(itemRow?.userRole);
    }
}
// ===== PERFORMANCE FIX: item summary + cashier for returned rows only END =====

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
     * Loading the items in small batches keeps the SQL statement and
     * MySQL temporary-file usage under control.
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
        // PERFORMANCE FIX: find the orders by store + Order No. (indexed) instead of
        // reading every order item in the database for each batch.
        const [rows] = await connection.execute(
            `SELECT
                 pio.order_number AS orderId,
                 piv.product_id AS productId,
                 CASE WHEN piv.is_default = 1 THEN NULL ELSE poi.variant_id END AS variantId,
                 poi.product_name_snapshot AS name,
                 poi.quantity,
                 poi.unit_price AS unitPrice,
                 poi.line_total AS lineTotal,
                 COALESCE(poi.cost_price_at_sale, 0) AS costPrice
             FROM orders pio
                      JOIN order_items poi ON poi.order_id = pio.order_id AND poi.store_id = pio.store_id
                      JOIN product_variants piv ON piv.id = poi.variant_id
             WHERE pio.store_id = ?
               AND pio.order_number IN (${placeholders})
             ORDER BY pio.order_number ASC, poi.id ASC`,
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
    return v2LockInventory(connection, { storeId, branchId, productId, variantId: variantId || null });
}

async function consumeV2Batches(connection, inventoryId, quantity, saleDate) {
    const remaining = Math.max(0, Number(quantity || 0));
    if (remaining <= 0) return;
    const sellable = await getSellableBatchQuantity(connection, inventoryId, saleDate);
    if (sellable < remaining) {
        throw new Error(
            `Sellable stock is short by ${remaining - sellable} unit(s) for inventory #${inventoryId}.`
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
            `Branch inventory row is missing for product ${options.productId}` +
            `${options.variantId ? ` variant ${options.variantId}` : ""}.`
        );
    }
    const before = Number(row.quantity_on_hand || 0);
    const quantity = Math.max(0, Number(options.quantity || 0));
    if (before < quantity) {
        throw new Error(
            `Stock mismatch for product ${options.productId}. Available: ${before}, needed: ${quantity}.`
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
         SET on_hand_quantity = ?
         WHERE id = ?`,
        [after, row.id]
    );
    const actor = options.actor || { id: null, role: "SYSTEM", name: "StockNBook" };
    await v2RecordMovement(connection, {
        storeId: options.storeId,
        branchId: options.branchId,
        inventoryId: row.id,
        movementType: "SALE",
        delta: -quantity,
        before,
        after,
        referenceType: options.referenceType || "POS_ORDER",
        reference: options.referenceId != null ? String(options.referenceId) : null,
        actorId: actor.id ?? null,
        notes: options.notes || "POS inventory deduction.",
    });
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
        // branch_inventory is the only stock ledger in stocknbook_v2.
        try {
            await decreaseV2Inventory(connection, {
                storeId,
                branchId,
                productId,
                variantId: variantId || null,
                quantity,
                saleDate: movementContext.saleDate,
                ...movementContext,
                notes: variantId
                    ? `POS sale: ${productName || `Product #${productId}`} (variant ${variantId}) x${quantity}`
                    : `POS sale: ${productName || `Product #${productId}`} x${quantity}`,
            });
        } catch (error) {
            if (/missing|mismatch|short/i.test(String(error.message || ""))) {
                throw new Error(
                    variantId
                        ? `Insufficient stock or invalid variant for "${productName}".`
                        : `Insufficient stock or invalid product for "${productName || productId}".`
                );
            }
            throw error;
        }
    }
}

/*
 * The JWT issued at login only carries ids (store_id / manager_id /
 * staff_id) and an email â€” never a display name. To log a real,
 * human-readable employee_actions row we look the acting user's name up
 * from their own table using the id that's already in the token.
 */
async function getActingEmployee(connection, decoded) {
    const role = String(decoded?.role || "").toLowerCase();
    const storeId = toPositiveInteger(decoded?.store_id);

    if (role === "manager" && toPositiveInteger(decoded?.manager_id)) {
        const [rows] = await connection.execute(
            `SELECT full_name AS manager_name FROM users WHERE id = ? AND store_id = ? AND role = 'manager' LIMIT 1`,
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
            `SELECT full_name AS staff_name FROM users WHERE id = ? AND store_id = ? AND role = 'staff' LIMIT 1`,
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
 * Writes one row to employee_actions. Callers decide whether this runs
 * inside the same DB transaction as the action it's logging (so the log
 * and the action succeed/fail together) or as a best-effort call after
 * the action already committed.
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
            "get_orders", "get_owner_dashboard_summary", "get_owner_sales_report", "get_owner_order_detail",
            "get_branch_sales_report", "get_branch_order_detail", "get_tax_registration",
            "get_pos_invoice_detail",
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
                    // The item summary is derived from order_items in stocknbook_v2.
                    void item;
                    const cashierUserId = await v2ActorUserId(connection, storeId, actingEmployee.id);
                    const [orderInsert] = await connection.execute(
                        `INSERT INTO orders
                         (
                             order_number, store_id, branch_id, order_date,
                             subtotal, discount_amount, vatable_sales, vat_amount, total,
                             tax_type, payment_mode, amount_tendered, change_due,
                             status, processed_by
                         )
                         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
                        [
                            orderId,
                            storeId,
                            tokenBranchId,
                            orderDate,
                            total,
                            vatableSales,
                            vatAmount,
                            total,
                            taxType,
                            paymentMode,
                            customerPayment,
                            changeDue,
                            cashierUserId,
                        ]
                    );
                    // The customer payment for this sale (payments.order_id).
                    if (total > 0) {
                        await connection.execute(
                            `INSERT INTO payments
                             (store_id, branch_id, order_id, payment_type, amount, payment_method,
                              status, recorded_by, paid_at)
                             VALUES (?, ?, ?, 'POS', ?, ?, 'recorded', ?, NOW())`,
                            [storeId, tokenBranchId, orderInsert.insertId, total, paymentMode, cashierUserId]
                        );
                    }

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
                        details: `${item} â€” Grand Total â‚±${total} â€” ${paymentMode} â€” ${taxType} â€” VATable â‚±${vatableSales} â€” VAT â‚±${vatAmount}`,
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
                             NULL AS item,
                             o.total,
                             o.total AS grandTotal,
                             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                             DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
                         FROM ${V2_POS_ORDERS} o
                                  LEFT JOIN branches b
                                            ON b.id = o.branch_id
                                                AND b.store_id = o.store_id
                         WHERE o.order_id = ? AND o.store_id = ?
                             LIMIT 1`,
                        [orderId, storeId]
                    );
                    // PERFORMANCE FIX: item summary for this one order only.
                    await fillPosItemAndCashier(connection, storeId, rows);

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

        // Shared database-backed invoice endpoint for Owner, Manager and Staff.
        if (action === "get_pos_invoice_detail") {
            const orderId = String(body.order_id ?? '').trim();
            const source = String(body.sales_source ?? '').trim().toUpperCase();
            const branchScope = tokenRole === 'owner' ? requestedBranchId : tokenBranchId;
            if (tokenRole !== 'owner' && requestedBranchId && requestedBranchId !== tokenBranchId) {
                return jsonResponse(403, headers, { error: 'Only the assigned branch can be accessed.' });
            }
            if (!['owner','manager','staff'].includes(tokenRole) ||
                (tokenRole !== 'owner' && (!Number.isSafeInteger(branchScope) || branchScope <= 0))) {
                return jsonResponse(403, headers, { error: 'Invoice access denied.' });
            }
            if (!orderId || orderId.length > 80 || !['WALK_IN','BOOKING'].includes(source)) {
                return jsonResponse(400, headers, { error: 'A valid Order ID and Sales Source are required.' });
            }
            if (tokenRole === 'staff' && source !== 'WALK_IN') {
                return jsonResponse(403, headers, { error: 'Staff may download todayâ€™s walk-in transactions only.' });
            }
            const numberOrNull = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
            const scopeSql = branchScope == null ? '' : ' AND t.branch_id = ?';
            const scopeArgs = branchScope == null ? [] : [branchScope];
            if (source === 'WALK_IN') {
                // orders.order_id is the numeric PK; order_number is the public transaction ID.
                // All joins contain tenant scope; user input never supplies store/branch authorization.
                const todaySql = tokenRole === 'staff' ? ' AND DATE(t.order_date) = ?' : '';
                const todayArgs = tokenRole === 'staff' ? [getManilaISODate()] : [];
                const [rows] = await connection.execute(`
                    SELECT t.order_id AS internalId, t.order_number AS orderId,
                           s.store_name AS storeName, s.business_name AS businessName,
                           s.address AS storeAddress, s.tin,
                           b.branch_name AS branchName, b.address AS branchAddress,
                           COALESCE(NULLIF(TRIM(c.full_name), ''), 'Walk-in Customer') AS customerName,
                           COALESCE((SELECT NULLIF(TRIM(ea.user_name), '')
                                     FROM employee_actions ea
                                     WHERE ea.store_id = t.store_id AND ea.branch_id = t.branch_id
                                       AND ea.reference_number = t.order_number
                                       AND ea.action = 'Completed POS transaction'
                                     ORDER BY ea.id DESC LIMIT 1), u.full_name) AS cashierName,
                           DATE_FORMAT(t.order_date, '%Y-%m-%d') AS date,
                           DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
                           t.payment_mode AS paymentMode, t.tax_type AS taxType,
                           t.vatable_sales AS vatableSales, t.vat_amount AS vatAmount,
                           t.subtotal, t.total, t.amount_tendered AS amountTendered, t.change_due AS changeDue
                    FROM orders t
                        JOIN stores s ON s.id = t.store_id
                        JOIN branches b ON b.id = t.branch_id AND b.store_id = t.store_id
                        LEFT JOIN customers c ON c.id = t.customer_id AND c.store_id = t.store_id
                        LEFT JOIN users u ON u.id = t.processed_by AND u.store_id = t.store_id
                    WHERE t.store_id = ? AND t.order_number = ?
                      AND LOWER(TRIM(t.status)) = 'completed'
                      AND UPPER(TRIM(t.payment_mode)) IN ('CASH','GCASH','BANK_TRANSFER')
                        ${scopeSql}${todaySql}
                        LIMIT 2`, [storeId, orderId, ...scopeArgs, ...todayArgs]);
                if (rows.length !== 1) return jsonResponse(404, headers, { error: 'Completed transaction not found in your allowed scope.' });
                const { internalId, ...row } = rows[0];
                const [stored] = await connection.execute(`
                    SELECT product_name_snapshot AS name, quantity, unit_price AS unitPrice, line_total AS lineTotal
                    FROM order_items WHERE store_id = ? AND order_id = ? ORDER BY id LIMIT 501`, [storeId, internalId]);
                const items = stored.slice(0,500).map(x => ({ name: String(x.name || ''), quantity: numberOrNull(x.quantity), unitPrice: numberOrNull(x.unitPrice), lineTotal: numberOrNull(x.lineTotal) }));
                const itemsAvailable = stored.length <= 500 && items.length > 0 && items.every(x => x.name.trim() && Number.isSafeInteger(x.quantity) && x.quantity > 0 && x.unitPrice != null && x.unitPrice >= 0 && x.lineTotal != null && x.lineTotal >= 0);
                const total = numberOrNull(row.total), tendered = numberOrNull(row.amountTendered);
                // Completed walk-in orders use the recorded tender, not a fabricated default.
                const paymentStatus = tendered == null || total == null ? null : tendered >= total ? 'PAID' : tendered > 0 ? 'PARTIAL' : 'UNPAID';
                return jsonResponse(200, headers, { success: true, detail: {
                        ...row, salesSource: 'WALK_IN', total, subtotal: numberOrNull(row.subtotal),
                        vatableSales: numberOrNull(row.vatableSales), vatAmount: numberOrNull(row.vatAmount),
                        amountTendered: tendered, changeDue: numberOrNull(row.changeDue), paymentStatus,
                        items, itemsAvailable, detailNotice: itemsAvailable ? null : 'Historical item details could not be verified.', officialInvoiceNumber: null,
                    }});
            }
            // Booking: same completed/completion-date scope and financial statement as the report.
            try {
                const detail = await getOwnerSalesReport.getOrderDetail(connection, storeId,
                    { order_id: orderId, sales_source: 'BOOKING' }, branchScope);
                const [rows] = await connection.execute(`
                    SELECT s.store_name AS storeName, s.business_name AS businessName, s.address AS storeAddress, s.tin,
                           b.branch_name AS branchName, b.address AS branchAddress, c.full_name AS customerName,
                           t.vat_amount AS vatAmount
                    FROM bookings t JOIN stores s ON s.id = t.store_id
                                    JOIN branches b ON b.id = t.branch_id AND b.store_id = t.store_id
                                    JOIN customers c ON c.id = t.customer_id AND c.store_id = t.store_id
                    WHERE t.store_id = ? AND t.booking_reference = ? AND LOWER(TRIM(t.status)) = 'completed' ${scopeSql} LIMIT 2`, [storeId, orderId, ...scopeArgs]);
                if (rows.length !== 1) return jsonResponse(404, headers, { error: 'Booking reference not found in your allowed scope.' });
                const row = rows[0];
                const vat = numberOrNull(detail.vatAmount), total = numberOrNull(detail.total);
                const taxType = detail.taxType;
                const vatableSales = vat != null && ['VAT','VAT_REGISTERED'].includes(taxType) && total != null && total >= vat ? Math.round((total - vat) * 100) / 100 : null;
                return jsonResponse(200, headers, { success: true, detail: {
                        ...detail, ...row, total, vatAmount: vat, taxType, vatableSales,
                        cashierName: detail.cashierName || null, subtotal: null, amountTendered: null, changeDue: null, paymentStatus: detail.paymentStatus,
                        officialInvoiceNumber: null,
                    }});
            } catch (error) {
                if ([400,404,409].includes(error?.statusCode)) return jsonResponse(error.statusCode, headers, { error: error.message });
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

        if (action === "get_branch_order_detail") {
            if (tokenRole !== "manager") {
                return jsonResponse(403, headers, { error: "Only the branch manager may view branch order details." });
            }
            if (requestedBranchId && requestedBranchId !== tokenBranchId) {
                return jsonResponse(403, headers, { error: "Only the assigned branch can be accessed." });
            }
            try {
                const detail = await getOwnerSalesReport.getOrderDetail(connection, storeId, body, tokenBranchId);
                return jsonResponse(200, headers, { success: true, detail });
            } catch (error) {
                if ([400, 404, 409].includes(error?.statusCode)) {
                    return jsonResponse(error.statusCode, headers, { error: error.message });
                }
                throw error;
            }
        }

        if (action === "get_branch_sales_report") {
            if (tokenRole !== "manager") {
                return jsonResponse(403, headers, { error: "Only the branch manager may access branch sales." });
            }
            if (requestedBranchId && requestedBranchId !== tokenBranchId) {
                return jsonResponse(403, headers, { error: "Only the assigned branch can be accessed." });
            }
            try {
                // The branch scope comes from the verified employee token, never the request body.
                const report = await getOwnerSalesReport(connection, storeId, tokenBranchId,
                    { ...body, branch_reporting: body.vat_export !== true });
                if (report.export) return jsonResponse(200, headers, { success: true, ...report });
                const orders = report.orders.map(({ totalCost, profit, customerContactNumber, ...visible }) => visible);
                return jsonResponse(200, headers, {
                    success: true, orders, pagination: report.pagination,
                    summary: report.filteredSummary,
                    taxRegistration: report.taxRegistration,
                    bookingIntegration: report.bookingIntegration,
                });
            } catch (error) {
                if (error?.statusCode === 400) return badRequest(headers, error.message);
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

            // Opt-in response; the legacy dashboard summary is unchanged.
            if (body.dashboard_version === 2) {
                const earliest = `${Number(requestedDateTo.slice(0,4))-1}-01-01`;
                if (requestedDateFrom < earliest || requestedDateTo > getManilaISODate()) {
                    return badRequest(headers, "Choose a date range within this and the previous calendar year.");
                }
                const summary = await loadOwnerDashboardV2(connection, storeId, requestedDateFrom, requestedDateTo);
                return jsonResponse(200, headers, {success:true, summary});
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
                     FROM ${V2_POS_ORDERS} o
                     LEFT JOIN ${V2_POS_ORDER_ITEMS} oi
                     ON oi.order_pk = o.order_pk
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
                 FROM ${V2_POS_ORDERS} o
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
                 FROM ${V2_POS_ORDER_ITEMS} oi
                          INNER JOIN ${V2_POS_ORDERS} o
                                     ON o.order_pk = oi.order_pk
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
            // PERFORMANCE FIX: cost is summed for this store only (was every store), per order key.
            const joinMetrics = includeFinancials ? `LEFT JOIN (
                SELECT order_id AS order_pk,
                    SUM(COALESCE(cost_price_at_sale,0) * quantity) AS cost
                FROM order_items WHERE store_id = ? GROUP BY order_id
            ) AS item_cost ON item_cost.order_pk = o.order_pk` : '';
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
                             NULL AS cashierName,
                             NULL AS cashierRole,
                             NULL AS item, o.total, o.total AS grandTotal,
                             CASE WHEN UPPER(o.tax_type)='VAT' THEN 'VAT_REGISTERED' ELSE 'NON_VAT' END AS taxRegistration,
                             ${metrics}
                                 DATE_FORMAT(o.order_date,'%Y-%m-%d') AS orderDate,
                             DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
                         FROM ${V2_POS_ORDERS} o
                                  LEFT JOIN branches b ON b.id=o.branch_id AND b.store_id=o.store_id
                             ${joinMetrics}
                         WHERE ${whereSql}
                         ORDER BY o.created_at DESC, o.order_id DESC`;
            if (paginate) query += ` LIMIT ${pageSize} OFFSET ${offset}`;
            const [rows] = await connection.execute(query, includeFinancials ? [storeId, ...params] : params);
            // PERFORMANCE FIX: item summary and cashier for the returned rows only.
            await fillPosItemAndCashier(connection, storeId, rows);
            const includeItems = body.include_order_items === true || body.includeOrderItems === true || isBranchUser;
            let orders = rows;
            if (includeItems && rows.length) {
                const byId = await loadOrderItemsForOrders(connection, storeId, rows.map(r => r.orderId));
                orders = rows.map(r => ({...r, orderItems: byId.get(String(r.orderId)) || []}));
            }
            let pagination = null;
            if (paginate) {
                const [[count]] = await connection.execute(`SELECT COUNT(*) AS total FROM ${V2_POS_ORDERS} o WHERE ${whereSql}`,params);
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
                                                             FROM ${V2_POS_ORDERS} o WHERE ${whereSql} AND ${POS_SALE_FILTER_SQL}`, params);
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
                                                             FROM ${V2_POS_ORDERS} o LEFT JOIN (
                                                                 SELECT order_id AS order_pk,SUM(COALESCE(cost_price_at_sale,0)*quantity) AS cost
                                                                 FROM order_items WHERE store_id = ? GROUP BY order_id
                                                             ) c ON c.order_pk=o.order_pk
                                                             WHERE ${whereSql} AND ${POS_SALE_FILTER_SQL}`,[storeId, ...params]);
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
