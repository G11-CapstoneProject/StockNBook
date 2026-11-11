"use strict";
// Dedicated rental inventory Lambda. This module never queries or writes Sales products.
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

// LOCAL DEVELOPMENT ONLY: Uses the same JWT and database settings as your existing Sales Lambda.
// For deployment, move these into environment variables and rotate the shared credentials.
const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook_v2",
    ssl: { rejectUnauthorized: false },
};

// Reuse a small number of MySQL connections across requests handled by this module.
// Keep the existing connection settings and all rental operations unchanged.
const dbPool = mysql.createPool({
    ...dbConfig,
    timezone: "+08:00",
    dateStrings: true,
    connectTimeout: 10000,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});

// ===== BEGIN StockNBook v2 rentals & bookings (identical in lambda-rental-inventory and lambda-bookings) =====
/*
 * stocknbook_v2 rental model
 *  - equipment + its default equipment_variants row (is_default = 1) hold the
 *    item, daily rate and average cost. A rental item belongs to the branch
 *    holding the branch_inventory row of that default variant.
 *  - branch_inventory (equipment_variant_id):
 *      on_hand_quantity     = total units owned by the branch
 *      reserved_quantity    = units currently out with customers (rented out)
 *      unavailable_quantity = units on hold (maintenance, inspection, cleaning)
 *                             + units reported missing
 *  - stock_issues: maintenance records (issue_type 'maintenance', status =
 *    condition), missing reports (issue_type 'missing') and staff repair
 *    completion requests (issue_type 'repair_completion').
 *  - booking_items (item_type 'rental') are the booking's equipment lines:
 *      item_status 'pending'   requested, not yet reserved
 *                  'reserved'  reserved by a confirmed booking
 *                  'released'  handed over (checked out)
 *                  'returned'  returned, waiting for inspection
 *                  'cleaning' / 'damaged' / 'cleared'  inspected
 *                  'cancelled'
 *    A customer charge for lost or damaged equipment is a booking_items row
 *    with item_status 'claim_approved' / 'claim_settled' / 'claim_waived'.
 *  - Rental activity is recorded in inventory_movements.
 */
const V2_RETURNED_ITEM_STATUSES_SQL = "('returned','cleaning','damaged','cleared')";
const V2_RENTAL_LINE_SQL = "bki.item_type = 'rental' AND bki.item_status NOT LIKE 'claim%'";

// Missing units still unresolved for an equipment branch stock row.
const V2_MISSING_UNITS_SQL = (bi) => `COALESCE((SELECT SUM(mi.quantity - mi.quantity_resolved)
        FROM stock_issues mi
        WHERE mi.branch_inventory_id = ${bi}.id AND mi.issue_type = 'missing' AND mi.status = 'pending'), 0)`;

// Rental equipment rows as the rental screens use them (one per item and branch).
const V2_RENTAL_EQUIPMENT = `(SELECT
        e.id, e.store_id, ebi.branch_id, e.category_id, e.equipment_number,
        e.equipment_name AS name, LOWER(TRIM(e.equipment_name)) AS name_key,
        ebi.reorder_level AS alert_level, ev.rental_rate_per_day,
        'manual' AS pricing_method, NULL AS pricing_recovery_days, NULL AS pricing_residual_value,
        NULL AS pricing_operating_cost_per_day, NULL AS pricing_margin_percent, NULL AS pricing_unit_cost_basis,
        ebi.on_hand_quantity AS total_units,
        ebi.reserved_quantity AS rented_out_units,
        ebi.unavailable_quantity - ${V2_MISSING_UNITS_SQL("ebi")} AS maintenance_units,
        ${V2_MISSING_UNITS_SQL("ebi")} AS missing_units,
        ev.cost_price AS average_unit_cost, NULL AS last_supplier,
        e.deleted_at AS archived_at, e.created_at, e.updated_at,
        ev.id AS equipment_variant_id, ebi.id AS inventory_id
    FROM equipment e
             JOIN equipment_variants ev ON ev.equipment_id = e.id AND ev.is_default = 1
             JOIN branch_inventory ebi ON ebi.equipment_variant_id = ev.id)`;

// Rental categories (store-wide categories with category_type 'equipment').
const V2_RENTAL_CATEGORIES = `(SELECT
        id, store_id, category_name AS name, LOWER(TRIM(category_name)) AS category_key,
        CASE WHEN status = 'active' THEN NULL ELSE updated_at END AS archived_at, created_at
    FROM categories
    WHERE category_type = 'equipment')`;

// Equipment lines of bookings in the legacy allocation + staff workflow shape.
const V2_RENTAL_ALLOCATIONS = `(SELECT
        bki.id, bki.id AS allocation_id, bki.store_id, rb.branch_id, rb.id AS booking_id, rb.booking_reference,
        ev.equipment_id, bki.equipment_variant_id, bki.quantity,
        COALESCE(rb.rental_start_date, rb.event_date) AS start_date,
        COALESCE(rb.rental_end_date, rb.event_end_date, rb.rental_start_date, rb.event_date) AS end_date,
        CASE
            WHEN bki.item_status = 'released' THEN 'checked_out'
            WHEN bki.item_status IN ${V2_RETURNED_ITEM_STATUSES_SQL} THEN 'returned'
            WHEN bki.item_status = 'cancelled' THEN 'cancelled'
            WHEN bki.item_status = 'reserved' THEN 'reserved'
            ELSE 'requested' END AS status,
        bki.item_status, bki.line_total AS rental_charge_total, bki.unit_price_snapshot AS daily_rate_snapshot,
        bki.rental_days AS billable_days, bki.item_name_snapshot AS equipment_name,
        bki.prepared_at, bki.prepared_by, bki.released_at, bki.released_by,
        bki.returned_at, bki.received_by AS returned_by,
        CASE WHEN bki.returned_at IS NULL THEN NULL ELSE bki.returned_quantity END AS returned_received_units,
        CASE WHEN bki.item_status = 'returned' THEN 'pending'
             WHEN bki.item_status IN ('cleaning','damaged','cleared') THEN bki.item_status
             ELSE NULL END AS inspection_status,
        bki.used_quantity AS inspection_cleaning_units,
        bki.damaged_quantity AS inspection_damaged_units,
        bki.missing_quantity AS missing_units,
        bki.return_notes AS inspection_notes,
        bki.inspected_at, bki.inspected_by,
        (SELECT di.id FROM stock_issues di
          WHERE di.booking_id = rb.id AND di.issue_type = 'maintenance'
            AND di.branch_inventory_id = (SELECT dbi.id FROM branch_inventory dbi
                                          WHERE dbi.equipment_variant_id = bki.equipment_variant_id
                                            AND dbi.branch_id = rb.branch_id LIMIT 1)
            AND di.reason LIKE 'Rental damage %'
          ORDER BY di.id DESC LIMIT 1) AS maintenance_record_id,
        bki.created_at, bki.updated_at
    FROM booking_items bki
             JOIN bookings rb ON rb.id = bki.booking_id AND rb.store_id = bki.store_id
             JOIN equipment_variants ev ON ev.id = bki.equipment_variant_id
    WHERE ${V2_RENTAL_LINE_SQL})`;

// Maintenance / inspection holds.
const V2_MAINTENANCE_RECORDS = `(SELECT
        si.id, si.store_id, si.branch_id, mev.equipment_id,
        si.quantity AS quantity_started, si.quantity - si.quantity_resolved AS quantity_remaining,
        si.reason AS start_reason, si.status AS condition_status,
        si.estimated_completion_date, si.created_at AS opened_at,
        mb.booking_reference, si.booking_id,
        si.approved_at AS repair_approved_at, si.approved_by AS repair_approved_by,
        si.resolution_notes AS completion_notes, si.resolved_at AS completed_at
    FROM stock_issues si
             JOIN branch_inventory mbi ON mbi.id = si.branch_inventory_id
             JOIN equipment_variants mev ON mev.id = mbi.equipment_variant_id
             LEFT JOIN bookings mb ON mb.id = si.booking_id
    WHERE si.issue_type = 'maintenance')`;

// Missing-unit reports.
const V2_MISSING_REPORTS = `(SELECT
        si.id, si.store_id, si.branch_id, mev.equipment_id, si.quantity, si.quantity_resolved AS recovered,
        si.reason, COALESCE(ru.full_name, '') AS reported_by, mb.booking_reference, si.booking_id,
        si.status, si.resolved_by, si.resolved_at, si.resolution_notes, si.created_at
    FROM stock_issues si
             JOIN branch_inventory mbi ON mbi.id = si.branch_inventory_id
             JOIN equipment_variants mev ON mev.id = mbi.equipment_variant_id
             LEFT JOIN bookings mb ON mb.id = si.booking_id
             LEFT JOIN users ru ON ru.id = si.reported_by
    WHERE si.issue_type = 'missing')`;

// Staff repair completion requests awaiting Manager approval.
const V2_COMPLETION_REQUESTS = `(SELECT
        si.id, si.store_id, si.branch_id, mev.equipment_id,
        CAST(SUBSTRING_INDEX(SUBSTRING(si.reason, 5), ':', 1) AS UNSIGNED) AS maintenance_record_id,
        si.quantity, SUBSTRING(si.reason, LOCATE(': ', si.reason) + 2) AS notes,
        si.status, si.reported_by AS requested_by, si.resolved_by AS reviewed_by,
        si.resolved_at AS reviewed_at, si.created_at
    FROM stock_issues si
             JOIN branch_inventory mbi ON mbi.id = si.branch_inventory_id
             JOIN equipment_variants mev ON mev.id = mbi.equipment_variant_id
    WHERE si.issue_type = 'repair_completion')`;

// Rental activity (inventory_movements of equipment stock rows).
const V2_RENTAL_MOVEMENTS = `(SELECT
        mm.id, mm.store_id, mm.branch_id, rev.equipment_id, mm.movement_type AS type,
        ABS(mm.quantity_change) AS quantity,
        CASE WHEN mm.reason LIKE 'Ref %: %'
                 THEN SUBSTRING_INDEX(SUBSTRING(mm.reason, 5), ': ', 1)
             ELSE NULL END AS reference_number,
        CASE WHEN mm.reason LIKE 'Ref %: %'
                 THEN SUBSTRING(mm.reason, LOCATE(': ', mm.reason) + 2)
             ELSE mm.reason END AS description,
        COALESCE(mu.full_name, 'System') AS actor_name, mm.created_at AS occurred_at
    FROM inventory_movements mm
             JOIN branch_inventory rbi ON rbi.id = mm.branch_inventory_id
             JOIN equipment_variants rev ON rev.id = rbi.equipment_variant_id
             LEFT JOIN users mu ON mu.id = mm.performed_by)`;

// Booking bill payments (security deposits and damage/loss charge payments are separate).
const V2_BOOKING_PAID_SQL = (b) => `(COALESCE((SELECT SUM(bp.amount) FROM payments bp
        WHERE bp.booking_id = ${b}.id AND bp.status <> 'voided'
          AND bp.payment_type NOT IN ('Security Deposit','Additional Charge')), 0)
    - COALESCE((SELECT SUM(br.amount) FROM refunds br JOIN payments brp ON brp.id = br.payment_id
        WHERE brp.booking_id = ${b}.id AND br.status = 'completed'
          AND brp.payment_type NOT IN ('Security Deposit','Additional Charge')), 0))`;

// Bookings with the legacy customer/package/payment columns.
const V2_BOOKINGS = `(SELECT
        b.id, b.store_id, b.branch_id, b.booking_reference, b.customer_id, b.package_id,
        b.booking_type, b.event_type, b.theme, b.event_date, b.event_end_date, b.event_time,
        b.venue, b.rental_start_date, b.rental_end_date, b.custom_order, b.notes, b.status,
        bc.full_name AS name, bc.facebook_name, bc.phone, bc.email,
        COALESCE(bpk.package_name, '') AS package_name,
        b.package_price_snapshot AS package_price, b.agreed_price, b.required_down_payment,
        b.down_payment_deadline, b.refundable_deposit_required, b.vat_amount,
        b.final_additional_charges, b.deposit_applied_amount, b.approved_refund_amount,
        b.settlement_status, b.settlement_notes, b.cancellation_reason,
        b.approved_by, b.approved_at, b.created_by,
        ${V2_BOOKING_PAID_SQL("b")} AS amount_paid,
        GREATEST(COALESCE(b.agreed_price, 0) - ${V2_BOOKING_PAID_SQL("b")}, 0) AS balance,
        CASE WHEN ${V2_BOOKING_PAID_SQL("b")} <= 0 THEN 'Unpaid'
             WHEN ${V2_BOOKING_PAID_SQL("b")} + 0.005 >= COALESCE(b.agreed_price, 0) THEN 'Paid'
             ELSE 'Partially Paid' END AS payment_status,
        b.created_at, b.updated_at
    FROM bookings b
             JOIN customers bc ON bc.id = b.customer_id
             LEFT JOIN packages bpk ON bpk.id = b.package_id)`;

// Security-deposit position of each booking.
const V2_BOOKING_FINANCIALS = `(SELECT
        b.id AS booking_id, b.store_id, b.branch_id,
        b.refundable_deposit_required,
        COALESCE((SELECT SUM(dp.amount) FROM payments dp
                  WHERE dp.booking_id = b.id AND dp.status <> 'voided' AND dp.payment_type = 'Security Deposit'), 0) AS deposit_collected,
        b.deposit_applied_amount AS deposit_applied,
        COALESCE((SELECT SUM(dr.amount) FROM refunds dr JOIN payments drp ON drp.id = dr.payment_id
                  WHERE drp.booking_id = b.id AND dr.status = 'completed' AND drp.payment_type = 'Security Deposit'), 0) AS deposit_refunded,
        b.final_additional_charges, b.approved_refund_amount, b.settlement_status, b.settlement_notes,
        b.settlement_reviewed_by, b.settlement_reviewed_at, b.required_down_payment, b.down_payment_deadline,
        b.vat_amount, b.agreed_price,
        COALESCE(b.package_price_snapshot, 0) AS package_base,
        COALESCE((SELECT SUM(rl.line_total) FROM booking_items rl
                  WHERE rl.booking_id = b.id AND rl.item_type = 'rental'
                    AND rl.item_status NOT LIKE 'claim%' AND rl.item_status <> 'cancelled'), 0) AS rental_subtotal,
        0 AS delivery_fee, 0 AS setup_fee,
        (SELECT JSON_UNQUOTE(JSON_EXTRACT(wa.details, '$.reason')) FROM employee_actions wa
          WHERE wa.store_id = b.store_id AND wa.entity_id = b.id
            AND wa.action = 'Recorded security deposit waiver'
          ORDER BY wa.id DESC LIMIT 1) AS deposit_waiver_reason,
        b.created_at, b.updated_at
    FROM bookings b)`;

// Customer charges for lost or damaged rental equipment.
const V2_BOOKING_CLAIMS = `(SELECT
        cl.id, cl.booking_id, cl.store_id, cb.branch_id,
        SUBSTRING_INDEX(cl.variant_name_snapshot, '#', 1) AS source_type,
        CAST(SUBSTRING_INDEX(cl.variant_name_snapshot, '#', -1) AS UNSIGNED) AS source_record_id,
        cev.equipment_id, cl.quantity, cl.notes AS reason,
        cl.line_total AS approved_amount,
        COALESCE((SELECT SUM(cp.amount) FROM payments cp
                  WHERE cp.booking_id = cl.booking_id AND cp.status <> 'voided'
                    AND cp.payment_type = 'Additional Charge'
                    AND cp.reference_number = CONCAT('CLAIM-', cl.id)), 0) AS amount_paid,
        cl.unit_price_snapshot AS deposit_applied,
        SUBSTRING(cl.item_status, 7) AS status,
        cl.inspected_by AS approved_by, cl.created_at, cl.updated_at
    FROM booking_items cl
             JOIN bookings cb ON cb.id = cl.booking_id AND cb.store_id = cl.store_id
             JOIN equipment_variants cev ON cev.id = cl.equipment_variant_id
    WHERE cl.item_type = 'rental' AND cl.item_status LIKE 'claim%')`;

// Applies a change to the rental stock buckets of one equipment branch row.
async function v2AdjustEquipmentStock(db, inventoryId, {total = 0, rentedOut = 0, maintenance = 0, missing = 0} = {}) {
    await db.execute(
        `UPDATE branch_inventory
         SET on_hand_quantity = on_hand_quantity + ?,
             reserved_quantity = reserved_quantity + ?,
             unavailable_quantity = unavailable_quantity + ?
         WHERE id = ?`,
        [Number(total) || 0, Number(rentedOut) || 0, (Number(maintenance) || 0) + (Number(missing) || 0), inventoryId]
    );
}

// Branch stock row id of an equipment item in a branch.
async function v2EquipmentInventoryId(db, storeId, branchId, equipmentId) {
    const [rows] = await db.execute(
        `SELECT ebi.id FROM branch_inventory ebi
                                JOIN equipment_variants ev ON ev.id = ebi.equipment_variant_id AND ev.is_default = 1
         WHERE ev.equipment_id = ? AND ebi.store_id = ? AND ebi.branch_id = ? LIMIT 1`,
        [equipmentId, storeId, branchId]
    );
    return rows.length ? Number(rows[0].id) : null;
}

