const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Account phone numbers use the same 11-digit Philippine mobile format in every role.
// Accept spaces/dashes and the international +63 prefix; save 09XXXXXXXXX in users.phone.
function normalizePhilippineMobile(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    const local = digits.startsWith("63")
        ? `0${digits.slice(2)}`
        : (digits.length === 10 && digits.startsWith("9") ? `0${digits}` : digits);
    return /^09\d{9}$/.test(local) ? local : null;
}
// A personal mobile number may be used for separate businesses by accounts
// with the SAME full name; different names cannot claim an existing number.
// Within one business, a personal number still belongs to a single account.
// Email uniqueness is checked separately. Branch contact numbers are separate.
// This compares recorded names, not verified legal identities or phone ownership.
function normalizedAccountName(value) {
    return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
async function accountPhoneConflict(connection, phone, fullName, storeId = null, excludeUserId = null) {
    const normalized = normalizePhilippineMobile(phone);
    if (!normalized) return null;
    const [rows] = await connection.execute(
        `SELECT id, store_id, full_name FROM users
         WHERE phone IS NOT NULL AND phone <> ''
           AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), 10) = ?
           AND (? IS NULL OR id <> ?)`,
        [normalized.slice(-10), excludeUserId, excludeUserId]
    );
    const requestedName = normalizedAccountName(fullName);
    // Check ALL matches, not only the first; the number could already appear
    // in more than one business belonging to the same person.
    if (rows.some(row => normalizedAccountName(row.full_name) !== requestedName)) {
        return {
            code: "PHONE_NAME_MISMATCH",
            error: "This mobile number is registered under a different name.",
        };
    }
    if (storeId != null && rows.some(row => String(row.store_id) === String(storeId))) {
        return {
            code: "PHONE_ALREADY_REGISTERED",
            error: "This mobile number is already registered for this business.",
        };
    }
    return null;
}

// Store slugs are stable URL identifiers, not editable display names.
// Keep the existing duplicate business-name policy independent of the slug.
const DUPLICATE_BUSINESS_MESSAGE = "This business name is already registered. Please use a different business name.";
function cleanStoreName(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
async function businessNameAlreadyRegistered(connection, name, excludeStoreId = null) {
    const [rows] = await connection.execute(
        `SELECT id FROM stores
         WHERE TRIM(REGEXP_REPLACE(store_name, '[[:space:]]+', ' ')) = ?
           AND (? IS NULL OR id <> ?) LIMIT 1`,
        [name, excludeStoreId, excludeStoreId]
    );
    return rows.length > 0;
}

// Call under the store-slug allocation lock. The database UNIQUE key remains
// the final protection against duplicate slugs, including concurrent signups.
async function allocateUniqueStoreSlug(connection, name) {
    const base = (generateSlug(name).slice(0, 120).replace(/-+$/, "") || "store");
    for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = attempt === 0 ? base : `${base}-${crypto.randomBytes(6).toString("hex")}`;
        const [rows] = await connection.execute("SELECT id FROM stores WHERE slug = ? LIMIT 1", [candidate]);
        if (!rows.length) return candidate;
    }
    throw securityError(503, "Unable to create a unique booking link. Please try again.", "STORE_SLUG_BUSY");
}

function normalizedBranchLabel(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function normalizedBranchPhone(value) {
    // Branch contacts use the existing stored format. The last ten digits
    // identify the same PH mobile number whether written as 09... or +639...
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
}
async function findStoreBranchConflict(connection, storeId, name, contact, excludeBranchId = null) {
    const [rows] = await connection.execute(
        `SELECT id, branch_name, phone FROM branches
         WHERE store_id = ? AND (? IS NULL OR id <> ?)`,
        [storeId, excludeBranchId, excludeBranchId]
    );
    const nameKey = normalizedBranchLabel(name);
    const phoneKey = normalizedBranchPhone(contact);
    if (nameKey && rows.some(row => normalizedBranchLabel(row.branch_name) === nameKey)) {
        return { code: 'BRANCH_NAME_EXISTS', error: 'This branch name is already used in your business.' };
    }
    if (phoneKey && rows.some(row => normalizedBranchPhone(row.phone) === phoneKey)) {
        return { code: 'BRANCH_PHONE_EXISTS', error: 'This branch contact number is already used by another branch in your business.' };
    }
    return null;
}

// ===== BEGIN StockNBook identification numbers (identical in lambda-auth, lambda-pos, lambda-products, lambda-rental-inventory) =====
const identifiers = (() => {
    /*
     * StockNBook standardized identification numbers.
     *
     *   Order      STORE-BRANCH-MMDDYY-XXXX   e.g. SPS-B4-110326-0001
     *   Product    STORE-BRANCH-PRD-XXXX      e.g. SPS-B4-PRD-0001  (one per product type)
     *   Equipment  STORE-BRANCH-EQP-XXXX      e.g. SPS-B4-EQP-0001  (one per physical rental unit)
     *   Employee   STORE_ID-BRANCH_ID-MN/SF-XXXX  e.g. 6-12-MN-0001 / 6-12-SF-0001
     *
     * Other Lambdas retain the existing order/product/equipment numbering.
     * Employee IDs are issued only by lambda-auth and have separate MN/SF sequences.
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
        employee: /^(\d+)-(\d+)-(MN|SF)-(\d{4,})$/,
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
    function buildEmployeeCode(storeId, branchId, roleCode, sequence) {
        if (![storeId, branchId].every((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
            throw new Error("A valid store number and branch number are required for Employee IDs.");
        }
        if (roleCode !== "MN" && roleCode !== "SF") {
            throw new Error("Employee ID role must be MN (manager) or SF (staff).");
        }
        return `${Number(storeId)}-${Number(branchId)}-${roleCode}-${formatSequence(sequence)}`;
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

    // Manager and staff Employee IDs are permanent and independently sequential per branch.
    // The store/branch numbers are the existing immutable database primary keys.
    async function generateEmployeeCode(connection, { storeId, branchId, roleCode }) {
        if (roleCode !== "MN" && roleCode !== "SF") {
            throw new Error("Employee ID role must be MN (manager) or SF (staff).");
        }
        await lockBranch(connection, storeId, branchId);
        const prefix = `${Number(storeId)}-${Number(branchId)}-${roleCode}-`;
        const floor = await maxSequenceFrom(connection,
            `SELECT employee_code AS value FROM users
             WHERE store_id = ? AND employee_code LIKE ?`,
            [storeId, `${prefix}%`], PATTERNS.employee);
        const { last } = await reserveSequenceBlock(connection, { storeId, branchId, floor });
        return buildEmployeeCode(storeId, branchId, roleCode, last);
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
const tls = require("tls");
const fs = require("fs");

/*
 * Shared subscription entitlement checks.
 *
 * Subscription management belongs to the store owner, but plan limits are
 * enforced at the API boundary so managers/staff (and public booking pages)
 * cannot bypass the active store plan.
 */

function normalizeLimit(value) {
    if (value === null || value === undefined || Number(value) === 0) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
// Paid subscriptions remain usable through their displayed expiration date.
// On the following day an unrenewed Growth/Scale subscription is reverted to
// the active Starter plan (revertExpiredPaidSubscriptionToStarter), so paid
// features can never outlive expires_at, even when the scheduled job has not
// run yet. The previous 48-hour pending-review grace period is intentionally
// no longer applied: a renewal submitted before expiry still becomes effective
// when the Platform Administrator approves it. No records are deleted.
async function getActivePlan(connection, storeId) {
    await processDueSubscriptionPlanChange(connection, Number(storeId));
    await revertExpiredPaidSubscriptionToStarter(connection, Number(storeId));
    const [rows] = await connection.execute(
        `SELECT p.id, p.plan_name AS name, p.price, p.max_inventory, p.max_bookings,
                p.max_staff, p.max_branches, p.has_low_stock_alerts,
                p.has_analytics, p.has_forecasting, p.has_multi_store,
                s.expires_at, s.status,
                CASE WHEN s.expires_at IS NOT NULL AND DATE(s.expires_at) < CURDATE()
             THEN 1 ELSE 0 END AS is_past_expiry
         FROM subscriptions s INNER JOIN plans p ON p.id = s.plan_id
         WHERE s.store_id = ? AND LOWER(s.status) IN ('active','expiring')
         ORDER BY s.id DESC LIMIT 1`, [Number(storeId)]
    );
    const paid = rows[0] || null;
    const normalized = (plan, accessStatus) => ({
        id: Number(plan.id), name: String(plan.name || 'Starter'),
        price: Number(plan.price || 0),
        max_inventory: normalizeLimit(plan.max_inventory),
        max_bookings: normalizeLimit(plan.max_bookings),
        max_staff: normalizeLimit(plan.max_staff),
        max_branches: normalizeLimit(plan.max_branches),
        has_low_stock_alerts: Boolean(plan.has_low_stock_alerts),
        has_analytics: Boolean(plan.has_analytics),
        has_forecasting: Boolean(plan.has_forecasting),
        has_multi_store: Boolean(plan.has_multi_store),
        access_status: accessStatus,
    });
    if (paid && !Number(paid.is_past_expiry)) {
        return normalized(paid, 'PAID');
    }
    // A paid row past expires_at is never returned as an entitlement. The
    // revert above normally converts it to Starter; this fallback also covers
    // cancelled subscriptions and stores without a subscription record.
    const [starterRows] = await connection.execute(
        `SELECT id, plan_name AS name, price, max_inventory, max_bookings, max_staff,
                max_branches, has_low_stock_alerts, has_analytics,
                has_forecasting, has_multi_store
         FROM plans WHERE is_archived = 0 AND (LOWER(plan_code) = 'starter' OR LOWER(plan_name) = 'starter' OR price = 0)
         ORDER BY price ASC, id ASC LIMIT 1`
    );
    if (!starterRows.length) return null;
    return normalized(starterRows[0], 'STARTER_FALLBACK');
}

async function getStoreUsage(connection, storeId) {
    const [inventoryRows] = await connection.execute(
        `SELECT
             (SELECT COUNT(*) FROM products WHERE store_id = ? AND deleted_at IS NULL) +
             (SELECT COUNT(*) FROM equipment WHERE store_id = ? AND deleted_at IS NULL) AS total`,
        [Number(storeId), Number(storeId)]
    );

    const [bookingRows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM bookings
         WHERE store_id = ? AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND created_at < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')`,
        [Number(storeId)]
    );

    const [staffRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE store_id = ?
           AND role = 'staff'
           AND status IN ('active', 'pending')`,
        [Number(storeId)]
    );

    const [branchRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM branches
         WHERE store_id = ?
           AND COALESCE(status, 'active') <> 'deleted'`,
        [Number(storeId)]
    );

    return {
        inventory: Number(inventoryRows[0]?.total || 0),
        bookings: Number(bookingRows[0]?.total || 0),
        staff: Number(staffRows[0]?.total || 0),
        branches: Number(branchRows[0]?.total || 0),
    };
}

function makeLimitError(resource, plan, current, limit, increment = 1, role = "") {
    const labels = {
        inventory: "inventory items",
        bookings: "bookings",
        staff: "staff accounts",
        branches: "branches",
    };

    const label = labels[resource] || resource;
    const isOwner = role === "owner";
    const ownerAction = isOwner
        ? "Upgrade your plan to add more."
        : "Contact your account owner to upgrade.";

    const error = new Error(
        `Plan limit reached: your ${plan?.name || "current"} plan allows up to ${limit} ${label}. ${ownerAction}`
    );
    error.statusCode = 409;
    error.code = `${String(resource).toUpperCase()}_LIMIT_REACHED`;
    error.plan_name = plan?.name || "Current plan";
    error.resource = resource;
    error.current = current;
    error.limit = limit;
    error.requested = current + increment;
    return error;
}

async function assertPlanLimit(
    connection,
    storeId,
    resource,
    increment = 1,
    role = ""
) {
    const plan = await getActivePlan(connection, storeId);

    if (!plan) {
        const error = new Error("No active subscription plan is configured for this store.");
        error.statusCode = 500;
        error.code = "PLAN_NOT_CONFIGURED";
        throw error;
    }

    const usage = await getStoreUsage(connection, storeId);
    const current = Number(usage[resource] || 0);
    const limit = plan[`max_${resource}`];

    if (limit !== null && current + Number(increment) > limit) {
        throw makeLimitError(resource, plan, current, limit, Number(increment), role);
    }

    return { plan, usage, current, limit };
}

module.exports = {
    getActivePlan,
    getStoreUsage,
    assertPlanLimit,
};








// ===== ENV SECURITY CHANGE: Required JWT environment variable BEGIN =====
function requiredEnv(name) {
    const value = process.env[name];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const JWT_SECRET = requiredEnv("JWT_SECRET");
// ===== ENV SECURITY CHANGE: Required JWT environment variable END =====







const OTP_EXPIRY_SECONDS = 300;
// Explicit, local-only OTP delivery for test accounts (never enabled in production).
// Start Next.js with STOCKNBOOK_DEV_OTP_CONSOLE=true and NODE_ENV=development.
// Only OTP email delivery is replaced; OTP hashing, database expiry and verification stay intact.
const LOCAL_OTP_CONSOLE_ONLY =
    process.env.NODE_ENV === "development" &&
    String(process.env.STOCKNBOOK_DEV_OTP_CONSOLE || "").toLowerCase() === "true";

function deliverOtpToLocalTerminal(purpose, toEmail, otp, expirySeconds) {
    console.log(
        `[StockNBook LOCAL OTP] ${purpose} | ` +
        `Email: ${toEmail} | ` +
        `OTP: ${otp} | ` +
        `Expires in: ${expirySeconds}s | ` +
        `Delivery: IDE terminal only (no email sent)`
    );
    return { accepted: [], response: "LOCAL_OTP_CONSOLE_ONLY" };
}
const MANAGER_INVITE_OTP_EXPIRY_SECONDS = OTP_EXPIRY_SECONDS;
const STAFF_INVITE_OTP_EXPIRY_SECONDS = OTP_EXPIRY_SECONDS;
const PAYMENT_OTP_EXPIRY_SECONDS = 300;
// Separate limits for accepted OTP emails and failed email-delivery attempts.
const PAYMENT_OTP_MAX_SENT_PER_WINDOW = 5;
const PAYMENT_OTP_MAX_FAILED_PER_WINDOW = 3;
const PAYMENT_OTP_RATE_WINDOW_MINUTES = 10;

// Local subscription-payment OTP terminal fallback is explicit opt-in only.
// A normal `npm run dev` must not silently treat failed Gmail delivery as success.
// For isolated local debugging, explicitly set PAYMENT_OTP_TERMINAL_DEBUG=true.
// Never enable this flag in production: it prints private OTP codes to logs.
const PAYMENT_OTP_TERMINAL_DEBUG =
    String(process.env.PAYMENT_OTP_TERMINAL_DEBUG || "").toLowerCase() === "true" &&
    process.env.NODE_ENV === "development";

// Local invitation testing / recovery.
// Invitation links remain usable even when SMTP cannot deliver a demo email.
// In development, failed Manager/Staff invitations are also printed to the
// server terminal so activation can still be tested safely.
// ===== ENV SECURITY CHANGE BEGIN =====
const INVITATION_TERMINAL_DEBUG =
    process.env.NODE_ENV === "development" &&
    String(process.env.INVITATION_TERMINAL_DEBUG || "")
        .toLowerCase() === "true";
// ===== ENV SECURITY CHANGE END =====
const SMTP_NETWORK_ERROR_CODES = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
]);

function isSmtpNetworkError(error) {
    return SMTP_NETWORK_ERROR_CODES.has(String(error?.code || "").toUpperCase());
}

function logDevelopmentInvitationFallback({
                                              role,
                                              email,
                                              name,
                                              storeName,
                                              branchName,
                                              inviteLink,
                                              errorMessage,
                                          }) {
    if (!INVITATION_TERMINAL_DEBUG) return;

    console.warn(
        `[StockNBook DEV INVITE] ${role} invitation email was not delivered. ` +
        `Use the backup invitation link for local testing.`,
        {
            role,
            name: name || "",
            email: email || "",
            store: storeName || "",
            branch: branchName || "",
            invite_link: inviteLink || "",
            email_error: errorMessage || "",
        }
    );
}





// ===== ENV SECURITY CHANGE: Authentication Gmail credentials BEGIN =====
const SMTP_USER = (process.env.AUTH_SMTP_USER || "").trim();

// Use a Google App Password, not the regular Gmail password.
const SMTP_PASS = (process.env.AUTH_SMTP_PASS || "").replace(/\s/g, "");
// ===== ENV SECURITY CHANGE: Authentication Gmail credentials END =====




const EMAIL_FROM =
    `"StockNBook" <${SMTP_USER}>`;

const EMAIL_REPLY_TO = SMTP_USER;



// ===== ENV SECURITY CHANGE: SMTP server configuration BEGIN =====
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
// ===== ENV SECURITY CHANGE: SMTP server configuration END =====




const SMTP_TIMEOUT_MS = 20000;

const APP_BASE_URL =
    String(
        process.env.APP_BASE_URL ||
        process.env.APP_URL ||
        "http://localhost:3000"
    ).replace(/\/+$/, "");
function generateOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOtp(otp) {
    return crypto
        .createHmac("sha256", JWT_SECRET)
        .update("stocknbook:otp:" + String(otp))
        .digest("hex");
}

// Authentication controls use the existing account and OTP tables only.
const AUTH_INVALID = "Invalid email or password.";
const DUMMY_PASSWORD_HASH = "$2a$10$C6UzMDM.H6dfI/f/IKcEe.5A7Z2O1qsOPzs6swBN9Gh.LzZun5EMG";
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_SENDS = 3;
function securityEvent(event, fields = {}) {
    // Structured security events: no passwords, OTPs, JWTs, reset tokens or raw emails.
    const entry = JSON.stringify({ category: "authentication_security", event, timestamp: new Date().toISOString(), ...fields });
    if (fields.priority === "high" || fields.priority === "medium") console.warn(entry);
    else console.info(entry);
}
function securityError(statusCode, message, code, retryAfter) {
    const error = new Error(message);
    error.statusCode = statusCode; error.code = code;
    if (retryAfter) error.retry_after_seconds = retryAfter;
    return error;
}
// Keep this release in sync with components/legal/PolicyDialog.tsx.
// Each role has its own version identifier; draft records are not final legal acceptance.
const POLICY_RELEASE = "1.0-draft";
function requirePolicyAcceptance(body, role, branchId) {
    const version = `${POLICY_RELEASE}-${role}`;
    if (body.terms_reviewed !== true || body.privacy_reviewed !== true || body.policies_accepted !== true) {
        throw securityError(400, "Review both documents and agree to the Terms of Service and acknowledge the Privacy Policy before continuing.", "POLICY_ACCEPTANCE_REQUIRED");
    }
    if (body.terms_version !== version || body.privacy_version !== version) {
        throw securityError(400, "The policies have changed. Reopen the form and review the current documents.", "POLICY_VERSION_MISMATCH");
    }
    if (role !== "owner" && (branchId == null || body.policy_branch_id == null || String(body.policy_branch_id) !== String(branchId))) {
        throw securityError(400, "Your branch assignment has changed. Reopen the invitation and review the policies again.", "POLICY_BRANCH_MISMATCH");
    }
    return version;
}
function passwordPolicy(password) {
    return typeof password === "string" && Array.from(password).length >= 8 &&
        /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) &&
        /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(password) &&
        Buffer.byteLength(password, "utf8") <= 72;
}
const PASSWORD_POLICY_MESSAGE = "Use at least 8 characters, including uppercase and lowercase letters, a number, and a special character.";
function passwordPolicyError(password) {
    return typeof password === "string" && Buffer.byteLength(password, "utf8") > 72
        ? "Your password is too long. Please use a shorter password."
        : PASSWORD_POLICY_MESSAGE;
}
// Named locks serialize related operations across all instances on the same MySQL primary.
// The handler releases all acquired locks before returning its pooled connection.
const heldAuthLocks = new WeakMap();
async function authLock(connection, scope) {
    // Use the same collation as the unique users.email index, including case/accent equivalents.
    const [keys] = await connection.execute("SELECT SHA2(WEIGHT_STRING(CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci), 256) AS lock_key", ["stocknbook:auth:" + scope]);
    const key = keys[0].lock_key;
    let held = heldAuthLocks.get(connection);
    if (!held) { held = new Set(); heldAuthLocks.set(connection, held); }
    if (held.has(key)) return;
    const [rows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [key]);
    if (Number(rows[0]?.acquired) !== 1) throw securityError(503, "Authentication is busy. Please try again.", "AUTH_BUSY");
    held.add(key);
}
async function releaseAuthLocks(connection) {
    const held = heldAuthLocks.get(connection);
    if (!held) return true;
    heldAuthLocks.delete(connection);
    try {
        for (const key of held) {
            const [rows] = await connection.execute("SELECT RELEASE_LOCK(?) AS released", [key]);
            if (Number(rows[0]?.released) !== 1) return false;
        }
        return true;
    } catch { return false; }
}
function otpScope(purpose, email, storeId = null, inviteHash = null) {
    const normalized = String(email || "").trim().toLowerCase();
    const where = ["purpose = ?"], params = [purpose];
    if (storeId !== null) { where.push("store_id = ?"); params.push(storeId); }
    else { where.push("email = ?"); params.push(normalized); }
    if (inviteHash !== null) { where.push("invite_token_hash = ?"); params.push(inviteHash); }
    // Count requests by email/purpose across replaced invitations, not only per token.
    const rateParams = storeId !== null ? [purpose, storeId] : [purpose, normalized];
    return { purpose, where: where.join(" AND "), params, rateWhere: where.slice(0, 2).join(" AND "), rateParams,
        key: `${purpose}:${storeId !== null ? String(storeId) : normalized}` };
}
async function guardOtpSend(connection, scope) {
    await authLock(connection, scope.key);
    const [rows] = await connection.execute(
        `SELECT COUNT(*) AS total, COALESCE(SUM(attempt_count),0) AS failures,
                COALESCE(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), DATE_ADD(MAX(created_at), INTERVAL 60 SECOND)),0) AS cooldown,
                COALESCE(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), DATE_ADD(MIN(created_at), INTERVAL 15 MINUTE)),0) AS window_wait
         FROM otp_codes WHERE ${scope.rateWhere} AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) AND created_at <= UTC_TIMESTAMP()`, scope.rateParams);
    const state = rows[0];
    const wait = Number(state.total) >= OTP_MAX_SENDS || Number(state.failures) >= 15 ? Number(state.window_wait) : Number(state.cooldown);
    if (wait > 0) {
        securityEvent("otp_request_throttled", { purpose: scope.purpose, scope_id: crypto.createHash("sha256").update(scope.key).digest("hex") });
        throw securityError(429, `Please wait ${Math.max(1, wait)} seconds before requesting another code.`, "OTP_RESEND_LIMIT", Math.max(1, wait));
    }
}
async function checkOtp(connection, scope, code, consume = true) {
    await authLock(connection, scope.key);
    if (!/^\d{6}$/.test(String(code))) throw securityError(400, "Enter the complete 6-digit verification code.", "OTP_FORMAT");
    const [rows] = await connection.execute(
        `SELECT id, otp_hash, attempt_count, user_id, challenge_id, invalidated_at FROM otp_codes
         WHERE ${scope.where} AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
         ORDER BY id DESC LIMIT 1`, scope.params);
    const row = rows[0];
    const [totals] = await connection.execute(`SELECT COALESCE(SUM(attempt_count),0) AS total FROM otp_codes WHERE ${scope.rateWhere} AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) AND created_at <= UTC_TIMESTAMP()`, scope.rateParams);
    if (Number(totals[0].total) >= 15 || (row && Number(row.attempt_count) >= OTP_MAX_ATTEMPTS)) {
        securityEvent("otp_verification_blocked", { purpose: scope.purpose });
        throw securityError(429, "Too many incorrect codes. Request a new code when available.", "OTP_ATTEMPTS_EXHAUSTED");
    }
    if (!row || row.invalidated_at) throw securityError(400, "Invalid or expired verification code. Request a new code.", "OTP_INVALID");
    const expected = Buffer.from(String(row.otp_hash), "hex");
    const actual = Buffer.from(hashOtp(code), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        const count = Number(row.attempt_count) + 1;
        await connection.execute(`UPDATE otp_codes SET attempt_count = ?, invalidated_at = IF(? >= 5, UTC_TIMESTAMP(), invalidated_at) WHERE id = ?`, [count, count, row.id]);
        securityEvent("otp_verification_failed", { purpose: scope.purpose, otp_record_id: String(row.id), attempt_count: count });
        if (count >= OTP_MAX_ATTEMPTS) throw securityError(429, "Too many incorrect codes. Request a new code when available.", "OTP_ATTEMPTS_EXHAUSTED");
        const remaining = OTP_MAX_ATTEMPTS - count;
        throw securityError(400, `Invalid code. Try again. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} left.`, "OTP_INCORRECT");
    }
    if (consume) await connection.execute("UPDATE otp_codes SET used_at = UTC_TIMESTAMP(), verified_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
    securityEvent("otp_verification_succeeded", { purpose: scope.purpose, otp_record_id: String(row.id) });
    return row;
}
// Return the current lockout level for UI guidance, without imposing a mandatory reset.
function accountLockedError(account, table, lockoutCount, retryAfter) {
    const error = securityError(429, "Your account is temporarily locked.", "ACCOUNT_LOCKED", retryAfter);
    error.lockout_count = Math.max(1, Number(lockoutCount) || 1);
    // Only active, verified regular accounts have email-based recovery in recoveryAction.
    error.password_recovery_available = table === "users" &&
        String(account.status).trim().toLowerCase() === "active" &&
        Boolean(account.email_verified_at && account.password_hash);
    return error;
}
async function authenticateAccount(connection, table, email, password) {
    if (!["users", "platform_admins"].includes(table)) throw new Error("Invalid account table");
    const normalized = String(email || "").trim().toLowerCase();
    await authLock(connection, `account:${normalized}`);
    // A single connection-scoped lock protects counter updates, password reset, and token issue.
    const [rows] = await connection.execute(`SELECT *,
                                                    IF(locked_until > UTC_TIMESTAMP(), 1, 0) AS currently_locked,
                                                    GREATEST(0, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(), locked_until) / 1000000)) AS lock_retry_seconds,
                                                    IF(first_failed_login_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), 1, 0) AS active_window,
                                                    IF(last_lockout_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR), 1, 0) AS recent_lockout
                                             FROM ${table} WHERE email = ? LIMIT 1`, [normalized]);
    const account = rows[0];
    if (!account) return null;
    const fields = { account_id: String(account.id), role: table === "platform_admins" ? "platform_admin" : account.role };
    if (Number(account.currently_locked)) {
        await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
        securityEvent("login_blocked", fields);
        throw accountLockedError(account, table, account.lockout_count, Math.max(1, Number(account.lock_retry_seconds) || 1));
    }
    if (String(account.status).trim().toLowerCase() !== "active" || !account.password_hash) {
        await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
        securityEvent("login_blocked_inactive", fields);
        throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
    }
    if (!(await bcrypt.compare(String(password), account.password_hash))) {
        const count = Number(account.active_window) && !account.locked_until ? Number(account.failed_login_attempts) + 1 : 1;
        const locked = count >= 5;
        const lockouts = Number(account.recent_lockout) ? Number(account.lockout_count) : 0;
        const nextLockouts = locked ? lockouts + 1 : lockouts;
        const minutes = nextLockouts === 1 ? 5 : nextLockouts === 2 ? 15 : 30;
        await connection.execute(`UPDATE ${table} SET failed_login_attempts = ?,
                                                      first_failed_login_at = IF(? = 1, UTC_TIMESTAMP(), first_failed_login_at),
                                                      locked_until = IF(? = 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), NULL),
                                                      lockout_count = ?, last_lockout_at = IF(? = 1, UTC_TIMESTAMP(), last_lockout_at)
                                  WHERE id = ?`, [count, count, locked ? 1 : 0, minutes, nextLockouts, locked ? 1 : 0, account.id]);
        securityEvent("login_failed", { ...fields, attempt_count: count });
        if (locked) {
            securityEvent("account_locked", { ...fields, duration_minutes: minutes, lockout_count: nextLockouts });
            // Emit this only for a new lockout, never for retries during an active lockout.
            if (nextLockouts >= 4) {
                securityEvent("suspicious_login_activity", {
                    ...fields, lockout_count: nextLockouts, duration_minutes: minutes,
                    priority: nextLockouts >= 5 ? "high" : "medium",
                });
            }
            throw accountLockedError(account, table, nextLockouts, minutes * 60);
        }
        throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
    }
    await connection.execute(`UPDATE ${table} SET failed_login_attempts = 0, first_failed_login_at = NULL, locked_until = NULL${table === "users" ? ", last_login_at = UTC_TIMESTAMP()" : ""} WHERE id = ?`, [account.id]);
    securityEvent("login_succeeded", fields);
    return account;
}
// Recovery uses a purpose-bound code and a separate 256-bit single-use authorization.
function resetTokenHash(value) { return crypto.createHmac("sha256", JWT_SECRET).update("stocknbook:reset:" + value).digest("hex"); }
async function sendRecoveryMail(email, subject, content) {
    return sendGmailHtmlEmail(email, [
        `From: ${EMAIL_FROM}`, `To: ${sanitizeEmailHeader(email)}`, `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", content,
    ].join("\r\n"), "account recovery");
}
async function recoveryAction(connection, action, body, headers) {
    const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
    const email = String(body.email || "").trim().toLowerCase();
    if (action === "request_password_reset") {
        if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255)
            throw securityError(400, "Enter a valid email address.", "RECOVERY_EMAIL_INVALID");
        await authLock(connection, `account:${email}`);
        const [rows] = await connection.execute("SELECT id, email, store_id FROM users WHERE email = ? AND status = 'active' AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL LIMIT 1", [email]);
        // Platform administrators use a controlled recovery procedure, not email-only reset.
        if (!rows.length) {
            // Do not reveal registration status; only eligible verified accounts receive email.
            await bcrypt.compare(String(email), DUMMY_PASSWORD_HASH);
            securityEvent("password_reset_requested_unknown", { purpose: "password_reset" });
            return respond(200, { message: "If this email has a registered account, a verification code will be sent.", otp_sent: true, expires_in: 300, resend_in: 60 });
        }
        const user = rows[0];
        // Send only to the canonical, already verified email stored on the account.
        // MySQL's case/accent-insensitive comparison can match a differently spelled input.
        const verifiedEmail = String(user.email).trim();
        const scope = otpScope("password_reset", verifiedEmail);
        // A cooldown response must not distinguish registered from unregistered email.
        try { await guardOtpSend(connection, scope); }
        catch (error) {
            if (Number(error?.statusCode) === 429) {
                return respond(200, { message: "If this email has a registered account, a verification code will be sent.", otp_sent: true, expires_in: 300, resend_in: 60 });
            }
            throw error;
        }
        const otp = generateOtp();
        const challenge = crypto.randomBytes(16).toString("hex");
        await connection.beginTransaction();
        try {
            await connection.execute("UPDATE otp_codes SET invalidated_at = UTC_TIMESTAMP(), used_at = COALESCE(used_at, UTC_TIMESTAMP()) WHERE purpose = 'password_reset' AND user_id = ? AND invalidated_at IS NULL", [user.id]);
            await connection.execute(`INSERT INTO otp_codes (purpose,email,store_id,user_id,challenge_id,otp_hash,expires_at,created_at)
                                      VALUES ('password_reset',?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE),UTC_TIMESTAMP())`, [verifiedEmail,user.store_id,user.id,challenge,hashOtp(otp)]);
            await connection.commit();
        } catch (err) { await connection.rollback(); throw err; }
        try {
            if (LOCAL_OTP_CONSOLE_ONLY) deliverOtpToLocalTerminal("Password recovery", verifiedEmail, otp, 300);
            else await sendRecoveryMail(verifiedEmail, "StockNBook Password Reset Code", `<p>Your StockNBook password reset code is <strong>${otp}</strong>. It expires in 5 minutes. If you did not request this, ignore this email.</p>`);
            securityEvent("password_reset_requested", { account_id: String(user.id) });
        } catch {
            await connection.execute("UPDATE otp_codes SET invalidated_at = UTC_TIMESTAMP(), used_at = UTC_TIMESTAMP() WHERE challenge_id = ?", [challenge]);
            securityEvent("password_reset_delivery_failed", { account_id: String(user.id) });
            return respond(200, { message: "If this email has a registered account, a verification code will be sent.", otp_sent: true, expires_in: 300, resend_in: 60 });
        }
        return respond(200, { message: "If this email has a registered account, a verification code will be sent.", otp_sent: true, expires_in: 300, resend_in: 60 });
    }
    if (action === "verify_password_reset_otp") {
        await authLock(connection, `account:${email}`);
        const [rows] = await connection.execute("SELECT id, email FROM users WHERE email = ? AND status = 'active' AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL LIMIT 1", [email]);
        if (!rows.length) throw securityError(400, "Invalid or expired verification code. Request a new code.", "OTP_INVALID");
        const user = rows[0];
        const scope = otpScope("password_reset", user.email);
        // Verification must belong to the same eligible account, not just an email string.
        scope.where += " AND user_id = ?";
        scope.params.push(user.id);
        const row = await checkOtp(connection, scope, String(body.otp || ""), false);
        const token = crypto.randomBytes(32).toString("hex");
        await connection.execute(`UPDATE otp_codes SET used_at = UTC_TIMESTAMP(), verified_at = UTC_TIMESTAMP(), reset_token_hash = ?, reset_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ?`, [resetTokenHash(token), row.id]);
        return respond(200, { reset_token: token, expires_in: 600 });
    }
    if (action === "reset_password") {
        const token = String(body.reset_token || ""); const password = body.new_password;
        if (!passwordPolicy(password)) return respond(400, { error: passwordPolicyError(password) });
        if (password !== body.confirm_password) return respond(400, { error: "Passwords do not match." });
        if (!/^[a-f0-9]{64}$/.test(token)) throw securityError(400, "Invalid or expired password reset authorization.", "RESET_INVALID");
        await authLock(connection, `account:${email}`);
        await authLock(connection, otpScope("password_reset", email).key);
        await connection.beginTransaction();
        let user;
        try {
            const [rows] = await connection.execute(`SELECT o.id AS otp_id, u.id, u.email FROM otp_codes o JOIN users u ON u.id = o.user_id AND u.email = o.email
                                                     WHERE o.purpose = 'password_reset' AND o.email = ? AND o.reset_token_hash = ? AND o.verified_at IS NOT NULL
                                                       AND o.invalidated_at IS NULL AND o.reset_expires_at > UTC_TIMESTAMP() AND u.status = 'active' AND u.email_verified_at IS NOT NULL LIMIT 1 FOR UPDATE`, [email, resetTokenHash(token)]);
            user = rows[0];
            if (!user) throw securityError(400, "Invalid or expired password reset authorization.", "RESET_INVALID");
            const hash = await bcrypt.hash(password, 12);
            await connection.execute(`UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(), auth_version = auth_version + 1,
                                                       failed_login_attempts = 0, first_failed_login_at = NULL, locked_until = NULL, lockout_count = 0, last_lockout_at = NULL WHERE id = ?`, [hash, user.id]);
            await connection.execute(`UPDATE otp_codes SET invalidated_at = UTC_TIMESTAMP(), used_at = COALESCE(used_at,UTC_TIMESTAMP()), reset_token_hash = NULL WHERE purpose = 'password_reset' AND user_id = ? AND invalidated_at IS NULL`, [user.id]);
            await connection.commit();
        } catch(err) { await connection.rollback(); throw err; }
        securityEvent("password_reset_succeeded", { account_id: String(user.id) });
        if (!LOCAL_OTP_CONSOLE_ONLY) try { await sendRecoveryMail(user.email, "StockNBook Password Changed", "<p>Your StockNBook password was changed. If you did not make this change, contact your administrator immediately.</p>"); } catch { securityEvent("password_reset_notification_failed", { account_id: String(user.id) }); }
        return respond(200, { message: "Password reset successful. Please sign in again." });
    }
}

function paymentOtpRetrySeconds(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

// Display the remaining wait in readable units instead of only minutes.
function formatPaymentOtpWaitTime(seconds) {
    const totalMinutes = Math.max(1, Math.ceil(Number(seconds) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    if (minutes === 0) return hourText;
    return `${hourText} and ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function paymentOtpCooldownResponse(headers, message, retryAfterSeconds, code) {
    return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(retryAfterSeconds) },
        body: JSON.stringify({
            error: message,
            code,
            retry_after_seconds: retryAfterSeconds,
        }),
    };
}


function hashInviteToken(inviteToken) {
    return crypto
        .createHash("sha256")
        .update(String(inviteToken))
        .digest("hex");
}

async function getManagerInviteRecord(connection, inviteToken) {
    if (!inviteToken) {
        const error = new Error("Missing invitation token.");
        error.statusCode = 400;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(inviteToken, JWT_SECRET);
    } catch {
        const error = new Error("Invalid or expired invitation.");
        error.statusCode = 401;
        throw error;
    }

    if (decoded.type !== "manager_invite") {
        const error = new Error("Invalid invitation type.");
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `SELECT
             users.id AS manager_id,
             users.full_name AS manager_name,
             users.email AS manager_email,
             users.phone AS manager_phone,
             users.permissions,
             users.auth_version,
             users.status,
             users.store_id,
             users.branch_id,
             branches.branch_name,
             stores.store_name
         FROM users
                  JOIN branches ON users.branch_id = branches.id
                  JOIN stores ON users.store_id = stores.id
         WHERE users.role = 'manager'
           AND users.invite_token_hash = SHA2(?, 256)
           AND users.email = ?
           AND users.store_id = ?
           AND users.branch_id = ?
           AND users.status = 'pending'
             LIMIT 1`,
        [
            inviteToken,
            String(decoded.email || "").toLowerCase(),
            decoded.store_id,
            decoded.branch_id,
        ]
    );

    if (rows.length === 0) {
        const error = new Error("Invitation not found or already used.");
        error.statusCode = 404;
        throw error;
    }

    const manager = rows[0];

    return {
        decoded,
        manager: {
            manager_id: manager.manager_id,
            manager_name: manager.manager_name || "",
            manager_email: manager.manager_email || "",
            manager_phone: manager.manager_phone || "",
            store_id: manager.store_id,
            store_name: manager.store_name || "",
            branch_id: manager.branch_id,
            branch_name: manager.branch_name || "",
            role: "manager",
            status: manager.status || "pending",
            // Managers receive the Manager role modules on activation.
            permissions: effectiveEmployeePermissions(manager.permissions, "manager"),
        },
    };
}

async function requireVerifiedManagerInvite(connection, inviteToken, email) {

    const inviteTokenHash = hashInviteToken(inviteToken);
    await authLock(connection, otpScope("manager_invite", email, null, inviteTokenHash).key);
    const [rows] = await connection.execute(
        `SELECT id
         FROM otp_codes
         WHERE purpose = 'manager_invite'
           AND invite_token_hash = ?
           AND email = ?
           AND verified_at IS NOT NULL
           AND invalidated_at IS NULL
           AND verified_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
         ORDER BY id DESC
             LIMIT 1`,
        [inviteTokenHash, String(email || "").toLowerCase()]
    );

    if (rows.length === 0) {
        const error = new Error(
            "Verify the invited email before continuing."
        );
        error.statusCode = 403;
        throw error;
    }
}


async function getStaffInviteRecord(connection, inviteToken) {
    if (!inviteToken) {
        const error = new Error("Missing invitation token.");
        error.statusCode = 400;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(inviteToken, JWT_SECRET);
    } catch {
        const error = new Error("Invalid or expired invitation.");
        error.statusCode = 401;
        throw error;
    }

    if (decoded.type !== "staff_invite") {
        const error = new Error("Invalid invitation type.");
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `SELECT
             staff.id AS staff_id,
             staff.full_name AS staff_name,
             staff.email AS staff_email,
             staff.phone AS staff_phone,
             staff.permissions,
             staff.auth_version,
             staff.status,
             staff.store_id,
             staff.branch_id,
             staff.manager_id,
             branches.branch_name,
             stores.store_name,
             COALESCE(managers.full_name, '') AS manager_name
         FROM users staff
                  JOIN branches ON staff.branch_id = branches.id
                  JOIN stores ON staff.store_id = stores.id
                  LEFT JOIN users managers ON staff.manager_id = managers.id AND managers.role = 'manager'
         WHERE staff.role = 'staff'
           AND staff.invite_token_hash = SHA2(?, 256)
           AND staff.email = ?
           AND staff.store_id = ?
           AND staff.branch_id = ?
           AND staff.manager_id = ?
           AND staff.status = 'pending'
             LIMIT 1`,
        [
            inviteToken,
            String(decoded.email || "").toLowerCase(),
            decoded.store_id,
            decoded.branch_id,
            decoded.manager_id,
        ]
    );

    if (rows.length === 0) {
        const error = new Error("Invitation not found or already used.");
        error.statusCode = 404;
        throw error;
    }

    const staffMember = rows[0];

    return {
        decoded,
        staff: {
            staff_id: staffMember.staff_id,
            staff_name: staffMember.staff_name || "",
            staff_email: staffMember.staff_email || "",
            staff_phone: staffMember.staff_phone || "",
            manager_id: staffMember.manager_id,
            manager_name: staffMember.manager_name || "",
            store_id: staffMember.store_id,
            store_name: staffMember.store_name || "",
            branch_id: staffMember.branch_id,
            branch_name: staffMember.branch_name || "",
            role: "staff",
            status: staffMember.status || "pending",
            permissions:
                typeof staffMember.permissions === "string"
                    ? JSON.parse(staffMember.permissions || "{}")
                    : staffMember.permissions || {},
        },
    };
}

async function requireVerifiedStaffInvite(connection, inviteToken, email) {

    const inviteTokenHash = hashInviteToken(inviteToken);
    await authLock(connection, otpScope("staff_invite", email, null, inviteTokenHash).key);
    const [rows] = await connection.execute(
        `SELECT id
         FROM otp_codes
         WHERE purpose = 'staff_invite'
           AND invite_token_hash = ?
           AND email = ?
           AND verified_at IS NOT NULL
           AND invalidated_at IS NULL
           AND verified_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
         ORDER BY id DESC
             LIMIT 1`,
        [inviteTokenHash, String(email || "").toLowerCase()]
    );

    if (rows.length === 0) {
        const error = new Error(
            "Verify the invited email before continuing."
        );
        error.statusCode = 403;
        throw error;
    }
}

function createSmtpResponseReader(socket) {
    let buffer = "";
    const waiting = [];

    const flush = () => {
        while (waiting.length > 0) {
            const lines = buffer.split(/\r?\n/);
            let responseEnd = -1;

            for (let index = 0; index < lines.length; index += 1) {
                if (/^\d{3} /.test(lines[index])) {
                    responseEnd = index;
                    break;
                }
            }

            if (responseEnd === -1) {
                return;
            }

            const responseLines = lines.slice(0, responseEnd + 1);
            buffer = lines.slice(responseEnd + 1).join("\r\n");

            const finalLine = responseLines[responseLines.length - 1];
            const code = Number(finalLine.slice(0, 3));
            const waiter = waiting.shift();

            waiter.resolve({
                code,
                message: responseLines.join("\n"),
            });
        }
    };

    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        flush();
    });

    socket.on("error", (error) => {
        while (waiting.length > 0) {
            waiting.shift().reject(error);
        }
    });

    socket.on("close", () => {
        while (waiting.length > 0) {
            waiting.shift().reject(
                new Error("SMTP connection closed unexpectedly.")
            );
        }
    });

    return () =>
        new Promise((resolve, reject) => {
            waiting.push({ resolve, reject });
            flush();
        });
}

async function expectSmtpResponse(readResponse, expectedCodes) {
    const response = await readResponse();

    if (!expectedCodes.includes(response.code)) {
        const error = new Error(
            `Gmail SMTP error ${response.code}: ${response.message}`
        );

        error.code =
            response.code === 535
                ? "GMAIL_AUTH_FAILED"
                : "GMAIL_SMTP_ERROR";

        throw error;
    }

    return response;
}

async function sendSmtpCommand(
    socket,
    readResponse,
    command,
    expectedCodes
) {
    socket.write(`${command}\r\n`);
    return expectSmtpResponse(readResponse, expectedCodes);
}

function buildOtpEmail(toEmail, otp) {
    const html = `
        <div style="font-family: Arial, sans-serif; background:#FDFAF4; padding:24px;">
            <div style="max-width:520px; margin:auto; background:#ffffff; border:1px solid #EBE4F0; border-radius:16px; padding:28px;">
                <h2 style="margin:0; color:#2D1B4E;">StockNBook</h2>

                <p style="margin-top:18px; color:#3F354C;">Hello,</p>

                <p style="color:#3F354C;">
                    Use the verification code below to continue creating your
                    StockNBook account.
                </p>

                <div style="margin:24px 0; padding:18px; text-align:center; background:#F8F5FF; border-radius:12px;">
                    <div style="font-size:32px; font-weight:bold; letter-spacing:6px; color:#2D1B4E;">
                        ${otp}
                    </div>
                </div>

                <p style="color:#7A6E88;">
                    This OTP will expire in <strong>5 minutes</strong>.
                </p>

                <p style="margin-top:24px; color:#7A6E88; font-size:13px;">
                    If you did not request this code, you can safely ignore this
                    email.
                </p>

                <p style="margin-top:24px; color:#2D1B4E; font-weight:bold;">
                    — StockNBook Team
                </p>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `To: ${toEmail}`,
        "Subject: StockNBook Email Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildPaymentOtpEmail(toEmail, otp, planName) {
    const planLabel = planName ? escapeHtml(planName) : "your selected";

    const html = `
        <div style="font-family: Arial, sans-serif; background:#FDFAF4; padding:24px;">
            <div style="max-width:520px; margin:auto; background:#ffffff; border:1px solid #EBE4F0; border-radius:16px; padding:28px;">
                <h2 style="margin:0; color:#2D1B4E;">StockNBook</h2>

                <p style="margin-top:18px; color:#3F354C;">Hello,</p>

                <p style="color:#3F354C;">
                    Use the verification code below to confirm your subscription
                    payment submission for the <strong>${planLabel}</strong> plan.
                </p>

                <div style="margin:24px 0; padding:18px; text-align:center; background:#F8F5FF; border-radius:12px;">
                    <div style="font-size:32px; font-weight:bold; letter-spacing:6px; color:#2D1B4E;">
                        ${otp}
                    </div>
                </div>

                <p style="color:#7A6E88;">
                    This code will expire in <strong>5 minutes</strong>.
                </p>

                <p style="margin-top:24px; color:#7A6E88; font-size:13px;">
                    If you did not request this, you can safely ignore this email
                    — no changes will be made to your account or subscription.
                </p>

                <p style="margin-top:24px; color:#2D1B4E; font-weight:bold;">
                    — StockNBook Team
                </p>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `To: ${toEmail}`,
        "Subject: StockNBook Payment Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeEmailHeader(value) {
    return String(value ?? "")
        .replace(/[\r\n]+/g, " ")
        .trim();
}

// Branch Managers receive every Manager-role module automatically once their
// account is active. Access is decided by the role, never by an Owner toggle
// or a client-supplied permission object; the Manager still remains limited to
// the assigned store/branch, and paid features still follow the store's
// effective subscription plan (enforced separately by the plan gates).
// Owner-only functions (branches, Branch Managers, subscription management)
// and Platform Administrator functions are not part of this set.
const MANAGER_ROLE_PERMISSIONS = Object.freeze({
    dashboard: true,
    bookings: true,
    packages: true,
    packages_manage: true,
    inventory: true,
    pos: true,
    reports: true, // Existing backend key for Audit Logs (assigned branch only).
    staff_management: true,
    analytics: true, // Still subject to the plan's has_analytics flag.
    forecasting: true, // Still subject to the plan's has_forecasting flag.
});

// Kept under its existing name for every caller. The argument (an older stored
// permission object or a request body) is intentionally ignored so legacy
// Manager rows with disabled modules receive the corrected role access without
// any database change or account re-creation.
function normalizeManagerRolePermissions() {
    return { ...MANAGER_ROLE_PERMISSIONS };
}

// Business-module backends (Bookings, Inventory, Rental Inventory, POS,
// Packages, Categories, Analytics, Audit Logs) still read users.permissions
// for Managers. Since the Owner no longer toggles Manager modules, the stored
// value is kept equal to the Manager role grant so those checks agree with
// role-based access. Existing Managers saved with disabled modules are
// corrected on their next login or session refresh, without re-creating the
// account. Branch, store and account-status checks are unaffected.
async function syncStoredManagerRolePermissions(connection, managerId, storedRaw) {
    const id = Number(managerId);
    if (!Number.isInteger(id) || id <= 0) return false;
    let stored = storedRaw;
    if (typeof stored === "string") {
        try { stored = JSON.parse(stored); } catch { stored = {}; }
    }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
    const differs = Object.entries(MANAGER_ROLE_PERMISSIONS)
        .some(([key, value]) => stored[key] !== value);
    if (!differs) return false;
    // users.updated_at is preserved: this aligns a derived value only.
    await connection.execute(
        `UPDATE users SET permissions = ?, updated_at = updated_at
         WHERE id = ? AND role = 'manager'`,
        [JSON.stringify(normalizeManagerRolePermissions()), id]
    );
    return true;
}

// Staff permissions are an explicit allowlist. A Manager cannot delegate
// modules the Owner did not grant or use crafted requests to grant Manager
// powers (Reports/Audit Logs, Analytics, Forecasting, branch administration).
function normalizeStaffRolePermissions(raw, managerRaw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw Object.assign(new Error("Provide a valid staff permission object."), { statusCode: 400 });
    }
    let manager = managerRaw;
    if (typeof manager === "string") {
        try { manager = JSON.parse(manager); } catch { manager = {}; }
    }
    if (!manager || typeof manager !== "object" || Array.isArray(manager)) manager = {};
    const allowedKeys = new Set([
        "dashboard", "pos", "pos_access", "bookings", "bookings_access",
        "inventory", "inventory_access", "inventory_stock_receive",
        "packages", "package_access",
        // These older fields may still be submitted as disabled by existing clients.
        "reports", "reports_access", "analytics", "analytics_access",
        "forecasting", "forecasting_access"
    ]);
    const disabled = (value) => value === false || value === "none" || value === null || value === undefined;
    for (const [key, value] of Object.entries(raw)) {
        if (!allowedKeys.has(key) && !disabled(value)) {
            throw Object.assign(new Error(`Staff cannot receive the ${key} permission.`), { statusCode: 403 });
        }
        if (["reports", "reports_access", "analytics", "analytics_access", "forecasting", "forecasting_access"].includes(key) && !disabled(value)) {
            throw Object.assign(new Error("Audit Logs, Analytics and Forecasting cannot be delegated to Staff."), { statusCode: 403 });
        }
    }
    const mode = (key, fallbackKey, accepted) => {
        const value = raw[key] === undefined ? raw[fallbackKey] : raw[key];
        if (disabled(value)) return "none";
        if (value === true || value === "true") {
            return accepted.includes("full") ? "full" : "view";
        }
        if (typeof value === "string" && accepted.includes(value)) return value;
        throw Object.assign(new Error(`Invalid ${key} access level.`), { statusCode: 400 });
    };
    const pos = mode("pos_access", "pos", ["view", "full"]);
    const bookings = mode("bookings_access", "bookings", ["view", "full"]);
    const inventory = mode("inventory_access", "inventory", ["view", "full"]);
    const packages = mode("package_access", "packages", ["view"]);
    for (const [key, access] of Object.entries({ pos, bookings, inventory, packages })) {
        if (access !== "none" && manager[key] !== true) {
            throw Object.assign(new Error(`Your account cannot delegate ${key} access.`), { statusCode: 403 });
        }
    }
    const receive = raw.inventory_stock_receive === true;
    if (receive && (inventory !== "full" || manager.inventory !== true)) {
        throw Object.assign(new Error("Stock receiving requires authorized full Inventory access."), { statusCode: 403 });
    }
    if (raw.dashboard !== undefined && raw.dashboard !== true) {
        throw Object.assign(new Error("Staff Dashboard is always available."), { statusCode: 400 });
    }
    return {
        dashboard: true,
        pos: pos !== "none", pos_access: pos,
        bookings: bookings !== "none", bookings_access: bookings,
        inventory: inventory !== "none", inventory_access: inventory,
        inventory_stock_receive: receive,
        packages: packages !== "none", package_access: packages,
    };
}

// Role defaults apply only to missing/invalid legacy permissions. A successful
// login must NEVER overwrite an Owner/Manager-selected invitation grant.
function effectiveEmployeePermissions(raw, role) {
    let value = raw;
    if (typeof value === "string") {
        try { value = JSON.parse(value); } catch { value = {}; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
    if (role === "manager") return normalizeManagerRolePermissions(value);
    if (role !== "staff") return {};
    const level = (field, fallback, permitted) => {
        const candidate = value[field] === undefined ? value[fallback] : value[field];
        if (candidate === true || candidate === "true") return permitted.includes("full") ? "full" : "view";
        if (typeof candidate === "string" && permitted.includes(candidate)) return candidate;
        // Prior Bookings standard-confirmation privileges must NOT be retained.
        if (field === "bookings_access" && ["standard", "confirm_standard"].includes(candidate)) return "view";
        return "none";
    };
    const pos = level("pos_access", "pos", ["view", "full"]);
    const bookings = level("bookings_access", "bookings", ["view", "full"]);
    const inventory = level("inventory_access", "inventory", ["view", "full"]);
    const packages = level("package_access", "packages", ["view"]);
    return {
        dashboard: true,
        pos: pos !== "none", pos_access: pos,
        bookings: bookings !== "none", bookings_access: bookings,
        inventory: inventory !== "none", inventory_access: inventory,
        inventory_stock_receive: inventory === "full" && value.inventory_stock_receive === true,
        packages: packages !== "none", package_access: packages,
    };
}

// Permission changes appear in the Owner's employee-action Audit Logs.
async function recordStaffPermissionChange(connection, { storeId, branchId, managerId, managerName, staffId, action, permissions }) {
    await connection.execute(
        `INSERT INTO employee_actions
         (store_id, branch_id, user_id, user_name, user_role, module, reference_number, action, entity_id, details)
         VALUES (?, ?, ?, ?, 'Manager', 'Staff Management', NULL, ?, ?, ?)`,
        [storeId, branchId, managerId, String(managerName || "Manager").slice(0, 150),
            action, staffId, JSON.stringify({ staff_id: staffId, permissions })]
    );
}

function permissionLabel(permission) {
    const labels = {
        dashboard: "Dashboard",
        bookings: "Bookings",
        packages: "Packages",
        packages_manage: "Manage Packages",
        inventory: "Inventory",
        pos: "Sales / POS",
        reports: "Audit Logs",
        analytics: "Analytics",
        forecasting: "Forecasting",
        staff_management: "Staff Management",
        branch_settings: "Branch Settings",
    };

    return labels[permission] || permission;
}

// Normalizes a raw permission value (which may be a boolean flag like
// `staff_management: true`, or a granular access-mode string like
// `"full" | "view" | "none"`) into a display-ready access level.
// Returns null when the module is set to no access at all, so callers
// can filter those out instead of showing them as granted.
function permissionAccessLevel(value) {
    if (value === true || value === "full" || value === "true") {
        return "Full Access";
    }

    if (value === "view" || value === "view_only" || value === "viewOnly") {
        return "View Only";
    }

    // Explicitly covers false, "none", undefined, null, "", 0, etc.
    return null;
}


function buildManagerInviteOtpEmail(toEmail, otp, managerName) {
    const safeName = escapeHtml(managerName || "Manager");
    const safeOtp = escapeHtml(otp);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#F7F4FB;padding:28px 14px;color:#21172C;">
            <div style="max-width:560px;margin:auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:20px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:26px 30px;color:#FFFFFF;">
                    <div style="font-size:22px;font-weight:800;">Stock<span style="color:#D4A126;">N</span>Book</div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">Manager invitation verification</div>
                </div>
                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:25px;color:#21172C;">Verify your invited email</h1>
                    <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeName}</strong>, use the code below to continue accepting your StockNBook manager invitation.
                    </p>
                    <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:#F3ECFF;">
                        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4B2380;">${safeOtp}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#7A6E88;">
                        This code expires in 5 minutes. Do not share it with anyone.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook Manager Invitation Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildStaffInviteOtpEmail(toEmail, otp, staffName) {
    const safeName = escapeHtml(staffName || "Staff member");
    const safeOtp = escapeHtml(otp);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#F7F4FB;padding:28px 14px;color:#21172C;">
            <div style="max-width:560px;margin:auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:20px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:26px 30px;color:#FFFFFF;">
                    <div style="font-size:22px;font-weight:800;">Stock<span style="color:#D4A126;">N</span>Book</div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">Staff invitation verification</div>
                </div>
                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:25px;color:#21172C;">Verify your invited email</h1>
                    <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeName}</strong>, use the code below to continue accepting your StockNBook staff invitation.
                    </p>
                    <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:#F3ECFF;">
                        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4B2380;">${safeOtp}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#7A6E88;">
                        This code expires in 5 minutes. Do not share it with anyone.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook Staff Invitation Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}

function buildManagerInvitationEmail({
                                         toEmail,
                                         managerName,
                                         storeName,
                                         branchName,
                                         inviteLink,
                                         permissions,
                                     }) {
    const safeManagerName = escapeHtml(managerName || "Manager");
    const safeStoreName = escapeHtml(storeName || "StockNBook Store");
    const safeBranchName = escapeHtml(branchName || "Assigned Branch");
    const safeInviteLink = escapeHtml(inviteLink);
    const safeRecipient = escapeHtml(toEmail);

    const subject = "StockNBook Manager Invitation";

    const html = `
        <div style="margin:0;background:#F7F4FB;padding:30px 14px;font-family:Arial,Helvetica,sans-serif;color:#21172C;">
            <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:22px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:28px 30px;color:#FFFFFF;">
                    <div style="font-size:23px;font-weight:800;letter-spacing:-.6px;">
                        Stock<span style="color:#D4A126;">N</span>Book
                    </div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">
                        Secure branch manager invitation
                    </div>
                </div>

                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:27px;line-height:1.25;color:#21172C;">
                        You have been invited
                    </h1>

                    <p style="margin:16px 0 0;font-size:15px;line-height:1.75;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeManagerName}</strong>,
                        the owner of <strong style="color:#2D1B4E;">${safeStoreName}</strong>
                        invited you to manage the
                        <strong style="color:#2D1B4E;">${safeBranchName}</strong> branch.
                    </p>

                    <div style="margin:24px 0;padding:18px;border:1px solid #E8DFF0;border-radius:16px;background:#FCFAFD;">
                        <table role="presentation" style="width:100%;border-collapse:collapse;">
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Store</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeStoreName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Branch</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeBranchName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 0 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Role</td>
                                <td style="padding:4px 0 0;color:#2D1B4E;font-size:14px;font-weight:700;">Branch Manager</td>
                            </tr>
                        </table>
                    </div>

                    <a href="${safeInviteLink}"
                       style="display:block;border-radius:12px;background:#2D1B4E;padding:15px 20px;text-align:center;font-size:15px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                        Review and accept invitation
                    </a>

                    <p style="margin:20px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        This invitation is intended only for <strong>${safeRecipient}</strong>.
                        Do not forward this email or share the invitation link.
                    </p>

                    <p style="margin:14px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        The invitation expires after 7 days. If you were not expecting this invitation,
                        you may safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildStaffInvitationEmail({
                                       toEmail,
                                       staffName,
                                       managerName,
                                       storeName,
                                       branchName,
                                       inviteLink,
                                       permissions,
                                   }) {
    const safeStaffName = escapeHtml(staffName || "Staff member");
    const safeManagerName = escapeHtml(managerName || "Branch Manager");
    const safeStoreName = escapeHtml(storeName || "StockNBook Store");
    const safeBranchName = escapeHtml(branchName || "Assigned Branch");
    const safeInviteLink = escapeHtml(inviteLink);
    const safeRecipient = escapeHtml(toEmail);

    // A staff permission may be represented twice (e.g. pos + pos_access).
    // Show each granted module once, without exposing internal field names.
    const invitationModules = [
        { label: "Dashboard", flag: "dashboard" },
        { label: "Sales / POS", flag: "pos", access: "pos_access" },
        { label: "Bookings", flag: "bookings", access: "bookings_access" },
        { label: "Inventory", flag: "inventory", access: "inventory_access" },
        { label: "Packages", flag: "packages", access: "package_access" },
    ];
    const enabledPermissions = invitationModules.flatMap(({ label, flag, access }) => {
        const granular = access ? permissions?.[access] : undefined;
        const value = granular !== undefined ? granular : permissions?.[flag];
        const level = permissionAccessLevel(value);
        return level ? [{ label, level }] : [];
    });

    const permissionItems = enabledPermissions.length > 0
        ? enabledPermissions.map(({ label, level }) =>
            `<span style="display:inline-block;margin:4px 18px 4px 0;color:#5B32C5;font-size:13px;font-weight:700;">${escapeHtml(label)}${level === "View Only" ? ' <span style="color:#8A7896;font-weight:400;">(View only)</span>' : label === "Dashboard" ? "" : ' <span style="color:#8A7896;font-weight:400;">(Operational access)</span>'}</span>`
        ).join("")
        : `<span style="color:#7A6E88;font-size:13px;">Your access will be configured by your branch manager.</span>`;

    const subject = "StockNBook Staff Invitation";

    const html = `
        <div style="margin:0;background:#F7F4FB;padding:30px 14px;font-family:Arial,Helvetica,sans-serif;color:#21172C;">
            <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:22px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:28px 30px;color:#FFFFFF;">
                    <div style="font-size:23px;font-weight:800;letter-spacing:-.6px;">
                        Stock<span style="color:#D4A126;">N</span>Book
                    </div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">
                        Secure staff invitation
                    </div>
                </div>

                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:27px;line-height:1.25;color:#21172C;">
                        You have been invited
                    </h1>

                    <p style="margin:16px 0 0;font-size:15px;line-height:1.75;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeStaffName}</strong>,
                        <strong style="color:#2D1B4E;">${safeManagerName}</strong>
                        invited you to join
                        <strong style="color:#2D1B4E;">${safeStoreName}</strong>
                        at the <strong style="color:#2D1B4E;">${safeBranchName}</strong> branch.
                    </p>

                    <div style="margin:24px 0;padding:18px;border:1px solid #E8DFF0;border-radius:16px;background:#FCFAFD;">
                        <table role="presentation" style="width:100%;border-collapse:collapse;">
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Store</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeStoreName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Branch</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeBranchName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 0 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Role</td>
                                <td style="padding:4px 0 0;color:#2D1B4E;font-size:14px;font-weight:700;">Staff Member</td>
                            </tr>
                        </table>
                    </div>

                    <div style="margin:0 0 22px;">
                        <div style="margin-bottom:9px;color:#2D1B4E;font-size:13px;font-weight:800;">Access assigned to you</div>
                        <div>${permissionItems}</div>
                    </div>

                    <a href="${safeInviteLink}"
                       style="display:block;border-radius:12px;background:#2D1B4E;padding:15px 20px;text-align:center;font-size:15px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                        Review and accept invitation
                    </a>

                    <p style="margin:20px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        This invitation is intended only for <strong>${safeRecipient}</strong>.
                        Do not forward this email or share the invitation link.
                    </p>

                    <p style="margin:14px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        The invitation expires after 7 days. If you were not expecting this invitation,
                        you may safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}

async function sendGmailHtmlEmail(toEmail, rawMessage, logLabel) {
    if (
        !SMTP_USER ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SMTP_USER)
    ) {
        const configError = new Error(
            // ===== ENV SECURITY CHANGE: SMTP configuration error message BEGIN =====
            "Email sending is not configured. Set a valid AUTH_SMTP_USER in the environment."
            // ===== ENV SECURITY CHANGE: SMTP configuration error message END =====
        );
        configError.code = "SMTP_NOT_CONFIGURED";
        throw configError;
    }

    if (
        // ===== ENV SECURITY CHANGE: Remove embedded SMTP password check BEGIN =====
        !SMTP_PASS
        // ===== ENV SECURITY CHANGE: Remove embedded SMTP password check END =====
    ) {
        const configError = new Error(
            // ===== ENV SECURITY CHANGE: SMTP password error message BEGIN =====
            "Email sending is not configured. Set AUTH_SMTP_PASS to a valid Google App Password in the environment."
            // ===== ENV SECURITY CHANGE: SMTP password error message END =====
        );
        configError.code = "SMTP_NOT_CONFIGURED";
        throw configError;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        const emailError = new Error("Invalid email recipient.");
        emailError.code = "INVALID_RECIPIENT";
        throw emailError;
    }

    const socket = tls.connect({
        host: SMTP_HOST,
        port: SMTP_PORT,
        servername: SMTP_HOST,
        rejectUnauthorized: true,
    });

    socket.setTimeout(SMTP_TIMEOUT_MS);

    const readResponse = createSmtpResponseReader(socket);

    try {
        await new Promise((resolve, reject) => {
            socket.once("secureConnect", resolve);
            socket.once("error", reject);
            socket.once("timeout", () => {
                const timeoutError = new Error(
                    "Lambda could not connect to Gmail SMTP."
                );
                timeoutError.code = "GMAIL_NETWORK_FAILED";
                reject(timeoutError);
            });
        });

        await expectSmtpResponse(readResponse, [220]);

        await sendSmtpCommand(
            socket,
            readResponse,
            "EHLO stocknbook.local",
            [250]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            "AUTH LOGIN",
            [334]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            Buffer.from(SMTP_USER).toString("base64"),
            [334]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            Buffer.from(SMTP_PASS).toString("base64"),
            [235]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            `MAIL FROM:<${SMTP_USER}>`,
            [250]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            `RCPT TO:<${toEmail}>`,
            [250, 251]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            "DATA",
            [354]
        );

        socket.write(`${rawMessage}\r\n.\r\n`);

        const dataResponse = await expectSmtpResponse(
            readResponse,
            [250]
        );

        socket.write("QUIT\r\n");

        console.log(`[stocknbook-auth] ${logLabel} email accepted:`, {
            to: toEmail,
            smtpResponse: dataResponse.message,
        });

        return {
            accepted: [toEmail],
            response: dataResponse.message,
        };
    } catch (error) {
        console.error(`[stocknbook-auth] ${logLabel} Gmail SMTP error:`, {
            code: error?.code,
            message: error?.message,
        });

        if (error?.code === "GMAIL_AUTH_FAILED") {
            const authError = new Error(
                // ===== ENV SECURITY CHANGE: Gmail authentication error message BEGIN =====
                "Gmail rejected the sender credentials. Set AUTH_SMTP_PASS to a current Google App Password generated for the AUTH_SMTP_USER account."
                // ===== ENV SECURITY CHANGE: Gmail authentication error message END =====
            );
            authError.code = "GMAIL_AUTH_FAILED";
            throw authError;
        }

        if (isSmtpNetworkError(error)) {
            const networkError = new Error(
                "The invitation email service is temporarily unreachable. The invitation itself is still valid; use the backup invite link or try Resend later."
            );
            networkError.code = "GMAIL_NETWORK_FAILED";
            networkError.cause = error;
            throw networkError;
        }

        throw error;
    } finally {
        if (!socket.destroyed) {
            socket.end();
        }
    }
}

async function sendSignupOtpEmail(toEmail, otp) {
    if (LOCAL_OTP_CONSOLE_ONLY) {
        return deliverOtpToLocalTerminal("Owner signup", toEmail, otp, OTP_EXPIRY_SECONDS);
    }
    return sendGmailHtmlEmail(
        toEmail,
        buildOtpEmail(toEmail, otp),
        "OTP"
    );
}

async function sendManagerInvitationEmail(invite) {
    return sendGmailHtmlEmail(
        invite.manager_email,
        buildManagerInvitationEmail({
            toEmail: invite.manager_email,
            managerName: invite.manager_name,
            storeName: invite.store_name,
            branchName: invite.branch_name,
            inviteLink: invite.invite_link,
            permissions: invite.permissions,
        }),
        "manager invitation"
    );
}


async function sendStaffInvitationEmail(invite) {
    return sendGmailHtmlEmail(
        invite.staff_email,
        buildStaffInvitationEmail({
            toEmail: invite.staff_email,
            staffName: invite.staff_name,
            managerName: invite.manager_name,
            storeName: invite.store_name,
            branchName: invite.branch_name,
            inviteLink: invite.invite_link,
            permissions: invite.permissions,
        }),
        "staff invitation"
    );
}


function getInvitationEmailFailureMessage(error) {
    const code = String(error?.code || "").toUpperCase();

    if (code === "GMAIL_NETWORK_FAILED" || isSmtpNetworkError(error)) {
        return "The email service is temporarily unreachable. The invitation is still valid; use the backup invite link or try Resend later.";
    }

    if (code === "GMAIL_AUTH_FAILED") {
        return "The email service could not authenticate. The invitation is still valid; use the backup invite link while the SMTP account is being fixed.";
    }

    if (code === "SMTP_NOT_CONFIGURED") {
        return "Email delivery is not configured yet. The invitation is still valid; use the backup invite link.";
    }

    if (code === "INVALID_RECIPIENT") {
        return "The invitation email address is invalid. Check the address or use the backup invite link.";
    }

    if (code === "GMAIL_SMTP_ERROR") {
        return "Gmail did not accept the invitation email. The invitation is still valid; use the backup invite link or try Resend later.";
    }

    return "The invitation email could not be delivered. The invitation is still valid; use the backup invite link or try Resend later.";
}

async function deliverInvitationEmail({
                                          role,
                                          email,
                                          name,
                                          storeName,
                                          branchName,
                                          inviteLink,
                                          send,
                                      }) {
    try {
        await send();

        return {
            email_sent: true,
            email_status: "sent",
            email_error: "",
        };
    } catch (sendError) {
        const emailError = getInvitationEmailFailureMessage(sendError);

        console.error(
            `[stocknbook-auth] ${role} invitation was created, but email delivery failed:`,
            {
                email,
                branch: branchName || "",
                code: sendError?.code || "EMAIL_SEND_FAILED",
                error: emailError,
            }
        );

        logDevelopmentInvitationFallback({
            role,
            email,
            name,
            storeName,
            branchName,
            inviteLink,
            errorMessage: emailError,
        });

        return {
            email_sent: false,
            email_status: "failed",
            email_error: emailError,
        };
    }
}


async function sendManagerInviteOtpEmail(toEmail, otp, managerName) {
    if (LOCAL_OTP_CONSOLE_ONLY) {
        return deliverOtpToLocalTerminal("Manager invitation", toEmail, otp, MANAGER_INVITE_OTP_EXPIRY_SECONDS);
    }
    return sendGmailHtmlEmail(
        toEmail,
        buildManagerInviteOtpEmail(toEmail, otp, managerName),
        "manager invitation OTP"
    );
}


async function sendStaffInviteOtpEmail(toEmail, otp, staffName) {
    if (LOCAL_OTP_CONSOLE_ONLY) {
        return deliverOtpToLocalTerminal("Staff invitation", toEmail, otp, STAFF_INVITE_OTP_EXPIRY_SECONDS);
    }
    return sendGmailHtmlEmail(
        toEmail,
        buildStaffInviteOtpEmail(toEmail, otp, staffName),
        "staff invitation OTP"
    );
}

async function sendPaymentOtpEmail(toEmail, otp, planName) {
    if (LOCAL_OTP_CONSOLE_ONLY) {
        return deliverOtpToLocalTerminal("Subscription payment", toEmail, otp, PAYMENT_OTP_EXPIRY_SECONDS);
    }
    return sendGmailHtmlEmail(
        toEmail,
        buildPaymentOtpEmail(toEmail, otp, planName),
        "payment verification OTP"
    );
}


// Sent only after the payment submission has been saved successfully.
// Acknowledgment does NOT mean that GCash funds have been verified.
function buildPaymentSubmissionAcknowledgmentEmail(toEmail, details) {
    const storeName = escapeHtml(details.store_name || "your store");
    const planName = escapeHtml(details.plan_name || "selected");
    const amount = Number(details.amount || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const paymentId = escapeHtml(details.payment_submission_id);

    const html = `
        <div style="font-family:Arial,sans-serif;background:#FDFAF4;padding:24px;color:#3F354C;">
          <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #E7DCEB;border-radius:16px;padding:28px;">
            <h2 style="color:#2D1B4E;margin:0;">StockNBook</h2>
            <p>Thank you for choosing StockNBook, <strong>${storeName}</strong>!</p>
            <p>We have <strong>received your GCash payment details and proof</strong> for the
              <strong>${planName}</strong> plan. Your submission is now <strong>Pending Review</strong>.</p>
            <div style="background:#F6F1FB;border-radius:12px;padding:16px;margin:20px 0;">
              <p style="margin:6px 0;">Plan: <strong>${planName}</strong></p>
              <p style="margin:6px 0;">Submitted amount: <strong>PHP ${amount}</strong></p>
              <p style="margin:6px 0;">Submission ID: <strong>#${paymentId}</strong></p>
              <p style="margin:6px 0;">Status: <strong>Pending Review</strong></p>
            </div>
            <p>Please allow <strong>up to 24 hours</strong> for the Platform Admin to review your payment.
              Reviews may take longer if extra verification is necessary.</p>
            <p><strong>Your plan is not yet activated by this email.</strong> We'll email you again if
              the payment is approved and your subscription is activated.</p>
            <p>If you did not submit this payment, contact StockNBook support.</p>
            <p style="margin-top:24px;color:#2D1B4E;font-weight:bold;">— StockNBook Team</p>
          </div>
        </div>`;
    return [
        `From: ${EMAIL_FROM}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook - We received your subscription payment proof",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n").replace(/^\./gm, "..");
}

async function sendPaymentSubmissionAcknowledgmentEmail(toEmail, details) {
    return sendGmailHtmlEmail(
        toEmail,
        buildPaymentSubmissionAcknowledgmentEmail(toEmail, details),
        "subscription payment submission acknowledgment"
    );
}

function generateSlug(storeName) {
    return storeName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

// ===== ENV SECURITY CHANGE: Update obsolete database configuration comment BEGIN =====
// MySQL connection settings are provided through environment variables.
// ===== ENV SECURITY CHANGE: Update obsolete database configuration comment END =====

// Database TLS: local DB_SSL=false; Azure DB_SSL=true requires trusted CA and hostname verification.
function stocknbookDatabaseTlsOptions() {
    const mode = String(process.env.DB_SSL ?? "false").trim().toLowerCase();
    if (mode !== "true" && mode !== "false") {
        throw new Error("DB_SSL must be true or false.");
    }
    if (process.env.NODE_ENV === "production" && mode !== "true") {
        throw new Error("DB_SSL=true is required for production database connections.");
    }
    if (mode === "false") return undefined;

    const caPath = String(process.env.DB_SSL_CA_PATH || "").trim();
    return {
        rejectUnauthorized: true,
        verifyIdentity: true,
        minVersion: "TLSv1.2",
        ...(caPath ? { ca: require("node:fs").readFileSync(caPath, "utf8") } : {}),
    };
}

const dbConfig = {
    // ===== ENV SECURITY CHANGE: MySQL environment configuration BEGIN =====
    host: requiredEnv("DB_HOST"),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_NAME"),
    port: Number(process.env.DB_PORT || 3306),
    // ===== ENV SECURITY CHANGE: MySQL environment configuration END =====
    ssl: stocknbookDatabaseTlsOptions(),
};

// Reuse database connections across warm requests. This avoids paying the
// TCP/TLS/database handshake cost for every dashboard API call.
const dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});




// Session revocation is enforced against existing users/platform_admins.auth_version.
// Every newly issued account JWT includes this claim; tokens from prior builds
// are intentionally rejected, so users must sign in once after deployment.
async function isCurrentAccountSession(connection, decoded) {
    const version = decoded?.auth_version;
    if (!Number.isSafeInteger(version) || version < 0) return false;
    const role = String(decoded?.role || "").trim().toLowerCase();
    if (role === "platform_admin") {
        const adminId = Number(decoded.platform_admin_id);
        if (!Number.isSafeInteger(adminId) || adminId < 1) return false;
        const [rows] = await connection.execute(
            "SELECT auth_version, email, status, role FROM platform_admins WHERE id = ? LIMIT 1", [adminId]);
        const admin = rows[0];
        return !!admin && String(admin.status).toLowerCase() === "active" &&
            String(admin.role).toLowerCase() === "platform_admin" &&
            Number(admin.auth_version) === version &&
            String(admin.email).toLowerCase() === String(decoded.email || "").toLowerCase();
    }
    if (!["owner", "manager", "staff"].includes(role)) return false;
    const accountId = Number(role === "owner" ? decoded.user_id :
        role === "manager" ? decoded.manager_id : decoded.staff_id);
    const storeId = Number(decoded.store_id);
    if (!Number.isSafeInteger(accountId) || accountId < 1 ||
        !Number.isSafeInteger(storeId) || storeId < 1) return false;
    const [rows] = await connection.execute(
        "SELECT auth_version, email, status, role, store_id, branch_id FROM users WHERE id = ? LIMIT 1", [accountId]);
    const user = rows[0];
    if (!user || String(user.status).toLowerCase() !== "active" ||
        String(user.role).toLowerCase() !== role ||
        Number(user.store_id) !== storeId || Number(user.auth_version) !== version ||
        String(user.email).toLowerCase() !== String(decoded.email || "").toLowerCase()) return false;
    return role === "owner" ||
        (Number.isSafeInteger(Number(decoded.branch_id)) &&
            Number(decoded.branch_id) > 0 && Number(user.branch_id) === Number(decoded.branch_id));
}

function getBearerTokenFromEvent(event) {
    const authHeader =
        event.headers?.Authorization || event.headers?.authorization || "";
    return String(authHeader).replace(/^Bearer\s+/i, "").trim();
}

// A valid JWT alone is not enough: the account must still be active in the
// same store, and a Manager/Staff account must still belong to the branch in
// its session. A deactivated or reassigned employee is rejected even before
// the session expires.
async function findActiveStoreAccount(connection, decoded) {
    const role = String(decoded?.role || "").toLowerCase();
    const storeId = Number(decoded?.store_id);
    if (!Number.isInteger(storeId) || storeId <= 0) return null;

    if (role === "owner") {
        const ownerId = Number(decoded?.user_id);
        const [rows] = await connection.execute(
            `SELECT id FROM users
             WHERE store_id = ? AND role = 'owner' AND LOWER(status) = 'active'
               AND (? = 0 OR id = ?)
                 LIMIT 1`,
            [storeId, Number.isInteger(ownerId) && ownerId > 0 ? 1 : 0, Number.isInteger(ownerId) && ownerId > 0 ? ownerId : 0]
        );
        return rows[0] || null;
    }

    if (role === "manager" || role === "staff") {
        const accountId = Number(role === "manager" ? decoded?.manager_id : decoded?.staff_id);
        const branchId = Number(decoded?.branch_id);
        if (!Number.isInteger(accountId) || accountId <= 0 ||
            !Number.isInteger(branchId) || branchId <= 0) return null;
        const [rows] = await connection.execute(
            `SELECT id FROM users
             WHERE id = ? AND store_id = ? AND branch_id = ? AND role = ?
               AND LOWER(status) = 'active'
                 LIMIT 1`,
            [accountId, storeId, branchId, role]
        );
        return rows[0] || null;
    }

    return null;
}

/*
 * Owner Branch Manager management helpers.
 * The Owner manages a Manager's account information, branch assignment,
 * invitation and access. The Owner can never read or set the Manager's
 * password, and a verified login email is never replaced without first
 * verifying the new address.
 */
const MANAGER_EMAIL_CHANGE_OTP_EXPIRY_SECONDS = OTP_EXPIRY_SECONDS;

async function requireOwnerForManagerManagement(connection, event) {
    const token = getBearerTokenFromEvent(event);
    if (!token) throw securityError(401, "Missing token", "AUTH_REQUIRED");
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        throw securityError(401, "Invalid token", "AUTH_INVALID_TOKEN");
    }
    if (decoded.role !== "owner" || !Number(decoded.store_id)) {
        throw securityError(403, "Only the store owner can manage branch managers.", "OWNER_REQUIRED");
    }
    if (!(await findActiveStoreAccount(connection, decoded))) {
        throw securityError(403, "Owner account could not be verified.", "OWNER_REQUIRED");
    }
    return decoded;
}

function maskEmailAddress(value) {
    const [local = "", domain = ""] = String(value || "").split("@");
    if (!domain) return "***";
    return `${local.slice(0, Math.min(3, local.length))}***@${domain}`;
}

// Issues a brand-new invitation token for a pending Manager. The stored hash
// is replaced, so every earlier invitation link stops working, and earlier
// invitation OTPs for the old/new address are invalidated. Must run inside the
// caller's transaction; the email is delivered after commit.
async function rotatePendingManagerInvitation(connection, { managerId, storeId, previousEmails = [] }) {
    const [rows] = await connection.execute(
        `SELECT managers.id, managers.full_name AS manager_name, managers.email AS manager_email,
                managers.branch_id, managers.status, branches.branch_name, stores.store_name
         FROM users managers
                  JOIN branches ON branches.id = managers.branch_id AND branches.store_id = managers.store_id
                  JOIN stores ON stores.id = managers.store_id
         WHERE managers.id = ? AND managers.store_id = ? AND managers.role = 'manager'
             LIMIT 1`,
        [managerId, storeId]
    );
    const manager = rows[0];
    if (!manager || String(manager.status || "").toLowerCase() !== "pending") {
        throw securityError(409, "Only pending manager invitations can be re-issued.", "INVITE_NOT_PENDING");
    }

    const inviteToken = jwt.sign(
        {
            store_id: storeId,
            branch_id: Number(manager.branch_id),
            email: manager.manager_email,
            type: "manager_invite",
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );

    await connection.execute(
        `UPDATE users
         SET invite_token_hash = SHA2(?, 256)
         WHERE id = ? AND store_id = ? AND role = 'manager' AND status = 'pending'`,
        [inviteToken, managerId, storeId]
    );

    const emails = [...new Set([manager.manager_email, ...previousEmails]
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean))];
    for (const email of emails) {
        await connection.execute(
            `UPDATE otp_codes
             SET used_at = COALESCE(used_at, UTC_TIMESTAMP()), invalidated_at = UTC_TIMESTAMP()
             WHERE purpose = 'manager_invite' AND email = ? AND invalidated_at IS NULL`,
            [email]
        );
    }

    const inviteLink = `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
    return {
        inviteLink,
        invitation: {
            manager_email: manager.manager_email,
            manager_name: manager.manager_name,
            store_name: manager.store_name || "StockNBook Store",
            branch_name: manager.branch_name || "Assigned Branch",
            invite_link: inviteLink,
            permissions: normalizeManagerRolePermissions(),
        },
    };
}

async function deliverRotatedManagerInvitation(invitation) {
    return deliverInvitationEmail({
        role: "Manager",
        email: invitation.manager_email,
        name: invitation.manager_name,
        storeName: invitation.store_name,
        branchName: invitation.branch_name,
        inviteLink: invitation.invite_link,
        send: () => sendManagerInvitationEmail(invitation),
    });
}

function buildManagerEmailChangeOtpEmail(managerName, storeName, otp) {
    const safeName = escapeHtml(managerName || "Manager");
    const safeStore = escapeHtml(storeName || "StockNBook");
    const safeOtp = escapeHtml(otp);
    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1A1220;line-height:1.6;max-width:520px;margin:0 auto;padding:24px;">
<h2 style="margin:0 0 12px;color:#2B174C;">Confirm your new StockNBook login email</h2>
<p>Hello ${safeName},</p>
<p>The owner of <strong>${safeStore}</strong> requested to change your manager account's login email to this address.</p>
<p>Give this verification code to the store owner only if you requested or agreed to this change:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#2B174C;margin:16px 0;">${safeOtp}</p>
<p>The code expires in ${Math.round(MANAGER_EMAIL_CHANGE_OTP_EXPIRY_SECONDS / 60)} minutes. If you did not expect this, ignore this email and your login email will not change.</p>
</div>`;
}

async function sendManagerEmailChangeOtp(toEmail, managerName, storeName, otp) {
    if (LOCAL_OTP_CONSOLE_ONLY) {
        return deliverOtpToLocalTerminal("Manager email change", toEmail, otp, MANAGER_EMAIL_CHANGE_OTP_EXPIRY_SECONDS);
    }
    return sendRecoveryMail(
        toEmail,
        "Confirm your new StockNBook login email",
        buildManagerEmailChangeOtpEmail(managerName, storeName, otp)
    );
}

// Subscription payment submissions are stored in subscription_payments.
async function getPlanColumnsForOwner() {
    return {
        id: "id",
        storeId: "store_id",
        planId: "plan_id",
        amount: "amount",
        reference: "reference_number",
        receipt: "receipt_storage_key",
        status: "status",
        createdAt: "submitted_at",
    };
}

function normalizePlanLimit(value) {
    if (value === null || value === undefined || Number(value) === 0) return null;
    return Number(value);
}

// These defaults mirror the Platform Admin dashboard. Database values always
// win, so an admin edit is reflected in the owner's checkout immediately.
const DEFAULT_PLATFORM_GCASH_SETTINGS = {
    account_name: "StockNBook Admin",
    gcash_number: "0917 123 4567",
    instruction: "Include your store name",
    qr_image: "",
};

async function getPlatformGcashPaymentSettings(connection) {
    // ===== GCASH QR BLOB CHANGE BEGIN =====
    const [rows] = await connection.execute(
        `SELECT \`key\`, value, image_data, image_mime_type
         FROM platform_settings
         WHERE \`key\` IN ('gcash_account_name', 'gcash_number', 'gcash_instruction', 'gcash_qr_image')`
    );

    const values = {};
    for (const row of rows) {
        const isQrBlob = row.key === "gcash_qr_image" && row.image_data &&
            ["image/png", "image/jpeg", "image/webp"].includes(row.image_mime_type);
        values[String(row.key)] = isQrBlob
            ? `data:${row.image_mime_type};base64,${Buffer.from(row.image_data).toString("base64")}`
            : String(row.value ?? "");
    }
    // ===== GCASH QR BLOB CHANGE END =====

    const paymentSettings = {
        account_name:
            values.gcash_account_name?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.account_name,
        gcash_number:
            values.gcash_number?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.gcash_number,
        instruction:
            values.gcash_instruction?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.instruction,
        qr_image:
            values.gcash_qr_image?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.qr_image,
    };

    return {
        ...paymentSettings,
        configured: Boolean(paymentSettings.account_name && paymentSettings.gcash_number),
    };
}

const BUILT_IN_SUBSCRIPTION_PLAN_TIER = {
    starter: 1,
    growth: 2,
    scale: 3,
};

function getSubscriptionPlanTier(plan) {
    if (!plan) return null;

    const explicitTier = Number(plan.tier_order);
    if (Number.isInteger(explicitTier) && explicitTier > 0) {
        return explicitTier;
    }

    return (
        BUILT_IN_SUBSCRIPTION_PLAN_TIER[
            String(plan.name || "").trim().toLowerCase()
            ] ?? null
    );
}

function getSubscriptionPlanDirection(currentPlan, targetPlan) {
    if (!currentPlan || !targetPlan) return null;
    if (Number(currentPlan.id) === Number(targetPlan.id)) return "current";

    const currentTier = getSubscriptionPlanTier(currentPlan);
    const targetTier = getSubscriptionPlanTier(targetPlan);

    if (currentTier !== null && targetTier !== null) {
        return targetTier > currentTier ? "upgrade" : "downgrade";
    }

    // Compatibility fallback for any custom plan that has no explicit/built-in tier.
    const currentPrice = Number(currentPlan.price || 0);
    const targetPrice = Number(targetPlan.price || 0);
    return targetPrice > currentPrice ? "upgrade" : "downgrade";
}

function dateOnlyUtc(value = new Date()) {
    return new Date(value).toISOString().slice(0, 10);
}

function addUtcDays(dateOnly, days) {
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + Number(days));
    return date.toISOString().slice(0, 10);
}

async function getPendingSubscriptionPlanChange(connection, storeId) {

    const [rows] = await connection.execute(
        `SELECT
             s.id,
             s.id AS subscription_id,
             s.store_id,
             s.plan_id AS current_plan_id,
             s.scheduled_plan_id AS target_plan_id,
             'DOWNGRADE' AS change_type,
             CASE
                 WHEN DATE(s.scheduled_change_at) <= UTC_DATE() AND COALESCE(target_plan.price, 0) > 0
             THEN 'AWAITING_PAYMENT'
             ELSE 'SCHEDULED'
        END AS status,
             'owner' AS requested_by_role,
             NULL AS requested_by_email,
             s.updated_at AS requested_at,
             s.scheduled_change_at AS effective_at,
             NULL AS cancelled_at,
             NULL AS applied_at,
             NULL AS notes,
             current_plan.plan_name AS current_plan_name,
             target_plan.plan_name AS target_plan_name,
             target_plan.price AS target_plan_price,
             target_plan.max_inventory AS target_max_inventory,
             target_plan.max_bookings AS target_max_bookings,
             target_plan.max_staff AS target_max_staff,
             target_plan.max_branches AS target_max_branches
         FROM subscriptions s
                  LEFT JOIN plans current_plan ON current_plan.id = s.plan_id
                  LEFT JOIN plans target_plan ON target_plan.id = s.scheduled_plan_id
         WHERE s.store_id = ?
           AND s.scheduled_plan_id IS NOT NULL
         ORDER BY s.id DESC
             LIMIT 1`,
        [storeId]
    );

    return rows[0] || null;
}

function serializeSubscriptionPlanChange(row) {
    if (!row) return null;

    return {
        id: Number(row.id),
        subscription_id:
            row.subscription_id == null ? null : Number(row.subscription_id),
        current_plan_id: Number(row.current_plan_id),
        current_plan_name: row.current_plan_name || null,
        target_plan_id: Number(row.target_plan_id),
        target_plan_name: row.target_plan_name || null,
        target_plan_price: Number(row.target_plan_price || 0),
        change_type: String(row.change_type || "DOWNGRADE").toUpperCase(),
        status: String(row.status || "SCHEDULED").toUpperCase(),
        requested_at: row.requested_at || null,
        effective_at: row.effective_at
            ? dateOnlyUtc(row.effective_at)
            : null,
    };
}

/*
 * Subscription lifecycle helpers.
 *
 * subscriptions (one row per store, uq_store_subscription) joined to plans is
 * the authoritative current subscription. stores.plan and users.plan are
 * cached copies of plans.plan_code for the business (users.plan is the same
 * store-level value on every Owner, Manager and Staff row). No code grants or
 * denies features from these cached columns; they are kept consistent inside
 * the same transaction whenever the effective plan changes.
 */
async function getStarterPlanRecord(connection) {
    const [rows] = await connection.execute(
        `SELECT id, plan_code, plan_name
         FROM plans
         WHERE LOWER(plan_code) = 'starter'
         ORDER BY is_archived ASC, id ASC
             LIMIT 1`
    );
    return rows[0] || null;
}

async function syncStorePlanCode(connection, storeId, planCode) {
    const code = String(planCode || "").trim().toLowerCase();
    if (!code || !Number(storeId)) return;
    await connection.execute(
        `UPDATE stores SET plan = ? WHERE id = ? AND plan <> ?`,
        [code, Number(storeId), code]
    );
    // users.updated_at is preserved: the account itself did not change.
    await connection.execute(
        `UPDATE users SET plan = ?, updated_at = updated_at WHERE store_id = ? AND plan <> ?`,
        [code, Number(storeId), code]
    );
}

// Creates the free Starter subscription for a newly registered store. The
// unique store_id key makes repeated calls a no-op, so a retried request can
// never create a second subscription or overwrite an existing paid one.
async function ensureStarterSubscription(connection, storeId) {
    const starter = await getStarterPlanRecord(connection);
    if (!starter) {
        throw Object.assign(
            new Error("The Starter plan is not configured. Registration cannot be completed."),
            { statusCode: 500, code: "PLAN_NOT_CONFIGURED" }
        );
    }
    await connection.execute(
        `INSERT INTO subscriptions
         (store_id, plan_id, status, started_at, expires_at, last_renewed_at,
          scheduled_plan_id, scheduled_change_at)
         VALUES (?, ?, 'active', NOW(), NULL, NULL, NULL, NULL)
             ON DUPLICATE KEY UPDATE id = id`,
        [Number(storeId), Number(starter.id)]
    );
    await syncStorePlanCode(connection, storeId, starter.plan_code);
    return starter;
}

// A Growth/Scale subscription is usable through its expiration date. From
// the next day, if no renewal was approved, the same subscription row reverts
// to the active Starter plan. Safe to call repeatedly and concurrently:
//  - a cheap probe avoids opening a transaction on every request;
//  - the row is re-read FOR UPDATE, so an approval that extended expires_at
//    (subscription-admin approvePayment also locks this row) is never
//    overwritten, and an approval that runs afterwards starts a new period;
//  - the EXPIRED notice is queued with INSERT IGNORE (uniq_expiry_notice), so
//    the expiry email is still delivered once by the scheduled job;
//  - subscription_payments rows are never touched.
// Callers must not hold an open transaction on this connection (same rule as
// processDueSubscriptionPlanChange).
async function revertExpiredPaidSubscriptionToStarter(connection, storeId) {
    const id = Number(storeId);
    if (!Number.isInteger(id) || id <= 0) return false;

    const [probe] = await connection.execute(
        `SELECT s.id
         FROM subscriptions s
                  INNER JOIN plans p ON p.id = s.plan_id
         WHERE s.store_id = ?
           AND p.price > 0
           AND s.expires_at IS NOT NULL
           AND DATE(s.expires_at) < CURDATE()
           AND LOWER(s.status) IN ('active', 'expiring', 'expired')
             LIMIT 1`,
        [id]
    );
    if (!probe.length) return false;

    const starter = await getStarterPlanRecord(connection);
    if (!starter) {
        throw Object.assign(
            new Error("The Starter plan is not configured."),
            { statusCode: 500, code: "PLAN_NOT_CONFIGURED" }
        );
    }

    await connection.beginTransaction();
    try {
        const [rows] = await connection.execute(
            `SELECT s.id, s.status, s.expires_at, p.price,
                    CASE WHEN s.expires_at IS NOT NULL AND DATE(s.expires_at) < CURDATE()
                 THEN 1 ELSE 0 END AS is_past_expiry
             FROM subscriptions s
                      INNER JOIN plans p ON p.id = s.plan_id
             WHERE s.store_id = ?
                 LIMIT 1
             FOR UPDATE`,
            [id]
        );
        const current = rows[0] || null;
        const stillExpiredPaid =
            current &&
            Number(current.price) > 0 &&
            Number(current.is_past_expiry) === 1 &&
            ["active", "expiring", "expired"].includes(String(current.status || "").toLowerCase());

        if (!stillExpiredPaid) {
            await connection.commit();
            return false;
        }

        await connection.execute(
            `INSERT IGNORE INTO subscription_expiry_notices
                 (subscription_id, expires_on, notice_type, delivery_status)
            SELECT id, DATE(expires_at), 'EXPIRED', 'PENDING'
            FROM subscriptions WHERE id = ? AND expires_at IS NOT NULL`,
            [Number(current.id)]
        );

        // Starter becomes effective the day after the paid expiration date.
        await connection.execute(
            `UPDATE subscriptions
             SET plan_id = ?,
                 status = 'active',
                 started_at = DATE_ADD(DATE(expires_at), INTERVAL 1 DAY),
                 expires_at = NULL,
                 last_renewed_at = NULL,
                 scheduled_plan_id = NULL,
                 scheduled_change_at = NULL
             WHERE id = ?
               AND expires_at IS NOT NULL
               AND DATE(expires_at) < CURDATE()`,
            [Number(starter.id), Number(current.id)]
        );

        await syncStorePlanCode(connection, id, starter.plan_code);
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function processDueSubscriptionPlanChange(connection, storeId) {
    const change = await getPendingSubscriptionPlanChange(connection, storeId);
    if (!change) return null;

    const status = String(change.status || "").toUpperCase();
    if (status !== "SCHEDULED") return change;

    const effectiveAt = change.effective_at
        ? dateOnlyUtc(change.effective_at)
        : null;

    if (!effectiveAt || effectiveAt > dateOnlyUtc()) {
        return change;
    }

    const [targetRows] = await connection.execute(
        `SELECT *, plan_name AS name FROM plans WHERE id = ? LIMIT 1`,
        [change.target_plan_id]
    );
    const targetPlan = targetRows[0] || null;

    if (!targetPlan || Number(targetPlan.is_archived) === 1) {
        await connection.execute(
            `UPDATE subscriptions
             SET scheduled_plan_id = NULL,
                 scheduled_change_at = NULL
             WHERE id = ? AND scheduled_plan_id IS NOT NULL`,
            [change.id]
        );
        return null;
    }

    // Paid lower-tier plans still require the owner's normal GCash payment and
    // platform-admin verification. The scheduled record simply makes that lower
    // plan eligible for payment after the current paid period ends.
    // The awaiting-payment state is derived from subscriptions.scheduled_change_at.
    if (Number(targetPlan.price || 0) > 0) {
        return getPendingSubscriptionPlanChange(connection, storeId);
    }

    // A free target plan (Starter) needs no GCash payment. Apply it automatically
    // when the current paid period has fully ended.
    await connection.beginTransaction();
    try {
        const [subscriptionRows] = await connection.execute(
            `SELECT * FROM subscriptions
             WHERE store_id = ?
             ORDER BY id DESC
                 LIMIT 1
             FOR UPDATE`,
            [storeId]
        );
        const subscription = subscriptionRows[0] || null;

        if (!subscription) {
            throw Object.assign(
                new Error("The current subscription record could not be found."),
                { statusCode: 409 }
            );
        }

        // Re-check under the row lock: an approved payment clears the scheduled
        // change, and that newer approval must never be overwritten.
        const stillScheduled =
            Number(subscription.scheduled_plan_id) === Number(targetPlan.id) &&
            subscription.scheduled_change_at &&
            dateOnlyUtc(subscription.scheduled_change_at) <= dateOnlyUtc();

        if (!stillScheduled) {
            await connection.commit();
            return null;
        }

        await connection.execute(
            `UPDATE subscriptions
             SET plan_id = ?,
                 status = 'active',
                 started_at = ?,
                 expires_at = NULL,
                 last_renewed_at = NULL,
                 scheduled_plan_id = NULL,
                 scheduled_change_at = NULL
             WHERE id = ?`,
            [targetPlan.id, effectiveAt, subscription.id]
        );

        // Keep the cached store/user plan code consistent in the same transaction.
        await syncStorePlanCode(connection, storeId, targetPlan.plan_code);

        // The UPDATE above applied the plan and cleared the scheduled change.
        await connection.commit();
        return null;
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

function getDowngradeUsageIssues(snapshot, targetPlan) {
    const checks = [
        {
            key: "inventory",
            label: "Inventory",
            current: Number(snapshot.usage.inventory || 0),
            limit: normalizePlanLimit(targetPlan.max_inventory),
        },
        {
            key: "bookings",
            label: "Bookings",
            current: Number(snapshot.usage.bookings || 0),
            limit: normalizePlanLimit(targetPlan.max_bookings),
        },
        {
            key: "staff",
            label: "Staff",
            current: Number(snapshot.usage.staff || 0),
            limit: normalizePlanLimit(targetPlan.max_staff),
        },
        {
            key: "branches",
            label: "Branches",
            current: Number(snapshot.usage.branches || 0),
            limit: normalizePlanLimit(targetPlan.max_branches),
        },
    ];

    return checks.filter(
        (item) => item.limit !== null && item.current > Number(item.limit)
    );
}

async function getStoreSubscriptionSnapshot(connection, storeId) {
    const [subscriptionRows] = await connection.execute(
        `SELECT
             s.id AS subscription_id,
             s.plan_id,
             s.status,
             s.started_at,
             s.expires_at,
             p.id AS plan_id_joined,
             p.plan_name AS name,
             p.price,
             p.max_inventory,
             p.max_bookings,
             p.max_staff,
             p.max_branches,
             p.has_low_stock_alerts,
             p.has_analytics,
             p.has_forecasting,
             p.has_multi_store,
             p.is_archived
         FROM subscriptions s
                  INNER JOIN plans p ON p.id = s.plan_id
         WHERE s.store_id = ?
         ORDER BY s.id DESC
             LIMIT 1`,
        [storeId]
    );

    let subscription = subscriptionRows[0] || null;

    if (!subscription) {
        const [starterRows] = await connection.execute(
            `SELECT
                 id AS plan_id,
                 plan_name AS name,
                 price,
                 max_inventory,
                 max_bookings,
                 max_staff,
                 max_branches,
                 has_low_stock_alerts,
                 has_analytics,
                 has_forecasting,
                 has_multi_store,
                 is_archived
             FROM plans
             WHERE is_archived = 0
               AND (LOWER(plan_code) = 'starter' OR LOWER(plan_name) = 'starter' OR price = 0)
             ORDER BY price ASC, id ASC
                 LIMIT 1`
        );

        subscription = starterRows[0]
            ? {
                ...starterRows[0],
                subscription_id: null,
                status: "active",
                started_at: null,
                expires_at: null,
            }
            : null;
    }

    if (!subscription) {
        const error = new Error("No active plan is configured for this platform.");
        error.statusCode = 500;
        throw error;
    }

    // Use the same usage calculation as the plan-enforcement layer so a
    // downgrade cannot be approved by the Subscription page while another
    // module would still consider the store above the target plan limit.
    const usage = await getStoreUsage(connection, storeId);

    const [pendingPaymentRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM subscription_payments
         WHERE store_id = ?
           AND UPPER(status) = 'PENDING'`,
        [storeId]
    );

    const expiresAt = subscription.expires_at
        ? dateOnlyUtc(subscription.expires_at)
        : null;

    let displayStatus = String(subscription.status || "active").toUpperCase();
    if (
        displayStatus !== "CANCELLED" &&
        expiresAt &&
        expiresAt < dateOnlyUtc()
    ) {
        displayStatus = "EXPIRED";
    }

    return {
        subscription_id:
            subscription.subscription_id == null
                ? null
                : Number(subscription.subscription_id),
        status: displayStatus,
        started_at: subscription.started_at || null,
        expires_at: expiresAt,
        plan: {
            id: Number(subscription.plan_id || subscription.plan_id_joined),
            name: subscription.name,
            price: Number(subscription.price || 0),
            max_inventory: normalizePlanLimit(subscription.max_inventory),
            max_bookings: normalizePlanLimit(subscription.max_bookings),
            max_staff: normalizePlanLimit(subscription.max_staff),
            max_branches: normalizePlanLimit(subscription.max_branches),
            has_low_stock_alerts: Boolean(subscription.has_low_stock_alerts),
            has_analytics: Boolean(subscription.has_analytics),
            has_forecasting: Boolean(subscription.has_forecasting),
            has_multi_store: Boolean(subscription.has_multi_store),
        },
        usage: {
            inventory: Number(usage.inventory || 0),
            bookings: Number(usage.bookings || 0),
            staff: Number(usage.staff || 0),
            branches: Number(usage.branches || 0),
        },
        pending_payment: Number(pendingPaymentRows[0]?.total || 0) > 0,
    };
}

async function getOwnerSubscription(connection, storeId) {
    await processDueSubscriptionPlanChange(connection, storeId);
    // Apply an expired paid plan's Starter reversion before the snapshot so the
    // Subscription / Plan & Usage pages show the current effective record.
    await revertExpiredPaidSubscriptionToStarter(connection, storeId);

    const snapshot = await getStoreSubscriptionSnapshot(connection, storeId);
    const pendingChange = await getPendingSubscriptionPlanChange(connection, storeId);

    const [planRows] = await connection.execute(
        `SELECT
             id,
             plan_name AS name,
             price,
             max_inventory,
             max_bookings,
             max_staff,
             max_branches,
             has_low_stock_alerts,
             has_analytics,
             has_forecasting,
             has_multi_store
         FROM plans
         WHERE is_archived = 0
         ORDER BY
             CASE LOWER(plan_name)
                 WHEN 'starter' THEN 1
                 WHEN 'growth' THEN 2
                 WHEN 'scale' THEN 3
                 ELSE 100
                 END ASC,
             price ASC,
             id ASC`
    );

    const effectivePlan = await getActivePlan(connection, storeId);
    const expiryDay = snapshot.expires_at;
    const dateToday = dateOnlyUtc();
    const daysUntilExpiration = expiryDay
        ? Math.round((Date.parse(`${expiryDay}T00:00:00Z`) - Date.parse(`${dateToday}T00:00:00Z`)) / 86400000)
        : null;
    const status = String(snapshot.status || '').toUpperCase();
    const displayStatus = status === 'ACTIVE' && daysUntilExpiration !== null &&
    daysUntilExpiration >= 0 && daysUntilExpiration <= 7 && Number(snapshot.plan.price) > 0
        ? 'EXPIRING' : status;
    return {
        ...snapshot,
        status: displayStatus,
        effective_plan: effectivePlan,
        access_status: effectivePlan?.access_status || 'STARTER_FALLBACK',
        days_until_expiration: daysUntilExpiration,
        scheduled_change: serializeSubscriptionPlanChange(pendingChange),
        available_plans: planRows.map((row) => ({
            id: Number(row.id),
            name: row.name,
            price: Number(row.price || 0),
            max_inventory: normalizePlanLimit(row.max_inventory),
            max_bookings: normalizePlanLimit(row.max_bookings),
            max_staff: normalizePlanLimit(row.max_staff),
            max_branches: normalizePlanLimit(row.max_branches),
            has_low_stock_alerts: Boolean(row.has_low_stock_alerts),
            has_analytics: Boolean(row.has_analytics),
            has_forecasting: Boolean(row.has_forecasting),
            has_multi_store: Boolean(row.has_multi_store),
        })),
    };
}

async function requestOwnerSubscriptionDowngrade(connection, decoded, body) {
    if (decoded.role !== "owner" || !decoded.store_id) {
        const error = new Error("Only the store owner can request a downgrade.");
        error.statusCode = 403;
        throw error;
    }

    const storeId = Number(decoded.store_id);
    const targetPlanId = Number(body.plan_id);

    if (!Number.isInteger(targetPlanId) || targetPlanId <= 0) {
        const error = new Error("Select a valid downgrade plan.");
        error.statusCode = 400;
        throw error;
    }

    await processDueSubscriptionPlanChange(connection, storeId);

    const snapshot = await getStoreSubscriptionSnapshot(connection, storeId);
    if (!snapshot.subscription_id) {
        const error = new Error("The current plan does not have a lower subscription tier to schedule.");
        error.statusCode = 409;
        throw error;
    }

    if (snapshot.pending_payment) {
        const error = new Error("Finish the payment request that is already awaiting review before scheduling another plan change.");
        error.statusCode = 409;
        throw error;
    }

    const [targetRows] = await connection.execute(
        `SELECT *, plan_name AS name FROM plans WHERE id = ? AND is_archived = 0 LIMIT 1`,
        [targetPlanId]
    );
    const targetPlan = targetRows[0] || null;

    if (!targetPlan) {
        const error = new Error("The selected downgrade plan is no longer available.");
        error.statusCode = 404;
        throw error;
    }

    const direction = getSubscriptionPlanDirection(snapshot.plan, {
        id: Number(targetPlan.id),
        name: targetPlan.name,
        price: Number(targetPlan.price || 0),
    });

    if (direction !== "downgrade") {
        const error = new Error("The selected plan is not a lower subscription tier.");
        error.statusCode = 409;
        throw error;
    }

    const issues = getDowngradeUsageIssues(snapshot, targetPlan);
    if (issues.length) {
        const details = issues
            .map(
                (item) =>
                    `${item.label}: ${item.current} / ${item.limit}`
            )
            .join("; ");
        const error = new Error(
            `Your current usage exceeds the ${targetPlan.name} plan limits. ${details}`
        );
        error.statusCode = 409;
        error.usage_issues = issues;
        throw error;
    }

    const existingChange = await getPendingSubscriptionPlanChange(connection, storeId);
    if (existingChange) {
        const error = new Error(
            `A ${String(existingChange.target_plan_name || "lower-tier")} downgrade is already ${String(existingChange.status || "scheduled").toLowerCase().replace(/_/g, " ")}. Cancel it before requesting another downgrade.`
        );
        error.statusCode = 409;
        throw error;
    }

    const currentExpiry = snapshot.expires_at;
    const effectiveAt = currentExpiry
        ? addUtcDays(currentExpiry, 1)
        : dateOnlyUtc();

    const [result] = await connection.execute(
        `UPDATE subscriptions
         SET scheduled_plan_id = ?,
             scheduled_change_at = ?
         WHERE id = ?
           AND store_id = ?`,
        [
            targetPlan.id,
            effectiveAt,
            snapshot.subscription_id,
            storeId,
        ]
    );

    // If the current period is already over, immediately advance the scheduled
    // record to the correct next state (automatic Starter or awaiting paid plan).
    await processDueSubscriptionPlanChange(connection, storeId);
    const scheduled = await getPendingSubscriptionPlanChange(connection, storeId);

    return {
        message:
            Number(targetPlan.price || 0) > 0
                ? `Downgrade to ${targetPlan.name} scheduled. Your current plan remains active through its paid period; payment for ${targetPlan.name} will be requested when the downgrade becomes effective.`
                : `Downgrade to ${targetPlan.name} scheduled. It will apply automatically after the current paid period ends.`,
        change_id: Number(result.affectedRows ? snapshot.subscription_id : 0),
        scheduled_change: serializeSubscriptionPlanChange(scheduled),
    };
}

async function cancelOwnerSubscriptionDowngrade(connection, decoded) {
    if (decoded.role !== "owner" || !decoded.store_id) {
        const error = new Error("Only the store owner can cancel a scheduled downgrade.");
        error.statusCode = 403;
        throw error;
    }

    const storeId = Number(decoded.store_id);
    await processDueSubscriptionPlanChange(connection, storeId);

    const change = await getPendingSubscriptionPlanChange(connection, storeId);
    if (!change) {
        const error = new Error("There is no scheduled downgrade to cancel.");
        error.statusCode = 404;
        throw error;
    }

    const changeStatus = String(change.status || "").toUpperCase();
    const effectiveAt = change.effective_at ? dateOnlyUtc(change.effective_at) : null;

    if (changeStatus !== "SCHEDULED" || (effectiveAt && effectiveAt <= dateOnlyUtc())) {
        const error = new Error(
            "This downgrade has already reached its effective date and can no longer be cancelled from the owner screen."
        );
        error.statusCode = 409;
        throw error;
    }

    const [pendingPaymentRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM subscription_payments
         WHERE store_id = ?
           AND UPPER(status) = 'PENDING'`,
        [storeId]
    );

    if (Number(pendingPaymentRows[0]?.total || 0) > 0) {
        const error = new Error("A subscription payment is already awaiting review. Resolve that payment before cancelling the downgrade.");
        error.statusCode = 409;
        throw error;
    }

    await connection.execute(
        `UPDATE subscriptions
         SET scheduled_plan_id = NULL,
             scheduled_change_at = NULL
         WHERE id = ?
           AND scheduled_plan_id IS NOT NULL`,
        [change.id]
    );

    return {
        message: "Scheduled downgrade cancelled.",
        cancelled_change_id: Number(change.id),
    };
}

async function submitOwnerPlanPayment(connection, decoded, body) {
    if (decoded.role !== "owner" || !decoded.store_id) {
        const error = new Error("Only the store owner can change the subscription.");
        error.statusCode = 403;
        throw error;
    }

    const storeId = Number(decoded.store_id);
    const planId = Number(body.plan_id);
    const referenceNumber = String(body.reference_number || "").trim();
    const receiptMimeType = String(body.receipt_mime_type || "").trim().toLowerCase();
    const receiptBase64 = body.receipt_base64;
    const maxReceiptBytes = 5 * 1024 * 1024;
    const maxBase64Length = Math.ceil(maxReceiptBytes / 3) * 4;
    const receiptTypes = ["image/png", "image/jpeg", "image/webp"];

    if (!receiptTypes.includes(receiptMimeType) || typeof receiptBase64 !== "string" ||
        !receiptBase64 || receiptBase64.length > maxBase64Length ||
        receiptBase64.length % 4 !== 0) {
        const error = new Error("Upload a valid PNG, JPG, JPEG, or WEBP receipt (maximum 5 MB).");
        error.statusCode = 400;
        throw error;
    }

    const receiptData = Buffer.from(receiptBase64, "base64");
    // Round-trip validation rejects malformed / noncanonical base64 without a
    // large, backtracking regular expression for multi-megabyte uploads.
    if (receiptData.toString("base64") !== receiptBase64) {
        const error = new Error("The receipt image data is invalid.");
        error.statusCode = 400;
        throw error;
    }
    if (!receiptData.length || receiptData.length > maxReceiptBytes) {
        const error = new Error("The receipt image must be 5 MB or smaller.");
        error.statusCode = 400;
        throw error;
    }

    // Content signature check: do not trust the browser's declared MIME type.
    const validImage = receiptMimeType === "image/png"
        ? receiptData.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : receiptMimeType === "image/jpeg"
            ? receiptData.length >= 3 && receiptData[0] === 255 && receiptData[1] === 216 && receiptData[2] === 255
            : receiptData.length >= 12 && receiptData.toString("ascii", 0, 4) === "RIFF" &&
            receiptData.toString("ascii", 8, 12) === "WEBP";
    if (!validImage) {
        const error = new Error("The selected file is not a valid receipt image.");
        error.statusCode = 400;
        throw error;
    }

    if (!Number.isInteger(planId) || planId <= 0) {
        const error = new Error("Select a valid plan.");
        error.statusCode = 400;
        throw error;
    }

    if (!referenceNumber || referenceNumber.length < 4 || referenceNumber.length > 120) {
        const error = new Error("Enter a valid GCash reference number.");
        error.statusCode = 400;
        throw error;
    }

    await processDueSubscriptionPlanChange(connection, storeId);
    // An expired paid plan is first reverted to Starter, so the requested paid
    // plan is evaluated against the store's real effective plan.
    await revertExpiredPaidSubscriptionToStarter(connection, storeId);

    const [planRows] = await connection.execute(
        `SELECT *, plan_name AS name FROM plans WHERE id = ? AND is_archived = 0 LIMIT 1`,
        [planId]
    );
    const targetPlan = planRows[0];

    if (!targetPlan) {
        const error = new Error("The selected plan is no longer available.");
        error.statusCode = 404;
        throw error;
    }

    if (Number(targetPlan.price || 0) <= 0) {
        const error = new Error("Starter does not require a payment submission.");
        error.statusCode = 400;
        throw error;
    }

    const snapshot = await getStoreSubscriptionSnapshot(connection, storeId);
    const direction = getSubscriptionPlanDirection(snapshot.plan, {
        id: Number(targetPlan.id),
        name: targetPlan.name,
        price: Number(targetPlan.price || 0),
    });

    // Once the previous paid term has expired, a new paid plan may be chosen
    // freely; there is no remaining paid period to schedule a downgrade for.
    if (direction === "downgrade" && snapshot.status !== "EXPIRED") {
        const scheduled = await getPendingSubscriptionPlanChange(connection, storeId);
        const validScheduledDowngrade =
            scheduled &&
            String(scheduled.status || "").toUpperCase() === "AWAITING_PAYMENT" &&
            Number(scheduled.target_plan_id) === Number(targetPlan.id);

        if (!validScheduledDowngrade) {
            const error = new Error(
                "Lower-tier paid plans must first be requested as a downgrade and become due at the end of the current paid period."
            );
            error.statusCode = 409;
            throw error;
        }
    }

    const columns = await getPlanColumnsForOwner(connection);

    const [pendingRows] = await connection.execute(
        `SELECT ${columns.id} AS payment_id
         FROM subscription_payments
         WHERE ${columns.storeId} = ?
           AND UPPER(${columns.status}) = 'PENDING'
             LIMIT 1`,
        [storeId]
    );

    if (pendingRows.length) {
        const error = new Error("You already have a payment awaiting platform admin review.");
        error.statusCode = 409;
        throw error;
    }

    const [duplicateRows] = await connection.execute(
        `SELECT ${columns.id} AS payment_id
         FROM subscription_payments
         WHERE ${columns.reference} = ?
           AND UPPER(${columns.status}) IN ('PENDING', 'APPROVED')
             LIMIT 1`,
        [referenceNumber]
    );

    if (duplicateRows.length) {
        const error = new Error("That GCash reference number has already been submitted.");
        error.statusCode = 409;
        throw error;
    }


    const otp = String(body.otp || "").trim();

    if (!/^\d{6}$/.test(otp)) {
        const error = new Error("Enter the 6-digit verification code sent to your email.");
        error.statusCode = 400;
        throw error;
    }

    await checkOtp(connection, otpScope("subscription_payment", "", storeId), otp, true);

    const insertColumns = [
        columns.storeId,
        columns.planId,
        "subscription_id",
        columns.amount,
        "payment_method",
        columns.reference,
        columns.status,
    ];
    const insertValues = [
        storeId,
        planId,
        snapshot.subscription_id || null,
        Number(targetPlan.price),
        "GCash",
        referenceNumber,
        "pending",
    ];

    // Store the image with the payment record, not in a publicly accessible path.
    insertColumns.push("receipt_data", "receipt_mime_type");
    insertValues.push(receiptData, receiptMimeType);

    if (columns.createdAt) {
        insertColumns.push(columns.createdAt);
        insertValues.push(new Date());
    }

    const placeholders = insertColumns.map(() => "?").join(", ");
    const [result] = await connection.execute(
        `INSERT INTO subscription_payments (${insertColumns.join(", ")}) VALUES (${placeholders})`,
        insertValues
    );

    return {
        message: "Payment submitted for platform admin review.",
        payment_submission_id: Number(result.insertId),
        plan_name: targetPlan.name,
        amount: Number(targetPlan.price),
    };
}

module.exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    let body = {};

    try {
        body = JSON.parse(event.body || "{}");
    } catch (err) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid JSON body" }),
        };
    }

    let { action } = body;
    const { store_name, password } = body;
    const email = ["login", "platform_admin_login"].includes(action) && typeof body.email === "string"
        ? body.email.trim().toLowerCase() : body.email;

    let connection;

    try {
        connection = await dbPool.getConnection();

        // A valid signature alone is insufficient after password reset or
        // deactivation. Check the current account version for every bearer request.
        const presentedToken = getBearerTokenFromEvent(event);
        if (presentedToken) {
            let accountSession;
            try { accountSession = jwt.verify(presentedToken, JWT_SECRET, { algorithms: ["HS256"] }); }
            catch { throw securityError(401, "Your session has expired. Please log in again.", "ACCOUNT_SESSION_INVALID"); }
            if (!(await isCurrentAccountSession(connection, accountSession))) {
                securityEvent("revoked_session_rejected", { role: String(accountSession.role || "unknown") });
                throw securityError(401, "Your session has expired. Please log in again.", "ACCOUNT_SESSION_INVALID");
            }
        }

        if (["request_password_reset", "verify_password_reset_otp", "reset_password"].includes(action))
            return await recoveryAction(connection, action, body, headers);

        let authenticatedAccount = null;
        if (action === "login" || action === "platform_admin_login") {
            if (typeof email !== "string" || !email || email.length > 255 || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 1024)
                throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
            authenticatedAccount = await authenticateAccount(connection, "platform_admins", email, password);
            if (authenticatedAccount) action = "platform_admin_login";
            else if (action === "login") authenticatedAccount = await authenticateAccount(connection, "users", email, password);
            if (!authenticatedAccount) {
                // A dummy bcrypt check reduces registration timing differences; no fake account records.
                await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
                // Keep the same public response for nonexistent email and wrong password.
                securityEvent("login_failed_unknown", { outcome: "invalid_credentials" });
                throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
            }
        }

        if (action === "get_subscription") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const subscriptionRole = String(decoded.role || "").toLowerCase();
            const allowedSubscriptionRoles = ["owner", "manager", "staff"];

            if (!allowedSubscriptionRoles.includes(subscriptionRole) || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have access to this store's plan and usage details.",
                        code: "SUBSCRIPTION_VIEW_FORBIDDEN",
                    }),
                };
            }

            // The Analytics/Forecasting API gates also use this action, so a
            // deactivated or reassigned account must not pass it.
            if (!(await findActiveStoreAccount(connection, decoded))) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Your account is inactive or its branch assignment changed. Please sign in again.",
                        code: "ACCOUNT_SESSION_INVALID",
                    }),
                };
            }

            // Managers and staff receive the same store-level plan snapshot for
            // visibility, but only the owner receives management permission.
            const subscription = await getOwnerSubscription(connection, Number(decoded.store_id));
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    role: subscriptionRole,
                    can_manage_subscription: subscriptionRole === "owner",
                    subscription,
                }),
            };
        }

        if (action === "get_payment_settings") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            if (String(decoded.role || "").toLowerCase() !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can access subscription payment details.",
                    }),
                };
            }

            const paymentSettings = await getPlatformGcashPaymentSettings(connection);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ payment_settings: paymentSettings }),
            };
        }

        // SEND PAYMENT VERIFICATION OTP
        // Triggered when the owner opens the "Upgrade" payment-proof modal, before
        // they can submit a GCash reference number. Confirms it is really the
        // account owner (not just whoever is holding an open session) submitting
        // the proof of payment.
        if (action === "send_payment_otp") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can submit a subscription payment.",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);

            let ownerEmail = String(decoded.email || "").trim().toLowerCase();
            if (!ownerEmail) {
                const [storeRows] = await connection.execute(
                    `SELECT email FROM users WHERE store_id = ? AND role = 'owner' LIMIT 1`,
                    [storeId]
                );
                ownerEmail = String(storeRows[0]?.email || "").trim().toLowerCase();
            }

            if (!ownerEmail) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: "No email is on file for this account." }),
                };
            }


            await guardOtpSend(connection, otpScope("subscription_payment", "", storeId));

            // Preserve the existing payment-specific delivery safeguards in addition to the shared limits.
            const [recentRows] = await connection.execute(
                `SELECT COUNT(*) AS total,
                        TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(),
                                              DATE_ADD(MIN(created_at), INTERVAL ? MINUTE)) AS retry_after_seconds
                 FROM otp_codes
                 WHERE purpose = 'subscription_payment'
                   AND invalidated_at IS NULL
                   AND store_id = ?
                   AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
                   AND created_at <= UTC_TIMESTAMP()`,
                [PAYMENT_OTP_RATE_WINDOW_MINUTES, storeId, PAYMENT_OTP_RATE_WINDOW_MINUTES]
            );

            if (Number(recentRows[0]?.total || 0) >= PAYMENT_OTP_MAX_SENT_PER_WINDOW) {
                const retrySeconds = paymentOtpRetrySeconds(recentRows[0]?.retry_after_seconds);
                return paymentOtpCooldownResponse(
                    headers,
                    `Too many verification emails requested. Please try again in ${formatPaymentOtpWaitTime(retrySeconds)}.`,
                    retrySeconds,
                    "PAYMENT_OTP_RATE_LIMIT"
                );
            }

            // A broken Gmail connection must not permit unlimited retries.
            // Failed attempts have their own independent 10-minute allowance.
            const [failureRows] = await connection.execute(
                `SELECT COUNT(*) AS total,
                        TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(),
                                              DATE_ADD(MIN(created_at), INTERVAL ? MINUTE)) AS retry_after_seconds
                 FROM otp_codes
                 WHERE purpose = 'subscription_payment_email_failure'
                   AND store_id = ?
                   AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
                   AND created_at <= UTC_TIMESTAMP()`,
                [PAYMENT_OTP_RATE_WINDOW_MINUTES, storeId, PAYMENT_OTP_RATE_WINDOW_MINUTES]
            );

            if (Number(failureRows[0]?.total || 0) >= PAYMENT_OTP_MAX_FAILED_PER_WINDOW) {
                const retrySeconds = paymentOtpRetrySeconds(failureRows[0]?.retry_after_seconds);
                return paymentOtpCooldownResponse(
                    headers,
                    `Email delivery has failed repeatedly. Please wait ${formatPaymentOtpWaitTime(retrySeconds)} before trying again. If the issue persists, check the Auth Lambda Gmail SMTP connection.`,
                    retrySeconds,
                    "PAYMENT_OTP_EMAIL_COOLDOWN"
                );
            }

            let planName = null;
            if (body.plan_id) {
                const [planRows] = await connection.execute(
                    `SELECT plan_name AS name FROM plans WHERE id = ? LIMIT 1`,
                    [Number(body.plan_id)]
                );
                planName = planRows[0]?.name || null;
            }

            const otp = generateOtp();
            const otpHash = hashOtp(otp);

            // Keep this OTP unusable until the SMTP server accepts the email.
            // In particular, do not invalidate the owner's previous active code
            // when delivery of this replacement code fails.
            const [insertResult] = await connection.execute(
                `INSERT INTO otp_codes (purpose, store_id, email, otp_hash, expires_at, used_at, created_at)
                 VALUES ('subscription_payment', ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
                [storeId, ownerEmail, otpHash, PAYMENT_OTP_EXPIRY_SECONDS]
            );
            const newOtpId = Number(insertResult.insertId);

            try {
                await sendPaymentOtpEmail(ownerEmail, otp, planName);
            } catch (emailError) {
                // Remove the code that was never delivered. It will not count
                // toward the existing email-delivery limit; the shared request limit retains the record.
                try {
                    await connection.execute(
                        `UPDATE otp_codes SET invalidated_at = UTC_TIMESTAMP() WHERE id = ? AND store_id = ? AND purpose = 'subscription_payment' AND used_at IS NOT NULL`,
                        [newOtpId, storeId]
                    );
                } catch (cleanupError) {
                    console.error("[stocknbook-auth] Unable to clean up undelivered OTP:", {
                        store_id: storeId,
                        message: cleanupError?.message,
                    });
                }

                const smtpErrorCode = String(emailError?.code || "SMTP_DELIVERY_FAILED")
                    .replace(/[^A-Za-z0-9_]/g, "_").slice(0, 50);
                try {
                    await connection.execute(
                        `INSERT INTO otp_codes
                             (purpose, store_id, email, otp_hash, expires_at, used_at, created_at)
                         VALUES ('subscription_payment_email_failure', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
                        [storeId, ownerEmail, smtpErrorCode]
                    );
                } catch (trackingError) {
                    console.error("[stocknbook-auth] Unable to track OTP email failure:", {
                        store_id: storeId,
                        message: trackingError?.message,
                    });
                }

                console.error("[stocknbook-auth] Subscription OTP was not delivered:", {
                    store_id: storeId,
                    code: smtpErrorCode,
                    message: emailError?.message || "Unknown SMTP failure",
                });

                const deliveryError = new Error(
                    smtpErrorCode === "GMAIL_AUTH_FAILED" || smtpErrorCode === "SMTP_NOT_CONFIGURED"
                        ? "StockNBook could not authenticate its email sender. Ask the administrator to check the Auth Lambda Gmail App Password before retrying."
                        : "StockNBook could not send the verification email. No new code was activated. Please try again shortly or check the Auth Lambda email-service logs."
                );
                deliveryError.statusCode = 503;
                deliveryError.code = "PAYMENT_OTP_EMAIL_FAILED";
                throw deliveryError;
            }

            // Email accepted, or explicit local terminal mode: activate the new code atomically
            // and invalidate only the previously active code(s).
            await connection.beginTransaction();
            try {
                await connection.execute(
                    `UPDATE otp_codes SET used_at = UTC_TIMESTAMP() WHERE purpose = 'subscription_payment' AND store_id = ? AND used_at IS NULL`,
                    [storeId]
                );
                const [activation] = await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = NULL, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)
                     WHERE id = ? AND store_id = ? AND purpose = 'subscription_payment' AND used_at IS NOT NULL`,
                    [PAYMENT_OTP_EXPIRY_SECONDS, newOtpId, storeId]
                );
                if (Number(activation.affectedRows || 0) !== 1) {
                    throw new Error("The emailed OTP could not be activated in the database.");
                }
                await connection.commit();
            } catch (activationError) {
                await connection.rollback();
                throw activationError;
            }

            // Explicit local debug remains optional, but a failed email never
            // silently turns into a successful terminal-only OTP.
            if (PAYMENT_OTP_TERMINAL_DEBUG && !LOCAL_OTP_CONSOLE_ONLY) {
                console.log(
                    `[StockNBook DEV OTP] Subscription payment verification | ` +
                    `Store ID: ${storeId} | ` +
                    `Plan: ${planName || "Selected plan"} | ` +
                    `Email: ${ownerEmail} | ` +
                    `OTP: ${otp} | ` +
                    `Expires in: ${PAYMENT_OTP_EXPIRY_SECONDS}s`
                );
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: LOCAL_OTP_CONSOLE_ONLY
                        ? "Verification code generated for local testing. Check the IDE terminal."
                        : "Verification code sent to your email.",
                    delivery: LOCAL_OTP_CONSOLE_ONLY ? "terminal" : "email",
                    expires_in: PAYMENT_OTP_EXPIRY_SECONDS,
                    resend_in: OTP_RESEND_SECONDS,
                    email_hint: ownerEmail.replace(/^(.{2}).+(@.+)$/, "$1***$2"),
                }),
            };
        }

        // Non-consuming OTP confirmation for the animated checkout dialog.
        // Final payment submission still verifies and consumes the code atomically.
        if (action === "verify_payment_otp") {
            const token = getBearerTokenFromEvent(event);
            if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }
            if (decoded.role !== "owner" || !decoded.store_id) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: "Only the store owner can verify a subscription payment." }) };
            }

            const storeId = Number(decoded.store_id);
            const code = String(body.otp || "").trim();
            if (!/^\d{6}$/.test(code)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: "Enter a valid 6-digit code." }) };
            }

            await checkOtp(connection, otpScope("subscription_payment", "", storeId), code, false);

            return { statusCode: 200, headers, body: JSON.stringify({ verified: true }) };
        }

        if (action === "submit_subscription_payment") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const result = await submitOwnerPlanPayment(connection, decoded, body);

            // The payment INSERT succeeded. Email delivery is best-effort so an
            // SMTP outage never causes the owner to re-submit an existing payment.
            let confirmationEmailStatus = "failed";
            try {
                const [storeRows] = await connection.execute(
                    `SELECT s.store_name, u.email
                     FROM stores s
                              LEFT JOIN users u ON u.store_id = s.id AND u.role = 'owner'
                     WHERE s.id = ?
                         LIMIT 1`,
                    [Number(decoded.store_id)]
                );
                const store = storeRows[0];
                const ownerEmail = String(store?.email || "").trim().toLowerCase();
                if (ownerEmail) {
                    await sendPaymentSubmissionAcknowledgmentEmail(ownerEmail, {
                        ...result,
                        store_name: store.store_name,
                    });
                    confirmationEmailStatus = "sent";
                } else {
                    confirmationEmailStatus = "no_email_on_file";
                }
            } catch (notificationError) {
                console.error("[stocknbook-auth] Payment saved, but acknowledgment email failed:", {
                    payment_submission_id: result.payment_submission_id,
                    message: notificationError?.message || "Unknown email error",
                });
            }
            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    ...result,
                    confirmation_email_status: confirmationEmailStatus,
                }),
            };
        }

        if (action === "request_subscription_downgrade") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const result = await requestOwnerSubscriptionDowngrade(
                connection,
                decoded,
                body
            );
            return { statusCode: 201, headers, body: JSON.stringify(result) };
        }

        if (action === "cancel_subscription_downgrade") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const result = await cancelOwnerSubscriptionDowngrade(
                connection,
                decoded
            );
            return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        // SEND SIGNUP OTP
        if (action === "send_signup_otp") {
            requirePolicyAcceptance(body, "owner");

            const ownerName = String(
                body.owner_name ?? body.ownerName ?? ""
            ).trim();

            const storeName = cleanStoreName(body.store_name ?? body.storeName);

            const rawPhoneNumber = String(
                body.phone_number ?? body.phoneNumber ?? body.phone ?? ""
            ).trim();
            const phoneNumber = normalizePhilippineMobile(rawPhoneNumber) || rawPhoneNumber;

            const emailAddress = String(body.email ?? "").trim().toLowerCase();
            const accountPassword = String(body.password ?? "");

            if (!ownerName || !storeName || !phoneNumber || !emailAddress || !accountPassword) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Owner name, business name, phone number, email, and password are required.",
                    }),
                };
            }

            if (!normalizePhilippineMobile(phoneNumber)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid Philippine mobile number (e.g. 0912 345 6789)." }),
                };
            }

            if (!/^\S+@\S+\.\S+$/.test(emailAddress)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid email address." }),
                };
            }

            if (!passwordPolicy(accountPassword)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: passwordPolicyError(accountPassword) }),
                };
            }

            if (storeName.length > 180 || !/[\p{L}\p{N}]/u.test(storeName)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Business name must contain letters or numbers and be at most 180 characters." }),
                };
            }

            await authLock(connection, `account:${emailAddress}`);
            const [existing] = await connection.execute(
                `SELECT id FROM users WHERE email = ? UNION ALL SELECT id FROM platform_admins WHERE email = ? LIMIT 1`,
                [emailAddress, emailAddress]
            );

            // A returning Owner can open another business using the same phone
            // and name, but must use a different (globally unique) email.
            await authLock(connection, `phone:${phoneNumber}`);
            const phoneConflict = await accountPhoneConflict(connection, phoneNumber, ownerName);
            await authLock(connection, `business-name:${storeName}`);
            const businessConflict = await businessNameAlreadyRegistered(connection, storeName);
            const fieldErrors = {};
            if (existing.length > 0) {
                fieldErrors.email = "This email address is already registered.";
            }
            if (phoneConflict) {
                fieldErrors.phone = phoneConflict.error;
            }
            if (businessConflict) {
                fieldErrors.store_name = DUPLICATE_BUSINESS_MESSAGE;
            }
            if (Object.prototype.hasOwnProperty.call(body, "confirm_password") &&
                String(body.confirm_password ?? "") !== accountPassword) {
                fieldErrors.confirm_password = "Passwords do not match. Try again.";
            }
            if (Object.keys(fieldErrors).length > 0) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        error: "Please correct the highlighted fields.",
                        code: "SIGNUP_FIELD_CONFLICT",
                        field_errors: fieldErrors,
                    }),
                };
            }

            await guardOtpSend(connection, otpScope("signup", emailAddress));
            const otp = generateOtp();
            const otpHash = hashOtp(otp);

            await connection.execute(
                `UPDATE otp_codes
                 SET used_at = UTC_TIMESTAMP()
                 WHERE purpose = 'signup'
                   AND email = ?
                   AND used_at IS NULL`,
                [emailAddress]
            );

            await connection.execute(
                `INSERT INTO otp_codes
                     (purpose, email, otp_hash, expires_at, created_at)
                 VALUES
                     ('signup', ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP())`,
                [emailAddress, otpHash, OTP_EXPIRY_SECONDS]
            );

            try {
                await sendSignupOtpEmail(emailAddress, otp);
            } catch (emailError) {
                await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = UTC_TIMESTAMP()
                     WHERE purpose = 'signup'
                       AND email = ?
                       AND otp_hash = ?
                       AND used_at IS NULL`,
                    [emailAddress, otpHash]
                );

                throw emailError;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: LOCAL_OTP_CONSOLE_ONLY
                        ? "Verification code generated for local testing. Check the IDE terminal."
                        : "OTP sent successfully",
                    expires_in: OTP_EXPIRY_SECONDS,
                    resend_in: OTP_RESEND_SECONDS,
                }),
            };
        }

        // VERIFY SIGNUP OTP AND CREATE OWNER ACCOUNT
        if (action === "verify_signup_otp") {
            const policyVersion = requirePolicyAcceptance(body, "owner");

            const otp = String(body.otp ?? "").trim();
            const otpEmail = String(body.email ?? "").trim().toLowerCase();

            if (!otp || !otpEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "OTP and email are required." }),
                };
            }

            if (!/^\d{6}$/.test(otp)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "OTP must be exactly 6 digits." }),
                };
            }

            // Accept both snake_case and camelCase because the Create Account modal
            // may submit either naming style. The current modal submits owner_name
            // and phone, which are both supported here.
            const ownerName = String(
                body.owner_name ?? body.ownerName ?? ""
            ).trim();
            const storeName = cleanStoreName(body.store_name ?? body.storeName);
            const rawPhoneNumber = String(
                body.phone_number ?? body.phoneNumber ?? body.phone ?? ""
            ).trim();
            const phoneNumber = normalizePhilippineMobile(rawPhoneNumber) || rawPhoneNumber;
            const emailAddress = String(body.email ?? "").trim().toLowerCase();
            const accountPassword = String(body.password ?? "");

            if (!ownerName || !storeName || !phoneNumber || !emailAddress || !accountPassword) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Owner name, business name, phone number, email, and password are required.",
                    }),
                };
            }

            if (!normalizePhilippineMobile(phoneNumber)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid Philippine mobile number (e.g. 0912 345 6789)." }),
                };
            }

            if (!/^\S+@\S+\.\S+$/.test(emailAddress)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid email address." }),
                };
            }

            if (!passwordPolicy(accountPassword)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: passwordPolicyError(accountPassword) }),
                };
            }

            if (storeName.length > 180 || !/[\p{L}\p{N}]/u.test(storeName)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Business name must contain letters or numbers and be at most 180 characters." }),
                };
            }

            await authLock(connection, `account:${emailAddress}`);
            const [existing] = await connection.execute(
                `SELECT id FROM users WHERE email = ? UNION ALL SELECT id FROM platform_admins WHERE email = ? LIMIT 1`,
                [emailAddress, emailAddress]
            );

            // Recheck before consuming the OTP: the business or identity may
            // have been registered by another request since the code was sent.
            // Use the same lock order as send_signup_otp (account, phone, business).
            await authLock(connection, `phone:${phoneNumber}`);
            const phoneConflict = await accountPhoneConflict(connection, phoneNumber, ownerName);
            await authLock(connection, `business-name:${storeName}`);
            const businessConflict = await businessNameAlreadyRegistered(connection, storeName);
            const fieldErrors = {};
            if (existing.length > 0) fieldErrors.email = "This email address is already registered.";
            if (phoneConflict) fieldErrors.phone = phoneConflict.error;
            if (businessConflict) fieldErrors.store_name = DUPLICATE_BUSINESS_MESSAGE;
            if (Object.keys(fieldErrors).length > 0) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        error: "Please correct the highlighted fields.",
                        code: "SIGNUP_FIELD_CONFLICT",
                        field_errors: fieldErrors,
                    }),
                };
            }
            const otpRecord = await checkOtp(connection, otpScope("signup", otpEmail), otp, false);

            const hashed = await bcrypt.hash(accountPassword, 10);
            await authLock(connection, "store-slug-allocation");
            const slug = await allocateUniqueStoreSlug(connection, storeName);

            // The store and its owner account are created together.
            let result;
            let ownerUserId;
            await connection.beginTransaction();
            try {
                await connection.execute("UPDATE otp_codes SET used_at = UTC_TIMESTAMP(), verified_at = UTC_TIMESTAMP() WHERE id = ?", [otpRecord.id]);
                const storeCode = await identifiers.allocateStoreCode(connection, storeName, slug);
                try {
                    [result] = await connection.execute(
                        `INSERT INTO stores
                             (store_code, slug, store_name, business_name, email, phone)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [storeCode, slug, storeName, storeName, emailAddress, phoneNumber]
                    );
                } catch (storeInsertError) {
                    if (storeInsertError?.code === "ER_DUP_ENTRY" &&
                        /slug/i.test(String(storeInsertError?.sqlMessage || storeInsertError?.message || ""))) {
                        throw securityError(409, "A booking link was just created with the same identifier. Please try again.", "STORE_SLUG_CONFLICT");
                    }
                    throw storeInsertError;
                }
                const [ownerResult] = await connection.execute(
                    `INSERT INTO users
                     (store_id, role, full_name, email, password_hash, phone, status, email_verified_at,
                      terms_version, terms_accepted_at, privacy_version, privacy_acknowledged_at)
                     VALUES (?, 'owner', ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())`,
                    [result.insertId, ownerName, emailAddress, hashed, phoneNumber, policyVersion, policyVersion]
                );
                ownerUserId = ownerResult.insertId;
                // Every business starts with an active free Starter subscription
                // (no expiry, no payment record). Created in this same transaction,
                // so a failure leaves no partial store/owner registration behind.
                await ensureStarterSubscription(connection, result.insertId);
                await connection.commit();
            } catch (signupError) {
                await connection.rollback();
                throw signupError;
            }

            const token = jwt.sign(
                {
                    store_id: result.insertId,
                    user_id: ownerUserId,
                    email: emailAddress,
                    role: "owner",
                    auth_version: 0,
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    token,
                    role: "owner",
                    store_id: result.insertId,
                    store_name: storeName,
                    store_slug: slug,
                    owner_name: ownerName,
                    phone_number: phoneNumber,
                }),
            };
        }

        // UPDATE STORE PROFILE: Only the authenticated owner may change the
        // display name. Never accept a store ID or slug from the request body.
        if (action === "update_store_profile") {
            if (!presentedToken) {
                throw securityError(401, "Please sign in again.", "ACCOUNT_SESSION_INVALID");
            }
            const decoded = jwt.verify(presentedToken, JWT_SECRET, { algorithms: ["HS256"] });
            if (decoded.role !== "owner") {
                throw securityError(403, "Only the store owner can edit the business name.", "STORE_PROFILE_FORBIDDEN");
            }
            const name = cleanStoreName(body.store_name);
            if (!name || name.length > 180 || !/[\p{L}\p{N}]/u.test(name)) {
                throw securityError(400, "Enter a business name containing letters or numbers (up to 180 characters).", "INVALID_STORE_NAME");
            }
            const storeId = Number(decoded.store_id);
            await authLock(connection, `business-name:${name}`);
            await connection.beginTransaction();
            let slug;
            try {
                const [stores] = await connection.execute(
                    "SELECT id, store_name, slug FROM stores WHERE id = ? FOR UPDATE",
                    [storeId]
                );
                const store = stores[0];
                if (!store) throw securityError(404, "Store not found.", "STORE_NOT_FOUND");
                if (await businessNameAlreadyRegistered(connection, name, storeId)) {
                    throw securityError(409, DUPLICATE_BUSINESS_MESSAGE, "BUSINESS_NAME_ALREADY_REGISTERED");
                }
                // Keep the public slug and the receipt/store code unchanged.
                slug = store.slug;
                await connection.execute(
                    "UPDATE stores SET store_name = ?, business_name = ? WHERE id = ?",
                    [name, name, storeId]
                );
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            }
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, store_name: name, store_slug: slug }),
            };
        }

        // GET STORE BY SLUG
        if (action === "get_store_by_slug") {
            const { slug } = body;

            if (typeof slug !== "string" || !slug.trim() || slug.length > 255) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Invalid store slug" }),
                };
            }

            let [rows] = await connection.execute(
                `SELECT id, store_name, slug
                 FROM stores
                 WHERE slug = ?
                     LIMIT 1`,
                [slug]
            );

            /*
             * Compatibility fallback for older/demo store records.
             *
             * Some existing records use seeded slugs such as
             * "demo-v1-party-store-001", while older customer links were
             * generated from the store name, for example:
             * "happy-party-supplies-quezon-city".
             *
             * Keep the database slug as the primary lookup. Only when it does
             * not match do we compare the requested URL slug with a slug
             * generated from each existing store name.
             */
            if (!rows.length) {
                const [storeRows] = await connection.execute(
                    `SELECT id, store_name, slug
                     FROM stores
                     ORDER BY id ASC`
                );

                const fallbackStores = storeRows.filter(
                    (store) => generateSlug(store.store_name || "") === slug
                );

                if (fallbackStores.length === 1) {
                    rows = fallbackStores;
                }
            }

            if (!rows.length) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Store not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ store: rows[0] }),
            };
        }

        // GET PUBLIC BRANCHES BY STORE
        if (action === "get_public_branches") {
            const { storeId } = body;

            if (!storeId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing storeId" }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     id,
                     branch_name,
                     phone AS contact_number,
                     address
                 FROM branches
                 WHERE store_id = ?
                 ORDER BY branch_name ASC`,
                [Number(storeId)]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    branches: branchRows.map((branch) => ({
                        id: branch.id,
                        branch_name: branch.branch_name,
                        contact_number: branch.contact_number || "",
                        address: branch.address || "",
                        branch_slug: generateSlug(branch.branch_name || ""),
                    })),
                }),
            };
        }
        // SAVE ONBOARDING
        if (action === "save_onboarding" || action === "create_branch") {

            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can complete onboarding",
                    }),
                };
            }

            const storeId = decoded.store_id;
            const { branches = [] } = body;
            const creatingBranch = action === "create_branch";
            const shouldSendInvitationEmails =
                !creatingBranch && body.send_invitation_emails !== false;

            if (!Array.isArray(branches) || branches.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "No branches provided" }),
                };
            }

            if (creatingBranch && branches.some(branch =>
                branch?.manager_name || branch?.manager_email || branch?.permissions
            )) {
                throw securityError(400, "Add managers in Branch Managers after creating the branch.", "MANAGER_MANAGEMENT_ONLY");
            }

            // Enforce the branch entitlement using the current active plan.
            // This covers both first-time onboarding and later single-branch
            // additions because the endpoint receives the new branch list.
            try {
                await assertPlanLimit(
                    connection,
                    Number(storeId),
                    "branches",
                    branches.length,
                    decoded.role
                );
            } catch (limitError) {
                return {
                    statusCode: limitError?.statusCode || 409,
                    headers,
                    body: JSON.stringify({
                        error: limitError?.message || "Plan limit reached.",
                        code: limitError?.code || "BRANCHES_LIMIT_REACHED",
                        plan_name: limitError?.plan_name,
                        current: limitError?.current,
                        limit: limitError?.limit,
                    }),
                };
            }

            const [storeRows] = await connection.execute(
                `SELECT store_name
                 FROM stores
                 WHERE id = ?
                     LIMIT 1`,
                [storeId]
            );

            if (storeRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Store not found" }),
                };
            }

            const storeName = storeRows[0].store_name || "StockNBook Store";
            const inviteLinks = [];

            // Identifier columns/tables must exist before the transaction (DDL commits implicitly).
            if (!(await identifiers.ensureIdentifierSchema(connection))) {
                throw new Error("Employee ID numbering is not set up. Run scripts/standardize-identifiers.js.");
            }

            await connection.beginTransaction();

            try {
                // Serialize branch creations for this store to avoid two requests
                // simultaneously accepting an identical branch name/contact.
                await connection.execute(`SELECT id FROM stores WHERE id = ? FOR UPDATE`, [storeId]);
                // Only first-time onboarding retains its initial setup invitation.
                // Once a store has branches, all new manager accounts are created
                // via add_manager_to_branch in the Branch Managers module.
                if (!creatingBranch && branches.some(branch => branch?.manager_name || branch?.manager_email)) {
                    const [existingBranches] = await connection.execute(
                        "SELECT id FROM branches WHERE store_id = ? LIMIT 1 FOR UPDATE", [storeId]
                    );
                    if (existingBranches.length) {
                        throw securityError(400, "Add managers in Branch Managers after creating the branch.", "MANAGER_MANAGEMENT_ONLY");
                    }
                }
                for (const branch of branches) {
                    const branchName = String(
                        branch.branch_name || ""
                    ).trim();

                    const contactNumber = String(
                        branch.contact_number || ""
                    ).trim();

                    const address = String(
                        branch.address || ""
                    ).trim();

                    const branchStatus = String(
                        branch.status ||
                        branch.branch_status ||
                        "active"
                    )
                        .trim()
                        .toLowerCase();

                    const inactiveReason =
                        branchStatus === "inactive"
                            ? String(
                                branch.inactive_reason ||
                                branch.branch_inactive_reason ||
                                ""
                            ).trim()
                            : "";

                    if (
                        branchStatus !== "active" &&
                        branchStatus !== "inactive"
                    ) {
                        throw new Error(
                            `Invalid branch status for ${branchName}.`
                        );
                    }

                    if (
                        branchStatus === "inactive" &&
                        !inactiveReason
                    ) {
                        throw new Error(
                            `Select an inactive reason for ${branchName}.`
                        );
                    }

                    const managerName = String(
                        branch.manager_name || ""
                    ).trim();

                    const managerEmail = String(
                        branch.manager_email || ""
                    )
                        .trim()
                        .toLowerCase();

                    if (!branchName) {
                        throw new Error("Every branch must have a branch name.");
                    }
                    const branchConflict = await findStoreBranchConflict(
                        connection, storeId, branchName, contactNumber
                    );
                    if (branchConflict) {
                        const duplicateError = new Error(branchConflict.error);
                        duplicateError.code = branchConflict.code;
                        duplicateError.statusCode = 409;
                        throw duplicateError;
                    }

                    if (
                        managerEmail &&
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)
                    ) {
                        throw new Error(
                            `Invalid manager email for ${branchName}.`
                        );
                    }

                    const [branchResult] = await connection.execute(
                        `INSERT INTO branches
                         (
                             store_id,
                             branch_code,
                             branch_name,
                             phone,
                             address,
                             status
                         )
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            storeId,
                            await identifiers.allocateBranchCode(connection, storeId, branchName),
                            branchName,
                            contactNumber || null,
                            address || null,
                            branchStatus,
                        ]
                    );

                    const branchId = branchResult.insertId;

                    // Decide the new branch's permanent ID initials (e.g. Moonwalk = MW).
                    // Saved in identifier_prefixes; the branch record itself is not changed.
                    await identifiers.getIdentifierCodes(connection, storeId, branchId);

                    if (managerEmail) {
                        const [existingManagerRows] =
                            await connection.execute(
                                `SELECT id, store_id
                                 FROM users
                                 WHERE email = ?
                                     LIMIT 1`,
                                [managerEmail]
                            );

                        if (existingManagerRows.length > 0) {
                            throw new Error(
                                `${managerEmail} is already assigned as a manager in this store.`
                            );
                        }

                        const inviteToken = jwt.sign(
                            {
                                store_id: storeId,
                                branch_id: branchId,
                                email: managerEmail,
                                type: "manager_invite",
                            },
                            JWT_SECRET,
                            { expiresIn: "7d" }
                        );

                        const inviteLink =
                            `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

                        const permissions = normalizeManagerRolePermissions(branch.permissions);

                        // Permanent role-specific Employee ID within this store and branch.
                        const employeeCode = await identifiers.generateEmployeeCode(connection, {
                            storeId,
                            branchId,
                            roleCode: "MN",
                        });

                        await connection.execute(
                            `INSERT INTO users
                             (
                                 store_id,
                                 branch_id,
                                 role,
                                 full_name,
                                 email,
                                 invite_token_hash,
                                 permissions,
                                 status,
                                 employee_code
                             )
                             VALUES (?, ?, 'manager', COALESCE(?, ''), ?, SHA2(?, 256), ?, ?, ?)`,
                            [
                                storeId,
                                branchId,
                                managerName || null,
                                managerEmail,
                                inviteToken,
                                JSON.stringify(permissions),
                                "pending",
                                employeeCode,
                            ]
                        );

                        inviteLinks.push({
                            manager_email: managerEmail,
                            manager_name: managerName,
                            store_name: storeName,
                            branch_name: branchName,
                            invite_link: inviteLink,
                            permissions,
                            email_sent: false,
                            email_status: "pending",
                            email_error: "",
                        });
                    }
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: err?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error: err?.message || "Unable to save onboarding",
                        ...(err?.code ? { code: err.code } : {}),
                    }),
                };
            }

            let invitationEmailsSent = 0;
            let invitationEmailsFailed = 0;

            if (shouldSendInvitationEmails) {
                for (const invite of inviteLinks) {
                    const delivery = await deliverInvitationEmail({
                        role: "Manager",
                        email: invite.manager_email,
                        name: invite.manager_name,
                        storeName: invite.store_name,
                        branchName: invite.branch_name,
                        inviteLink: invite.invite_link,
                        send: () => sendManagerInvitationEmail(invite),
                    });

                    invite.email_sent = delivery.email_sent;
                    invite.email_status = delivery.email_status;
                    invite.email_error = delivery.email_error;

                    if (delivery.email_sent) {
                        invitationEmailsSent += 1;
                    } else {
                        invitationEmailsFailed += 1;
                    }
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: creatingBranch ? "Branch created successfully" : "Onboarding saved successfully",
                    invite_links: inviteLinks,
                    invitation_emails_sent: invitationEmailsSent,
                    invitation_emails_failed: invitationEmailsFailed,
                }),
            };
        }

        // GET MANAGER INVITATION DETAILS
        if (action === "get_manager_invite") {
            try {
                const { manager } = await getManagerInviteRecord(
                    connection,
                    body.invite_token
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(manager),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to load the invitation.",
                    }),
                };
            }
        }

        // SEND MANAGER INVITATION OTP
        if (action === "send_manager_invite_otp") {
            try {

                const inviteToken = String(body.invite_token || "");
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                if (manager.status !== "pending") {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "This invitation is no longer pending.",
                        }),
                    };
                }

                const otp = generateOtp();
                const otpHash = hashOtp(otp);
                const inviteTokenHash = hashInviteToken(inviteToken);
                await guardOtpSend(connection, otpScope("manager_invite", manager.manager_email, null, inviteTokenHash));
                const refreshed = await getManagerInviteRecord(connection, inviteToken);
                if (refreshed.manager.status !== "pending") throw securityError(400, "This invitation is no longer pending.", "INVITE_INACTIVE");

                await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = COALESCE(used_at, UTC_TIMESTAMP()), invalidated_at = UTC_TIMESTAMP()
                     WHERE purpose = 'manager_invite'
                       AND invite_token_hash = ?
                       AND email = ?
                       AND invalidated_at IS NULL`,
                    [inviteTokenHash, manager.manager_email]
                );

                await connection.execute(
                    `INSERT INTO otp_codes
                     (
                         purpose,
                         invite_token_hash,
                         email,
                         otp_hash,
                         expires_at, created_at
                     )
                     VALUES ('manager_invite', ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP())`,
                    [
                        inviteTokenHash,
                        manager.manager_email,
                        otpHash,
                        MANAGER_INVITE_OTP_EXPIRY_SECONDS,
                    ]
                );

                if (INVITATION_TERMINAL_DEBUG && !LOCAL_OTP_CONSOLE_ONLY) {
                    console.log(
                        `[StockNBook DEV OTP] Manager invitation verification | ` +
                        `Email: ${manager.manager_email} | ` +
                        `OTP: ${otp} | ` +
                        `Expires in: ${MANAGER_INVITE_OTP_EXPIRY_SECONDS}s`
                    );
                }

                let managerOtpDelivery = LOCAL_OTP_CONSOLE_ONLY ? "terminal" : "email";

                try {
                    await sendManagerInviteOtpEmail(
                        manager.manager_email,
                        otp,
                        manager.manager_name
                    );
                } catch (emailError) {
                    if (INVITATION_TERMINAL_DEBUG) {
                        managerOtpDelivery = "terminal";
                        console.warn(
                            "[StockNBook DEV OTP] Manager invitation OTP email could not be delivered. " +
                            "The OTP remains active for local testing and is shown in the IDE terminal.",
                            {
                                email: manager.manager_email,
                                error: emailError?.message || "Email delivery failed",
                            }
                        );
                    } else {
                        await connection.execute(
                            `UPDATE otp_codes
                             SET used_at = UTC_TIMESTAMP()
                             WHERE purpose = 'manager_invite'
                               AND invite_token_hash = ?
                               AND email = ?
                               AND otp_hash = ?
                               AND used_at IS NULL`,
                            [inviteTokenHash, manager.manager_email, otpHash]
                        );
                        throw emailError;
                    }
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message:
                            managerOtpDelivery === "terminal"
                                ? "Verification code generated for local testing. Check the IDE terminal."
                                : "Verification code sent successfully.",
                        expires_in: MANAGER_INVITE_OTP_EXPIRY_SECONDS,
                        resend_in: OTP_RESEND_SECONDS,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.statusCode && inviteError.statusCode < 500 ? inviteError.message : "Unable to send the verification code.",
                        code: inviteError?.code,
                        retry_after_seconds: inviteError?.retry_after_seconds,
                    }),
                };
            }
        }

        // VERIFY MANAGER INVITATION OTP
        if (action === "verify_manager_invite_otp") {
            try {

                const inviteToken = String(body.invite_token || "");
                const otp = String(body.otp || "").replace(/\D/g, "");
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                if (!/^\d{6}$/.test(otp)) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter the complete 6-digit verification code.",
                        }),
                    };
                }

                const inviteTokenHash = hashInviteToken(inviteToken);
                await checkOtp(connection, otpScope("manager_invite", manager.manager_email, null, inviteTokenHash), otp);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Invited email verified successfully.",
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.statusCode && inviteError.statusCode < 500 ? inviteError.message : "Unable to verify the invitation code.",
                        code: inviteError?.code,
                        retry_after_seconds: inviteError?.retry_after_seconds,
                    }),
                };
            }
        }

        // UPDATE MANAGER INVITATION DETAILS
        if (action === "update_manager_invite_details") {
            try {
                const inviteToken = String(body.invite_token || "");
                const managerName = String(body.manager_name || "").trim();
                const phoneNumber = normalizePhilippineMobile(body.phone);
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedManagerInvite(
                    connection,
                    inviteToken,
                    manager.manager_email
                );

                if (managerName.length < 2 || managerName.length > 120) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter a valid manager name.",
                        }),
                    };
                }

                if (!phoneNumber) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ error: "Enter a valid 11-digit Philippine mobile number starting with 09." }),
                    };
                }

                await authLock(connection, `phone:${phoneNumber}`);
                const phoneConflict = await accountPhoneConflict(
                    connection, phoneNumber, managerName, manager.store_id, manager.manager_id
                );
                if (phoneConflict) {
                    return { statusCode: 409, headers, body: JSON.stringify(phoneConflict) };
                }

                await connection.execute(
                    `UPDATE users
                     SET full_name = ?, phone = ?
                     WHERE id = ?
                       AND role = 'manager'
                       AND invite_token_hash = SHA2(?, 256)
                       AND status = 'pending'`,
                    [managerName, phoneNumber, manager.manager_id, inviteToken]
                );

                const refreshed = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(refreshed.manager),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to update the manager details.",
                    }),
                };
            }
        }

        // ACCEPT MANAGER INVITE
        if (action === "accept_manager_invite") {
            try {
                const inviteToken = String(body.invite_token || "");
                const accountPassword = String(body.password || "");
                const requestedManagerName = String(
                    body.manager_name || ""
                ).trim();
                const phoneNumber = normalizePhilippineMobile(body.phone);
                if (!phoneNumber) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ error: "Enter a valid 11-digit Philippine mobile number starting with 09." }),
                    };
                }

                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedManagerInvite(
                    connection,
                    inviteToken,
                    manager.manager_email
                );

                const policyVersion = requirePolicyAcceptance(body, "manager", manager.branch_id);
                const finalManagerName = requestedManagerName || manager.manager_name || "Manager";

                await authLock(connection, `phone:${phoneNumber}`);
                const phoneConflict = await accountPhoneConflict(
                    connection, phoneNumber, finalManagerName, manager.store_id, manager.manager_id
                );
                if (phoneConflict) {
                    return { statusCode: 409, headers, body: JSON.stringify(phoneConflict) };
                }

                const passwordValid = passwordPolicy(accountPassword);

                if (!passwordValid) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error:
                                passwordPolicyError(accountPassword),
                        }),
                    };
                }

                const hashedPassword = await bcrypt.hash(
                    accountPassword,
                    10
                );

                // Preserve existing pending Manager records on downgrade;
                // activation is a new entitlement use and is refused while
                // the store exceeds its effective branch capacity. Active
                // Managers are unaffected and remain able to sign in.
                try {
                    await assertPlanLimit(connection, Number(manager.store_id), "branches", 0, "manager");
                } catch (limitError) {
                    return {
                        statusCode: limitError?.statusCode || 409,
                        headers,
                        body: JSON.stringify({
                            error: limitError?.message || "Plan limit reached.",
                            code: limitError?.code || "BRANCHES_LIMIT_REACHED",
                            plan_name: limitError?.plan_name,
                            current: limitError?.current,
                            limit: limitError?.limit,
                        }),
                    };
                }

                // Activation stores the canonical Manager role grant. Authorization
                // itself is role-based and does not depend on this stored value.
                const [result] = await connection.execute(
                    `UPDATE users
                     SET full_name = ?,
                         phone = ?,
                         password_hash = ?,
                         permissions = ?,
                         status = 'active',
                         email_verified_at = UTC_TIMESTAMP(),
                         terms_version = ?, terms_accepted_at = UTC_TIMESTAMP(),
                         privacy_version = ?, privacy_acknowledged_at = UTC_TIMESTAMP(),
                         invite_token_hash = NULL
                     WHERE id = ?
                       AND role = 'manager'
                       AND branch_id = ?
                       AND store_id = ?
                       AND invite_token_hash = SHA2(?, 256)
                       AND email = ?
                       AND status = 'pending'`,
                    [
                        finalManagerName,
                        phoneNumber,
                        hashedPassword,
                        JSON.stringify(normalizeManagerRolePermissions()),
                        policyVersion,
                        policyVersion,
                        manager.manager_id,
                        manager.branch_id,
                        manager.store_id,
                        inviteToken,
                        manager.manager_email,
                    ]
                );

                if (result.affectedRows === 0) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Invitation not found or already accepted.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = UTC_TIMESTAMP(),
                         verified_at = NULL
                     WHERE purpose = 'manager_invite'
                       AND invite_token_hash = ?
                       AND email = ?`,
                    [
                        hashInviteToken(inviteToken),
                        manager.manager_email,
                    ]
                );

                const sessionToken = jwt.sign(
                    {
                        manager_id: manager.manager_id,
                        store_id: manager.store_id,
                        branch_id: manager.branch_id,
                        email: manager.manager_email,
                        role: "manager",
                        auth_version: Number(manager.auth_version),
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Manager account activated successfully.",
                        token: sessionToken,
                        manager_id: manager.manager_id,
                        manager_name: finalManagerName,
                        manager_email: manager.manager_email,
                        manager_phone: phoneNumber,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        role: "manager",
                        status: "active",
                        permissions: manager.permissions,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        ...(String(inviteError?.code || "").startsWith("POLICY_") ? { code: inviteError.code } : {}),
                        error:
                            inviteError?.message ||
                            "Unable to activate the manager account.",
                    }),
                };
            }
        }

        // INVITE STAFF
        if (action === "invite_staff") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only branch managers can invite staff",
                    }),
                };
            }

            const staffName = String(body.staff_name || "").trim();
            const staffEmail = String(body.staff_email || "")
                .trim()
                .toLowerCase();
            const requestedPermissions = body.permissions;

            if (!staffName || !staffEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing staff name or email",
                    }),
                };
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Enter a valid staff email address",
                    }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.permissions,
                     managers.full_name AS manager_name,
                     branches.branch_name,
                     stores.store_name
                 FROM users managers
                          JOIN branches ON branches.id = managers.branch_id AND branches.store_id = managers.store_id
                          JOIN stores ON stores.id = managers.store_id
                 WHERE managers.id = ?
                   AND managers.role = 'manager'
                   AND managers.store_id = ?
                   AND managers.branch_id = ?
                   AND managers.status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const manager = managerRows[0];

            const managerPermissions =
                // Role-based Manager access; legacy stored values are not consulted.
                effectiveEmployeePermissions(manager.permissions, "manager");

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to invite staff",
                    }),
                };
            }

            let permissions;
            try {
                permissions = normalizeStaffRolePermissions(requestedPermissions, managerPermissions);
            } catch (err) {
                return { statusCode: err.statusCode || 400, headers,
                    body: JSON.stringify({ error: err.message }) };
            }

            const [existingStaff] = await connection.execute(
                `SELECT id
                 FROM users
                 WHERE email = ?
                     LIMIT 1`,
                [staffEmail]
            );

            if (existingStaff.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Staff email already exists in this branch",
                    }),
                };
            }

            try {
                await assertPlanLimit(
                    connection,
                    Number(storeId),
                    "staff",
                    1,
                    decoded.role
                );
            } catch (limitError) {
                return {
                    statusCode: limitError?.statusCode || 409,
                    headers,
                    body: JSON.stringify({
                        error: limitError?.message || "Plan limit reached.",
                        code: limitError?.code || "STAFF_LIMIT_REACHED",
                        plan_name: limitError?.plan_name,
                        current: limitError?.current,
                        limit: limitError?.limit,
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    manager_id: managerId,
                    email: staffEmail,
                    type: "staff_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-staff-invite?token=${encodeURIComponent(inviteToken)}`;

            // Permanent role-specific Employee ID within this store and branch.
            if (!(await identifiers.ensureIdentifierSchema(connection))) {
                throw new Error("Employee ID numbering is not set up. Run scripts/standardize-identifiers.js.");
            }
            const employeeCode = await identifiers.generateEmployeeCode(connection, {
                storeId,
                branchId,
                roleCode: "SF",
            });

            let invitedStaffResult;
            await connection.beginTransaction();
            try {
                [invitedStaffResult] = await connection.execute(
                    `INSERT INTO users
                     (
                         store_id,
                         branch_id,
                         manager_id,
                         role,
                         full_name,
                         email,
                         invite_token_hash,
                         status,
                         permissions,
                         employee_code
                     )
                     VALUES (?, ?, ?, 'staff', COALESCE(?, ''), ?, SHA2(?, 256), ?, ?, ?)`,
                    [
                        storeId,
                        branchId,
                        managerId,
                        staffName,
                        staffEmail,
                        inviteToken,
                        "pending",
                        JSON.stringify(permissions),
                        employeeCode,
                    ]
                );

                await recordStaffPermissionChange(connection, {
                    storeId, branchId, managerId, managerName: manager.manager_name,
                    staffId: Number(invitedStaffResult.insertId), action: "Invited staff with permissions", permissions,
                });

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            }

            const invitation = {
                staff_email: staffEmail,
                staff_name: staffName,
                manager_name: manager.manager_name || "Branch Manager",
                store_name: manager.store_name || "StockNBook Store",
                branch_name: manager.branch_name || "Assigned Branch",
                invite_link: inviteLink,
                permissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Staff",
                email: staffEmail,
                name: staffName,
                storeName: manager.store_name || "StockNBook Store",
                branchName: manager.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendStaffInvitationEmail(invitation),
            });

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Staff invitation created and emailed successfully."
                        : "Staff invitation created successfully, but the email could not be delivered. Copy the backup invite link or use Resend later.",
                    invite_link: inviteLink,
                    staff_email: staffEmail,
                    staff_name: staffName,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // PLATFORM ADMIN LOGIN
        // Platform administrators are stored in platform_admins,
        // which uses the `password_hash` column for the bcrypt hash.
        // Account-based throttling is performed above for both login entry points.
        if (action === "platform_admin_login") {
            // Only an account authenticated by the shared limiter may receive an admin token.
            const admin = {
                platform_admin_id: authenticatedAccount.id,
                full_name: authenticatedAccount.full_name,
                email: authenticatedAccount.email,
                role: authenticatedAccount.role,
            };

            const token = jwt.sign(
                {
                    platform_admin_id: admin.platform_admin_id,
                    email: admin.email,
                    full_name: admin.full_name,
                    role: "PLATFORM_ADMIN",
                    auth_version: Number(authenticatedAccount.auth_version),
                },
                JWT_SECRET,
                { expiresIn: "8h" }
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    token,
                    role: "PLATFORM_ADMIN",
                    user: {
                        id: admin.platform_admin_id,
                        platform_admin_id: admin.platform_admin_id,
                        full_name: admin.full_name,
                        email: admin.email,
                        role: "PLATFORM_ADMIN",
                    },
                }),
            };
        }

        // LOGIN
        if (action === "login") {
            if (!email || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing email or password" }),
                };
            }

            // 1. Try owner login first
            const [storeRows] = await connection.execute(
                `SELECT s.id, s.store_name, s.slug, u.id AS user_id, u.full_name AS owner_name,
                        u.email, u.password_hash AS password, u.status, u.auth_version
                 FROM users u
                          JOIN stores s ON s.id = u.store_id
                 WHERE u.email = ?
                   AND u.role = 'owner'
                     LIMIT 1`,
                [email]
            );

            if (storeRows.length > 0) {
                const store = storeRows[0];
                // The password and lockout were checked once above; bind this response to that same account.
                if (String(store.user_id) !== String(authenticatedAccount.id) || authenticatedAccount.role !== "owner") {
                    throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
                }

                const token = jwt.sign(
                    {
                        store_id: store.id,
                        user_id: store.user_id,
                        email: store.email,
                        role: "owner",
                        auth_version: Number(store.auth_version),
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "owner",
                        store_id: store.id,
                        owner_name: store.owner_name,
                        store_name: store.store_name,
                        store_slug: store.slug,
                    }),
                };
            }

            // 2. Try manager login
            const [managerRows] = await connection.execute(
                `SELECT
                     managers.id,
                     managers.store_id,
                     managers.branch_id,
                     managers.full_name AS manager_name,
                     managers.email AS manager_email,
                     managers.password_hash AS password,
                     managers.permissions,
                     managers.auth_version,
                     managers.status,
                     managers.employee_code,
                     branches.branch_name,
                     stores.store_name, stores.slug AS store_slug
                 FROM users managers
                          JOIN branches ON managers.branch_id = branches.id
                          JOIN stores ON managers.store_id = stores.id
                 WHERE managers.email = ?
                   AND managers.role = 'manager'
                     LIMIT 1`,
                [email]
            );

            if (managerRows.length > 0) {
                const manager = managerRows[0];
                // The password and lockout were checked once above; bind this response to that same account.
                if (String(manager.id) !== String(authenticatedAccount.id) || authenticatedAccount.role !== "manager") {
                    throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
                }

                const managerStatus = String(
                    manager.status || ""
                ).trim().toLowerCase();

                if (managerStatus === "inactive") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error:
                                "Your branch manager account has already been deactivated. Please contact the store owner if you think this was a mistake.",
                            code: "ACCOUNT_DEACTIVATED",
                            message:
                                "Your branch manager account has already been deactivated. Please contact the store owner if you think this was a mistake.",
                        }),
                    };
                }

                if (managerStatus === "pending" || !manager.password) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account activation required",
                            code: "ACCOUNT_PENDING",
                            message:
                                "Your manager invitation has not been accepted yet. Open the invitation email and complete the account activation first.",
                        }),
                    };
                }

                if (managerStatus !== "active") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account unavailable",
                            code: "ACCOUNT_UNAVAILABLE",
                            message:
                                "Your branch manager account is not currently active. Please contact the store owner.",
                        }),
                    };
                }

                // Align the stored Manager permissions with the Manager role.
                await syncStoredManagerRolePermissions(connection, manager.id, manager.permissions);

                const token = jwt.sign(
                    {
                        manager_id: manager.id,
                        store_id: manager.store_id,
                        branch_id: manager.branch_id,
                        email: manager.manager_email,
                        role: "manager",
                        auth_version: Number(manager.auth_version),
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "manager",
                        manager_id: manager.id,
                        manager_name: manager.manager_name,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        store_slug: manager.store_slug,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        permissions: effectiveEmployeePermissions(manager.permissions, "manager"),
                    }),
                };
            }

            // 3. Try staff login
            const [staffRows] = await connection.execute(
                `SELECT
                     staff.id,
                     staff.store_id,
                     staff.branch_id,
                     staff.manager_id,
                     staff.full_name AS staff_name,
                     staff.email AS staff_email,
                     staff.password_hash AS password,
                     staff.permissions,
                     staff.auth_version,
                     staff.status,
                     staff.employee_code,
                     branches.branch_name,
                     stores.store_name, stores.slug AS store_slug
                 FROM users staff
                          JOIN branches ON staff.branch_id = branches.id
                          JOIN stores ON staff.store_id = stores.id
                 WHERE staff.email = ?
                   AND staff.role = 'staff'
                   AND staff.status = 'active'
                     LIMIT 1`,
                [email]
            );

            if (staffRows.length > 0) {
                const staff = staffRows[0];
                // The password and lockout were checked once above; bind this response to that same account.
                if (String(staff.id) !== String(authenticatedAccount.id) || authenticatedAccount.role !== "staff") {
                    throw securityError(401, AUTH_INVALID, "AUTH_FAILED");
                }


                if (!staff.password) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Staff invitation has not been accepted yet",
                        }),
                    };
                }

                const token = jwt.sign(
                    {
                        staff_id: staff.id,
                        store_id: staff.store_id,
                        branch_id: staff.branch_id,
                        manager_id: staff.manager_id,
                        email: staff.staff_email,
                        role: "staff",
                        auth_version: Number(staff.auth_version),
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "staff",
                        staff_id: staff.id,
                        staff_name: staff.staff_name,
                        staff_email: staff.staff_email,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        store_slug: staff.store_slug,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        permissions: effectiveEmployeePermissions(staff.permissions, "staff"),
                    }),
                };
            }

            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: "Invalid email or password" }),
            };
        }

        // GET STAFF INVITATION DETAILS
        if (action === "get_staff_invite") {
            try {
                const { staff } = await getStaffInviteRecord(
                    connection,
                    body.invite_token
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(staff),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to load the invitation.",
                    }),
                };
            }
        }

        // SEND STAFF INVITATION OTP
        if (action === "send_staff_invite_otp") {
            try {

                const inviteToken = String(body.invite_token || "");
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                if (staff.status !== "pending") {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "This invitation is no longer pending.",
                        }),
                    };
                }

                const otp = generateOtp();
                const otpHash = hashOtp(otp);
                const inviteTokenHash = hashInviteToken(inviteToken);
                await guardOtpSend(connection, otpScope("staff_invite", staff.staff_email, null, inviteTokenHash));
                const refreshed = await getStaffInviteRecord(connection, inviteToken);
                if (refreshed.staff.status !== "pending") throw securityError(400, "This invitation is no longer pending.", "INVITE_INACTIVE");

                await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = COALESCE(used_at, UTC_TIMESTAMP()), invalidated_at = UTC_TIMESTAMP()
                     WHERE purpose = 'staff_invite'
                       AND invite_token_hash = ?
                       AND email = ?
                       AND invalidated_at IS NULL`,
                    [inviteTokenHash, staff.staff_email]
                );

                await connection.execute(
                    `INSERT INTO otp_codes
                     (
                         purpose,
                         invite_token_hash,
                         email,
                         otp_hash,
                         expires_at, created_at
                     )
                     VALUES ('staff_invite', ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP())`,
                    [
                        inviteTokenHash,
                        staff.staff_email,
                        otpHash,
                        STAFF_INVITE_OTP_EXPIRY_SECONDS,
                    ]
                );

                if (INVITATION_TERMINAL_DEBUG && !LOCAL_OTP_CONSOLE_ONLY) {
                    console.log(
                        `[StockNBook DEV OTP] Staff invitation verification | ` +
                        `Email: ${staff.staff_email} | ` +
                        `OTP: ${otp} | ` +
                        `Expires in: ${STAFF_INVITE_OTP_EXPIRY_SECONDS}s`
                    );
                }

                let staffOtpDelivery = LOCAL_OTP_CONSOLE_ONLY ? "terminal" : "email";

                try {
                    await sendStaffInviteOtpEmail(
                        staff.staff_email,
                        otp,
                        staff.staff_name
                    );
                } catch (emailError) {
                    if (INVITATION_TERMINAL_DEBUG) {
                        staffOtpDelivery = "terminal";
                        console.warn(
                            "[StockNBook DEV OTP] Staff invitation OTP email could not be delivered. " +
                            "The OTP remains active for local testing and is shown in the IDE terminal.",
                            {
                                email: staff.staff_email,
                                error: emailError?.message || "Email delivery failed",
                            }
                        );
                    } else {
                        await connection.execute(
                            `UPDATE otp_codes
                             SET used_at = UTC_TIMESTAMP()
                             WHERE purpose = 'staff_invite'
                               AND invite_token_hash = ?
                               AND email = ?
                               AND otp_hash = ?
                               AND used_at IS NULL`,
                            [inviteTokenHash, staff.staff_email, otpHash]
                        );
                        throw emailError;
                    }
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message:
                            staffOtpDelivery === "terminal"
                                ? "Verification code generated for local testing. Check the IDE terminal."
                                : "Verification code sent successfully.",
                        expires_in: STAFF_INVITE_OTP_EXPIRY_SECONDS,
                        resend_in: OTP_RESEND_SECONDS,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.statusCode && inviteError.statusCode < 500 ? inviteError.message : "Unable to send the verification code.",
                        code: inviteError?.code,
                        retry_after_seconds: inviteError?.retry_after_seconds,
                    }),
                };
            }
        }

        // VERIFY STAFF INVITATION OTP
        if (action === "verify_staff_invite_otp") {
            try {

                const inviteToken = String(body.invite_token || "");
                const otp = String(body.otp || "").replace(/\D/g, "");
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                if (!/^\d{6}$/.test(otp)) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter the complete 6-digit verification code.",
                        }),
                    };
                }

                const inviteTokenHash = hashInviteToken(inviteToken);
                await checkOtp(connection, otpScope("staff_invite", staff.staff_email, null, inviteTokenHash), otp);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Invited email verified successfully.",
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.statusCode && inviteError.statusCode < 500 ? inviteError.message : "Unable to verify the invitation code.",
                        code: inviteError?.code,
                        retry_after_seconds: inviteError?.retry_after_seconds,
                    }),
                };
            }
        }

        // UPDATE STAFF INVITATION DETAILS
        if (action === "update_staff_invite_details") {
            try {
                const inviteToken = String(body.invite_token || "");
                const staffName = String(body.staff_name || "").trim();
                const phoneNumber = normalizePhilippineMobile(body.phone);
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedStaffInvite(
                    connection,
                    inviteToken,
                    staff.staff_email
                );

                if (staffName.length < 2 || staffName.length > 120) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter a valid staff name.",
                        }),
                    };
                }

                if (!phoneNumber) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ error: "Enter a valid 11-digit Philippine mobile number starting with 09." }),
                    };
                }

                await authLock(connection, `phone:${phoneNumber}`);
                const phoneConflict = await accountPhoneConflict(
                    connection, phoneNumber, staffName, staff.store_id, staff.staff_id
                );
                if (phoneConflict) {
                    return { statusCode: 409, headers, body: JSON.stringify(phoneConflict) };
                }

                await connection.execute(
                    `UPDATE users
                     SET full_name = ?, phone = ?
                     WHERE id = ?
                       AND role = 'staff'
                       AND invite_token_hash = SHA2(?, 256)
                       AND status = 'pending'`,
                    [staffName, phoneNumber, staff.staff_id, inviteToken]
                );

                const refreshed = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(refreshed.staff),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to update the staff details.",
                    }),
                };
            }
        }

        // ACCEPT STAFF INVITE
        if (action === "accept_staff_invite") {
            try {
                const inviteToken = String(body.invite_token || "");
                const accountPassword = String(body.password || "");
                const requestedStaffName = String(
                    body.staff_name || ""
                ).trim();
                const phoneNumber = normalizePhilippineMobile(body.phone);
                if (!phoneNumber) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ error: "Enter a valid 11-digit Philippine mobile number starting with 09." }),
                    };
                }

                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedStaffInvite(
                    connection,
                    inviteToken,
                    staff.staff_email
                );

                const policyVersion = requirePolicyAcceptance(body, "staff", staff.branch_id);
                const finalStaffName = requestedStaffName || staff.staff_name || "Staff";

                await authLock(connection, `phone:${phoneNumber}`);
                const phoneConflict = await accountPhoneConflict(
                    connection, phoneNumber, finalStaffName, staff.store_id, staff.staff_id
                );
                if (phoneConflict) {
                    return { statusCode: 409, headers, body: JSON.stringify(phoneConflict) };
                }

                const passwordValid = passwordPolicy(accountPassword);

                if (!passwordValid) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error:
                                passwordPolicyError(accountPassword),
                        }),
                    };
                }

                const hashedPassword = await bcrypt.hash(
                    accountPassword,
                    10
                );

                try {
                    // The pending invitation already occupies one staff slot.
                    // Activating it changes the existing row from pending -> active,
                    // so it must NOT consume a second plan slot.
                    //
                    // We still validate with increment 0 so a downgrade or other
                    // plan change that leaves current usage above the limit can
                    // correctly block activation.
                    await assertPlanLimit(
                        connection,
                        Number(staff.store_id),
                        "staff",
                        0,
                        "staff"
                    );
                } catch (limitError) {
                    return {
                        statusCode: limitError?.statusCode || 409,
                        headers,
                        body: JSON.stringify({
                            error: limitError?.message || "Plan limit reached.",
                            code: limitError?.code || "STAFF_LIMIT_REACHED",
                            plan_name: limitError?.plan_name,
                            current: limitError?.current,
                            limit: limitError?.limit,
                        }),
                    };
                }

                const [result] = await connection.execute(
                    `UPDATE users
                     SET full_name = ?,
                         phone = ?,
                         password_hash = ?,
                         status = 'active',
                         email_verified_at = UTC_TIMESTAMP(),
                         terms_version = ?, terms_accepted_at = UTC_TIMESTAMP(),
                         privacy_version = ?, privacy_acknowledged_at = UTC_TIMESTAMP(),
                         invite_token_hash = NULL
                     WHERE id = ?
                       AND role = 'staff'
                       AND branch_id = ?
                       AND store_id = ?
                       AND invite_token_hash = SHA2(?, 256)
                       AND email = ?
                       AND status = 'pending'`,
                    [
                        finalStaffName,
                        phoneNumber,
                        hashedPassword,
                        policyVersion,
                        policyVersion,
                        staff.staff_id,
                        staff.branch_id,
                        staff.store_id,
                        inviteToken,
                        staff.staff_email,
                    ]
                );

                if (result.affectedRows === 0) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Invitation not found or already accepted.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = UTC_TIMESTAMP(),
                         verified_at = NULL
                     WHERE purpose = 'staff_invite'
                       AND invite_token_hash = ?
                       AND email = ?`,
                    [
                        hashInviteToken(inviteToken),
                        staff.staff_email,
                    ]
                );

                const sessionToken = jwt.sign(
                    {
                        staff_id: staff.staff_id,
                        manager_id: staff.manager_id,
                        store_id: staff.store_id,
                        branch_id: staff.branch_id,
                        email: staff.staff_email,
                        role: "staff",
                        auth_version: Number(staff.auth_version),
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Staff account activated successfully.",
                        token: sessionToken,
                        staff_id: staff.staff_id,
                        staff_name: finalStaffName,
                        staff_email: staff.staff_email,
                        staff_phone: phoneNumber,
                        manager_id: staff.manager_id,
                        manager_name: staff.manager_name,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        role: "staff",
                        status: "active",
                        permissions: effectiveEmployeePermissions(staff.permissions, "staff"),
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        ...(String(inviteError?.code || "").startsWith("POLICY_") ? { code: inviteError.code } : {}),
                        error:
                            inviteError?.message ||
                            "Unable to activate the staff account.",
                    }),
                };
            }
        }

        // GET STAFF BY MANAGER BRANCH
        if (action === "get_staff") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can view branch staff" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM users
                 WHERE id = ?
                   AND role = 'manager'
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                // Role-based Manager access; legacy stored values are not consulted.
                effectiveEmployeePermissions(managerRows[0].permissions, "manager");

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to view staff",
                    }),
                };
            }

            const employeeCodeReady = await identifiers.ensureIdentifierSchema(connection);
            const [staffRows] = await connection.execute(
                `SELECT
                     id,
                     full_name AS staff_name,
                     email AS staff_email,
                     phone AS staff_phone,
                     status,
                     permissions,
                     NULL AS invite_token,
                     employee_code,
                     NULL AS created_at
                 FROM users
                 WHERE role = 'staff'
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?
                 ORDER BY id DESC`,
                [storeId, branchId, managerId]
            );

            const staff = [];
            const pendingInvites = [];

            for (const row of staffRows) {
                const parsedPermissions =
                    typeof row.permissions === "string"
                        ? JSON.parse(row.permissions || "{}")
                        : row.permissions || {};

                if (
                    row.status === "active" ||
                    row.status === "inactive"
                ) {
                    staff.push({
                        id: row.id,
                        employee_code: row.employee_code || "",
                        name: row.staff_name || "Unnamed staff",
                        email: row.staff_email || "",
                        phone: row.staff_phone || "",
                        status:
                            row.status === "inactive"
                                ? "Inactive"
                                : "Accepted",
                        permissions: parsedPermissions,
                    });
                } else if (row.status === "pending") {
                    pendingInvites.push({
                        id: row.id,
                        employee_code: row.employee_code || "",
                        email: row.staff_email || "",
                        invitedAt: row.created_at || "Recently",
                        expiresAt: "7 days after invite",
                        status: "Pending",
                        permissions: parsedPermissions,
                    });
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    staff,
                    pending_invites: pendingInvites,
                }),
            };
        }

        // DEACTIVATE OR REACTIVATE STAFF
        if (
            action === "deactivate_staff" ||
            action === "reactivate_staff"
        ) {
            const authHeader =
                event.headers?.Authorization ||
                event.headers?.authorization ||
                "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Missing token",
                    }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid token",
                    }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Only managers can update staff account status",
                    }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const staffId = Number(body.staff_id);
            const staffEmail = String(
                body.staff_email || ""
            )
                .trim()
                .toLowerCase();

            if (!staffId && !staffEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing staff id or email",
                    }),
                };
            }

            const [managerRows] =
                await connection.execute(
                    `SELECT permissions
                     FROM users
                     WHERE id = ?
                       AND role = 'manager'
                       AND store_id = ?
                       AND branch_id = ?
                       AND status = 'active'
                         LIMIT 1`,
                    [managerId, storeId, branchId]
                );

            if (managerRows.length === 0) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Your manager account is not active",
                    }),
                };
            }

            const managerPermissions =
                // Role-based Manager access; legacy stored values are not consulted.
                effectiveEmployeePermissions(managerRows[0].permissions, "manager");

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "You do not have permission to update staff accounts",
                    }),
                };
            }

            const nextStatus =
                action === "reactivate_staff"
                    ? "active"
                    : "inactive";

            if (nextStatus === "active") {
                try {
                    // Re-activation consumes a staff seat too. This prevents
                    // an inactive account from being used to bypass the plan.
                    await assertPlanLimit(
                        connection,
                        Number(storeId),
                        "staff",
                        1,
                        decoded.role
                    );
                } catch (limitError) {
                    return {
                        statusCode: limitError?.statusCode || 409,
                        headers,
                        body: JSON.stringify({
                            error: limitError?.message || "Plan limit reached.",
                            code: limitError?.code || "STAFF_LIMIT_REACHED",
                            plan_name: limitError?.plan_name,
                            current: limitError?.current,
                            limit: limitError?.limit,
                        }),
                    };
                }
            }

            let result;

            if (staffId) {
                [result] = await connection.execute(
                    `UPDATE users
                     SET status = ?, auth_version = auth_version + 1
                     WHERE id = ?
                       AND role = 'staff'
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?
                       AND status IN ('active', 'inactive')`,
                    [
                        nextStatus,
                        staffId,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            } else {
                [result] = await connection.execute(
                    `UPDATE users
                     SET status = ?, auth_version = auth_version + 1
                     WHERE email = ?
                       AND role = 'staff'
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?
                       AND status IN ('active', 'inactive')`,
                    [
                        nextStatus,
                        staffEmail,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            }

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Staff account was not found or is still pending activation",
                    }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message:
                        nextStatus === "active"
                            ? "Staff account reactivated successfully"
                            : "Staff account deactivated successfully",
                    staff_status: nextStatus,
                    staff_updated: result.affectedRows,
                }),
            };
        }

        // UPDATE STAFF PERMISSIONS
        if (action === "update_staff_permissions") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can update staff access" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const { staff_id, staff_email } = body;
            const requestedPermissions = body.permissions;

            if (!staff_id && !staff_email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff id or email" }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT permissions, full_name
                 FROM users
                 WHERE id = ?
                   AND role = 'manager'
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                // Role-based Manager access; legacy stored values are not consulted.
                effectiveEmployeePermissions(managerRows[0].permissions, "manager");

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to update staff access",
                    }),
                };
            }

            let permissions;
            try {
                permissions = normalizeStaffRolePermissions(requestedPermissions, managerPermissions);
            } catch (err) {
                return { statusCode: err.statusCode || 400, headers,
                    body: JSON.stringify({ error: err.message }) };
            }

            const [targetStaff] = await connection.execute(
                `SELECT id FROM users WHERE role = 'staff' AND store_id = ? AND branch_id = ?
                                        AND manager_id = ? AND ${staff_id ? "id = ?" : "email = ?"} LIMIT 1`,
                [storeId, branchId, managerId, staff_id || staff_email]
            );
            if (!targetStaff.length) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: "Staff not found" }) };
            }

            let result;
            await connection.beginTransaction();
            try {
                if (staff_id) {
                    [result] = await connection.execute(
                        `UPDATE users
                         SET permissions = ?
                         WHERE id = ?
                           AND role = 'staff'
                           AND store_id = ?
                           AND branch_id = ?
                           AND manager_id = ?`,
                        [
                            JSON.stringify(permissions || {}),
                            staff_id,
                            storeId,
                            branchId,
                            managerId,
                        ]
                    );
                } else {
                    [result] = await connection.execute(
                        `UPDATE users
                         SET permissions = ?
                         WHERE email = ?
                           AND role = 'staff'
                           AND store_id = ?
                           AND branch_id = ?
                           AND manager_id = ?`,
                        [
                            JSON.stringify(permissions || {}),
                            staff_email,
                            storeId,
                            branchId,
                            managerId,
                        ]
                    );
                }

                if (result.affectedRows === 0) {
                    await connection.rollback();
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Staff not found" }),
                    };
                }

                await recordStaffPermissionChange(connection, {
                    storeId, branchId, managerId,
                    managerName: managerRows[0].full_name || "Manager",
                    staffId: Number(targetStaff[0].id),
                    action: "Updated staff permissions", permissions,
                });
                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Staff permissions updated successfully",
                    staff_updated: result.affectedRows,
                }),
            };
        }

        // RESEND STAFF INVITE
        if (action === "resend_staff_invite") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only managers can resend staff invites",
                    }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const staffEmail = String(body.staff_email || "")
                .trim()
                .toLowerCase();

            if (!staffEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff email" }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.permissions,
                     managers.full_name AS manager_name,
                     branches.branch_name,
                     stores.store_name
                 FROM users managers
                          JOIN branches ON branches.id = managers.branch_id AND branches.store_id = managers.store_id
                          JOIN stores ON stores.id = managers.store_id
                 WHERE managers.id = ?
                   AND managers.role = 'manager'
                   AND managers.store_id = ?
                   AND managers.branch_id = ?
                   AND managers.status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const manager = managerRows[0];

            const managerPermissions =
                // Role-based Manager access; legacy stored values are not consulted.
                effectiveEmployeePermissions(manager.permissions, "manager");

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to resend staff invites",
                    }),
                };
            }

            const [staffRows] = await connection.execute(
                `SELECT id, full_name AS staff_name, email AS staff_email, status, permissions
                 FROM users
                 WHERE email = ?
                   AND role = 'staff'
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?
                     LIMIT 1`,
                [staffEmail, storeId, branchId, managerId]
            );

            if (staffRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Pending staff invite not found",
                    }),
                };
            }

            const staff = staffRows[0];

            if (staff.status !== "pending") {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "This staff account is already accepted or inactive",
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    manager_id: managerId,
                    email: staff.staff_email,
                    type: "staff_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-staff-invite?token=${encodeURIComponent(inviteToken)}`;

            await connection.execute(
                `UPDATE users
                 SET invite_token_hash = SHA2(?, 256)
                 WHERE id = ?
                   AND role = 'staff'
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?`,
                [inviteToken, staff.id, storeId, branchId, managerId]
            );

            const staffPermissions =
                typeof staff.permissions === "string"
                    ? JSON.parse(staff.permissions || "{}")
                    : staff.permissions || {};

            const resendInvitation = {
                staff_email: staff.staff_email,
                staff_name: staff.staff_name,
                manager_name: manager.manager_name || "Branch Manager",
                store_name: manager.store_name || "StockNBook Store",
                branch_name: manager.branch_name || "Assigned Branch",
                invite_link: inviteLink,
                permissions: staffPermissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Staff",
                email: staff.staff_email,
                name: staff.staff_name,
                storeName: manager.store_name || "StockNBook Store",
                branchName: manager.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendStaffInvitationEmail(resendInvitation),
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Staff invitation emailed successfully."
                        : "The staff invitation link was refreshed, but the email could not be delivered. Copy the backup link or try Resend later.",
                    invite_link: inviteLink,
                    staff_email: staff.staff_email,
                    staff_name: staff.staff_name,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // ADD MANAGER TO AN EXISTING BRANCH
        if (action === "add_manager_to_branch") {
            const decoded = await requireOwnerForManagerManagement(connection, event);
            const storeId = Number(decoded.store_id);
            const branchId = Number(body.branch_id);
            const managerName = String(body.manager_name || "").trim();
            const managerEmail = String(body.manager_email || "").trim().toLowerCase();
            const permissions = normalizeManagerRolePermissions();

            if (!Number.isSafeInteger(branchId) || branchId <= 0) {
                throw securityError(400, "Select a valid branch.", "INVALID_BRANCH");
            }
            if (managerName.length < 2 || managerName.length > 120) {
                throw securityError(400, "Enter a valid manager name.", "INVALID_NAME");
            }
            if (managerEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) {
                throw securityError(400, "Enter a valid manager email address.", "INVALID_EMAIL");
            }

            if (!(await identifiers.ensureIdentifierSchema(connection))) {
                throw new Error("Employee ID numbering is not set up. Run scripts/standardize-identifiers.js.");
            }

            // Serialize email claims with existing signup/email-change actions.
            await authLock(connection, `account:${managerEmail}`);
            let branch;
            let managerResult;
            let inviteLink;
            // Subscription lifecycle helpers can start their own transaction;
            // check the plan before opening the manager-assignment transaction.
            try {
                await assertPlanLimit(connection, storeId, "branches", 0, decoded.role);
            } catch (limitError) {
                return {
                    statusCode: limitError?.statusCode || 409,
                    headers,
                    body: JSON.stringify({
                        error: limitError?.message || "Plan limit reached.",
                        code: limitError?.code || "BRANCHES_LIMIT_REACHED",
                        plan_name: limitError?.plan_name,
                        current: limitError?.current,
                        limit: limitError?.limit,
                    }),
                };
            }
            await connection.beginTransaction();
            try {
                // Share the store lock with branch edits and manager reassignments.
                // Two concurrent invitations cannot occupy the same branch.
                await connection.execute("SELECT id FROM stores WHERE id = ? FOR UPDATE", [storeId]);
                const [branchRows] = await connection.execute(
                    `SELECT branches.id, branches.branch_name, branches.status, stores.store_name
                     FROM branches JOIN stores ON stores.id = branches.store_id
                     WHERE branches.id = ? AND branches.store_id = ?
                         LIMIT 1 FOR UPDATE`,
                    [branchId, storeId]
                );
                branch = branchRows[0];
                if (!branch) {
                    throw securityError(404, "The selected branch was not found.", "BRANCH_NOT_FOUND");
                }
                if (String(branch.status || "active").toLowerCase() !== "active") {
                    throw securityError(409, "Choose an active branch.", "BRANCH_INACTIVE");
                }

                // One manager per branch, including inactive/pending accounts.
                const [occupied] = await connection.execute(
                    `SELECT id FROM users WHERE branch_id = ? AND store_id = ?
                                            AND role = 'manager' LIMIT 1 FOR UPDATE`,
                    [branchId, storeId]
                );
                if (occupied.length) {
                    throw securityError(409, "This branch already has an assigned or pending manager.", "BRANCH_HAS_MANAGER");
                }

                const [existingEmailRows] = await connection.execute(
                    `SELECT id FROM users WHERE email = ?
                     UNION ALL SELECT id FROM platform_admins WHERE email = ? LIMIT 1`,
                    [managerEmail, managerEmail]
                );
                if (existingEmailRows.length) {
                    throw securityError(409, "This email address is already registered.", "EMAIL_ALREADY_USED");
                }

                const inviteToken = jwt.sign(
                    { store_id: storeId, branch_id: branchId, email: managerEmail, type: "manager_invite" },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );
                inviteLink = `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

                const employeeCode = await identifiers.generateEmployeeCode(connection, {
                    storeId, branchId, roleCode: "MN",
                });
                [managerResult] = await connection.execute(
                    `INSERT INTO users
                     (store_id, branch_id, role, full_name, email, invite_token_hash,
                      permissions, status, employee_code)
                     VALUES (?, ?, 'manager', ?, ?, SHA2(?, 256), ?, 'pending', ?)`,
                    [storeId, branchId, managerName, managerEmail, inviteToken,
                        JSON.stringify(permissions), employeeCode]
                );
                await connection.commit();
            } catch (createError) {
                await connection.rollback();
                if (createError?.code === "ER_DUP_ENTRY") {
                    throw securityError(409, "This account or employee ID already exists. Refresh and try again.", "MANAGER_CONFLICT");
                }
                throw createError;
            }

            const invitation = {
                manager_email: managerEmail,
                manager_name: managerName,
                store_name:
                    branch.store_name ||
                    "StockNBook Store",
                branch_name:
                    branch.branch_name ||
                    "Assigned Branch",
                invite_link: inviteLink,
                permissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Manager",
                email: managerEmail,
                name: managerName,
                storeName: branch.store_name || "StockNBook Store",
                branchName: branch.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendManagerInvitationEmail(invitation),
            });

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Manager added and invitation email sent successfully."
                        : "Manager added successfully, but the invitation email could not be delivered. Use Resend Invite in Pending Invites to try again.",
                    manager: {
                        id: managerResult.insertId,
                        name: managerName,
                        email: managerEmail,
                        branch:
                            branch.branch_name ||
                            "No branch assigned",
                        status: "pending",
                        permissions,
                    },
                    invite_link: inviteLink,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // RESEND MANAGER INVITATION
        if (action === "resend_manager_invite") {
            const token = getBearerTokenFromEvent(event);

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can resend a manager invitation.",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);
            const managerEmail = String(body.manager_email || "")
                .trim()
                .toLowerCase();

            if ((!Number.isInteger(managerId) || managerId <= 0) && !managerEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Select a pending manager invitation to resend.",
                    }),
                };
            }

            const whereClause =
                Number.isInteger(managerId) && managerId > 0
                    ? "managers.id = ?"
                    : "LOWER(managers.manager_email) = ?";

            const lookupValue =
                Number.isInteger(managerId) && managerId > 0
                    ? managerId
                    : managerEmail;

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.id,
                     managers.full_name AS manager_name,
                     managers.email AS manager_email,
                     managers.permissions,
                     managers.auth_version,
                     managers.status,
                     managers.branch_id,
                     branches.branch_name,
                     stores.store_name
                 FROM users managers
                          JOIN branches ON branches.id = managers.branch_id AND branches.store_id = managers.store_id
                          JOIN stores ON stores.id = managers.store_id
                 WHERE managers.role = 'manager'
                   AND managers.store_id = ?
                   AND ${whereClause}
                     LIMIT 1`,
                [storeId, lookupValue]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Pending manager invitation not found.",
                    }),
                };
            }

            const manager = managerRows[0];

            if (String(manager.status || "").toLowerCase() !== "pending") {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        error: "Only pending manager invitations can be resent.",
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: manager.branch_id,
                    email: manager.manager_email,
                    type: "manager_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

            await connection.execute(
                `UPDATE users
                 SET invite_token_hash = SHA2(?, 256)
                 WHERE id = ?
                   AND role = 'manager'
                   AND store_id = ?
                   AND status = 'pending'`,
                [inviteToken, manager.id, storeId]
            );

            const permissions = effectiveEmployeePermissions(manager.permissions, "manager");

            const invitation = {
                manager_email: manager.manager_email,
                manager_name: manager.manager_name,
                store_name: manager.store_name || "StockNBook Store",
                branch_name: manager.branch_name || "Assigned Branch",
                invite_link: inviteLink,
                permissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Manager",
                email: manager.manager_email,
                name: manager.manager_name,
                storeName: manager.store_name || "StockNBook Store",
                branchName: manager.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendManagerInvitationEmail(invitation),
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Manager invitation emailed successfully."
                        : "The manager invitation link was refreshed, but the email could not be delivered. Use Resend Invite in Pending Invites to try again.",
                    manager_id: Number(manager.id),
                    manager_email: manager.manager_email,
                    manager_name: manager.manager_name,
                    invite_link: inviteLink,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // GET BRANCH MANAGERS
        if (action === "get_branch_managers") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            // The list exposes every branch's manager contact details, so it is
            // limited to the store Owner (Managers/Staff cannot list it).
            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only store owners can view branch managers" }),
                };
            }

            const storeId = decoded.store_id;

            const employeeCodeReady = await identifiers.ensureIdentifierSchema(connection);
            const [managerRows] = await connection.execute(
                `SELECT
                     managers.id,
                     managers.employee_code AS employeeCode,
                     managers.full_name AS name,
                     managers.email AS email,
                     managers.phone,
                     managers.status,
                     managers.permissions,
                     managers.branch_id,
                     managers.email_verified_at,
                     managers.created_at,
                     branches.branch_name AS branch
                 FROM users managers
                          JOIN branches ON managers.branch_id = branches.id
                 WHERE managers.store_id = ?
                   AND managers.role = 'manager'
                 ORDER BY branches.branch_name ASC, managers.full_name ASC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    managers: managerRows.map((manager) => ({
                        id: manager.id,
                        employee_code: manager.employeeCode || "",
                        name: manager.name || "Unnamed manager",
                        email: manager.email || "",
                        phone: manager.phone || "",
                        branch: manager.branch || "No branch assigned",
                        branch_id: Number(manager.branch_id) || null,
                        status: manager.status || "pending",
                        email_verified: Boolean(manager.email_verified_at),
                        created_at: manager.created_at || null,
                        // Manager access is determined by the Manager role.
                        permissions: effectiveEmployeePermissions(manager.permissions, "manager"),
                    })),
                }),
            };
        }

        // UPDATE MANAGER DETAILS (Owner): name, phone and branch assignment.
        // Login email changes use request/confirm_manager_email_change below.
        if (action === "update_manager_details") {
            const decoded = await requireOwnerForManagerManagement(connection, event);
            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);
            const fullName = String(body.full_name ?? body.manager_name ?? "").trim();
            const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
            const rawPhone = hasPhone ? String(body.phone ?? "").trim() : "";
            const phoneNumber = hasPhone && rawPhone ? normalizePhilippineMobile(rawPhone) : null;
            const rawBranchId = body.branch_id;
            const requestedBranchId =
                rawBranchId === undefined || rawBranchId === null || rawBranchId === ""
                    ? null
                    : Number(rawBranchId);

            if (!Number.isInteger(managerId) || managerId <= 0) {
                throw securityError(400, "Select a valid manager.", "INVALID_MANAGER");
            }
            if (fullName.length < 2 || fullName.length > 120) {
                throw securityError(400, "Enter a valid manager name.", "INVALID_NAME");
            }
            if (hasPhone && rawPhone && !phoneNumber) {
                throw securityError(400, "Enter a valid 11-digit Philippine mobile number starting with 09.", "INVALID_PHONE");
            }
            if (requestedBranchId !== null && (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0)) {
                throw securityError(400, "Select a valid branch.", "INVALID_BRANCH");
            }

            let rotated = null;
            let branchChanged = false;
            let managerStatus = "";
            let branchName = "";

            if (phoneNumber) await authLock(connection, `phone:${phoneNumber}`);
            await connection.beginTransaction();
            try {
                await connection.execute("SELECT id FROM stores WHERE id = ? FOR UPDATE", [storeId]);
                const [managerRows] = await connection.execute(
                    `SELECT managers.id, managers.branch_id, managers.status, branches.branch_name
                     FROM users managers
                              JOIN branches ON branches.id = managers.branch_id AND branches.store_id = managers.store_id
                     WHERE managers.id = ? AND managers.store_id = ? AND managers.role = 'manager'
                         LIMIT 1
                     FOR UPDATE`,
                    [managerId, storeId]
                );
                const manager = managerRows[0];
                if (!manager) throw securityError(404, "Manager not found.", "MANAGER_NOT_FOUND");
                managerStatus = String(manager.status || "").toLowerCase();
                branchName = manager.branch_name || "";

                branchChanged = requestedBranchId !== null && requestedBranchId !== Number(manager.branch_id);

                if (branchChanged) {
                    // The target branch must belong to this Owner's store.
                    const [branchRows] = await connection.execute(
                        `SELECT id, branch_name, status FROM branches WHERE id = ? AND store_id = ? LIMIT 1 FOR UPDATE`,
                        [requestedBranchId, storeId]
                    );
                    if (!branchRows.length) {
                        throw securityError(404, "The selected branch was not found.", "BRANCH_NOT_FOUND");
                    }
                    if (String(branchRows[0].status || "active").toLowerCase() !== "active") {
                        throw securityError(409, "Choose an active branch.", "BRANCH_INACTIVE");
                    }
                    // Existing rule: one assigned or pending manager per branch.
                    const [occupiedRows] = await connection.execute(
                        `SELECT id FROM users
                         WHERE store_id = ? AND branch_id = ? AND role = 'manager' AND id <> ?
                             LIMIT 1
                         FOR UPDATE`,
                        [storeId, requestedBranchId, managerId]
                    );
                    if (occupiedRows.length) {
                        throw securityError(409, "This branch already has an assigned or pending manager.", "BRANCH_HAS_MANAGER");
                    }
                    // Staff belong to their branch and are managed by that branch's
                    // manager. Moving a manager with assigned staff would leave them
                    // unmanaged, so this is blocked instead of silently moving them.
                    const [staffRows] = await connection.execute(
                        `SELECT COUNT(*) AS total FROM users
                         WHERE store_id = ? AND role = 'staff' AND manager_id = ?
                           AND LOWER(status) IN ('active', 'pending')`,
                        [storeId, managerId]
                    );
                    const assignedStaff = Number(staffRows[0]?.total || 0);
                    if (assignedStaff > 0) {
                        throw securityError(
                            409,
                            `This manager still has ${assignedStaff} active or pending staff ${assignedStaff === 1 ? "account" : "accounts"} in ${manager.branch_name || "the current branch"}. Deactivate or remove those staff accounts before changing the manager's branch.`,
                            "MANAGER_HAS_STAFF"
                        );
                    }
                    branchName = branchRows[0].branch_name || "";
                }

                if (phoneNumber) {
                    const phoneConflict = await accountPhoneConflict(connection, phoneNumber, fullName, storeId, managerId);
                    if (phoneConflict) {
                        throw securityError(409, phoneConflict.error, phoneConflict.code);
                    }
                }
                await connection.execute(
                    `UPDATE users
                     SET full_name = ?,
                         phone = IF(? = 1, ?, phone),
                         branch_id = ?,
                         auth_version = auth_version + ?
                     WHERE id = ? AND store_id = ? AND role = 'manager'`,
                    [
                        fullName,
                        hasPhone ? 1 : 0,
                        phoneNumber,
                        branchChanged ? requestedBranchId : Number(manager.branch_id),
                        branchChanged ? 1 : 0,
                        managerId,
                        storeId,
                    ]
                );

                // A pending invitation is bound to its branch: re-issue it so the
                // previous link (for the old branch) can no longer be used.
                if (branchChanged && managerStatus === "pending") {
                    rotated = await rotatePendingManagerInvitation(connection, { managerId, storeId });
                }

                await connection.commit();
            } catch (updateError) {
                await connection.rollback();
                throw updateError;
            }

            const delivery = rotated ? await deliverRotatedManagerInvitation(rotated.invitation) : null;
            securityEvent("manager_details_updated", {
                account_id: String(managerId),
                branch_changed: branchChanged,
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: branchChanged
                        ? managerStatus === "pending"
                            ? "Manager updated. A new invitation for the new branch was issued; the previous link no longer works."
                            : "Manager updated. The manager must sign in again and can now access only the new branch."
                        : "Manager details updated.",
                    manager: {
                        id: managerId,
                        name: fullName,
                        branch_id: branchChanged ? requestedBranchId : null,
                        branch: branchName,
                        status: managerStatus,
                    },
                    branch_changed: branchChanged,
                    ...(rotated ? {
                        invite_link: rotated.inviteLink,
                        email_sent: delivery.email_sent,
                        email_status: delivery.email_status,
                        email_error: delivery.email_error,
                    } : {}),
                }),
            };
        }

        // REQUEST MANAGER EMAIL CHANGE (Owner)
        // Pending invitation: the address is replaced and a new invitation is
        // issued (the previous link stops working). Activated account: the new
        // address must first receive and confirm a one-time code.
        if (action === "request_manager_email_change") {
            const decoded = await requireOwnerForManagerManagement(connection, event);
            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);
            const newEmail = String(body.new_email ?? body.email ?? "").trim().toLowerCase();

            if (!Number.isInteger(managerId) || managerId <= 0) {
                throw securityError(400, "Select a valid manager.", "INVALID_MANAGER");
            }
            if (!newEmail || newEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
                throw securityError(400, "Enter a valid email address.", "INVALID_EMAIL");
            }

            // Serialize with signup/invitations that may claim the same address.
            await authLock(connection, `account:${newEmail}`);

            const [managerRows] = await connection.execute(
                `SELECT managers.id, managers.full_name AS manager_name, managers.email,
                        managers.status, stores.store_name
                 FROM users managers
                          JOIN stores ON stores.id = managers.store_id
                 WHERE managers.id = ? AND managers.store_id = ? AND managers.role = 'manager'
                     LIMIT 1`,
                [managerId, storeId]
            );
            const manager = managerRows[0];
            if (!manager) throw securityError(404, "Manager not found.", "MANAGER_NOT_FOUND");
            const currentEmail = String(manager.email || "").trim().toLowerCase();
            const status = String(manager.status || "").toLowerCase();

            if (newEmail === currentEmail) {
                throw securityError(400, "The manager already uses this email address.", "EMAIL_UNCHANGED");
            }

            const [existingRows] = await connection.execute(
                `SELECT id FROM users WHERE email = ? UNION ALL SELECT id FROM platform_admins WHERE email = ? LIMIT 1`,
                [newEmail, newEmail]
            );
            if (existingRows.length) {
                throw securityError(409, "This email address is already used by another account.", "EMAIL_IN_USE");
            }

            if (status === "pending") {
                let rotated;
                await connection.beginTransaction();
                try {
                    const [updateResult] = await connection.execute(
                        `UPDATE users SET email = ?
                         WHERE id = ? AND store_id = ? AND role = 'manager'
                           AND status = 'pending' AND email = ?`,
                        [newEmail, managerId, storeId, currentEmail]
                    );
                    if (updateResult.affectedRows !== 1) {
                        throw securityError(409, "The invitation changed. Refresh and try again.", "INVITE_CHANGED");
                    }
                    rotated = await rotatePendingManagerInvitation(connection, {
                        managerId,
                        storeId,
                        previousEmails: [currentEmail],
                    });
                    await connection.commit();
                } catch (changeError) {
                    await connection.rollback();
                    throw changeError;
                }

                const delivery = await deliverRotatedManagerInvitation(rotated.invitation);
                securityEvent("manager_invite_email_replaced", { account_id: String(managerId) });

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: delivery.email_sent
                            ? "Invitation email updated. A new invitation was sent and the previous link no longer works."
                            : "Invitation email updated and a new link was issued, but the email could not be delivered. Copy the backup link or use Resend later.",
                        verification_required: false,
                        email_changed: true,
                        manager_id: managerId,
                        manager_email: newEmail,
                        invite_link: rotated.inviteLink,
                        email_sent: delivery.email_sent,
                        email_status: delivery.email_status,
                        email_error: delivery.email_error,
                    }),
                };
            }

            if (status !== "active" && status !== "inactive") {
                throw securityError(409, "This manager account cannot change its email right now.", "MANAGER_STATUS_INVALID");
            }

            const scope = otpScope("manager_email_change", newEmail);
            await guardOtpSend(connection, scope);

            const otp = generateOtp();
            const otpHash = hashOtp(otp);

            // Only the latest request for this manager can be confirmed.
            await connection.execute(
                `UPDATE otp_codes
                 SET used_at = COALESCE(used_at, UTC_TIMESTAMP()), invalidated_at = UTC_TIMESTAMP()
                 WHERE purpose = 'manager_email_change' AND user_id = ? AND invalidated_at IS NULL`,
                [managerId]
            );
            await connection.execute(
                `INSERT INTO otp_codes
                     (purpose, email, store_id, user_id, otp_hash, expires_at, created_at)
                 VALUES ('manager_email_change', ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP())`,
                [newEmail, storeId, managerId, otpHash, MANAGER_EMAIL_CHANGE_OTP_EXPIRY_SECONDS]
            );

            try {
                await sendManagerEmailChangeOtp(newEmail, manager.manager_name, manager.store_name, otp);
            } catch (emailError) {
                await connection.execute(
                    `UPDATE otp_codes SET used_at = UTC_TIMESTAMP()
                     WHERE purpose = 'manager_email_change' AND user_id = ? AND otp_hash = ? AND used_at IS NULL`,
                    [managerId, otpHash]
                );
                console.error("[stocknbook-auth] Manager email-change code delivery failed:", {
                    code: emailError?.code || "EMAIL_SEND_FAILED",
                });
                throw securityError(
                    502,
                    "The verification code could not be sent to the new email address. Check the address and try again later.",
                    "EMAIL_CHANGE_OTP_FAILED"
                );
            }

            securityEvent("manager_email_change_requested", { account_id: String(managerId) });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: LOCAL_OTP_CONSOLE_ONLY
                        ? "Verification code generated for local testing. Check the IDE terminal."
                        : `A verification code was sent to ${maskEmailAddress(newEmail)}. The login email changes only after that code is confirmed.`,
                    verification_required: true,
                    email_changed: false,
                    manager_id: managerId,
                    pending_email: newEmail,
                    expires_in: MANAGER_EMAIL_CHANGE_OTP_EXPIRY_SECONDS,
                    resend_in: OTP_RESEND_SECONDS,
                }),
            };
        }

        // CONFIRM MANAGER EMAIL CHANGE (Owner enters the code the manager received)
        if (action === "confirm_manager_email_change") {
            const decoded = await requireOwnerForManagerManagement(connection, event);
            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);
            const newEmail = String(body.new_email ?? body.email ?? "").trim().toLowerCase();
            const otp = String(body.otp ?? "").trim();

            if (!Number.isInteger(managerId) || managerId <= 0) {
                throw securityError(400, "Select a valid manager.", "INVALID_MANAGER");
            }
            if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
                throw securityError(400, "Enter a valid email address.", "INVALID_EMAIL");
            }

            await authLock(connection, `account:${newEmail}`);

            const [managerRows] = await connection.execute(
                `SELECT id, email, status FROM users
                 WHERE id = ? AND store_id = ? AND role = 'manager'
                     LIMIT 1`,
                [managerId, storeId]
            );
            const manager = managerRows[0];
            if (!manager) throw securityError(404, "Manager not found.", "MANAGER_NOT_FOUND");
            const status = String(manager.status || "").toLowerCase();
            if (status !== "active" && status !== "inactive") {
                throw securityError(409, "This manager account cannot change its email right now.", "MANAGER_STATUS_INVALID");
            }
            const previousEmail = String(manager.email || "").trim().toLowerCase();

            const otpRecord = await checkOtp(connection, otpScope("manager_email_change", newEmail), otp, false);
            const [otpRows] = await connection.execute(
                `SELECT store_id, user_id FROM otp_codes WHERE id = ? LIMIT 1`,
                [otpRecord.id]
            );
            if (Number(otpRows[0]?.user_id) !== managerId || Number(otpRows[0]?.store_id) !== storeId) {
                throw securityError(400, "Invalid or expired verification code. Request a new code.", "OTP_INVALID");
            }

            const [existingRows] = await connection.execute(
                `SELECT id FROM users WHERE email = ? AND id <> ?
                 UNION ALL SELECT id FROM platform_admins WHERE email = ? LIMIT 1`,
                [newEmail, managerId, newEmail]
            );
            if (existingRows.length) {
                throw securityError(409, "This email address is already used by another account.", "EMAIL_IN_USE");
            }

            await connection.beginTransaction();
            try {
                await connection.execute(
                    "UPDATE otp_codes SET used_at = UTC_TIMESTAMP(), verified_at = UTC_TIMESTAMP() WHERE id = ?",
                    [otpRecord.id]
                );
                const [updateResult] = await connection.execute(
                    `UPDATE users
                     SET email = ?, email_verified_at = UTC_TIMESTAMP(), auth_version = auth_version + 1
                     WHERE id = ? AND store_id = ? AND role = 'manager' AND email = ?`,
                    [newEmail, managerId, storeId, previousEmail]
                );
                if (updateResult.affectedRows !== 1) {
                    throw securityError(409, "The manager account changed. Refresh and try again.", "MANAGER_CHANGED");
                }
                // Recovery codes issued to the previous address can no longer be used.
                await connection.execute(
                    `UPDATE otp_codes
                     SET invalidated_at = UTC_TIMESTAMP(), used_at = COALESCE(used_at, UTC_TIMESTAMP()), reset_token_hash = NULL
                     WHERE purpose = 'password_reset' AND user_id = ? AND invalidated_at IS NULL`,
                    [managerId]
                );
                await connection.commit();
            } catch (confirmError) {
                await connection.rollback();
                throw confirmError;
            }

            securityEvent("manager_email_changed", { account_id: String(managerId) });

            if (!LOCAL_OTP_CONSOLE_ONLY && previousEmail) {
                try {
                    await sendRecoveryMail(
                        previousEmail,
                        "StockNBook login email changed",
                        `<p>The login email for your StockNBook manager account was changed to ${escapeHtml(maskEmailAddress(newEmail))} by the store owner after the new address was verified.</p><p>If you did not expect this change, contact the store owner immediately.</p>`
                    );
                } catch {
                    securityEvent("manager_email_change_notification_failed", { account_id: String(managerId) });
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "The manager's login email was verified and updated.",
                    manager_id: managerId,
                    manager_email: newEmail,
                }),
            };
        }

        // CANCEL PENDING MANAGER INVITATION (Owner)
        // Only an unaccepted invitation (no password, status pending) is removed;
        // its link and OTPs stop working and the branch becomes available again.
        if (action === "cancel_manager_invite") {
            const decoded = await requireOwnerForManagerManagement(connection, event);
            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);

            if (!Number.isInteger(managerId) || managerId <= 0) {
                throw securityError(400, "Select a pending manager invitation.", "INVALID_MANAGER");
            }

            await connection.beginTransaction();
            try {
                const [rows] = await connection.execute(
                    `SELECT id, email, status, password_hash
                     FROM users
                     WHERE id = ? AND store_id = ? AND role = 'manager'
                         LIMIT 1
                     FOR UPDATE`,
                    [managerId, storeId]
                );
                const manager = rows[0];
                if (!manager) throw securityError(404, "Pending manager invitation not found.", "MANAGER_NOT_FOUND");
                if (String(manager.status || "").toLowerCase() !== "pending" || manager.password_hash) {
                    throw securityError(409, "Only pending invitations can be cancelled. Use Deactivate Access for activated managers.", "INVITE_NOT_PENDING");
                }

                await connection.execute(
                    `UPDATE otp_codes
                     SET used_at = COALESCE(used_at, UTC_TIMESTAMP()), invalidated_at = UTC_TIMESTAMP()
                     WHERE purpose = 'manager_invite' AND email = ? AND invalidated_at IS NULL`,
                    [String(manager.email || "").toLowerCase()]
                );
                const [deleteResult] = await connection.execute(
                    `DELETE FROM users
                     WHERE id = ? AND store_id = ? AND role = 'manager'
                       AND status = 'pending' AND password_hash IS NULL`,
                    [managerId, storeId]
                );
                if (deleteResult.affectedRows !== 1) {
                    throw securityError(409, "The invitation changed. Refresh and try again.", "INVITE_CHANGED");
                }
                await connection.commit();
            } catch (cancelError) {
                await connection.rollback();
                throw cancelError;
            }

            securityEvent("manager_invite_cancelled", { account_id: String(managerId) });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Invitation cancelled. The invitation link can no longer be used.",
                    manager_id: managerId,
                }),
            };
        }

        // GET BRANCHES
        if (action === "get_branches") {

            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;

            if (!storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Missing store access" }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     branches.id,
                     branches.branch_name,
                     branches.phone AS contact_number,
                     branches.address,
                     COALESCE(branches.status, 'active') AS branch_status,
                     '' AS inactive_reason,
                     COALESCE(managers.full_name, '') AS manager_name,
                     COALESCE(managers.email, '') AS manager_email,
                     COALESCE(managers.status, 'setup_pending') AS manager_status,
                     managers.permissions,
                     COUNT(
                             DISTINCT CASE
                                          WHEN staff.status = 'active'
                                              THEN staff.id
                                          ELSE NULL
                         END
                     ) AS staff_count
                 FROM branches
                          LEFT JOIN users managers
                                    ON managers.branch_id = branches.id
                                        AND managers.role = 'manager'
                          LEFT JOIN users staff
                                    ON staff.branch_id = branches.id
                                        AND staff.role = 'staff'
                 WHERE branches.store_id = ?
                 GROUP BY
                     branches.id,
                     branches.branch_name,
                     branches.phone,
                     branches.address,
                     branches.status,
                     managers.full_name,
                     managers.email,
                     managers.status,
                     managers.permissions
                 ORDER BY branches.id ASC`,
                [storeId]
            );

            // Managers and Staff use this list only for branch names. Other
            // branches' manager contact details are returned to the Owner only.
            const isOwnerRequest = decoded.role === "owner";

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    branches: branchRows.map((branch) => ({
                        id: branch.id,
                        branch_name: branch.branch_name,
                        contact_number: branch.contact_number || "",
                        address: branch.address || "",
                        branch_status:
                            branch.branch_status || "active",
                        status:
                            branch.branch_status || "active",
                        inactive_reason:
                            branch.inactive_reason || "",
                        branch_inactive_reason:
                            branch.inactive_reason || "",
                        manager_name: isOwnerRequest ? (branch.manager_name || "") : "",
                        manager_email: isOwnerRequest ? (branch.manager_email || "") : "",
                        manager_status: isOwnerRequest ? (branch.manager_status || "setup_pending") : "",
                        staff_count: Number(branch.staff_count || 0),
                        revenue: 0,
                        bookings: 0,
                        permissions:
                            isOwnerRequest && branch.manager_email
                                ? effectiveEmployeePermissions(branch.permissions, "manager")
                                : {},
                    }))
                }),
            };
        }

        // UPDATE BRANCH
        if (action === "update_branch") {

            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;

            // Only the store owner may change branch details.
            if (decoded.role !== "owner" || !storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only the store owner can update branches." }),
                };
            }

            const {
                branch_id,
                branch_name,
                contact_number,
                address,
                status,
                branch_status,
                inactive_reason,
                branch_inactive_reason,
            } = body;
            if (body.manager_name || body.manager_email || body.permissions) {
                throw securityError(400, "Edit manager accounts in Branch Managers.", "MANAGER_MANAGEMENT_ONLY");
            }

            if (!branch_id || !branch_name) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing branch id or branch name" }),
                };
            }

            const normalizedBranchStatus = String(
                status || branch_status || "active"
            )
                .trim()
                .toLowerCase();

            const normalizedInactiveReason =
                normalizedBranchStatus === "inactive"
                    ? String(
                        inactive_reason ||
                        branch_inactive_reason ||
                        ""
                    ).trim()
                    : "";

            if (
                normalizedBranchStatus !== "active" &&
                normalizedBranchStatus !== "inactive"
            ) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Branch status must be active or inactive",
                    }),
                };
            }

            if (
                normalizedBranchStatus === "inactive" &&
                !normalizedInactiveReason
            ) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Select a reason before marking the branch inactive",
                    }),
                };
            }

            await connection.beginTransaction();

            try {
                await connection.execute(`SELECT id FROM stores WHERE id = ? FOR UPDATE`, [storeId]);
                const branchConflict = await findStoreBranchConflict(
                    connection, storeId, branch_name, contact_number, branch_id
                );
                if (branchConflict) {
                    await connection.rollback();
                    return { statusCode: 409, headers, body: JSON.stringify(branchConflict) };
                }
                const [branchResult] = await connection.execute(
                    `UPDATE branches
                     SET branch_name = ?,
                         phone = ?,
                         address = ?,
                         status = ?
                     WHERE id = ?
                       AND store_id = ?`,
                    [
                        branch_name,
                        contact_number || null,
                        address || null,
                        normalizedBranchStatus,
                        branch_id,
                        storeId,
                    ]
                );

                if (branchResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Branch not found" }),
                    };
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Branch updated successfully",
                        branch_updated: branchResult.affectedRows,
                        branch_status: normalizedBranchStatus,
                        inactive_reason:
                        normalizedInactiveReason,
                    }),
                };
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: err.message }),
                };
            }
        }

// DELETE BRANCH
        if (action === "delete_branch") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;
            const { branch_id } = body;

            // Branch deletion also removes assigned employees: owner approval is required.
            if (decoded.role !== "owner" || !storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only the store owner can delete branches." }),
                };
            }

            if (!branch_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing store or branch id" }),
                };
            }

            await connection.beginTransaction();

            try {
                await connection.execute(
                    `DELETE FROM users WHERE branch_id = ? AND store_id = ? AND role = 'staff'`,
                    [branch_id, storeId]
                );

                await connection.execute(
                    `DELETE FROM users WHERE branch_id = ? AND store_id = ? AND role = 'manager'`,
                    [branch_id, storeId]
                );

                const [branchResult] = await connection.execute(
                    `DELETE FROM branches WHERE id = ? AND store_id = ?`,
                    [branch_id, storeId]
                );

                if (branchResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Branch not found" }),
                    };
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Branch deleted successfully",
                    }),
                };
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: err.message }),
                };
            }
        }

        // GET CURRENT USER
        if (action === "get_current_user") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            // Platform administrator sessions do not belong to a store.
            // Return the admin identity directly so the dashboard's
            // get_current_user check succeeds instead of treating the token
            // as an invalid/unknown role and redirecting to the landing page.
            if (decoded.role === "PLATFORM_ADMIN") {
                const platformAdminId = Number(decoded.platform_admin_id);

                if (!platformAdminId) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid platform admin token" }),
                    };
                }

                const [adminRows] = await connection.execute(
                    `SELECT
                         id AS platform_admin_id,
                         full_name,
                         email,
                         role,
                         status,
                         CASE WHEN LOWER(status) = 'active' THEN 1 ELSE 0 END AS is_active
                     FROM platform_admins
                     WHERE id = ?
                         LIMIT 1`,
                    [platformAdminId]
                );

                if (!adminRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Platform administrator not found" }),
                    };
                }

                const admin = adminRows[0];
                const adminStatus = String(admin.status || "")
                    .trim()
                    .toLowerCase();

                if (adminStatus !== "active" || Number(admin.is_active) !== 1) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Platform administrator account is inactive.",
                            code: "ACCOUNT_INACTIVE",
                        }),
                    };
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "PLATFORM_ADMIN",
                        platform_admin_id: admin.platform_admin_id,
                        full_name: admin.full_name,
                        email: admin.email,
                    }),
                };
            }

            if (decoded.role === "owner") {
                const [storeRows] = await connection.execute(
                    `SELECT s.id, s.store_name, u.full_name AS owner_name, u.email, s.slug
                     FROM stores s
                              LEFT JOIN users u ON u.store_id = s.id AND u.role = 'owner'
                     WHERE s.id = ?
                         LIMIT 1`,
                    [decoded.store_id]
                );

                if (!storeRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Owner store not found" }),
                    };
                }

                const store = storeRows[0];



                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "owner",
                        store_id: store.id,
                        store_name: store.store_name,
                        store_slug: store.slug,
                        owner_name: store.owner_name,
                        email: store.email,
                    }),
                };
            }

            if (decoded.role === "manager") {
                const [managerRows] = await connection.execute(
                    `SELECT
                         managers.id,
                         managers.full_name AS manager_name,
                         managers.email AS manager_email,
                         managers.permissions,
                         managers.status,
                         managers.store_id,
                         managers.branch_id,
                         branches.branch_name,
                         stores.store_name, stores.slug AS store_slug
                     FROM users managers
                              JOIN branches ON managers.branch_id = branches.id
                              JOIN stores ON managers.store_id = stores.id
                     WHERE managers.id = ?
                       AND managers.role = 'manager'
                       AND managers.store_id = ?
                       AND managers.branch_id = ?
                         LIMIT 1`,
                    [decoded.manager_id, decoded.store_id, decoded.branch_id]
                );

                if (!managerRows.length) {
                    // The session's branch no longer matches (branch reassignment)
                    // or the account was removed: the old session must end.
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Manager not found. Your branch assignment may have changed. Please sign in again.",
                            code: "SESSION_INVALIDATED",
                        }),
                    };
                }

                const manager = managerRows[0];

                if (manager.status !== "active") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account deactivated",
                            code: "ACCOUNT_DEACTIVATED",
                            message:
                                "Your branch manager account has been deactivated. Please contact the store owner if you think this was a mistake.",
                        }),
                    };
                }

                // Existing active Managers saved with disabled modules receive the
                // Manager role access on their next session refresh.
                await syncStoredManagerRolePermissions(connection, manager.id, manager.permissions);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "manager",
                        manager_id: manager.id,
                        manager_name: manager.manager_name,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        store_slug: manager.store_slug,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        permissions: effectiveEmployeePermissions(manager.permissions, "manager"),
                    }),
                };
            }

            if (decoded.role === "staff") {
                const [staffRows] = await connection.execute(
                    `SELECT
                         staff.id,
                         staff.full_name AS staff_name,
                         staff.email AS staff_email,
                         staff.permissions,
                         staff.store_id,
                         staff.branch_id,
                         staff.manager_id,
                         branches.branch_name,
                         stores.store_name, stores.slug AS store_slug
                     FROM users staff
                              JOIN branches ON staff.branch_id = branches.id
                              JOIN stores ON staff.store_id = stores.id
                     WHERE staff.id = ?
                       AND staff.role = 'staff'
                       AND staff.store_id = ?
                       AND staff.branch_id = ?
                       AND staff.status = 'active'
                         LIMIT 1`,
                    [decoded.staff_id, decoded.store_id, decoded.branch_id]
                );

                if (!staffRows.length) {
                    // Deactivated, removed, or moved to another branch.
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Staff not found. Your account access may have changed. Please sign in again.",
                            code: "SESSION_INVALIDATED",
                        }),
                    };
                }

                const staff = staffRows[0];

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "staff",
                        staff_id: staff.id,
                        staff_name: staff.staff_name,
                        staff_email: staff.staff_email,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        store_slug: staff.store_slug,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        manager_id: staff.manager_id,
                        permissions: effectiveEmployeePermissions(staff.permissions, "staff"),
                    }),
                };
            }

            // DEACTIVATE MANAGER


            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Invalid role" }),
            };
        }
        // DELETE MANAGER ACCOUNT
        if (action === "delete_manager") {
            const authHeader =
                event.headers?.Authorization ||
                event.headers?.authorization ||
                "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Missing token",
                    }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid token",
                    }),
                };
            }

            if (decoded.role !== "owner") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only owners can delete managers",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);

            if (!storeId || !managerId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing manager id",
                    }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT id, branch_id, full_name AS manager_name, email AS manager_email
                 FROM users
                 WHERE id = ?
                   AND role = 'manager'
                   AND store_id = ?
                     LIMIT 1`,
                [managerId, storeId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Manager not found",
                    }),
                };
            }

            await connection.beginTransaction();

            try {
                // Staff accounts belong to this manager through staff.manager_id.
                // Remove them first so the manager can be deleted cleanly and
                // no staff account remains attached to a deleted manager.
                const [staffDeleteResult] = await connection.execute(
                    `DELETE FROM users WHERE manager_id = ? AND store_id = ? AND role = 'staff'`,
                    [managerId, storeId]
                );

                const [managerDeleteResult] = await connection.execute(
                    `DELETE FROM users WHERE id = ? AND store_id = ? AND role = 'manager'`,
                    [managerId, storeId]
                );

                if (managerDeleteResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Manager not found",
                        }),
                    };
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Manager account deleted successfully",
                        manager_deleted: managerDeleteResult.affectedRows,
                        staff_deleted: staffDeleteResult.affectedRows,
                    }),
                };
            } catch (deleteError) {
                await connection.rollback();
                throw deleteError;
            }
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid action" }),
        };
    } catch (err) {
        const securityAction = /^(login|platform_admin_login|request_password_reset|verify_password_reset_otp|reset_password|send_signup_otp|verify_signup_otp|update_store_profile|send_manager_invite_otp|verify_manager_invite_otp|send_staff_invite_otp|verify_staff_invite_otp|send_payment_otp|verify_payment_otp|submit_subscription_payment|request_manager_email_change|confirm_manager_email_change)$/.test(String(action));
        if (!securityAction) {
            console.error("[stocknbook-auth] Error:", { action, message: err?.message, code: err?.code, stack: err?.stack });
            return { statusCode: Number(err?.statusCode) || 500, headers, body: JSON.stringify({ error: err?.message || "Internal server error", code: err?.code || "UNKNOWN_ERROR" }) };
        }
        if (!err?.statusCode || Number(err.statusCode) >= 500)
            console.error(JSON.stringify({ category: "authentication_backend_error", action, code: err?.code || "INTERNAL_ERROR" }));
        return {
            statusCode: Number(err?.statusCode) || 500,
            headers,
            body: JSON.stringify({
                error: (err?.code === "PAYMENT_OTP_EMAIL_FAILED" || (err?.statusCode && Number(err.statusCode) < 500)) ? err.message : "Unable to process your request. Please try again.",
                code: (err?.code === "PAYMENT_OTP_EMAIL_FAILED" || (err?.statusCode && Number(err.statusCode) < 500)) ? err.code : "SERVER_ERROR",
                ...(err?.retry_after_seconds ? { retry_after_seconds: err.retry_after_seconds } : {}),
                ...(err?.code === "ACCOUNT_LOCKED" ? {
                    lockout_count: err.lockout_count,
                    password_recovery_available: err.password_recovery_available,
                } : {}),
            }),
        };
    } finally {
        if (connection) {
            if (await releaseAuthLocks(connection)) connection.release();
            else connection.destroy();
        }
    }
};
// The existing standalone Platform Administrator login helper shares these same counters.
module.exports.authenticateAccount = authenticateAccount;
module.exports.releaseAuthLocks = releaseAuthLocks;