async function v2BookingIdByReference(db, storeId, branchId, reference) {
    if (!reference) return null;
    const [rows] = await db.execute(
        "SELECT id FROM bookings WHERE store_id = ? AND branch_id = ? AND booking_reference = ? LIMIT 1",
        [storeId, branchId, reference]
    );
    return rows.length ? Number(rows[0].id) : null;
}

async function v2UserId(db, storeId, userId) {
    const value = Number(userId);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    const [rows] = await db.execute("SELECT id FROM users WHERE id = ? AND store_id = ? LIMIT 1", [value, storeId]);
    return rows.length ? value : null;
}

// Signed effect of each rental activity on its stock bucket.
const V2_RENTAL_MOVEMENT_BUCKETS = {
    received: ["on_hand", 1], adjustment: ["on_hand", 1],
    rented_out: ["reserved", 1], returned: ["reserved", -1],
    maintenance_started: ["unavailable", 1], maintenance_completed: ["unavailable", -1],
    missing_reported: ["unavailable", 1], missing_resolved: ["unavailable", -1],
    missing_replaced: ["unavailable", -1],
    prepared: ["event", 1], inspected: ["event", 1], cleaned: ["unavailable", -1], damage_reported: ["event", 1],
};

// Records one rental activity in inventory_movements (after the stock change).
async function v2RecordRentalMovement(db, scope, equipmentId, type, quantity, ref, description, sign = null) {
    const inventoryId = await v2EquipmentInventoryId(db, scope.storeId, scope.branchId, equipmentId);
    if (!inventoryId) return;
    const [bucket, defaultSign] = V2_RENTAL_MOVEMENT_BUCKETS[type] || ["event", 1];
    const delta = Math.abs(Number(quantity) || 0) * (sign ?? defaultSign);
    let after = Math.abs(Number(quantity) || 0);
    let before = 0;
    if (bucket !== "event") {
        const column = bucket === "on_hand" ? "on_hand_quantity" : bucket === "reserved" ? "reserved_quantity" : "unavailable_quantity";
        const [rows] = await db.execute(`SELECT ${column} AS value FROM branch_inventory WHERE id = ?`, [inventoryId]);
        after = Number(rows[0]?.value || 0);
        before = after - delta;
        if (before < 0) { before = 0; after = delta > 0 ? delta : 0; }
    }
    const reference = String(ref ?? "").replace(/: /g, " ").trim();
    const text = String(description ?? "").trim();
    await db.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type, quantity_bucket, quantity_change,
          quantity_before, quantity_after, reference_type, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RENTAL', ?, ?)`,
        [scope.storeId, scope.branchId, inventoryId, type, bucket, bucket === "event" ? after : after - before,
            before, after, reference ? `Ref ${reference}: ${text}` : (text || null),
            await v2UserId(db, scope.storeId, scope.actorId)]
    );
}
// ===== END StockNBook v2 rentals & bookings =====

const ALL_ACTIVITIES = new Set(["received", "rented_out", "returned", "maintenance_started",
    "maintenance_completed", "missing_reported", "missing_resolved", "missing_replaced", "adjustment", "prepared", "inspected", "cleaned", "damage_reported"]);

function reply(statusCode, body) {
    return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
            ...(process.env.APP_ORIGIN ? { "Access-Control-Allow-Origin": process.env.APP_ORIGIN,
                "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" } : {}) },
        body: JSON.stringify(body) };
}
function fail(code, message) { const error = new Error(message); error.statusCode = code; throw error; }
function id(value, label = "ID") { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail(400, `${label} must be a positive integer.`); return n; }
function whole(value, label, positive = false) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0) || n > 2147483647) fail(400, `${label} must be a ${positive ? "positive" : "nonnegative"} whole number.`);
    return n;
}
function cents(value, label) {
    if (value === null || value === undefined || value === "" || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) fail(400, `${label} needs 0–2 decimal places.`);
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0 || num > 100000000) fail(400, `${label} is invalid or too large.`);
    return Math.round(num * 100);
}
const sumMoney = arr => arr.reduce((v, x) => v + x, 0);
const trim = (v, max) => String(v ?? "").trim().slice(0, max);
function requiredText(value, max, label) { const s = trim(value, max); if (!s) fail(400, `${label} is required.`); return s; }
const key = value => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
function isoDate(v, label, optional = false) {
    if ((v == null || v === "") && optional) return null;
    const s = String(v ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(400, `${label} must be YYYY-MM-DD.`);
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) fail(400, `Invalid ${label}.`);
    return s;
}
function todayPh() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
const intMoney = n => n / 100;
function purchaseData(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Purchase details are required.");
    const supplier = requiredText(input.supplier, 150, "Supplier");
    const purchaseDate = isoDate(input.purchaseDate, "Purchase date");
    if (purchaseDate > todayPh()) fail(400, "Purchase date cannot be in the future.");
    const quantity = whole(input.quantity, "Quantity", true);
    const unitCents = cents(input.unitCost, "Unit cost");
    const totalCents = quantity * unitCents;
    if (!Number.isSafeInteger(totalCents) || totalCents > 99999999999999) fail(400, "Purchase total is too large.");
    const paymentMethod = String(input.paymentMethod ?? "").toLowerCase();
    if (!["cash", "credit"].includes(paymentMethod)) fail(400, "Payment method must be cash or credit.");
    const paidCents = paymentMethod === "cash" ? totalCents : cents(input.amountPaid ?? 0, "Amount paid");
    if (paidCents > totalCents) fail(400, "Amount paid cannot exceed the purchase total.");
    const due = paymentMethod === "credit" ? isoDate(input.paymentDueDate, "Payment due date", true) : null;
    if (paidCents < totalCents && (!due || due < purchaseDate)) fail(400, "Unpaid credit requires a due date on or after the purchase date.");
    return { supplier, purchaseDate, quantity, unitCents, totalCents, paidCents, paymentMethod, due,
        invoice: trim(input.supplierInvoiceNumber, 80) || null };
}
// Suggested rental pricing is a cost-recovery estimate, not an automatic age discount.
// Always verify it on the server; never rely on a browser-calculated price.
function rentalPricing(input, purchaseUnitCost, fallbackRate = null) {
    const method = String(input.pricingMethod ?? "manual");
    if (!['manual', 'cost_based'].includes(method)) fail(400, 'Invalid rental pricing method.');
    if (method === 'manual') {
        const rate = input.rentalRatePerDay == null ? fallbackRate : intMoney(cents(input.rentalRatePerDay, 'Rental rate per unit per day'));
        if (rate == null) fail(400, 'Manual rental rate is required.');
        return { method, rate, recoveryDays:null, residual:null, operating:null, margin:null, basis:null };
    }
    if (purchaseUnitCost === null || purchaseUnitCost === undefined)
        fail(400, 'Cost-based pricing requires an actual equipment purchase cost. Receive equipment first or choose Manual Rental Rate.');
    const unitCost = intMoney(cents(purchaseUnitCost, 'Equipment unit cost'));
    const recoveryDays = whole(input.pricingRecoveryDays, 'Target paid rental days to recover cost', true);
    if (recoveryDays > 10980) fail(400, 'Cost-recovery target must be 1–10,980 paid rental days per item.');
    const residual = intMoney(cents(input.pricingResidualValue, 'Residual value'));
    const operating = intMoney(cents(input.pricingOperatingCostPerDay, 'Operating cost per paid rental day'));
    const margin = Number(input.pricingMarginPercent);
    if (input.pricingMarginPercent === '' || input.pricingMarginPercent == null ||
        !Number.isFinite(margin) || margin < 0 || margin > 80 ||
        !/^\d+(?:\.\d{1,2})?$/.test(String(input.pricingMarginPercent).trim()))
        fail(400, 'Target margin must be 0–80% with up to two decimal places.');
    if (residual > unitCost) fail(400, 'Residual value cannot exceed the equipment unit cost.');
    const estimate = ((unitCost - residual) / recoveryDays + operating) / (1 - margin / 100);
    const rate = Math.ceil(estimate - 1e-9);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100000000)
        fail(400, 'The calculated daily rental rate is invalid or too large.');
    if (input.rentalRatePerDay !== null && input.rentalRatePerDay !== undefined &&
        cents(input.rentalRatePerDay, 'Rental rate') !== Math.round(rate * 100))
        fail(400, 'The submitted rental rate does not match the cost-based calculation. Please refresh pricing.');
    return { method, rate, recoveryDays, residual, operating, margin, basis:unitCost };
}
function equipmentInput(input, unitCost = null) {
    const name = requiredText(input.name, 150, 'Equipment name');
    const category = requiredText(input.category, 100, 'Category');
    const alertLevel = whole(input.alertLevel, 'Low availability alert');
    return { name, category, alertLevel,
        pricing: rentalPricing(input, unitCost) };
}
async function categoryId(db, scope, name) {
    const catKey = key(name);
    const [rows] = await db.execute(`SELECT id, status FROM categories
                                     WHERE store_id=? AND category_type='equipment' AND LOWER(TRIM(category_name))=? FOR UPDATE`,
        [scope.storeId, catKey]);
    if (rows.length) {
        if (String(rows[0].status) !== "active") await db.execute("UPDATE categories SET status='active', category_name=? WHERE id=?", [name, rows[0].id]);
        return Number(rows[0].id);
    }
    const [r] = await db.execute("INSERT INTO categories (store_id,category_name,category_type,status) VALUES (?,?,'equipment','active')",
        [scope.storeId, name]);
    return Number(r.insertId);
}
async function branchCodes(db, scope) {
    const [rows] = await db.execute(`SELECT s.store_code AS storeCode, b.branch_code AS branchCode
                                     FROM branches b JOIN stores s ON s.id=b.store_id WHERE s.id=? AND b.id=? LIMIT 1`, [scope.storeId, scope.branchId]);
    if (!rows.length || !rows[0].storeCode || !rows[0].branchCode) fail(409, "Store/Branch codes are missing. Complete the existing StockNBook product-number migration first.");
    const code = v => { const s=String(v); if (!/^[A-Z0-9]{2,8}$/.test(s)) fail(409, "Stored branch/store code format is invalid."); return s; };
    return `${code(rows[0].storeCode)}-${code(rows[0].branchCode)}`;
}
// One Equipment No. (STORE-BRANCH-EQP-XXXX) per physical unit added from now on.
// Workflows stay quantity-based; delta = units added (+) or removed (-).
async function adjustEquipmentUnitNumbers(db, scope, equipmentId, delta) {
    await identifiers.adjustEquipmentUnits(db, { storeId: scope.storeId, branchId: scope.branchId, equipmentId: Number(equipmentId), delta });
}
async function lockBranch(db, scope) {
    const [rows] = await db.execute("SELECT id FROM branches WHERE id=? AND store_id=? FOR UPDATE", [scope.branchId, scope.storeId]);
    if (!rows.length) fail(403, "Branch not assigned to this store.");
}
async function lockEquipment(db, scope, equipmentId) {
    // Lock the equipment, its default variant and its branch stock row.
    const [locked] = await db.execute(`SELECT e.id FROM equipment e
                                                            JOIN equipment_variants ev ON ev.equipment_id=e.id AND ev.is_default=1
                                                            JOIN branch_inventory ebi ON ebi.equipment_variant_id=ev.id
                                       WHERE e.id=? AND e.store_id=? AND ebi.branch_id=? AND e.deleted_at IS NULL FOR UPDATE`,
        [equipmentId, scope.storeId, scope.branchId]);
    if (!locked.length) fail(404, "Active rental equipment not found in this branch.");
    const [rows] = await db.execute(`SELECT * FROM ${V2_RENTAL_EQUIPMENT} rental_equipment
                                     WHERE rental_equipment.id=? AND rental_equipment.store_id=? AND rental_equipment.branch_id=?`,
        [equipmentId, scope.storeId, scope.branchId]);
    if (!rows.length) fail(404, "Active rental equipment not found in this branch.");
    return rows[0];
}
async function appendMovement(db, scope, equipmentId, type, quantity, ref, description = null, sign = null) {
    if (!ALL_ACTIVITIES.has(type)) throw new Error("Internal rental movement type is invalid.");
    await v2RecordRentalMovement(db, scope, equipmentId, type, quantity, ref, description, sign);
}
// One confirmed rental purchase receipt updates the equipment quantity, receipt,
// purchase history and stock movement within the caller's existing transaction.
// A purchase that has not physically arrived must NOT use this helper.
async function postRentalPurchaseReceipt(db, scope, equipmentRow, purchaseId, purchaseItemId,
                                         quantity, unitCents, referenceNumber) {
    const existing = Number(equipmentRow.total_units);
    const next = existing + quantity;
    if (!Number.isSafeInteger(next) || next > 2147483647)
        fail(409, "Rental stock exceeds the equipment quantity limit.");
    const previousCostCents = Math.round(Number(equipmentRow.average_unit_cost || 0) * 100);
    const averageCostCents = Math.round((existing * previousCostCents + quantity * unitCents) / next);
    await v2AdjustEquipmentStock(db, equipmentRow.inventory_id, {total: quantity});
    await db.execute("UPDATE equipment_variants SET cost_price=? WHERE id=?",
        [intMoney(averageCostCents), equipmentRow.equipment_variant_id]);
    await appendMovement(db, scope, equipmentRow.id, "received", quantity, referenceNumber,
        "Rental stock received");
    const [movement] = await db.execute("SELECT MAX(id) AS id FROM inventory_movements WHERE branch_inventory_id=?",
        [equipmentRow.inventory_id]);
    const prefix = await branchCodes(db, scope);
    return `${prefix}-RRCV-${String(Number(movement[0]?.id || 0)).padStart(6, "0")}`;
}

async function receivePurchase(db, scope, equipmentRow, data, source) {
    // Parent equipment row MUST already be locked to protect the moving average.
    // Supplier purchases are not stored in stocknbook_v2; the delivery is still
    // validated and received into stock.
    const purchase = purchaseData(data);
    void source;
    const prefix = await branchCodes(db, scope);
    const purchaseNumber = `${prefix}-RPUR-${String(scope.requestKey || Date.now()).replace(/[^A-Za-z0-9-]/g, "").slice(-12)}`;
    const receivingNumber = await postRentalPurchaseReceipt(db, scope, equipmentRow, null, null,
        purchase.quantity, purchase.unitCents, purchaseNumber);
    return {purchaseId: null, purchaseNumber, receivingNumber, amountPaid: intMoney(purchase.paidCents),
        outstandingBalance: intMoney(purchase.totalCents - purchase.paidCents), awaitingReceipt: false};
}
async function createEquipment(db,scope,raw,source, importedUnitCost = null) {
    const e = equipmentInput(raw, raw.initialPurchase?.unitCost ?? importedUnitCost);
    // One active rental item per name in a branch.
    const [sameName] = await db.execute(`SELECT e.id FROM ${V2_RENTAL_EQUIPMENT} e
                                         WHERE e.store_id=? AND e.branch_id=? AND e.name_key=? AND e.archived_at IS NULL LIMIT 1`,
        [scope.storeId,scope.branchId,key(e.name)]);
    if (sameName.length) fail(409, "A rental record with that name, number, or request key already exists.");
    const cid = await categoryId(db,scope,e.category);
    // The rental item gets a Product No. (STORE-BRANCH-PRD-XXXX) from the branch
    // sequence it shares with sales products.
    const equipmentNumber = await identifiers.allocateProductNumber(db,{storeId:scope.storeId,branchId:scope.branchId});
    const [created] = await db.execute(`INSERT INTO equipment
                                        (store_id,category_id,equipment_number,equipment_name,has_variants,status)
                                        VALUES(?,?,?,?,0,'active')`,
        [scope.storeId,cid,equipmentNumber,e.name]);
    const equipmentId = Number(created.insertId);
    const [variant] = await db.execute(`INSERT INTO equipment_variants
                                        (store_id,equipment_id,variant_number,variant_name,is_default,rental_rate_per_day,cost_price,status)
                                        VALUES(?,?,?,?,1,?,0,'active')`,
        [scope.storeId,equipmentId,equipmentNumber,e.name.slice(0,150),e.pricing.rate]);
    await db.execute(`INSERT INTO branch_inventory
                      (store_id,branch_id,equipment_variant_id,on_hand_quantity,reorder_level,status)
                      VALUES(?,?,?,0,?,'active')`,
        [scope.storeId,scope.branchId,Number(variant.insertId),e.alertLevel]);
    let purchase = null;
    if (raw.initialPurchase != null) {
        const row = await lockEquipment(db, scope,equipmentId);
        purchase = await receivePurchase(db, scope,row,raw.initialPurchase,source);
    }
    return { equipmentId,equipmentNumber,purchase,referenceNumber:purchase?.purchaseNumber || equipmentNumber };
}
async function mutate(db,scope,body) {
    switch(body.action) {
        case "create_equipment": return createEquipment(db,scope,body,"add");
        case "import_equipment": {
            // One Excel workbook = one supplier delivery. Individual equipment are
            // separate receipt lines.
            if (body.importMode !== "single_purchase") fail(400, "Use the single-purchase rental import format.");
            if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 500)
                fail(400, "Import requires 1–500 equipment rows.");
            const p = body.purchase;
            if (!p || typeof p !== "object" || Array.isArray(p)) fail(400, "Supplier purchase details are required.");
            const normalizedRows = [];
            const uniqueNames = new Set();
            let totalCents = 0;
            for (const line of body.rows) {
                if (!line || typeof line !== "object" || Array.isArray(line)) fail(400, "Invalid equipment import line.");
                const name = requiredText(line.name, 150, "Equipment name");
                const category = requiredText(line.category, 100, "Category");
                const quantity = whole(line.openingUnits, "Stock units", true);
                const unitCents = cents(line.unitCost, "Unit purchase cost");
                const pricing = rentalPricing(line, line.unitCost);
                if (uniqueNames.has(key(name))) fail(400, `Duplicate rental equipment in workbook: ${name}`);
                uniqueNames.add(key(name));
                const lineCents = quantity * unitCents;
                totalCents += lineCents;
                if (!Number.isSafeInteger(totalCents) || totalCents > 99999999999999)
                    fail(400, "Combined supplier purchase total is too large.");
                normalizedRows.push({ name, category, quantity, unitCents, pricing });
            }
            requiredText(p.supplier, 150, "Supplier");
            const purchaseDate = isoDate(p.purchaseDate, "Purchase date");
            if (purchaseDate > todayPh()) fail(400, "Purchase date cannot be in the future.");
            const paymentMethod = String(p.paymentMethod || "").toLowerCase();
            if (!["cash", "credit"].includes(paymentMethod)) fail(400, "Payment method must be cash or credit.");
            const requestedPaidCents = cents(p.amountPaid ?? 0, "Amount paid");
            const paidCents = paymentMethod === "cash" ? totalCents : requestedPaidCents;
            if (paymentMethod === "cash" && requestedPaidCents !== 0 && requestedPaidCents !== totalCents)
                fail(400, "Cash purchase must be paid in full.");
            if (paidCents > totalCents) fail(400, "Amount paid cannot exceed the purchase total.");
            const due = paymentMethod === "credit" ? isoDate(p.paymentDueDate, "Payment due date", true) : null;
            if (due && due < purchaseDate) fail(400, "Payment due date cannot precede purchase date.");
            if (paidCents < totalCents && !due) fail(400, "Outstanding credit requires a payment due date.");

            const createdRows = [];
            for (const line of normalizedRows) {
                const newEquipment = await createEquipment(db, scope, {
                    name: line.name, category: line.category, alertLevel: 0,
                    rentalRatePerDay: line.pricing.rate,
                    pricingMethod: line.pricing.method,
                    pricingRecoveryDays: line.pricing.recoveryDays,
                    pricingResidualValue: line.pricing.residual,
                    pricingOperatingCostPerDay: line.pricing.operating,
                    pricingMarginPercent: line.pricing.margin,
                    // Supply unit cost ONLY for cost-based formula validation.
                    initialPurchase: undefined
                }, "import", line.unitCents / 100);
                createdRows.push({ ...line, equipmentId: newEquipment.equipmentId,
                    equipmentNumber: newEquipment.equipmentNumber });
            }
            // Supplier purchases are not stored in stocknbook_v2.
            const prefix = await branchCodes(db, scope);
            const purchaseNumber = `${prefix}-RPUR-${String(scope.requestKey || Date.now()).replace(/[^A-Za-z0-9-]/g, "").slice(-12)}`;
            for (const line of createdRows) {
                // Imported opening stock has already been counted at import confirmation.
                const equipment = await lockEquipment(db,scope,line.equipmentId);
                await postRentalPurchaseReceipt(db,scope,equipment,null,null,
                    line.quantity,line.unitCents,purchaseNumber);
            }
            return { imported: createdRows.length, equipment: createdRows.map(line=>({
                    equipmentId:line.equipmentId,equipmentNumber:line.equipmentNumber,name:line.name
                })), purchaseId:null,purchaseNumber,purchaseTotal:intMoney(totalCents),
                amountPaid:intMoney(paidCents),outstandingBalance:intMoney(totalCents-paidCents),
                referenceNumber:purchaseNumber };
        }
        case "update_equipment": {
            const current = await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const name = requiredText(body.name,150,"Equipment name");
            const category = requiredText(body.category,100,"Category");
            const alert = whole(body.alertLevel,"Low availability alert");
            // The cost basis for cost-based pricing is the equipment's average cost.
            const basis = Number(current.total_units) > 0
                ? (body.pricingRefreshBasis === true || current.pricing_unit_cost_basis == null
                    ? current.average_unit_cost : current.pricing_unit_cost_basis)
                : null;
            const pricing = rentalPricing(body, basis, Number(current.rental_rate_per_day));
            const [sameName] = await db.execute(`SELECT e.id FROM ${V2_RENTAL_EQUIPMENT} e
                                                 WHERE e.store_id=? AND e.branch_id=? AND e.name_key=? AND e.archived_at IS NULL AND e.id<>? LIMIT 1`,
                [scope.storeId,scope.branchId,key(name),current.id]);
            if (sameName.length) fail(409, "A rental record with that name, number, or request key already exists.");
            const cat = await categoryId(db,scope,category);
            await db.execute(`UPDATE equipment e
                                  JOIN equipment_variants ev ON ev.equipment_id=e.id AND ev.is_default=1
                                  JOIN branch_inventory ebi ON ebi.id=?
                                  SET e.equipment_name=?,e.category_id=?,ev.variant_name=?,ev.rental_rate_per_day=?,
                                      ebi.reorder_level=?
                              WHERE e.id=? AND e.store_id=?`,
                [current.inventory_id,name,cat,name.slice(0,150),pricing.rate,alert,current.id,scope.storeId]);
            return { equipmentId:current.id,referenceNumber:current.equipment_number };
        }
        case "correct_equipment_stock": {
            // Sales Inventory's audited stock correction equivalent: no fake
            // purchase, no staff delivery, no double count on a browser retry.
            const current=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const target=whole(body.totalUnits,"Verified total equipment units");
            const reason=requiredText(body.reason,500,"Stock correction reason");
            if(reason.length<10)fail(400,"Explain the stock count correction in at least 10 characters.");
            if(body.physicalCountVerified!==true)
                fail(400,"Confirm that the corrected quantity was physically counted. Use Restock for supplier purchases.");
            const before=Number(current.total_units);
            if(target===before)fail(400,"The corrected total must differ from the current total.");
            // Lock commitments under the equipment row (same order as Booking
            // confirmation), then calculate peak overlapping reservations.
            await db.execute(`SELECT bki.id FROM booking_items bki
                              WHERE bki.store_id=? AND bki.equipment_variant_id=? AND bki.item_type='rental'
                                AND bki.item_status IN ('reserved','released') FOR UPDATE`,
                [scope.storeId,current.equipment_variant_id]);
            const [reservations]=await db.execute(`SELECT a.quantity,a.status,
                                                          DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                                          DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate
                                                   FROM ${V2_RENTAL_ALLOCATIONS} a
                                                   WHERE a.store_id=? AND a.branch_id=? AND a.equipment_id=?
                                                     AND a.status IN ('reserved','checked_out')
                                                   ORDER BY a.start_date,a.id`,[scope.storeId,scope.branchId,current.id]);
            const dates=reservations.flatMap(r=>[String(r.startDate),String(r.endDate)]).sort();
            const peak=dates.length?computePeak(reservations,dates[0],dates[dates.length-1],todayPh()):0;
            const activeHeld=Number(current.maintenance_units)+Number(current.missing_units);
            const minimum=Math.max(Number(current.rented_out_units),peak)+activeHeld;
            if(target<minimum)
                fail(409,`Cannot reduce total below ${minimum}: confirmed bookings, rented-out, held and missing equipment must remain accounted for.`);
            const difference=target-before;
            await v2AdjustEquipmentStock(db,current.inventory_id,{total:difference});
            await appendMovement(db,scope,current.id,'adjustment',Math.abs(difference),current.equipment_number,
                `Physical stock correction ${difference>0?'+':''}${difference}: ${reason}`,difference>0?1:-1);
            return {equipmentId:current.id,referenceNumber:current.equipment_number,
                previousTotal:before,correctedTotal:target,quantityChange:difference};
        }
        case "receive_equipment": {
            const current=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const purchase=await receivePurchase(db,scope,current,body,"receive");
            return {equipmentId:current.id,...purchase,referenceNumber:purchase.purchaseNumber};
        }
        case "start_maintenance": {
            const current=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const qty=whole(body.quantity,"Maintenance quantity",true);
            const free=Number(current.total_units)-Number(current.rented_out_units)-Number(current.maintenance_units)-Number(current.missing_units);
            if (qty>free) fail(409,`Only ${Math.max(0,free)} unassigned units are available for maintenance.`);
            const reason=requiredText(body.reason,500,"Maintenance reason");
            if(reason.length<5)fail(400,"Maintenance notes must have at least 5 characters.");
            const conditionStatus=body.conditionStatus==null||body.conditionStatus===""
                ? "In Repair" : String(body.conditionStatus);
            if(!["In Repair","For Inspection"].includes(conditionStatus))
                fail(400,"Maintenance condition must be In Repair or For Inspection.");
            const estimate=isoDate(body.estimatedCompletionDate,"Estimated completion date",true);
            if(estimate && estimate<todayPh())fail(400,"Estimated completion date cannot be in the past.");
            const [r]=await db.execute(`INSERT INTO stock_issues
                                        (store_id,branch_id,branch_inventory_id,issue_type,quantity,reason,
                                         status,estimated_completion_date,reported_by) VALUES(?,?,?,'maintenance',?,?,?,?,?)`,
                [scope.storeId,scope.branchId,current.inventory_id,qty,reason,conditionStatus,estimate,
                    await v2UserId(db,scope.storeId,scope.actorId)]);
            await v2AdjustEquipmentStock(db,current.inventory_id,{maintenance:qty});
            const ref=`MNT-${String(r.insertId).padStart(6,"0")}`;
            await appendMovement(db,scope,current.id,"maintenance_started",qty,ref,reason);
            return {referenceNumber:ref};
        }
        case "approve_maintenance_repair": {
            const maintenanceId=id(body.maintenanceId,"Maintenance record");
            // Lock equipment before the maintenance record to match stock lock ordering.
            const [identity]=await db.execute(`SELECT m.equipment_id FROM ${V2_MAINTENANCE_RECORDS} m
                                               WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
            if(!identity.length)fail(404,"Maintenance record not found.");
            const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
            await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[maintenanceId]);
            const [records]=await db.execute(`SELECT m.id,m.quantity_remaining,m.repair_approved_at,m.condition_status FROM ${V2_MAINTENANCE_RECORDS} m
                                              WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
            if(!records.length || Number(records[0].quantity_remaining)<=0)fail(409,"Maintenance is already completed.");
            if(records[0].condition_status === "Routine")
                fail(409,"Routine care is completed by Staff and does not require Manager approval.");
            if(records[0].repair_approved_at)fail(409,"This repair was already approved.");
            await db.execute(`UPDATE stock_issues SET approved_at=NOW(),approved_by=? WHERE id=?`,
                [await v2UserId(db,scope.storeId,scope.actorId),maintenanceId]);
            return {referenceNumber:`MNT-${String(maintenanceId).padStart(6,"0")}`,equipmentId:equipment.id};
        }
        case "approve_repair_completion": {
            const requestId=id(body.requestId,"Repair completion request");
            const [identity]=await db.execute(`SELECT q.equipment_id FROM ${V2_COMPLETION_REQUESTS} q
                                               WHERE q.id=? AND q.store_id=? AND q.branch_id=?`,[requestId,scope.storeId,scope.branchId]);
            if(!identity.length)fail(404,"Completion request not found.");
            const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
            await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[requestId]);
            const [requests]=await db.execute(`SELECT q.* FROM ${V2_COMPLETION_REQUESTS} q
                                               WHERE q.id=? AND q.store_id=? AND q.branch_id=?`,[requestId,scope.storeId,scope.branchId]);
            const request=requests[0];
            if(request.status!=="pending")fail(409,"This request has already been reviewed.");
            await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[request.maintenance_record_id]);
            const [records]=await db.execute(`SELECT m.quantity_remaining,m.repair_approved_at,m.condition_status FROM ${V2_MAINTENANCE_RECORDS} m
                                              WHERE m.id=? AND m.equipment_id=? AND m.store_id=? AND m.branch_id=?`,
                [request.maintenance_record_id,equipment.id,scope.storeId,scope.branchId]);
            const quantity=Number(request.quantity);
            if(!records.length || records[0].condition_status === "Routine" ||
                !records[0].repair_approved_at || Number(records[0].quantity_remaining)<quantity ||
                Number(equipment.maintenance_units)<quantity)fail(409,"Repair quantities or approval no longer match. Please refresh.");
            await db.execute(`UPDATE stock_issues SET quantity_resolved=quantity_resolved+?,resolution_notes=?,
                                                      resolved_at=CASE WHEN quantity-quantity_resolved=0 THEN NOW() ELSE resolved_at END,
                                                      resolved_by=CASE WHEN quantity-quantity_resolved=0 THEN ? ELSE resolved_by END
                              WHERE id=?`,
                [quantity,request.notes,await v2UserId(db,scope.storeId,scope.actorId),request.maintenance_record_id]);
            await v2AdjustEquipmentStock(db,equipment.inventory_id,{maintenance:-quantity});
            await db.execute(`UPDATE stock_issues SET status='approved',resolved_by=?,resolved_at=NOW()
                              WHERE id=?`,[await v2UserId(db,scope.storeId,scope.actorId),requestId]);
            const ref=`MNT-${String(request.maintenance_record_id).padStart(6,"0")}`;
            await appendMovement(db,scope,equipment.id,"maintenance_completed",quantity,ref,`Manager approved release: ${request.notes}`);
            return {referenceNumber:ref};
        }
        case "resolve_missing_equipment": {
            const reportId=id(body.reportId,"Missing equipment report");
            const resolution=String(body.resolution||"");
            if(!["found","writeoff"].includes(resolution))fail(400,"Choose Found or Approve Write-Off.");
            const [identity]=await db.execute(`SELECT r.equipment_id FROM ${V2_MISSING_REPORTS} r
                                               WHERE r.id=? AND r.store_id=? AND r.branch_id=?`,[reportId,scope.storeId,scope.branchId]);
            if(!identity.length)fail(404,"Missing-unit report not found.");
            const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
            await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[reportId]);
            const [reports]=await db.execute(`SELECT r.* FROM ${V2_MISSING_REPORTS} r WHERE r.id=?
                                                                                        AND r.store_id=? AND r.branch_id=?`,[reportId,scope.storeId,scope.branchId]);
            const report=reports[0];
            if(report.status!=="pending")fail(409,"This missing-unit report has already been reviewed.");
            const qty=Number(report.quantity)-Number(report.recovered);
            if(qty<=0)fail(409,"All missing units have already been recovered.");
            if(qty>Number(equipment.missing_units))fail(409,"Missing unit counts need reconciliation.");
            const notes=requiredText(body.notes,500,"Resolution notes");
            if(notes.length<10)fail(400,"Explain the disposition of missing equipment (10+ characters).");
            if(resolution==="writeoff" && qty>Number(equipment.total_units)-Number(equipment.rented_out_units)-Number(equipment.maintenance_units))
                fail(409,"Cannot write off units committed to other equipment operations.");
            // Recovered units stay on hold until Staff inspects/cleans them.
            // They do not return directly to the rentable pool on Manager review.
            await v2AdjustEquipmentStock(db,equipment.inventory_id,{missing:-qty,
                maintenance:resolution==="found"?qty:0,total:resolution==="writeoff"?-qty:0});
            const actorUserId=await v2UserId(db,scope.storeId,scope.actorId);
            if(resolution==="found"){
                await db.execute(`INSERT INTO stock_issues
                                  (store_id,branch_id,branch_inventory_id,booking_id,issue_type,quantity,
                                   reason,status,reported_by)
                                  VALUES(?,?,?,?,'maintenance',?,?,'Routine',?)`,[scope.storeId,scope.branchId,equipment.inventory_id,
                    report.booking_id||null,qty,
                    `Recovered missing equipment (report #${reportId}); Staff must inspect before marking cleaned. ${notes}`.slice(0,500),
                    actorUserId]);
            }
            await db.execute(`UPDATE stock_issues SET status=?,resolved_by=?,resolved_at=NOW(),resolution_notes=?,
                                                      quantity_resolved=quantity
                              WHERE id=?`,[resolution,actorUserId,notes,reportId]);
            await appendMovement(db,scope,equipment.id,resolution==="found"?"missing_resolved":"adjustment",qty,
                `MISS-${String(reportId).padStart(6,"0")}`,`${resolution==="found"?"Missing units recovered":"Manager-approved stock write-off"}: ${notes}`,
                -1);
            // After this inventory transaction commits, re-check whether this
            // booking can automatically finish.
            return {referenceNumber:`MISS-${String(reportId).padStart(6,"0")}`,
                bookingReference:report.booking_reference||null};
        }
        case "archive_equipment": {
            const current=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const reason=requiredText(body.reason,400,"Retirement reason");
            if(reason.length<10)fail(400,"Explain why equipment is being retired (at least 10 characters).");
            if(String(body.confirmName||"").trim()!==current.name)fail(400,"Type the equipment name exactly to confirm retirement.");
            if(Number(current.rented_out_units)||Number(current.maintenance_units)||Number(current.missing_units))
                fail(409,"Resolve rented-out, held, and missing units before retiring this equipment.");
            const [allocated]=await db.execute(`SELECT a.id FROM ${V2_RENTAL_ALLOCATIONS} a
                                                WHERE a.store_id=? AND a.branch_id=? AND a.equipment_id=? AND a.status IN ('reserved','checked_out') LIMIT 1`,
                [scope.storeId,scope.branchId,current.id]);
            if(allocated.length)fail(409,"Cannot retire equipment with an active or future rental allocation.");
            const units=Number(current.total_units);
            // An intentional full-stock retirement is audited.
            if(units>0){
                await v2AdjustEquipmentStock(db,current.inventory_id,{total:-units});
                await appendMovement(db,scope,current.id,"adjustment",units,current.equipment_number,
                    `Equipment retired: ${reason}`,-1);
            }
            await db.execute(`UPDATE equipment SET deleted_at=NOW(),status='inactive' WHERE id=?`,[current.id]);
            await db.execute(`UPDATE branch_inventory SET status='inactive' WHERE id=?`,[current.inventory_id]);
            return {referenceNumber:current.equipment_number,retiredUnits:units};
        }
        case "create_rental_category": {
            const name=requiredText(body.name,100,"Category name");
            const cid=await categoryId(db,scope,name);
            return {categoryId:cid,referenceNumber:""};
        }
        case "rename_rental_category": {
            const previous=requiredText(body.previousName,100,"Previous category");
            const updated=requiredText(body.name,100,"New category name");
            const [found]=await db.execute(`SELECT id FROM categories WHERE store_id=? AND category_type='equipment'
                                                                        AND LOWER(TRIM(category_name))=? AND status='active' FOR UPDATE`,
                [scope.storeId,key(previous)]);
            if(!found.length)fail(404,"Rental category not found.");
            await db.execute("UPDATE categories SET category_name=? WHERE id=?",[updated,found[0].id]);
            return {categoryId:found[0].id,referenceNumber:""};
        }
        case "delete_rental_category": {
            const name=requiredText(body.name,100,"Category name");
            const [found]=await db.execute(`SELECT id FROM categories WHERE store_id=? AND category_type='equipment'
                                                                        AND LOWER(TRIM(category_name))=? AND status='active' FOR UPDATE`,
                [scope.storeId,key(name)]);
            if(!found.length)fail(404,"Rental category not found.");
            const [inUse]=await db.execute("SELECT id FROM equipment WHERE category_id=? LIMIT 1",[found[0].id]);
            if(inUse.length)fail(409,"Cannot delete a category with equipment or historical records. Move or update those records first.");
            await db.execute("DELETE FROM categories WHERE id=? AND store_id=? AND category_type='equipment'",[found[0].id,scope.storeId]);
            return {referenceNumber:""};
        }
        case "pay_rental_supplier_purchase": {
            // Supplier purchases and payments are not part of stocknbook_v2.
            fail(410,"Supplier payments are no longer recorded in StockNBook.");
            return {};
        }
        default: fail(400,"Unsupported rental inventory action.");
    }
}
// Bookable units and physical units are intentionally separate. A confirmed booking
// reserves equipment on its event dates, without pretending units were handed out.
// Using the allocation ledger here keeps the Rental Inventory view consistent with
// Booking approval, the customer portal, and date-specific availability.
async function rentalBookableToday(db,scope) {
    const today=todayPh();
    const [rows]=await db.execute(`SELECT a.equipment_id AS equipmentId,COALESCE(SUM(a.quantity),0) AS bookedUnits
                                   FROM ${V2_RENTAL_ALLOCATIONS} a
                                   WHERE a.store_id=? AND a.branch_id=? AND a.status IN ('reserved','checked_out')
                                     AND a.start_date<=? AND (a.end_date>=? OR a.status='checked_out')
                                   GROUP BY a.equipment_id`,[scope.storeId,scope.branchId,today,today]);
    return new Map(rows.map(r=>[Number(r.equipmentId),Number(r.bookedUnits)]));
}
function rentalBookableProjection(item,bookedUnits) {
    return Math.max(0,Number(item.totalUnits)-Number(item.maintenanceUnits)-
        Number(item.missingUnits)-Number(bookedUnits||0));
}
async function getInventory(db,scope) {
    const bookedToday=await rentalBookableToday(db,scope);
    const [equipment]=await db.execute(`SELECT e.id,e.equipment_number AS equipmentNumber,e.name,
                                               c.name AS category,e.total_units AS totalUnits,e.rented_out_units AS rentedOutUnits,
                                               e.maintenance_units AS maintenanceUnits,e.missing_units AS missingUnits,e.alert_level AS alertLevel,
                                               IF(e.archived_at IS NULL,1,0) AS active,e.rental_rate_per_day AS rentalRatePerDay,
                                               e.average_unit_cost AS averageUnitCost,e.last_supplier AS lastSupplier,
                                               e.pricing_method AS pricingMethod,
                                               e.pricing_recovery_days AS pricingRecoveryDays,
                                               e.pricing_residual_value AS pricingResidualValue,
                                               e.pricing_operating_cost_per_day AS pricingOperatingCostPerDay,
                                               e.pricing_margin_percent AS pricingMarginPercent,
                                               e.pricing_unit_cost_basis AS pricingUnitCostBasis
                                        FROM ${V2_RENTAL_EQUIPMENT} e JOIN ${V2_RENTAL_CATEGORIES} c ON c.id=e.category_id
                                        WHERE e.store_id=? AND e.branch_id=? ORDER BY e.created_at DESC,e.id DESC`, [scope.storeId,scope.branchId]);
    const [activity]=await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                              COALESCE(e.name,'Archived equipment') AS equipmentName,m.type,m.quantity,
                                              DATE_FORMAT(m.occurred_at,'%Y-%m-%dT%H:%i:%s+08:00') AS occurredAt,
                                              COALESCE(m.reference_number,'') AS referenceNumber,m.description AS description
                                       FROM ${V2_RENTAL_MOVEMENTS} m LEFT JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=m.equipment_id AND e.branch_id=m.branch_id
                                       WHERE m.store_id=? AND m.branch_id=? ORDER BY m.occurred_at DESC,m.id DESC LIMIT 100`,
        [scope.storeId,scope.branchId]);
    // Manager monitoring history uses the stock movement ledger (read-only).
    const [maintenanceHistory]=await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                                        COALESCE(e.name,'Archived equipment') AS equipmentName,
                                                        m.type,m.quantity,
                                                        DATE_FORMAT(m.occurred_at,'%Y-%m-%dT%H:%i:%s+08:00') AS occurredAt,
                                                        COALESCE(m.reference_number,'') AS referenceNumber,
                                                        m.actor_name AS actorName,m.description AS notes,
                                                        COALESCE(mr.booking_reference,miss.booking_reference) AS bookingReference
                                                 FROM ${V2_RENTAL_MOVEMENTS} m
                                                          LEFT JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=m.equipment_id
                                                     AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                          LEFT JOIN ${V2_MAINTENANCE_RECORDS} mr ON m.type='maintenance_completed'
                                                     AND mr.id=CAST(SUBSTRING(m.reference_number,5) AS UNSIGNED)
                                                     AND mr.store_id=m.store_id AND mr.branch_id=m.branch_id
                                                     AND mr.equipment_id=m.equipment_id
                                                          LEFT JOIN ${V2_MISSING_REPORTS} miss ON m.type IN ('missing_resolved','missing_replaced')
                                                     AND miss.id=CAST(SUBSTRING(m.reference_number,6) AS UNSIGNED)
                                                     AND miss.store_id=m.store_id AND miss.branch_id=m.branch_id
                                                     AND miss.equipment_id=m.equipment_id
                                                 WHERE m.store_id=? AND m.branch_id=?
                                                   AND m.type IN ('maintenance_completed','missing_resolved','missing_replaced')
                                                 ORDER BY m.occurred_at DESC,m.id DESC LIMIT 150`,
        [scope.storeId,scope.branchId]);
    // Returns awaiting the one-time Staff inspection.
    const [pendingInspections]=await db.execute(`SELECT a.id AS allocationId,a.equipment_id AS equipmentId,
                                                        COALESCE(e.name,'Archived equipment') AS equipmentName,
                                                        a.booking_reference AS bookingReference,
                                                        COALESCE(a.returned_received_units,a.quantity) AS units,
                                                        COALESCE(a.inspection_damaged_units,0) AS observedDamageUnits,
                                                        a.inspection_notes AS notes,
                                                        DATE_FORMAT(COALESCE(a.returned_at,a.updated_at),'%Y-%m-%d') AS reportedAt
                                                 FROM ${V2_RENTAL_ALLOCATIONS} a
                                                          JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=a.equipment_id
                                                     AND e.store_id=a.store_id AND e.branch_id=a.branch_id
                                                 WHERE a.store_id=? AND a.branch_id=? AND a.status='returned'
                                                   AND COALESCE(a.returned_received_units,a.quantity)>0
                                                   AND (a.inspected_at IS NULL OR a.inspection_status='pending')
                                                 ORDER BY a.updated_at DESC,a.id DESC LIMIT 200`,
        [scope.storeId,scope.branchId]);
    // Source of truth: open maintenance records.
    const [maintenanceRecords]=await db.execute(`SELECT m.id,
                                                        m.equipment_id AS equipmentId,
                                                        COALESCE(e.name,'Archived equipment') AS equipmentName,
                                                        m.quantity_started AS quantityStarted,m.quantity_remaining AS units,
                                                        m.start_reason AS reason,
                                                        DATE_FORMAT(m.opened_at,'%Y-%m-%d') AS dateReported,
                                                        DATE_FORMAT(m.estimated_completion_date,'%Y-%m-%d') AS estimatedCompletion,
                                                        m.condition_status AS status,m.booking_reference AS bookingReference,
                                                        IF(m.repair_approved_at IS NULL,0,1) AS repairApproved,
                                                        q.id AS pendingCompletionId,q.quantity AS pendingCompletionUnits,
                                                        q.notes AS pendingCompletionNotes
                                                 FROM ${V2_MAINTENANCE_RECORDS} m
                                                          LEFT JOIN ${V2_COMPLETION_REQUESTS} q ON q.maintenance_record_id=m.id AND q.status='pending'
                                                          LEFT JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=m.equipment_id
                                                     AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                 WHERE m.store_id=? AND m.branch_id=? AND m.quantity_remaining>0
                                                 ORDER BY m.opened_at DESC,m.id DESC LIMIT 1000`,
        [scope.storeId,scope.branchId]);
    // Preliminary damage recorded by Staff when receiving the booking return.
    const [pendingDamageObservations]=await db.execute(`SELECT a.id AS allocationId,
                                                               a.booking_reference AS bookingReference,
                                                               e.name AS equipmentName,
                                                               a.inspection_damaged_units AS observedDamagedUnits,
                                                               a.inspection_notes AS notes,
                                                               DATE_FORMAT(a.returned_at,'%Y-%m-%d') AS reportedAt
                                                        FROM ${V2_RENTAL_ALLOCATIONS} a
                                                                 JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=a.equipment_id
                                                            AND e.store_id=a.store_id AND e.branch_id=a.branch_id
                                                        WHERE a.store_id=? AND a.branch_id=? AND a.status='returned'
                                                          AND a.inspection_status='pending'
                                                          AND COALESCE(a.inspection_damaged_units,0)>0
                                                        ORDER BY a.returned_at DESC,a.id DESC LIMIT 200`,
        [scope.storeId,scope.branchId]);
    // Staff receiving tasks are not part of stocknbook_v2.
    const pendingReceipts=[];
    const [missingReports]=await db.execute(`SELECT r.id,r.equipment_id AS equipmentId,e.name AS equipmentName,
                                                    r.quantity,r.reason,r.booking_reference AS bookingReference,
                                                    DATE_FORMAT(r.created_at,'%Y-%m-%d') AS reportedAt,r.reported_by AS reportedBy,
                                                    GREATEST(0,r.quantity-r.recovered) AS remainingUnits
                                             FROM ${V2_MISSING_REPORTS} r JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=r.equipment_id AND e.branch_id=r.branch_id
                                             WHERE r.store_id=? AND r.branch_id=? AND r.status='pending' ORDER BY r.created_at DESC,r.id DESC
                                                 LIMIT 200`,[scope.storeId,scope.branchId]);
    const [categories]=await db.execute(`SELECT name FROM ${V2_RENTAL_CATEGORIES} c WHERE c.store_id=? AND c.archived_at IS NULL ORDER BY name`,
        [scope.storeId]);
    const unitNumbers=await identifiers.listEquipmentUnitNumbers(db,{storeId:scope.storeId,branchId:scope.branchId});
    return {success:true, storeId:scope.storeId, branchId:scope.branchId, storeName:scope.storeName, branchName:scope.branchName, bookingSyncConnected: process.env.RENTAL_BOOKING_SYNC_ENABLED === "true", equipment:equipment.map(row=>({ ...row,id:Number(row.id),totalUnits:Number(row.totalUnits),
            unitNumbers:unitNumbers.get(Number(row.id))||[],
            bookableToday:rentalBookableProjection(row,bookedToday.get(Number(row.id))),
            rentedOutUnits:Number(row.rentedOutUnits),maintenanceUnits:Number(row.maintenanceUnits),missingUnits:Number(row.missingUnits),
            alertLevel:Number(row.alertLevel),active:Boolean(row.active),rentalRatePerDay:Number(row.rentalRatePerDay),
            averageUnitCost:row.averageUnitCost===null?null:Number(row.averageUnitCost),
            pricingRecoveryDays:row.pricingRecoveryDays===null?null:Number(row.pricingRecoveryDays),
            pricingResidualValue:row.pricingResidualValue===null?null:Number(row.pricingResidualValue),
            pricingOperatingCostPerDay:row.pricingOperatingCostPerDay===null?null:Number(row.pricingOperatingCostPerDay),
            pricingMarginPercent:row.pricingMarginPercent===null?null:Number(row.pricingMarginPercent),
            pricingUnitCostBasis:row.pricingUnitCostBasis===null?null:Number(row.pricingUnitCostBasis)})),
        activity,
        maintenanceHistory:maintenanceHistory.map(row=>({...row,id:Number(row.id),equipmentId:Number(row.equipmentId),
            quantity:Number(row.quantity)})),
        pendingInspections:pendingInspections.map(row=>({...row,allocationId:Number(row.allocationId),
            equipmentId:Number(row.equipmentId),units:Number(row.units),observedDamageUnits:Number(row.observedDamageUnits)})),
        maintenanceRecords:maintenanceRecords.map(row=>({
            ...row,id:Number(row.id),equipmentId:Number(row.equipmentId),
            quantityStarted:Number(row.quantityStarted),units:Number(row.units),
            repairApproved:Boolean(row.repairApproved),pendingCompletionId:row.pendingCompletionId==null?null:Number(row.pendingCompletionId),
            pendingCompletionUnits:row.pendingCompletionUnits==null?null:Number(row.pendingCompletionUnits)
        })),
        pendingDamageObservations:pendingDamageObservations.map(row=>({
            ...row,allocationId:Number(row.allocationId),
            observedDamagedUnits:Number(row.observedDamagedUnits)
        })),
        pendingReceipts,
        missingReports:missingReports.map(r=>({...r,id:Number(r.id),equipmentId:Number(r.equipmentId),
            quantity:Number(r.quantity),remainingUnits:Number(r.remainingUnits)})),
        categories:categories.map(c=>c.name) };
}
async function getPayables() {
    return {success:true,payables:[]};
}
async function getPurchaseItems(db,scope,body) {
    id(body.purchaseId,"Purchase ID");
    fail(404,"Purchase not found.");
    return {};
}
function addCalendarDay(date) { const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); }
function computePeak(rows, from, to, today) {
    const events=new Map();
    for(const r of rows) {
        const start=String(r.startDate); const end=String(r.status)==="checked_out" && String(r.endDate)<today ? today : String(r.endDate);
        if(start>to||end<from)continue;
        const s=start<from?from:start,e=end>to?to:end;
        events.set(s,(events.get(s)||0)+Number(r.quantity));
        const after=addCalendarDay(e);
        events.set(after,(events.get(after)||0)-Number(r.quantity));
    }
    let current=0,peak=0;
    for(const [_,delta] of [...events.entries()].sort(([a],[b])=>a.localeCompare(b))) {current+=delta;peak=Math.max(peak,current);}
    return peak;
}
async function checkAvailability(db,scope,body) {
    if(process.env.RENTAL_BOOKING_SYNC_ENABLED!=="true") fail(409,"Date availability is not connected to booking allocations yet. Connect booking/booking_items writes before enabling this filter.");
    const from=isoDate(body.start_date,"Start date"),to=isoDate(body.end_date,"End date");
    if(from>to)fail(400,"End date must be on or after start date.");
    if((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000>366)fail(400,"Availability range cannot exceed 366 days.");
    const [equipment]=await db.execute(`SELECT e.id,e.total_units,e.maintenance_units,e.missing_units FROM ${V2_RENTAL_EQUIPMENT} e
                                        WHERE e.store_id=? AND e.branch_id=? AND e.archived_at IS NULL`,[scope.storeId,scope.branchId]);
    const [allocations]=await db.execute(`SELECT a.equipment_id AS equipmentId,a.quantity,
                                                 DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,a.status
                                          FROM ${V2_RENTAL_ALLOCATIONS} a WHERE a.store_id=? AND a.branch_id=? AND a.status IN ('reserved','checked_out')
                                                                            AND a.start_date<=? AND (a.end_date>=? OR a.status='checked_out')`,[scope.storeId,scope.branchId,to,from]);
    const grouped=new Map();for(const row of allocations){const k=Number(row.equipmentId);grouped.set(k,[...(grouped.get(k)||[]),row]);}
    const today=todayPh();
    return {success:true,availability:equipment.map(e=>({equipmentId:Number(e.id),availableUnits:Math.max(0,
                Number(e.total_units)-Number(e.maintenance_units)-Number(e.missing_units)-computePeak(grouped.get(Number(e.id))||[],from,to,today))}))};
}


// Read-only branch schedule for Staff. Do not use today's physical availability as
// date-specific availability: confirmed future reservations may overlap.
async function staffEquipmentSchedule(db,scope,body) {
    const equipmentId=id(body.equipmentId,'Equipment');
    const date=isoDate(body.date,'Schedule date');
    const [rows]=await db.execute(`SELECT e.id,e.equipment_number AS equipmentNumber,e.name,e.total_units AS totalUnits,
                                          e.rented_out_units AS rentedOutUnits,e.maintenance_units AS maintenanceUnits,
                                          e.missing_units AS missingUnits
                                   FROM ${V2_RENTAL_EQUIPMENT} e
                                   WHERE e.id=? AND e.store_id=? AND e.branch_id=? AND e.archived_at IS NULL LIMIT 1`,
        [equipmentId,scope.storeId,scope.branchId]);
    if(!rows.length)fail(404,'Equipment not found in this branch.');
    const item=rows[0];
    const today=todayPh();
    if(date<today)fail(400,'Use today or a future date to plan rental availability. Past rentals are in activity history.');
    const [bookings]=await db.execute(`SELECT a.id AS allocationId,a.booking_reference AS bookingReference,
                                              a.quantity,DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                              DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,a.status
                                       FROM ${V2_RENTAL_ALLOCATIONS} a
                                                JOIN bookings b ON b.id=a.booking_id
                                           AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                       WHERE a.store_id=? AND a.branch_id=? AND a.equipment_id=?
                                         AND a.status IN ('reserved','checked_out') AND a.start_date<=?
                                         AND (a.end_date>=? OR (a.status='checked_out' AND a.end_date<?))
                                       ORDER BY a.start_date,a.id LIMIT 300`,
        [scope.storeId,scope.branchId,equipmentId,date,date,today]);
    // The total must NOT be limited by the 300-row schedule preview.
    const [summaryRows]=await db.execute(`SELECT COALESCE(SUM(a.quantity),0) AS bookedUnits,COUNT(*) AS allocationCount
                                          FROM ${V2_RENTAL_ALLOCATIONS} a
                                                   JOIN bookings b ON b.id=a.booking_id
                                              AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                          WHERE a.store_id=? AND a.branch_id=? AND a.equipment_id=?
                                            AND a.status IN ('reserved','checked_out') AND a.start_date<=?
                                            AND (a.end_date>=? OR (a.status='checked_out' AND a.end_date<?))`,
        [scope.storeId,scope.branchId,equipmentId,date,date,today]);
    // The booked quantity on a date is NOT the same as physically rented-out
    // quantity right now. Never add the latter again (double-counting).
    const bookedUnits=Number(summaryRows[0].bookedUnits);
    const allocationCount=Number(summaryRows[0].allocationCount);
    const totalUnits=Number(item.totalUnits),maintenanceUnits=Number(item.maintenanceUnits),
        missingUnits=Number(item.missingUnits),rentedOutUnits=Number(item.rentedOutUnits);
    return {success:true,schedule:{equipmentId,date,totalUnits,maintenanceUnits,missingUnits,
            rentedOutUnits,physicallyAvailableNow:Math.max(0,totalUnits-rentedOutUnits-maintenanceUnits-missingUnits),
            bookedUnits,allocationCount,availableOnDate:Math.max(0,totalUnits-maintenanceUnits-missingUnits-bookedUnits),
            bookings:bookings.map(b=>({allocationId:Number(b.allocationId),bookingReference:b.bookingReference,
                quantity:Number(b.quantity),startDate:b.startDate,endDate:b.endDate,status:b.status}))}};
}

// Read-only month markers for Staff: no customer identity, contact information,
// financial fields, or cross-branch bookings are returned. Day details use the
// existing branch-scoped get_staff_equipment_schedule request.
async function staffEquipmentCalendar(db,scope,body) {
    const equipmentId=id(body.equipmentId,'Equipment');
    const month=String(body.month||'');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'Select a valid calendar month.');
    const today=todayPh();
    if(month<today.slice(0,7))fail(400,'Past calendar months are not available in the staff schedule.');
    const [year,monthNumber]=month.split('-').map(Number);
    const daysInMonth=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
    const lastDate=`${month}-${String(daysInMonth).padStart(2,'0')}`;
    const firstDate=month===today.slice(0,7)?today:`${month}-01`;
    const [found]=await db.execute(`SELECT e.id FROM ${V2_RENTAL_EQUIPMENT} e
                                    WHERE e.id=? AND e.store_id=? AND e.branch_id=? AND e.archived_at IS NULL LIMIT 1`,
        [equipmentId,scope.storeId,scope.branchId]);
    if(!found.length)fail(404,'Equipment not found in this branch.');
    const [rows]=await db.execute(`SELECT a.id AS allocationId,a.quantity,
                                          DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                          DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,a.status
                                   FROM ${V2_RENTAL_ALLOCATIONS} a
                                            JOIN bookings b ON b.id=a.booking_id
                                       AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                   WHERE a.store_id=? AND a.branch_id=? AND a.equipment_id=?
                                     AND a.status IN ('reserved','checked_out') AND a.start_date<=?
                                     AND (a.end_date>=? OR (a.status='checked_out' AND a.end_date<?))`,
        [scope.storeId,scope.branchId,equipmentId,lastDate,firstDate,today]);
    const days=[];
    for(let day=1;day<=daysInMonth;day++) {
        const date=`${month}-${String(day).padStart(2,'0')}`;
        if(date<today)continue;
        let bookedUnits=0,allocationCount=0;
        for(const row of rows) {
            if(String(row.startDate)>date)continue;
            if(String(row.endDate)<date && !(row.status==='checked_out' && String(row.endDate)<today))continue;
            bookedUnits+=Number(row.quantity||0);
            allocationCount+=1;
        }
        if(allocationCount)days.push({date,allocationCount,bookedUnits});
    }
    return {success:true,calendar:{equipmentId,month,days}};
}

// Staff operations consume existing booking allocations; there is no equipment/catalog write access.
// Bookings must already be confirmed by the existing booking workflow.
async function staffRentalWorkspace(db, scope) {
    const bookedToday=await rentalBookableToday(db,scope);
    const [equipment] = await db.execute(`SELECT e.id,e.equipment_number AS equipmentNumber,e.name,c.name AS category,
                                                 e.total_units AS totalUnits,e.rented_out_units AS rentedOutUnits,e.maintenance_units AS maintenanceUnits,
                                                 e.missing_units AS missingUnits,e.alert_level AS alertLevel,
                                                 (SELECT DATE_FORMAT(MAX(m.occurred_at),'%Y-%m-%d')
                                                  FROM ${V2_RENTAL_MOVEMENTS} m
                                                  WHERE m.store_id=e.store_id AND m.branch_id=e.branch_id
                                                    AND m.equipment_id=e.id AND m.type='received') AS lastStockReceivedDate
                                          FROM ${V2_RENTAL_EQUIPMENT} e JOIN ${V2_RENTAL_CATEGORIES} c ON c.id=e.category_id
                                          WHERE e.store_id=? AND e.branch_id=? AND e.archived_at IS NULL ORDER BY e.name LIMIT 300`,
        [scope.storeId, scope.branchId]);
    const [allocations] = await db.execute(`SELECT a.id AS allocationId,a.booking_reference AS bookingReference,
                                                   a.equipment_id AS equipmentId,e.name AS equipmentName,e.equipment_number AS equipmentNumber,
                                                   a.quantity,DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                                   DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,a.status,
                                                   a.prepared_at AS preparedAt,a.returned_at AS returnedAt,
                                                   COALESCE(a.returned_received_units,a.quantity) AS returnedReceivedUnits,
                                                   COALESCE(a.inspection_cleaning_units,IF(a.inspection_status='cleaning',a.quantity,0)) AS cleaningUnits,
                                                   COALESCE(a.inspection_damaged_units,IF(a.inspection_status='damaged',a.quantity,0)) AS damagedUnits,
                                                   b.name AS clientName,b.booking_type AS bookingType,b.status AS bookingStatus,
                                                   b.package_name AS packageName,
                                                   DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate,
                                                   b.event_time AS eventTime,
                                                   COALESCE(b.agreed_price,0) AS bookingTotal,
                                                   COALESCE(b.amount_paid,0) AS amountPaid,
                                                   COALESCE(b.balance,0) AS bookingBalance,
                                                   f.refundable_deposit_required AS depositRequired,
                                                   f.deposit_collected AS depositCollected,
                                                   CASE WHEN a.inspection_status='damaged' AND m.id IS NOT NULL AND m.quantity_remaining=0
                                                            THEN 'cleared' ELSE a.inspection_status END AS inspectionStatus,
                                                   a.inspection_notes AS inspectionNotes
                                            FROM ${V2_RENTAL_ALLOCATIONS} a
                                                     JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=a.equipment_id AND e.store_id=a.store_id AND e.branch_id=a.branch_id AND e.archived_at IS NULL
                                                     JOIN ${V2_BOOKINGS} b ON b.id=a.booking_id
                                                AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                                     LEFT JOIN ${V2_BOOKING_FINANCIALS} f ON f.booking_id=b.id
                                                     LEFT JOIN ${V2_MAINTENANCE_RECORDS} m ON m.id=a.maintenance_record_id
                                            WHERE a.store_id=? AND a.branch_id=? AND (a.status IN ('reserved','checked_out')
                                                OR (a.status='returned' AND (a.inspection_status IN ('pending','cleaning')
                                                    OR (a.inspection_status='damaged' AND COALESCE(m.quantity_remaining,0)>0))))
                                            ORDER BY a.end_date ASC,a.start_date ASC,a.id ASC LIMIT 300`,[scope.storeId,scope.branchId]);
    const [activity] = await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,COALESCE(e.name,'Archived equipment') AS equipmentName,
                                                m.type,m.quantity,DATE_FORMAT(m.occurred_at,'%Y-%m-%dT%H:%i:%s+08:00') AS occurredAt,
                                                COALESCE(m.reference_number,'') AS referenceNumber
                                         FROM ${V2_RENTAL_MOVEMENTS} m LEFT JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=m.equipment_id AND e.branch_id=m.branch_id
                                         WHERE m.store_id=? AND m.branch_id=? ORDER BY m.occurred_at DESC,m.id DESC LIMIT 30`,[scope.storeId,scope.branchId]);
    // Staff receiving tasks are not part of stocknbook_v2.
    const pendingReceipts=[];
    const [missingReports]=await db.execute(`SELECT r.id,r.equipment_id AS equipmentId,e.name AS equipmentName,
                                                    r.booking_reference AS bookingReference,r.reason,
                                                    r.quantity-r.recovered AS remainingUnits
                                             FROM ${V2_MISSING_REPORTS} r JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=r.equipment_id AND e.branch_id=r.branch_id
                                             WHERE r.store_id=? AND r.branch_id=? AND r.status='pending' AND e.archived_at IS NULL
                                             ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,[scope.storeId,scope.branchId]);
    const [maintenanceTasks]=await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,e.name AS equipmentName,
                                                      m.quantity_remaining AS units,m.start_reason AS reason,
                                                      m.condition_status AS conditionStatus,
                                                      IF(m.repair_approved_at IS NULL,0,1) AS repairApproved,
                                                      (SELECT COALESCE(SUM(q.quantity),0) FROM ${V2_COMPLETION_REQUESTS} q
                                                       WHERE q.maintenance_record_id=m.id AND q.status='pending') AS pendingUnits
                                               FROM ${V2_MAINTENANCE_RECORDS} m JOIN ${V2_RENTAL_EQUIPMENT} e ON e.id=m.equipment_id AND e.branch_id=m.branch_id
                                               WHERE m.store_id=? AND m.branch_id=? AND e.archived_at IS NULL AND m.quantity_remaining>0
                                               ORDER BY m.opened_at DESC LIMIT 200`,[scope.storeId,scope.branchId]);
    const unitNumbers=await identifiers.listEquipmentUnitNumbers(db,{storeId:scope.storeId,branchId:scope.branchId});
    return {success:true,equipment:equipment.map(x=>({...x,id:Number(x.id),totalUnits:Number(x.totalUnits),
            unitNumbers:unitNumbers.get(Number(x.id))||[],
            bookableToday:rentalBookableProjection(x,bookedToday.get(Number(x.id))),
            rentedOutUnits:Number(x.rentedOutUnits),maintenanceUnits:Number(x.maintenanceUnits),
            missingUnits:Number(x.missingUnits),alertLevel:Number(x.alertLevel)})),
        allocations:allocations.map(x=>({...x,allocationId:Number(x.allocationId),equipmentId:Number(x.equipmentId),quantity:Number(x.quantity),
            returnedReceivedUnits:Number(x.returnedReceivedUnits),cleaningUnits:Number(x.cleaningUnits),damagedUnits:Number(x.damagedUnits),
            bookingTotal:Number(x.bookingTotal),amountPaid:Number(x.amountPaid),bookingBalance:Number(x.bookingBalance),
            depositRequired:x.depositRequired==null?null:Number(x.depositRequired),
            depositCollected:x.depositCollected==null?null:Number(x.depositCollected)})),
        activity,
        pendingReceipts,
        maintenanceTasks:maintenanceTasks.map(x=>({...x,id:Number(x.id),equipmentId:Number(x.equipmentId),
            units:Number(x.units),repairApproved:Boolean(x.repairApproved),pendingUnits:Number(x.pendingUnits)})),
        missingReports:missingReports.filter(x=>Number(x.remainingUnits)>0).map(x=>({...x,
            id:Number(x.id),equipmentId:Number(x.equipmentId),remainingUnits:Number(x.remainingUnits)}))};
}
// All booking stages after confirmation are driven by actual rental and Sales
// inventory movements, not a Staff booking-status button.
async function markRentalPreparation(db,scope,reference) {
    await db.execute(`UPDATE bookings SET status='Preparing'
                      WHERE store_id=? AND branch_id=? AND booking_reference=? AND status='Confirmed'`,
        [scope.storeId,scope.branchId,reference]);
}
async function markInventoryBookingReleased(db,scope,reference) {
    const [sales]=await db.execute(`SELECT COUNT(*) AS pending FROM booking_items bi
                                    WHERE bi.store_id=?
                                      AND bi.booking_id=(SELECT id FROM bookings
                                                         WHERE store_id=? AND branch_id=? AND booking_reference=? LIMIT 1)
                                      AND bi.item_type='consumable' AND bi.quantity>0
                                      AND (bi.released_at IS NULL OR bi.used_quantity<bi.quantity)`,
        [scope.storeId,scope.storeId,scope.branchId,reference]);
    const [rentals]=await db.execute(`SELECT COUNT(*) AS pending FROM ${V2_RENTAL_ALLOCATIONS} a
                                      WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=?
                                        AND a.status='reserved'`,[scope.storeId,scope.branchId,reference]);
    if(Number(sales[0]?.pending||0)===0 && Number(rentals[0]?.pending||0)===0) {
        await db.execute(`UPDATE bookings SET status='Released'
                          WHERE store_id=? AND branch_id=? AND booking_reference=?
                            AND status IN ('Confirmed','Preparing')`,[scope.storeId,scope.branchId,reference]);
    } else {
        await markRentalPreparation(db,scope,reference);
    }
}
async function settleReturnedRentalBooking(db,scope,reference) {
    const [locked]=await db.execute(`SELECT id FROM bookings
                                     WHERE store_id=? AND branch_id=? AND booking_reference=? FOR UPDATE`,
        [scope.storeId,scope.branchId,reference]);
    if(!locked.length)return;
    const [bookingRows]=await db.execute(`SELECT b.id,b.status,b.agreed_price,b.amount_paid,b.balance FROM ${V2_BOOKINGS} b
                                          WHERE b.id=?`,[locked[0].id]);
    const booking=bookingRows[0];
    if(!booking || !['released','return inspection','pending settlement','preparing'].includes(String(booking.status||'').toLowerCase()))return;
    const [allocations]=await db.execute(`SELECT a.status,a.quantity,a.returned_received_units,a.inspected_at,a.inspection_status
                                          FROM ${V2_RENTAL_ALLOCATIONS} a
                                          WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=?
                                            AND a.status<>'requested'`,
        [scope.storeId,scope.branchId,reference]);
    if(!allocations.length || allocations.some(a=>a.status!=='returned'))return;
    const needsInspection=allocations.some(a=>Number(a.returned_received_units??a.quantity)>0 &&
        (!a.inspected_at || ['pending','cleaning'].includes(String(a.inspection_status||''))));
    if(needsInspection) {
        await db.execute(`UPDATE bookings SET status='Return Inspection'
                          WHERE id=? AND store_id=? AND branch_id=? AND status<>'Completed'`,
            [booking.id,scope.storeId,scope.branchId]);
        return;
    }
    await db.execute(`UPDATE bookings SET status='Pending Settlement'
                      WHERE id=? AND store_id=? AND branch_id=? AND status<>'Completed'`,
        [booking.id,scope.storeId,scope.branchId]);
    // Completion only when booking bill, claims and refundable deposit are all settled.
    if(!(Number(booking.agreed_price)>0) || Number(booking.amount_paid)+0.005<Number(booking.agreed_price) ||
        Number(booking.balance)>0.005)return;
    const [finance]=await db.execute(`SELECT f.refundable_deposit_required,f.deposit_collected,f.deposit_applied,f.deposit_refunded
                                      FROM ${V2_BOOKING_FINANCIALS} f WHERE f.booking_id=? AND f.store_id=? AND f.branch_id=?`,
        [booking.id,scope.storeId,scope.branchId]);
    if(!finance.length || Number(finance[0].deposit_collected)+0.005<Number(finance[0].refundable_deposit_required) ||
        Number(finance[0].deposit_collected)-Number(finance[0].deposit_applied)-Number(finance[0].deposit_refunded)>0.005)return;
    const [sales]=await db.execute(`SELECT COUNT(*) AS pending FROM booking_items bi
                                    WHERE bi.booking_id=? AND bi.store_id=?
                                      AND bi.item_type='consumable' AND bi.quantity>0
                                      AND (bi.released_at IS NULL OR bi.used_quantity<bi.quantity)`,
        [booking.id,scope.storeId]);
    if(Number(sales[0]?.pending||0)>0)return;
    const [pendingMissing]=await db.execute(`SELECT COUNT(*) AS pending FROM ${V2_MISSING_REPORTS} m
                                                                                 LEFT JOIN ${V2_BOOKING_CLAIMS} c ON c.source_type='missing'
                AND c.source_record_id=m.id AND c.booking_id=?
                                             WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                               AND (m.status='pending' OR (m.status='writeoff' AND c.id IS NULL))`,
        [booking.id,scope.storeId,scope.branchId,reference]);
    if(Number(pendingMissing[0]?.pending||0)>0)return;
    const [pendingDamage]=await db.execute(`SELECT COUNT(*) AS pending FROM ${V2_MAINTENANCE_RECORDS} m
                                                                                LEFT JOIN ${V2_BOOKING_CLAIMS} c ON c.source_type='damage'
                AND c.source_record_id=m.id AND c.booking_id=?
                                            WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                              AND m.start_reason LIKE 'Rental damage %' AND c.id IS NULL`,
        [booking.id,scope.storeId,scope.branchId,reference]);
    if(Number(pendingDamage[0]?.pending||0)>0)return;
    const [pendingRecovery]=await db.execute(`SELECT COUNT(*) AS pending FROM ${V2_MAINTENANCE_RECORDS} m
                                              WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                                AND m.start_reason LIKE 'Recovered missing equipment (report #%'
                                                AND m.quantity_remaining>0`,[scope.storeId,scope.branchId,reference]);
    if(Number(pendingRecovery[0]?.pending||0)>0)return;
    // Check the actual monetary balance of every customer charge.
    const [claims]=await db.execute(`SELECT COUNT(*) AS pending FROM ${V2_BOOKING_CLAIMS} c
                                     WHERE c.booking_id=? AND c.store_id=? AND c.branch_id=?
                                       AND c.status<>'waived'
                                       AND COALESCE(c.approved_amount,0)>
                                           COALESCE(c.amount_paid,0)+COALESCE(c.deposit_applied,0)+0.005`,
        [booking.id,scope.storeId,scope.branchId]);
    if(Number(claims[0]?.pending||0)>0)return;
    await db.execute(`UPDATE bookings SET status='Completed'
                      WHERE id=? AND store_id=? AND branch_id=? AND status='Pending Settlement'`,
        [booking.id,scope.storeId,scope.branchId]);
}

// Staff hands over and receives an ENTIRE booking, never just one equipment line.
// The caller's existing transaction + branch lock + idempotency key encompass
// every inventory update, workflow row, and movement written by this operation.
async function staffRentalBookingMutation(db,scope,body) {
    const action=String(body.action||'');
    const reference=requiredText(body.bookingReference,100,'Booking reference');
    const [lockedBooking]=await db.execute(`SELECT id FROM bookings WHERE store_id=? AND branch_id=? AND booking_reference=? LIMIT 1 FOR UPDATE`,
        [scope.storeId,scope.branchId,reference]);
    if(!lockedBooking.length)fail(404,'Booking not found in this branch.');
    const [bookingRows]=await db.execute(`SELECT b.id,b.status,b.agreed_price,b.amount_paid,b.balance
                                          FROM ${V2_BOOKINGS} b WHERE b.id=?`,[lockedBooking[0].id]);
    const booking=bookingRows[0];
    const bookingStatus=String(booking.status||'').toLowerCase();
    if(!(action==='release_rental_booking'?['confirmed','preparing']:['released','preparing']).includes(bookingStatus))
        fail(409,'Booking status does not permit this rental operation.');
    const [identities]=await db.execute(`SELECT a.id,a.equipment_id AS equipmentId
                                         FROM ${V2_RENTAL_ALLOCATIONS} a
                                         WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=? AND a.status<>'requested'
                                         ORDER BY a.equipment_id,a.id`,[scope.storeId,scope.branchId,reference]);
    if(!identities.length)fail(409,'No rental equipment allocations were found for this booking.');
    // Lock all equipment rows in a stable order to keep totals consistent across
    // multiple allocations using the same equipment and other stock operations.
    const equipmentById=new Map();
    for(const equipmentId of [...new Set(identities.map(x=>Number(x.equipmentId)))].sort((a,b)=>a-b)) {
        equipmentById.set(equipmentId,await lockEquipment(db,scope,equipmentId));
    }
    await db.execute(`SELECT id FROM booking_items WHERE booking_id=? AND item_type='rental' FOR UPDATE`,[booking.id]);
    const [lines]=await db.execute(`SELECT a.id,a.equipment_id AS equipmentId,a.quantity,a.status,
                                           DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                           a.prepared_at AS preparedAt
                                    FROM ${V2_RENTAL_ALLOCATIONS} a
                                    WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=? AND a.status<>'requested'
                                    ORDER BY a.equipment_id,a.id`,[scope.storeId,scope.branchId,reference]);
    if(lines.length!==identities.length)fail(409,'Booking equipment changed. Refresh and retry.');
    const qtyByEquipment=new Map();
    for(const line of lines) {
        const quantity=Number(line.quantity),equipmentId=Number(line.equipmentId);
        if(!Number.isSafeInteger(quantity)||quantity<1||!equipmentById.has(equipmentId))
            fail(409,'Booking equipment quantity or identity is invalid.');
        qtyByEquipment.set(equipmentId,(qtyByEquipment.get(equipmentId)||0)+quantity);
    }
    const note=trim(body.notes,400);
    const actorUserId=await v2UserId(db,scope.storeId,scope.actorId);
    if(action==='release_rental_booking') {
        const total=Number(booking.agreed_price),paid=Number(booking.amount_paid),balance=Number(booking.balance);
        if(!Number.isFinite(total)||total<=0||!Number.isFinite(paid)||!Number.isFinite(balance)
            ||paid+0.005<total||balance>0.005)
            fail(409,'The customer must pay the entire booking balance before equipment handover.');
        // Financial security deposit is separate from rental revenue. A zero
        // agreed deposit is valid (no policy, or documented Manager waiver).
        // Never hand equipment over while an agreed positive deposit is unpaid.
        const [depositTerms]=await db.execute(`SELECT f.refundable_deposit_required,f.deposit_collected
                                               FROM ${V2_BOOKING_FINANCIALS} f
                                               WHERE f.booking_id=? AND f.store_id=? AND f.branch_id=? LIMIT 1`,
            [booking.id,scope.storeId,scope.branchId]);
        if(!depositTerms.length)fail(409,'Booking security-deposit terms are unavailable. Ask the Manager to review Billing.');
        if(Number(depositTerms[0].deposit_collected||0)+0.005<Number(depositTerms[0].refundable_deposit_required||0))
            fail(409,'Collect the agreed refundable security deposit before releasing rental equipment.');
        if(lines.some(line=>line.status!=='reserved'||!line.preparedAt))
            fail(409,'Every rental equipment line must be prepared before releasing the booking.');
        if(lines.some(line=>String(line.startDate)>todayPh()))
            fail(409,'The booking cannot be released before its scheduled rental start date.');
        for(const [equipmentId,needed] of qtyByEquipment) {
            const equipment=equipmentById.get(equipmentId);
            const available=Number(equipment.total_units)-Number(equipment.rented_out_units)
                -Number(equipment.maintenance_units)-Number(equipment.missing_units);
            if(needed>available)fail(409,'Not enough safe, physically available equipment for the whole booking.');
        }
        for(const line of lines) {
            await db.execute(`UPDATE booking_items SET item_status='released',released_at=NOW(),released_by=? WHERE id=?`,
                [actorUserId,line.id]);
            await v2AdjustEquipmentStock(db,equipmentById.get(Number(line.equipmentId)).inventory_id,{rentedOut:Number(line.quantity)});
            await appendMovement(db,scope,Number(line.equipmentId),'rented_out',Number(line.quantity),reference,
                'Complete booking handover confirmed');
        }
        await markInventoryBookingReleased(db,scope,reference);
        return {bookingReference:reference,processedLines:lines.length,operation:'released'};
    }
    if(action==='return_rental_booking') {
        // Explicit confirmation permits same-visit inspection. Omitted flags retain
        // the old hold-for-inspection behavior for legacy API clients.
        const conditionChecked=body.conditionChecked===true;
        const inspectionDeferred=body.inspectionDeferred===true || !conditionChecked;
        if(conditionChecked&&body.inspectionDeferred===true)
            fail(400,'Choose completed condition check or Inspect Later, not both.');
        if(lines.some(line=>line.status!=='checked_out'))
            fail(409,'All rental equipment must be out on rental before using Receive Booking Return. Contact the Manager to reconcile an older partial handover.');
        if(!Array.isArray(body.returns)||body.returns.length!==lines.length)
            fail(400,'Record the returned or missing quantity for every equipment line.');
        const inputs=new Map();
        for(const item of body.returns) {
            const allocationId=id(item?.allocationId,'Return equipment line');
            if(inputs.has(allocationId))fail(400,'An equipment line was included twice.');
            inputs.set(allocationId,{
                missing:whole(item?.missingUnits,'Missing units on return'),
                // Damage is confirmed when the condition check is completed, or an
                // observation only when Staff explicitly defers inspection.
                observedDamage:whole(item?.damagedUnitsObserved ?? 0,'Damaged units')
            });
        }
        let anyIssue=false;
        for(const line of lines) {
            const quantity=Number(line.quantity),counts=inputs.get(Number(line.id));
            if(!counts||counts.missing+counts.observedDamage>quantity)
                fail(400,'Missing and observed damaged quantities must match each equipment line and cannot exceed booked units.');
            if(counts.missing>0||counts.observedDamage>0)anyIssue=true;
        }
        if(anyIssue&&note.length<5)fail(400,'Describe missing or damaged equipment in at least five characters.');
        for(const [equipmentId,needed] of qtyByEquipment) {
            if(Number(equipmentById.get(equipmentId).rented_out_units)<needed)
                fail(409,'Out-on-rental stock is inconsistent. Ask the Manager to reconcile equipment before receiving this booking.');
        }
        for(const line of lines) {
            const quantity=Number(line.quantity),counts=inputs.get(Number(line.id));
            const missing=counts.missing,observedDamage=counts.observedDamage,received=quantity-missing;
            const inventoryId=equipmentById.get(Number(line.equipmentId)).inventory_id;
            // All returned units are on hold only if Staff chose Inspect Later.
            // Otherwise the condition check is complete: only damaged units stay
            // unavailable, and the remaining units have completed routine care.
            const holdUnits=inspectionDeferred?received:observedDamage;
            const status=inspectionDeferred&&received>0?'returned':observedDamage>0?'damaged':'cleared';
            await v2AdjustEquipmentStock(db,inventoryId,{rentedOut:-quantity,maintenance:holdUnits,missing});
            if(conditionChecked&&observedDamage>0){
                // Same booking-linked damage record consumed by Manager repair
                // approval and Booking Billing. Never create a second incident in inspection.
                await db.execute(`INSERT INTO stock_issues
                                  (store_id,branch_id,branch_inventory_id,booking_id,issue_type,quantity,reason,status,reported_by)
                                  VALUES(?,?,?,?,'maintenance',?,?,'In Repair',?)`,[scope.storeId,scope.branchId,inventoryId,booking.id,
                    observedDamage,`Rental damage ${reference}: ${note}`,actorUserId]);
            }
            await db.execute(`UPDATE booking_items
                              SET item_status=?,returned_at=NOW(),received_by=?,returned_quantity=?,missing_quantity=?,
                                  inspected_at=IF(?=1,NOW(),NULL),inspected_by=IF(?=1,?,NULL),
                                  used_quantity=0,damaged_quantity=?,return_notes=?
                              WHERE id=?`,[status,actorUserId,received,missing,conditionChecked?1:0,
                conditionChecked?1:0,actorUserId,Math.min(observedDamage,received),
                observedDamage>0?(inspectionDeferred?`Reported damage - pending condition check (${observedDamage} units): ${note}`:note).slice(0,400):null,
                line.id]);
            if(received>0)await appendMovement(db,scope,Number(line.equipmentId),'returned',received,reference,
                inspectionDeferred?'Returned equipment held for deferred Staff inspection':
                    `Return checked; ${received-observedDamage} ready, ${observedDamage} damaged on hold`);
            if(conditionChecked&&received>0){
                await appendMovement(db,scope,Number(line.equipmentId),'inspected',received,reference,
                    `Condition confirmed on return; ${received-observedDamage} ready, ${observedDamage} damaged`);
                if(observedDamage>0)await appendMovement(db,scope,Number(line.equipmentId),'damage_reported',observedDamage,reference,
                    `Damage held for Manager review: ${note}`);
            }
            if(missing>0) {
                const [report]=await db.execute(`INSERT INTO stock_issues
                                                 (store_id,branch_id,branch_inventory_id,booking_id,issue_type,quantity,reason,status,reported_by)
                                                 VALUES(?,?,?,?,'missing',?,?,'pending',?)`,[scope.storeId,scope.branchId,inventoryId,booking.id,missing,
                    `Booking ${reference}: ${note}`,actorUserId]);
                await appendMovement(db,scope,Number(line.equipmentId),'missing_reported',missing,
                    `MISS-${String(report.insertId).padStart(6,'0')}`,`Missing on booking return ${reference}: ${note}`);
            }
        }
        await settleReturnedRentalBooking(db,scope,reference);
        return {bookingReference:reference,processedLines:lines.length,operation:'returned'};
    }
    fail(400,'Unsupported booking-level equipment action.');
}

async function staffRentalMutation(db,scope,body) {
    const action=String(body.action||'');
    // Deprecated per-allocation handover is unsafe for multi-line event bookings.
    if(action==='release_rental_allocation'||action==='return_rental_allocation')
        fail(409,'Use the booking-level release or return action for the complete reservation.');
    const allocationId=id(body.allocationId,'Rental allocation');
    // Lock equipment before the allocation to match other stock write operations.
    const [identity]=await db.execute(`SELECT a.equipment_id FROM ${V2_RENTAL_ALLOCATIONS} a WHERE a.id=? AND a.store_id=? AND a.branch_id=?`,
        [allocationId,scope.storeId,scope.branchId]);
    if(!identity.length)fail(404,'Rental allocation does not belong to this branch.');
    const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
    await db.execute(`SELECT id FROM booking_items WHERE id=? FOR UPDATE`,[allocationId]);
    const [allocations]=await db.execute(`SELECT a.*, a.prepared_at AS preparedAt, a.inspection_status AS inspectionStatus,
                                                 a.returned_received_units AS returnedReceivedUnits,
                                                 a.inspection_cleaning_units AS cleaningUnits,
                                                 a.inspection_damaged_units AS damagedUnits,
                                                 a.inspection_notes AS inspectionNotes
                                          FROM ${V2_RENTAL_ALLOCATIONS} a
                                                   JOIN bookings b ON b.id=a.booking_id
                                              AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                          WHERE a.id=? AND a.store_id=? AND a.branch_id=? AND a.status<>'requested'`,[allocationId,scope.storeId,scope.branchId]);
    if(!allocations.length)fail(409,'Only a confirmed, branch-owned booking allocation can be processed.');
    const a=allocations[0], qty=Number(a.quantity);
    if(!Number.isSafeInteger(qty)||qty<1)fail(409,'Rental booking quantity is invalid.');
    const ref=requiredText(a.booking_reference,100,'Booking reference');
    if(['prepare_rental_allocation','release_rental_allocation'].includes(action)) {
        const [eligible]=await db.execute(`SELECT id FROM bookings WHERE booking_reference=? AND store_id=? AND branch_id=?
                                                                     AND LOWER(status) IN ('confirmed','preparing','approved') LIMIT 1`,[ref,scope.storeId,scope.branchId]);
        if(!eligible.length)fail(409,'Only currently confirmed bookings can be prepared or released.');
    }
    const note=trim(body.notes,400);
    const actorUserId=await v2UserId(db,scope.storeId,scope.actorId);
    const total=Number(equipment.total_units),out=Number(equipment.rented_out_units),hold=Number(equipment.maintenance_units),missing=Number(equipment.missing_units);
    if(action==='prepare_rental_allocation') {
        if(a.status!=='reserved'||a.preparedAt)fail(409,'This booking is already prepared or cannot be prepared.');
        // Preparation means physically gathered and usable equipment, not a free-form status flag.
        if(qty>total-out-hold-missing)fail(409,'Not enough physically usable units to prepare this booking. Resolve damaged or missing stock first.');
        await db.execute('UPDATE booking_items SET prepared_at=NOW(),prepared_by=? WHERE id=?',[actorUserId,allocationId]);
        await appendMovement(db,scope,equipment.id,'prepared',qty,ref,'Equipment prepared for scheduled release');
        await markRentalPreparation(db,scope,ref);
    } else if(action==='release_rental_allocation') {
        // Financial obligation is enforced in the rental Lambda, never just the browser.
        await db.execute(`SELECT id FROM bookings WHERE store_id=? AND branch_id=? AND booking_reference=? LIMIT 1 FOR UPDATE`,
            [scope.storeId,scope.branchId,ref]);
        const [payment]=await db.execute(`SELECT b.agreed_price,b.amount_paid,b.balance,b.status
                                          FROM ${V2_BOOKINGS} b WHERE b.store_id=? AND b.branch_id=? AND b.booking_reference=? LIMIT 1`,
            [scope.storeId,scope.branchId,ref]);
        const bill=payment[0];
        const total=Number(bill?.agreed_price||0),paid=Number(bill?.amount_paid||0);
        if(!bill || !['confirmed','preparing'].includes(String(bill.status).toLowerCase()) ||
            !Number.isFinite(total)||total<=0||!Number.isFinite(paid)||paid+.005<total||Number(bill.balance||0)>.005)
            fail(409,'Customer must fully settle the booking balance before any rental equipment can be released.');
        if(a.status!=='reserved'||!a.preparedAt)fail(409,'Prepare this confirmed booking before release.');
        if(String(a.start_date).slice(0,10)>todayPh())fail(409,'This booking cannot be released before its scheduled start date.');
        if(qty>total-out-hold-missing)fail(409,'Not enough physically available units to release.');
        await db.execute(`UPDATE booking_items SET item_status='released',released_at=NOW(),released_by=? WHERE id=?`,[actorUserId,allocationId]);
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{rentedOut:qty});
        await appendMovement(db,scope,equipment.id,'rented_out',qty,ref,'Physical handover confirmed');
    } else if(action==='return_rental_allocation') {
        if(a.status!=='checked_out'||out<qty)fail(409,'Booking is not checked out or stock needs reconciliation.');
        // Reconcile every issued unit: received units are held for inspection;
        // missing units immediately become unavailable pending Manager resolution.
        const missingCount=whole(body.missingUnits ?? 0,'Missing units on return');
        if(missingCount>qty)fail(400,'Missing units cannot exceed the booking quantity.');
        if(missingCount>0&&note.length<5)fail(400,'Explain missing units in at least five characters.');
        const receivedCount=qty-missingCount;
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{rentedOut:-qty,maintenance:receivedCount,missing:missingCount});
        await db.execute(`UPDATE booking_items SET item_status=?,returned_at=NOW(),received_by=?,
                                                   returned_quantity=?,missing_quantity=? WHERE id=?`,
            [receivedCount>0?'returned':'cleared',actorUserId,receivedCount,missingCount,allocationId]);
        if(receivedCount>0)await appendMovement(db,scope,equipment.id,'returned',receivedCount,ref,'Physically returned - held for inspection');
        if(missingCount>0){
            const [report]=await db.execute(`INSERT INTO stock_issues
                                             (store_id,branch_id,branch_inventory_id,booking_id,issue_type,quantity,reason,status,reported_by)
                                             VALUES(?,?,?,?,'missing',?,?,'pending',?)`,[scope.storeId,scope.branchId,equipment.inventory_id,
                a.booking_id,missingCount,`Booking ${ref}: ${note}`,actorUserId]);
            await appendMovement(db,scope,equipment.id,'missing_reported',missingCount,
                `MISS-${String(report.insertId).padStart(6,'0')}`,`Missing on rental return ${ref}: ${note}`);
        }
    } else if(action==='inspect_rental_allocation') {
        if(a.status!=='returned'||a.inspectionStatus!=='pending')fail(409,'Only returned equipment awaiting inspection can be inspected.');
        const receivedCount=a.returnedReceivedUnits==null?qty:Number(a.returnedReceivedUnits);
        if(!Number.isSafeInteger(receivedCount)||receivedCount<1||hold<receivedCount)
            fail(409,'Inspection quantity does not match the returned equipment on hold.');
        // Existing callers sending a single condition are still supported.
        // New Staff UI explicitly splits the received quantity by condition.
        let goodCount,cleaningCount,damagedCount;
        let finalNote=note;
        if(body.useRecordedReturn===true){
            // One-time closeout for returns entered before the streamlined flow.
            if(body.goodUnits!==undefined||body.cleaningUnits!==undefined||body.damagedUnits!==undefined||body.condition!==undefined)
                fail(400,'Use the saved return details; do not submit new damage quantities.');
            damagedCount=a.damagedUnits==null?0:Number(a.damagedUnits);
            if(!Number.isSafeInteger(damagedCount)||damagedCount<0||damagedCount>receivedCount)
                fail(409,'The recorded return quantities need Manager reconciliation.');
            goodCount=receivedCount-damagedCount;
            cleaningCount=0;
            finalNote=String(a.inspectionNotes||'').replace(/^(?:Unverified damage observed at return|Reported damage - pending condition check) \(\d+ units\): /,'').trim();
            if(damagedCount>0&&finalNote.length<5)
                fail(409,'The previous damage report has no usable notes. Ask the Manager to reconcile the incident before releasing stock.');
        }else if(body.goodUnits !== undefined || body.cleaningUnits !== undefined || body.damagedUnits !== undefined){
            goodCount=whole(body.goodUnits,'Good-condition units');
            cleaningCount=whole(body.cleaningUnits,'Cleaning units');
            damagedCount=whole(body.damagedUnits,'Damaged units');
        } else {
            const result=String(body.condition||'');
            if(!['good','cleaning','damaged'].includes(result))fail(400,'Select good condition, cleaning, or damaged.');
            goodCount=result==='good'?receivedCount:0;
            cleaningCount=result==='cleaning'?receivedCount:0;
            damagedCount=result==='damaged'?receivedCount:0;
        }
        if(goodCount+cleaningCount+damagedCount!==receivedCount)
            fail(400,`Condition quantities must total ${receivedCount} physically returned units.`);
        if(damagedCount>0&&finalNote.length<5)fail(400,'Describe the damaged equipment (at least five characters).');
        if(goodCount>0)await v2AdjustEquipmentStock(db,equipment.inventory_id,{maintenance:-goodCount});
        if(damagedCount>0){
            await db.execute(`INSERT INTO stock_issues
                              (store_id,branch_id,branch_inventory_id,booking_id,issue_type,quantity,reason,status,reported_by)
                              VALUES (?,?,?,?,'maintenance',?,?,'In Repair',?)`,[scope.storeId,scope.branchId,equipment.inventory_id,
                a.booking_id,damagedCount,`Rental damage ${ref}: ${finalNote}`,actorUserId]);
        }
        const nextStatus=cleaningCount>0?'cleaning':damagedCount>0?'damaged':'cleared';
        await db.execute(`UPDATE booking_items SET inspected_at=NOW(),inspected_by=?,
                                                   item_status=?,return_notes=?,used_quantity=?,damaged_quantity=? WHERE id=?`,
            [actorUserId,nextStatus,finalNote||null,cleaningCount,damagedCount,allocationId]);
        await appendMovement(db,scope,equipment.id,'inspected',receivedCount,ref,
            `Return condition finalized: ${goodCount} ready, ${cleaningCount} cleaning, ${damagedCount} damaged${finalNote?` - ${finalNote}`:''}`);
        if(damagedCount>0)await appendMovement(db,scope,equipment.id,'damage_reported',damagedCount,ref,
            `Damage held for Manager approval: ${finalNote}`);
        await settleReturnedRentalBooking(db,scope,ref);
    } else if(action==='clean_rental_allocation') {
        if(a.status!=='returned'||a.inspectionStatus!=='cleaning')fail(409,'No cleaning task is pending for this booking.');
        const cleaningCount=a.cleaningUnits==null||Number(a.cleaningUnits)===0?qty:Number(a.cleaningUnits);
        const damagedCount=a.damagedUnits==null?0:Number(a.damagedUnits);
        if(!Number.isSafeInteger(cleaningCount)||cleaningCount<1||hold<cleaningCount)
            fail(409,'Cleaning hold quantity needs reconciliation.');
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{maintenance:-cleaningCount});
        await db.execute(`UPDATE booking_items SET item_status=?,used_quantity=0 WHERE id=?`,
            [damagedCount>0?'damaged':'cleared',allocationId]);
        await appendMovement(db,scope,equipment.id,'cleaned',cleaningCount,ref,note||'Cleaning completed');
        await settleReturnedRentalBooking(db,scope,ref);
    } else fail(400,'Unsupported staff rental action.');
    return {referenceNumber:ref,allocationId};
}

async function staffRentalStockMutation(db,scope,body) {
    const action=String(body.action||"");
    if(action==="staff_receive_rental_purchase") {
        // Staff receiving tasks are not part of stocknbook_v2.
        id(body.taskId,"Purchase receiving task");
        fail(410,"Staff receiving tasks are no longer available. Ask the Manager to record the delivery with Restock.");
    }
    const actorUserId=await v2UserId(db,scope.storeId,scope.actorId);
    if(action==="staff_report_equipment_issue") {
        const equipment=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
        const quantity=whole(body.quantity,"Affected units",true);
        const free=Number(equipment.total_units)-Number(equipment.rented_out_units)-
            Number(equipment.maintenance_units)-Number(equipment.missing_units);
        if(quantity>free)fail(409,`Only ${Math.max(0,free)} units can be held for inspection.`);
        const reason=requiredText(body.reason,500,"Issue description");
        if(reason.length<5)fail(400,"Describe the issue in at least 5 characters.");
        const issueType=String(body.issueType||"damage");
        if(!["routine","damage","missing"].includes(issueType))
            fail(400,"Choose routine care, damaged, or missing equipment.");
        if(issueType==="missing"){
            const [r]=await db.execute(`INSERT INTO stock_issues
                                        (store_id,branch_id,branch_inventory_id,issue_type,quantity,reason,status,reported_by)
                                        VALUES(?,?,?,'missing',?,?,'pending',?)`,[scope.storeId,scope.branchId,equipment.inventory_id,quantity,reason,actorUserId]);
            await v2AdjustEquipmentStock(db,equipment.inventory_id,{missing:quantity});
            const ref=`MISS-${String(r.insertId).padStart(6,"0")}`;
            await appendMovement(db,scope,equipment.id,"missing_reported",quantity,ref,`Staff reported missing units: ${reason}`);
            return {referenceNumber:ref};
        }
        const [r]=await db.execute(`INSERT INTO stock_issues
                                    (store_id,branch_id,branch_inventory_id,issue_type,quantity,reason,status,reported_by)
                                    VALUES(?,?,?,'maintenance',?,?,?,?)`,[scope.storeId,scope.branchId,equipment.inventory_id,quantity,reason,
            issueType === "routine" ? "Routine" : "For Inspection",actorUserId]);
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{maintenance:quantity});
        const ref=`MNT-${String(r.insertId).padStart(6,"0")}`;
        await appendMovement(db,scope,equipment.id,"maintenance_started",quantity,ref,
            `${issueType === "routine" ? "Staff routine care" : "Staff reported damage"}: ${reason}`);
        return {referenceNumber:ref};
    }
    if(action==="staff_complete_routine_maintenance") {
        const maintenanceId=id(body.maintenanceId,"Routine maintenance record");
        const [identity]=await db.execute(`SELECT m.equipment_id FROM ${V2_MAINTENANCE_RECORDS} m
                                           WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Routine maintenance task not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[maintenanceId]);
        const [records]=await db.execute(`SELECT m.quantity_remaining,m.condition_status,m.repair_approved_at,m.booking_reference
                                          FROM ${V2_MAINTENANCE_RECORDS} m WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,
            [maintenanceId,scope.storeId,scope.branchId]);
        const record=records[0];
        if(!record || record.condition_status!=="Routine" || record.repair_approved_at)
            fail(403,"Only routine cleaning and non-safety upkeep can be completed without Manager approval.");
        const qty=whole(body.quantity,"Completed routine-care units",true);
        if(qty>Number(record.quantity_remaining)||qty>Number(equipment.maintenance_units))
            fail(409,"The routine-care quantity is no longer available. Refresh this task.");
        const notes=requiredText(body.notes,500,"Routine-care completion notes");
        if(notes.length<5)fail(400,"Describe the completed work in at least 5 characters.");
        const [pending]=await db.execute(`SELECT COUNT(*) AS count FROM ${V2_COMPLETION_REQUESTS} q
                                          WHERE q.maintenance_record_id=? AND q.status='pending'`,[maintenanceId]);
        if(Number(pending[0].count)>0)fail(409,"This maintenance record has a pending approval request.");
        await db.execute(`UPDATE stock_issues SET quantity_resolved=quantity_resolved+?,
                                                  resolution_notes=?,resolved_at=CASE WHEN quantity-quantity_resolved=0 THEN NOW() ELSE resolved_at END,
                                                  resolved_by=CASE WHEN quantity-quantity_resolved=0 THEN ? ELSE resolved_by END
                          WHERE id=?`,[qty,notes,actorUserId,maintenanceId]);
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{maintenance:-qty});
        const referenceNumber=`MNT-${String(maintenanceId).padStart(6,"0")}`;
        await appendMovement(db,scope,equipment.id,"maintenance_completed",qty,referenceNumber,
            `Staff completed routine cleaning/upkeep: ${notes}`);
        if(record.booking_reference)await settleReturnedRentalBooking(db,scope,record.booking_reference);
        return {referenceNumber};
    }
    // Staff confirms actual repair and safe reuse directly. This is stock handling,
    // NOT a decision about customer liability, write-offs, or repair purchases.
    if(action==="staff_mark_repaired_ready") {
        const maintenanceId=id(body.maintenanceId,"Maintenance record");
        const [identity]=await db.execute(`SELECT m.equipment_id FROM ${V2_MAINTENANCE_RECORDS} m
                                           WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,
            [maintenanceId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Maintenance record not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[maintenanceId]);
        const [records]=await db.execute(`SELECT m.quantity_remaining,m.condition_status,m.booking_reference
                                          FROM ${V2_MAINTENANCE_RECORDS} m WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,
            [maintenanceId,scope.storeId,scope.branchId]);
        const record=records[0];
        if(!record || record.condition_status==='Routine')
            fail(409,"Use routine care for cleaning tasks; this action is only for repaired equipment.");
        const quantity=whole(body.quantity,"Repaired quantity",true);
        if(quantity>Number(record.quantity_remaining)||quantity>Number(equipment.maintenance_units))
            fail(409,"Repaired units exceed the current maintenance hold. Refresh the task.");
        if(body.safetyChecked!==true)fail(400,"Confirm the repaired units have been inspected and are safe to rent.");
        const notes=requiredText(body.notes,500,"Repair and safety-check notes");
        if(notes.length<10)fail(400,"Describe the actual repair and safety check (at least 10 characters).");
        const [pending]=await db.execute(`SELECT q.id,q.quantity FROM ${V2_COMPLETION_REQUESTS} q
                                          WHERE q.maintenance_record_id=? AND q.store_id=? AND q.branch_id=? AND q.status='pending'`,
            [maintenanceId,scope.storeId,scope.branchId]);
        const requestedUnits=pending.reduce((sum,r)=>sum+Number(r.quantity),0);
        if(requestedUnits>quantity)
            fail(409,`An earlier completion request covers ${requestedUnits} units. Confirm at least that many repaired units to reconcile it.`);
        for(const request of pending){
            // Do not leave old approval requests active after the same units have been released.
            await db.execute(`UPDATE stock_issues
                              SET status='completed_by_staff',resolved_by=?,resolved_at=NOW()
                              WHERE id=? AND status='pending'`,
                [actorUserId,request.id]);
        }
        await db.execute(`UPDATE stock_issues SET quantity_resolved=quantity_resolved+?,
                                                  resolution_notes=?,resolved_at=CASE WHEN quantity-quantity_resolved=0 THEN NOW() ELSE resolved_at END,
                                                  resolved_by=CASE WHEN quantity-quantity_resolved=0 THEN ? ELSE resolved_by END
                          WHERE id=?`,[quantity,notes,actorUserId,maintenanceId]);
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{maintenance:-quantity});
        const ref=`MNT-${String(maintenanceId).padStart(6,'0')}`;
        await appendMovement(db,scope,equipment.id,'maintenance_completed',quantity,ref,
            `Staff verified repairs and safe reuse: ${notes}`);
        return {referenceNumber:ref,bookingReference:record.booking_reference||null};
    }
    // Record partial or complete physical recovery against the ORIGINAL missing report.
    if(action==="staff_mark_missing_recovered" || action==="staff_mark_missing_replaced") {
        const reportId=id(body.reportId,"Missing report");
        const [identity]=await db.execute(`SELECT r.equipment_id FROM ${V2_MISSING_REPORTS} r
                                           WHERE r.id=? AND r.store_id=? AND r.branch_id=?`,
            [reportId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Missing report not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[reportId]);
        const [reports]=await db.execute(`SELECT r.* FROM ${V2_MISSING_REPORTS} r
                                          WHERE r.id=? AND r.store_id=? AND r.branch_id=?`,
            [reportId,scope.storeId,scope.branchId]);
        const report=reports[0];
        if(!report || report.status!=='pending')fail(409,"This missing-item report is already resolved.");
        const ref=`MISS-${String(reportId).padStart(6,'0')}`;
        const remaining=Number(report.quantity)-Number(report.recovered);
        const replacement=action==="staff_mark_missing_replaced";
        const quantity=whole(body.quantity,replacement?"Replacement quantity":"Recovered quantity",true);
        const damagedUnits=replacement?0:whole(body.damagedUnits??0,"Recovered damaged units");
        if(remaining<=0||quantity>remaining||quantity>Number(equipment.missing_units))
            fail(409,"Quantity exceeds unresolved missing units. Refresh the task.");
        if(damagedUnits>quantity)fail(400,"Damaged recovered units cannot exceed recovered quantity.");
        if(body.conditionChecked!==true)
            fail(400,replacement
                ? "Confirm replacement equipment is physically received, inspected, and safe to rent."
                : "Confirm that recovered equipment was physically counted and inspected, and usable units were cleaned.");
        if(replacement && body.replacementNotPreviouslyReceived!==true)
            fail(400,"Confirm that replacement units have not already been counted through Restock or another receipt.");
        const notes=requiredText(body.notes,500,replacement?"Replacement source and condition notes":"Recovery and condition notes");
        if(notes.length<10)fail(400,replacement
            ? "Describe where the physical replacements came from and their verified condition (at least 10 characters)."
            : "Describe where the equipment was found and its inspected condition (at least 10 characters).");
        await v2AdjustEquipmentStock(db,equipment.inventory_id,{missing:-quantity,maintenance:damagedUnits});
        await db.execute(`UPDATE stock_issues SET quantity_resolved=quantity_resolved+? WHERE id=?`,[quantity,reportId]);
        if(damagedUnits>0){
            const reason=`Recovered damaged missing equipment (report #${reportId}): ${notes}`.slice(0,500);
            const [r]=await db.execute(`INSERT INTO stock_issues
                                        (store_id,branch_id,branch_inventory_id,booking_id,issue_type,quantity,
                                         reason,status,reported_by)
                                        VALUES(?,?,?,?,'maintenance',?,?,'For Inspection',?)`,[scope.storeId,scope.branchId,equipment.inventory_id,
                report.booking_id||null,damagedUnits,reason,actorUserId]);
            await appendMovement(db,scope,equipment.id,'maintenance_started',damagedUnits,
                `MNT-${String(r.insertId).padStart(6,'0')}`,reason);
        }
        await appendMovement(db,scope,equipment.id,replacement?'missing_replaced':'missing_resolved',quantity,ref,
            replacement
                ? `Staff physically verified ${quantity} replacement unit(s) not previously included in receipts. Original missing unit(s) retired; net total fleet units unchanged. ${notes}`.slice(0,500)
                : `Staff recovered and checked ${quantity} unit(s); ${quantity-damagedUnits} ready, ${damagedUnits} damaged on hold. ${notes}`);
        if(quantity===remaining){
            await db.execute(`UPDATE stock_issues
                              SET status=?,resolved_by=?,resolved_at=NOW(),resolution_notes=?
                              WHERE id=? AND store_id=? AND branch_id=?`,
                [replacement?'replaced':'found',actorUserId,notes,reportId,scope.storeId,scope.branchId]);
        }
        return {referenceNumber:ref,bookingReference:report.booking_reference||null};
    }
    if(action==="staff_submit_repair_completion") {
        const maintenanceId=id(body.maintenanceId,"Maintenance record");
        const [identity]=await db.execute(`SELECT m.equipment_id FROM ${V2_MAINTENANCE_RECORDS} m
                                           WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Maintenance record not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        await db.execute("SELECT id FROM stock_issues WHERE id=? FOR UPDATE",[maintenanceId]);
        const [records]=await db.execute(`SELECT m.quantity_remaining,m.repair_approved_at,m.condition_status FROM ${V2_MAINTENANCE_RECORDS} m
                                          WHERE m.id=? AND m.store_id=? AND m.branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
        if(records[0]?.condition_status === "Routine")
            fail(409,"Use the routine-care completion action for this task.");
        if(!records[0]?.repair_approved_at)fail(409,"Manager repair approval is required before completion.");
        const quantity=whole(body.quantity,"Completed units",true);
        const [pending]=await db.execute(`SELECT COALESCE(SUM(q.quantity),0) AS total FROM ${V2_COMPLETION_REQUESTS} q
                                          WHERE q.maintenance_record_id=? AND q.status='pending'`,[maintenanceId]);
        if(Number(pending[0].total)>0)fail(409,"A repair completion request is already awaiting Manager review.");
        if(quantity>Number(records[0].quantity_remaining))
            fail(409,"Completed quantity exceeds the remaining maintenance units.");
        const notes=requiredText(body.notes,500,"Repair completion notes");
        if(notes.length<5)fail(400,"Enter at least five characters describing the completed work.");
        const [r]=await db.execute(`INSERT INTO stock_issues
                                    (store_id,branch_id,branch_inventory_id,issue_type,quantity,reason,status,reported_by)
                                    VALUES(?,?,?,'repair_completion',?,?,'pending',?)`,
            [scope.storeId,scope.branchId,equipment.inventory_id,quantity,`MNT#${maintenanceId}: ${notes}`,actorUserId]);
        return {referenceNumber:`MNT-${String(maintenanceId).padStart(6,"0")}`,requestId:r.insertId};
    }
    fail(400,"Unsupported staff stock action.");
}

// The current database permission is authoritative. A valid JWT alone cannot
// restore access after an employee is deactivated or made view-only.
function rentalInventoryPermission(permissions, role) {
    let selected = permissions;
    if (typeof selected === "string") {
        try { selected = JSON.parse(selected); } catch { selected = {}; }
    }
    if (!selected || typeof selected !== "object" || Array.isArray(selected)) selected = {};
    const value = selected.inventory_access !== undefined ? selected.inventory_access : selected.inventory;
    // Older Manager records without an Inventory key retain their original
    // full-access default; an explicit denial always takes priority.
    if (value === undefined || value === null) return role === "manager" ? "full" : "none";
    if (value === true || value === 1 || value === "true" || value === "full") return "full";
    if (["view", "view_only", "viewOnly"].includes(value)) return "view";
    return "none";
}

// Completed write responses by request key (see the handler).
const RENTAL_REQUEST_CACHE = new Map();

const READ_ACTIONS = new Set(["get_manager_inventory","check_availability","get_rental_supplier_payables","get_rental_purchase_items","get_owner_supplier_payables"]);
const STAFF_READ_ACTIONS = new Set(["get_staff_rental_workspace","get_staff_equipment_schedule","get_staff_equipment_calendar"]);
const STAFF_WRITE_ACTIONS = new Set(["prepare_rental_allocation","release_rental_allocation",
    "return_rental_allocation","inspect_rental_allocation","clean_rental_allocation",
    "release_rental_booking","return_rental_booking",
    "staff_receive_rental_purchase","staff_report_equipment_issue",
    "staff_complete_routine_maintenance","staff_mark_repaired_ready","staff_mark_missing_recovered","staff_mark_missing_replaced"]);
const WRITE_ACTIONS = new Set(["create_equipment","import_equipment","update_equipment","correct_equipment_stock","receive_equipment",
    "approve_maintenance_repair","approve_repair_completion","resolve_missing_equipment","archive_equipment",
    "create_rental_category","rename_rental_category",
    "delete_rental_category","pay_rental_supplier_purchase"]);

exports.handler = async (event) => {
    if((event?.requestContext?.http?.method||event?.httpMethod)==="OPTIONS")return reply(204,{});
    if((event?.requestContext?.http?.method||event?.httpMethod||"POST")!=="POST")return reply(405,{error:"Use POST."});
    let db;
    let transactionOpen = false;
    try {
        const auth = event?.headers?.authorization||event?.headers?.Authorization||"";
        const match = /^Bearer\s+(.+)$/i.exec(auth);
        if (!match)fail(401,"Missing access token.");
        let session;
        try { session=jwt.verify(match[1],JWT_SECRET,{ algorithms:["HS256"] }); }
        catch {fail(401,"Invalid or expired session.");}
        const storeId=id(session.store_id,"Store ID");
        const role=String(session.role||"").toLowerCase();
        if(!["manager","owner","staff"].includes(role))fail(403,"Rental inventory role is not authorized.");
        let body;
        try { body = JSON.parse(event?.body || "{}"); }
        catch { fail(400, "Invalid JSON request body."); }
        if(!body||typeof body!=="object"||Array.isArray(body))fail(400,"Invalid request body.");
        const action=String(body.action||"");
        if(!READ_ACTIONS.has(action)&&!WRITE_ACTIONS.has(action)&&!STAFF_READ_ACTIONS.has(action)&&!STAFF_WRITE_ACTIONS.has(action))fail(400,"Unknown rental inventory action.");
        if(role==="staff"&&!STAFF_READ_ACTIONS.has(action)&&!STAFF_WRITE_ACTIONS.has(action))fail(403,"Staff cannot access rental catalog, supplier, or purchasing operations.");
        if(role!=="staff"&&(STAFF_READ_ACTIONS.has(action)||STAFF_WRITE_ACTIONS.has(action)))
            fail(403,"Only Staff can perform daily rental operations.");
        // Owners retain financial oversight. Catalog changes and physical repair approvals belong to managers.
        if(role==="owner" && !READ_ACTIONS.has(action) && !["pay_rental_supplier_purchase"].includes(action))
            fail(403,"Owner cannot perform branch equipment operations.");
        // Owner-wide rental supplier balances (read-only; no branch selection required).
        // Separate from the regular Sales Inventory supplier ledger.
        if(action==="get_owner_supplier_payables") {
            if(role!=="owner")fail(403,"Only the Owner may view all branch rental supplier balances.");
            // Supplier purchases and payables are not part of stocknbook_v2.
            return reply(200,{success:true,payables:[]});
        }
        // Resolve the manager's assigned branch from the verified manager record,
        // not from the browser's branch_id. Owner must select a store-owned branch.
        let branchId = role==="owner" ? id(body.branch_id||body.branchId,"Branch ID") : null;
        let actor=trim(session.email,150)||role;
        let actorId=null;
        db = await dbPool.getConnection();
        if(role==="manager") {
            const managerId=id(session.manager_id,"Manager ID");
            const [managers]=await db.execute(`SELECT branch_id AS branchId,full_name AS managerName,status,permissions
                                               FROM users WHERE id=? AND store_id=? AND role='manager' LIMIT 1`,[managerId,storeId]);
            if(!managers.length || !['active','accepted'].includes(String(managers[0].status).toLowerCase()))
                fail(403,"An active Manager account is required.");
            branchId=id(managers[0].branchId,"Assigned branch");
            // A moved employee must sign in again; never authorize using a stale branch claim.
            if(Number(session.branch_id)!==branchId)fail(403,"Branch assignment changed. Please sign in again.");
            const access=rentalInventoryPermission(managers[0].permissions,"manager");
            if(access==="none")fail(403,"Inventory access is not assigned to this Manager.");
            if(WRITE_ACTIONS.has(action) && access!=="full")fail(403,"Full Inventory access is required to change equipment or supplier records.");
            actor=trim(managers[0].managerName,150)||actor;
            actorId=managerId;
        }
        if(role==="staff") {
            const staffId=id(session.staff_id,"Staff ID");
            const [staff]=await db.execute(`SELECT branch_id,full_name AS staff_name,status,permissions FROM users
                                            WHERE id=? AND store_id=? AND role='staff' LIMIT 1`,[staffId,storeId]);
            if(!staff.length||!['active','accepted'].includes(String(staff[0].status).toLowerCase()))
                fail(403,"Active staff account required.");
            branchId=id(staff[0].branch_id,"Assigned branch");
            if(Number(session.branch_id)!==branchId)fail(403,"Branch assignment changed. Please sign in again.");
            const access=rentalInventoryPermission(staff[0].permissions,"staff");
            if(access==="none")fail(403,"Inventory access is not assigned to this Staff account.");
            if(STAFF_WRITE_ACTIONS.has(action) && access!=="full")
                fail(403,"Full Inventory access is required for rental receiving, releases, returns and condition tasks.");
            actor=trim(staff[0].staff_name,150)||actor;
            actorId=staffId;
        }
        if(role==="owner") {
            const [owners]=await db.execute(`SELECT id,full_name FROM users WHERE store_id=? AND role='owner' ORDER BY id LIMIT 1`,[storeId]);
            if(owners.length){actorId=Number(owners[0].id);actor=trim(owners[0].full_name,150)||actor;}
        }
        const scope={storeId,branchId,actor,actorId,role,requestKey:""};
        const [branches]=await db.execute(`SELECT b.id,s.store_name AS storeName,b.branch_name AS branchName,
                                                  s.store_code AS storeCode,b.branch_code AS branchCode
                                           FROM branches b JOIN stores s ON s.id=b.store_id
                                           WHERE b.id=? AND b.store_id=? LIMIT 1`,[branchId,storeId]);
        if(!branches.length)fail(403,"Invalid branch or store association.");
        scope.storeName=branches[0].storeName;
        scope.branchName=branches[0].branchName;
        if(action==="get_staff_rental_workspace")return reply(200,await staffRentalWorkspace(db,scope));
        if(action==="get_staff_equipment_schedule")return reply(200,await staffEquipmentSchedule(db,scope,body));
        if(action==="get_staff_equipment_calendar")return reply(200,await staffEquipmentCalendar(db,scope,body));
        if(action==="get_manager_inventory")return reply(200,await getInventory(db,scope));
        if(action==="check_availability")return reply(200,await checkAvailability(db,scope,body));
        if(action==="get_rental_supplier_payables")return reply(200,await getPayables(db,scope));
        if(action==="get_rental_purchase_items")return reply(200,await getPurchaseItems(db,scope,body));
        const requestKey=requiredText(body.requestKey,90,"Request key");
        scope.requestKey=requestKey;
        if(!(await identifiers.ensureIdentifierSchema(db)))
            fail(503,"Equipment numbering is not set up. Run scripts/standardize-identifiers.js.");
        await db.beginTransaction();
        transactionOpen = true;
        await lockBranch(db,scope);
        // One idempotency key per rental write action. stocknbook_v2 has no
        // request table, so completed responses are remembered by this Lambda
        // instance; the branch lock above serializes concurrent requests.
        const requestCacheKey=`${storeId}:${branchId}:${requestKey}`;
        const cached=RENTAL_REQUEST_CACHE.get(requestCacheKey);
        if(cached){
            if(cached.action!==action)fail(409,"This request key belongs to a different action.");
            await db.commit();
            transactionOpen = false;
            return reply(200,cached.output);
        }
        const result=STAFF_WRITE_ACTIONS.has(action)
            ? (["staff_receive_rental_purchase","staff_report_equipment_issue",
                "staff_complete_routine_maintenance","staff_mark_repaired_ready","staff_mark_missing_recovered","staff_mark_missing_replaced"].includes(action)
                ? await staffRentalStockMutation(db,scope,body)
                : ['release_rental_booking','return_rental_booking'].includes(action)
                    ? await staffRentalBookingMutation(db,scope,body)
                    : await staffRentalMutation(db,scope,body))
            : await mutate(db,scope,body);
        const output={success:true,...result};
        await db.commit();
        transactionOpen = false;
        RENTAL_REQUEST_CACHE.set(requestCacheKey,{action,output});
        if(RENTAL_REQUEST_CACHE.size>2000)RENTAL_REQUEST_CACHE.delete(RENTAL_REQUEST_CACHE.keys().next().value);
        // Missing-item resolution can be the LAST outstanding condition after
        // the customer has already paid. Recheck in a fresh transaction so
        // the physical equipment locks are released before locking bookings,
        // avoiding the opposite lock order used by Staff booking workflows.
        // A successful Inventory resolution must not be rolled back or falsely
        // reported as failed if this follow-up status sync cannot run.
        if(["resolve_missing_equipment","staff_mark_missing_recovered","staff_mark_missing_replaced","staff_mark_repaired_ready"].includes(action) && result.bookingReference){
            try {
                await db.beginTransaction();
                transactionOpen = true;
                await settleReturnedRentalBooking(db,scope,result.bookingReference);
                await db.commit();
                transactionOpen = false;
            } catch(syncError) {
                try { await db.rollback(); transactionOpen = false; }
                catch { db.destroy(); db = null; transactionOpen = false; }
                console.error("Unable to recheck booking completion after missing-item resolution:",syncError);
            }
        }
        return reply(action==="create_equipment"||action==="import_equipment"?201:200,output);
    } catch(err) {
        // A pooled connection must never be returned with an open transaction.
        if(db && transactionOpen) {
            try { await db.rollback(); }
            catch { db.destroy(); db = null; }
        }
        // Never expose internal SQL or connection errors to the caller.
        if(!err?.statusCode)console.error("Rental inventory backend:",err);
        const duplicate=err?.code==="ER_DUP_ENTRY";
        const status=err?.statusCode|| (duplicate?409:500);
        return reply(status,{success:false,error:err?.statusCode?err.message:
                duplicate?"A rental record with that name, number, or request key already exists.":"Unable to process rental request. Check server logs."});
    } finally { if(db)db.release(); }
};