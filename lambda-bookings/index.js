/* eslint-disable @typescript-eslint/no-require-imports */

const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "stocknbook-db.ctc4eeuyq62e.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
};

function response(statusCode, payload) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(payload),
    };
}

function parseBody(event) {
    if (!event.body) return {};

    if (typeof event.body === "object") {
        return event.body;
    }

    try {
        return JSON.parse(event.body || "{}");
    } catch {
        return {};
    }
}

function toNumber(value, fallback = 0) {
    const num = Number(value ?? fallback);
    return Number.isFinite(num) ? num : fallback;
}

function safeParseJSON(value) {
    if (!value) return null;

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function cleanPackageName(value) {
    if (!value) return "";

    return String(value)
        .replace(/\s*-\s*₱?\s*[\d,]+(\.\d+)?\s*$/i, "")
        .trim();
}

function normalizeText(value) {
    return cleanPackageName(value).toLowerCase().trim();
}

function getPackageInput(body) {
    return (
        body.selectedPackage ||
        body.packageData ||
        body.package_json ||
        body.packageJSON ||
        body.package ||
        null
    );
}

function getPackageIdFromInput(packageInput, body) {
    if (body.package_id) return Number(body.package_id);
    if (body.packageId) return Number(body.packageId);

    if (packageInput && typeof packageInput === "object") {
        return Number(
            packageInput.id ||
            packageInput.package_id ||
            packageInput.packageId ||
            0
        );
    }

    return 0;
}

function getPackageNameFromInput(packageInput, body) {
    if (body.packageName) return cleanPackageName(body.packageName);
    if (body.package_name) return cleanPackageName(body.package_name);

    if (typeof body.package === "string") {
        return cleanPackageName(body.package);
    }

    if (packageInput && typeof packageInput === "object") {
        return cleanPackageName(
            packageInput.name ||
            packageInput.package_name ||
            packageInput.packageName ||
            packageInput.title ||
            ""
        );
    }

    return "";
}

function snapshotFromPackagePayload(packageInput) {
    const parsed = safeParseJSON(packageInput);

    if (!parsed || typeof parsed !== "object") return null;

    const name = cleanPackageName(
        parsed.name ||
        parsed.package_name ||
        parsed.packageName ||
        parsed.title ||
        ""
    );

    const packagePrice = toNumber(
        parsed.package_price ??
        parsed.packagePrice ??
        parsed.price ??
        parsed.package_price_amount ??
        0
    );

    const downPaymentAmount = toNumber(
        parsed.down_payment_amount ??
        parsed.downPaymentAmount ??
        parsed.required_down_payment ??
        parsed.requiredDownPayment ??
        0
    );

    if (!name && packagePrice <= 0) return null;

    return {
        id: parsed.id || parsed.package_id || parsed.packageId || null,
        name,
        price: packagePrice,
        package_price: packagePrice,
        down_payment_amount: downPaymentAmount,
        required_down_payment: downPaymentAmount,
        duration: parsed.duration || null,
        status: parsed.status || null,
        inclusions: parsed.inclusions || [],
    };
}

function packageSnapshotFromRow(row) {
    return {
        id: row.id,
        name: row.name,
        price: toNumber(row.package_price),
        package_price: toNumber(row.package_price),
        down_payment_amount: toNumber(row.down_payment_amount),
        required_down_payment: toNumber(row.down_payment_amount),
        duration: row.duration || null,
        status: row.status || null,
        inclusions: safeParseJSON(row.inclusions) || [],
    };
}

async function findPackageSnapshot(connection, options) {
    const {
        storeId,
        branchId,
        packageId,
        packageName,
        packageInput,
    } = options;

    if (packageId) {
        const [rows] = await connection.execute(
            `
                SELECT
                    id,
                    name,
                    package_price,
                    down_payment_amount,
                    duration,
                    status,
                    inclusions
                FROM packages
                WHERE id = ?
                  AND store_id = ?
                  AND (? IS NULL OR branch_id = ?)
                    LIMIT 1
            `,
            [
                Number(packageId),
                Number(storeId),
                branchId ? Number(branchId) : null,
                branchId ? Number(branchId) : null,
            ]
        );

        if (rows.length > 0) {
            return packageSnapshotFromRow(rows[0]);
        }
    }

    const cleanedName = normalizeText(packageName);

    if (cleanedName) {
        const [rows] = await connection.execute(
            `
                SELECT
                    id,
                    name,
                    package_price,
                    down_payment_amount,
                    duration,
                    status,
                    inclusions
                FROM packages
                WHERE store_id = ?
                  AND (? IS NULL OR branch_id = ?)
                ORDER BY created_at DESC
            `,
            [
                Number(storeId),
                branchId ? Number(branchId) : null,
                branchId ? Number(branchId) : null,
            ]
        );

        const matched = rows.find((row) => {
            return normalizeText(row.name) === cleanedName;
        });

        if (matched) {
            return packageSnapshotFromRow(matched);
        }
    }

    return snapshotFromPackagePayload(packageInput);
}

function getBookingItemsInput(body) {
    const rawItems =
        body.bookingItems ||
        body.booking_items ||
        body.selectedCustomItems ||
        body.customItems ||
        [];

    const parsed = safeParseJSON(rawItems);

    return Array.isArray(parsed) ? parsed : [];
}

function normalizeBookingItemsForSave(rawItems, options) {
    const {
        bookingId,
        storeId,
        branchId,
        sourceType,
        packageId = null,
    } = options;

    if (!Array.isArray(rawItems)) return [];

    return rawItems
        .map((item) => {
            const productId = Number(
                item.productId ||
                item.product_id ||
                item.id ||
                0
            );

            if (!Number.isInteger(productId) || productId <= 0) {
                return null;
            }

            const rawVariantId = item.variantId ?? item.variant_id ?? null;
            const variantId = rawVariantId ? Number(rawVariantId) : null;

            const displayName = String(
                item.displayName ||
                item.productName ||
                item.product_name ||
                item.item ||
                item.name ||
                ""
            ).trim();

            const productName = String(
                item.productName ||
                item.product_name ||
                item.item ||
                item.name ||
                displayName.split("—")[0] ||
                displayName
            ).trim();

            const variantName = String(
                item.variantName ||
                item.variant_name ||
                ""
            ).trim();

            const category = String(item.category || "").trim();

            const bookedQuantity = Math.max(
                1,
                Math.floor(
                    toNumber(
                        item.quantity ??
                        item.qty ??
                        item.bookedQuantity ??
                        item.booked_quantity ??
                        1,
                        1
                    )
                )
            );

            const unitPrice = toNumber(
                item.salesPrice ??
                item.sales_price ??
                item.unitPrice ??
                item.unit_price ??
                item.unitSalesPrice ??
                item.unit_sales_price ??
                0,
                0
            );

            return {
                bookingId,
                storeId,
                branchId,
                sourceType,
                packageId,
                productId,
                variantId,
                productName,
                variantName,
                category,
                bookedQuantity,
                unitPrice,
                estimatedSubtotal: unitPrice * bookedQuantity,
            };
        })
        .filter(Boolean);
}

async function insertBookingItems(connection, items) {
    if (!Array.isArray(items) || items.length === 0) return;

    const placeholders = items
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");

    const params = items.flatMap((item) => [
        item.bookingId,
        item.storeId,
        item.branchId,
        item.sourceType,
        item.packageId,

        item.productId,
        item.variantId,

        item.productName,
        item.variantName || null,
        item.category || null,

        item.bookedQuantity,
        0,
        0,
        0,

        item.unitPrice,
        item.estimatedSubtotal,
        0,

        "pending",
        null,
    ]);

    await connection.execute(
        `
            INSERT INTO booking_items
            (
                booking_id,
                store_id,
                branch_id,
                source_type,
                package_id,

                product_id,
                variant_id,

                product_name,
                variant_name,
                category,

                booked_quantity,
                reserved_quantity,
                used_quantity,
                restored_quantity,

                unit_price,
                estimated_subtotal,
                used_subtotal,

                inventory_status,
                notes
            )
            VALUES ${placeholders}
        `,
        params
    );
}

async function reserveBookingInventory(connection, options) {
    const { bookingId, storeId, branchId } = options;

    const params = [Number(bookingId), Number(storeId)];
    let branchFilter = "";

    if (branchId) {
        branchFilter = " AND branch_id = ?";
        params.push(Number(branchId));
    }

    const [items] = await connection.execute(
        `
            SELECT
                id,
                product_id,
                variant_id,
                product_name,
                variant_name,
                booked_quantity,
                reserved_quantity,
                inventory_status
            FROM booking_items
            WHERE booking_id = ?
              AND store_id = ?
                ${branchFilter}
          AND inventory_status = 'pending'
        FOR UPDATE
        `,
        params
    );

    let reservedCount = 0;

    for (const item of items) {
        const bookingItemId = Number(item.id);
        const productId = Number(item.product_id);
        const variantId = item.variant_id ? Number(item.variant_id) : null;
        const bookedQty = Number(item.booked_quantity || 0);
        const alreadyReserved = Number(item.reserved_quantity || 0);
        const qtyToReserve = bookedQty - alreadyReserved;

        if (!productId || qtyToReserve <= 0) continue;

        const itemLabel = item.variant_name
            ? `${item.product_name} — ${item.variant_name}`
            : item.product_name;

        if (variantId) {
            const [variantRows] = await connection.execute(
                `
                    SELECT stock
                    FROM product_variants
                    WHERE id = ?
                      AND product_id = ?
                        FOR UPDATE
                `,
                [variantId, productId]
            );

            if (!variantRows.length) {
                return {
                    ok: false,
                    error: `Variant stock record not found for ${itemLabel}.`,
                };
            }

            const currentStock = Number(variantRows[0].stock || 0);

            if (currentStock < qtyToReserve) {
                return {
                    ok: false,
                    error: `Not enough stock for ${itemLabel}. Available: ${currentStock}, needed: ${qtyToReserve}.`,
                };
            }

            await connection.execute(
                `
                    UPDATE product_variants
                    SET stock = stock - ?
                    WHERE id = ?
                      AND product_id = ?
                `,
                [qtyToReserve, variantId, productId]
            );

            await connection.execute(
                `
                    UPDATE products
                    SET stock = GREATEST(stock - ?, 0)
                    WHERE id = ?
                      AND store_id = ?
                `,
                [qtyToReserve, productId, storeId]
            );
        } else {
            const productParams = [productId, storeId];
            let productBranchFilter = "";

            if (branchId) {
                productBranchFilter = " AND branch_id = ?";
                productParams.push(Number(branchId));
            }

            const [productRows] = await connection.execute(
                `
                    SELECT stock
                    FROM products
                    WHERE id = ?
                      AND store_id = ?
                        ${productBranchFilter}
                FOR UPDATE
                `,
                productParams
            );

            if (!productRows.length) {
                return {
                    ok: false,
                    error: `Product stock record not found for ${itemLabel}.`,
                };
            }

            const currentStock = Number(productRows[0].stock || 0);

            if (currentStock < qtyToReserve) {
                return {
                    ok: false,
                    error: `Not enough stock for ${itemLabel}. Available: ${currentStock}, needed: ${qtyToReserve}.`,
                };
            }

            const updateParams = [qtyToReserve, productId, storeId];

            let updateBranchFilter = "";

            if (branchId) {
                updateBranchFilter = " AND branch_id = ?";
                updateParams.push(Number(branchId));
            }

            await connection.execute(
                `
                    UPDATE products
                    SET stock = stock - ?
                    WHERE id = ?
                      AND store_id = ?
                        ${updateBranchFilter}
                `,
                updateParams
            );
        }

        await connection.execute(
            `
                UPDATE booking_items
                SET
                    reserved_quantity = booked_quantity,
                    inventory_status = 'reserved',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
            [bookingItemId]
        );

        reservedCount += 1;
    }

    return {
        ok: true,
        reservedCount,
    };
}

function getUsedItemsInput(body) {
    const rawItems =
        body.usedItems ||
        body.used_items ||
        body.cancelItems ||
        body.cancel_items ||
        [];

    const parsed = safeParseJSON(rawItems);

    return Array.isArray(parsed) ? parsed : [];
}

function getUsedQuantityForItem(item, usedItems) {
    const matched = usedItems.find((usedItem) => {
        const usedBookingItemId = Number(
            usedItem.booking_item_id ||
            usedItem.bookingItemId ||
            usedItem.id ||
            0
        );

        return usedBookingItemId === Number(item.id);
    });

    if (!matched) return 0;

    return Math.max(
        0,
        Math.floor(
            toNumber(
                matched.used_quantity ??
                matched.usedQuantity ??
                matched.quantityUsed ??
                matched.qtyUsed ??
                0,
                0
            )
        )
    );
}

async function restoreBookingInventoryOnCancel(connection, options) {
    const { bookingId, storeId, branchId, usedItems = [] } = options;

    const params = [Number(bookingId), Number(storeId)];
    let branchFilter = "";

    if (branchId) {
        branchFilter = " AND branch_id = ?";
        params.push(Number(branchId));
    }

    const [items] = await connection.execute(
        `
            SELECT
                id,
                product_id,
                variant_id,
                product_name,
                variant_name,
                reserved_quantity,
                used_quantity,
                restored_quantity,
                unit_price,
                inventory_status
            FROM booking_items
            WHERE booking_id = ?
              AND store_id = ?
                ${branchFilter}
          AND inventory_status = 'reserved'
        FOR UPDATE
        `,
        params
    );

    let restoredCount = 0;
    let restoredQuantity = 0;
    let usedQuantity = 0;

    for (const item of items) {
        const bookingItemId = Number(item.id);
        const productId = Number(item.product_id);
        const variantId = item.variant_id ? Number(item.variant_id) : null;
        const reservedQty = Number(item.reserved_quantity || 0);
        const unitPrice = toNumber(item.unit_price, 0);

        if (!productId || reservedQty <= 0) continue;

        const usedQty = getUsedQuantityForItem(item, usedItems);

        const itemLabel = item.variant_name
            ? `${item.product_name} — ${item.variant_name}`
            : item.product_name;

        if (usedQty > reservedQty) {
            return {
                ok: false,
                error: `Used quantity for ${itemLabel} cannot exceed reserved quantity. Reserved: ${reservedQty}, used: ${usedQty}.`,
            };
        }

        const qtyToRestore = reservedQty - usedQty;

        if (qtyToRestore > 0) {
            if (variantId) {
                await connection.execute(
                    `
                        UPDATE product_variants
                        SET stock = stock + ?
                        WHERE id = ?
                          AND product_id = ?
                    `,
                    [qtyToRestore, variantId, productId]
                );

                await connection.execute(
                    `
                        UPDATE products
                        SET stock = stock + ?
                        WHERE id = ?
                          AND store_id = ?
                    `,
                    [qtyToRestore, productId, storeId]
                );
            } else {
                const updateParams = [qtyToRestore, productId, storeId];
                let updateBranchFilter = "";

                if (branchId) {
                    updateBranchFilter = " AND branch_id = ?";
                    updateParams.push(Number(branchId));
                }

                await connection.execute(
                    `
                        UPDATE products
                        SET stock = stock + ?
                        WHERE id = ?
                          AND store_id = ?
                            ${updateBranchFilter}
                    `,
                    updateParams
                );
            }
        }

        const nextInventoryStatus =
            usedQty <= 0
                ? "cancelled_restored"
                : qtyToRestore <= 0
                    ? "cancelled_used"
                    : "cancelled_partial_used";

        await connection.execute(
            `
                UPDATE booking_items
                SET
                    used_quantity = ?,
                    restored_quantity = ?,
                    used_subtotal = ?,
                    inventory_status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
            [
                usedQty,
                qtyToRestore,
                unitPrice * usedQty,
                nextInventoryStatus,
                bookingItemId,
            ]
        );

        restoredCount += 1;
        restoredQuantity += qtyToRestore;
        usedQuantity += usedQty;
    }

    return {
        ok: true,
        restoredCount,
        restoredQuantity,
        usedQuantity,
    };
}

function getAuthHeader(event) {
    return event.headers?.Authorization || event.headers?.authorization || "";
}

function verifyProtectedStore(event) {
    const authHeader = getAuthHeader(event);

    if (!authHeader) {
        throw new Error("No token");
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);

    return Number(decoded.store_id || decoded.storeId || 0);
}

const packagePriceExpr = `
    COALESCE(
        NULLIF(bookings.package_price, 0),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.package_price')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.price')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.packageJSON, '$.package_price')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.packageJSON, '$.price')), '') AS DECIMAL(10,2)),
        0
    )
`;

const requiredDownPaymentExpr = `
    COALESCE(
        NULLIF(bookings.required_down_payment, 0),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.down_payment_amount')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.required_down_payment')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.packageJSON, '$.down_payment_amount')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.packageJSON, '$.required_down_payment')), '') AS DECIMAL(10,2)),
        0
    )
`;

const totalPriceExpr = `
    CASE
        WHEN LOWER(COALESCE(bookings.booking_type, '')) LIKE '%custom%'
             OR COALESCE(bookings.custom_order, '') <> ''
        THEN COALESCE(NULLIF(bookings.agreed_price, 0), 0)
        ELSE ${packagePriceExpr}
    END
`;

const computedBalanceExpr = `
    CASE
        WHEN COALESCE(bookings.balance, 0) = 0
             AND COALESCE(bookings.amount_paid, 0) = 0
             AND ${totalPriceExpr} > 0
        THEN ${totalPriceExpr}
        ELSE COALESCE(bookings.balance, 0)
    END
`;

function bookingSelectFields() {
    return `
        bookings.id,
        bookings.branch_id              AS branchId,
        branches.branch_name            AS branchName,
        bookings.booking_reference      AS bookingReference,
        bookings.booking_type           AS bookingType,
        bookings.name,
        bookings.facebook_name          AS facebookName,
        bookings.phone,
        bookings.email,
        bookings.event_date             AS date,
        bookings.event_time             AS eventTime,
        bookings.event_type             AS eventType,
        bookings.package_name           AS package,
        bookings.custom_order           AS customOrder,
        bookings.theme,
        bookings.venue,
        bookings.notes,
        bookings.status,
        bookings.agreed_price,
        bookings.agreed_price           AS agreedPrice,
        ${packagePriceExpr}             AS package_price,
        ${packagePriceExpr}             AS packagePrice,
        ${requiredDownPaymentExpr}      AS required_down_payment,
        ${requiredDownPaymentExpr}      AS requiredDownPayment,
        COALESCE(bookings.amount_paid, 0) AS amount_paid,
        COALESCE(bookings.amount_paid, 0) AS amountPaid,
        ${computedBalanceExpr}          AS balance,
        COALESCE(bookings.payment_status, 'Unpaid') AS payment_status,
        COALESCE(bookings.payment_status, 'Unpaid') AS paymentStatus,
        bookings.package_json,
        bookings.packageJSON,
        bookings.created_at             AS createdAt
    `;
}

// Lightweight fields used by owner, manager, and staff dashboards.
// Do not include package JSON/payment calculations here because dashboards
// only need counts, package names, schedules, statuses, and branch details.
function dashboardBookingSelectFields() {
    return `
        bookings.id,
        bookings.branch_id         AS branchId,
        branches.branch_name       AS branchName,
        bookings.name,
        bookings.event_date        AS date,
        bookings.status,
        bookings.package_name      AS packageName,
        bookings.event_type        AS eventName,
        bookings.created_at        AS createdAt
    `;
}

// Fields used by the full Bookings screens. This avoids the very large
// package JSON expressions used by get_bookings while still returning the
// customer, schedule, branch, package, status, and payment values needed by
// owner, manager, and staff booking pages.
function bookingPageSelectFields() {
    return `
        bookings.id,
        bookings.branch_id                      AS branchId,
        branches.branch_name                    AS branchName,
        bookings.booking_reference              AS bookingReference,
        bookings.booking_type                   AS bookingType,
        bookings.name,
        bookings.facebook_name                  AS facebookName,
        bookings.phone,
        bookings.email,
        bookings.event_date                     AS date,
        bookings.event_time                     AS eventTime,
        bookings.event_type                     AS eventType,
        bookings.event_type                     AS eventName,
        bookings.package_name                   AS package,
        bookings.package_name                   AS packageName,
        bookings.custom_order                   AS customOrder,
        bookings.theme,
        bookings.venue,
        bookings.notes,
        bookings.status,
        COALESCE(bookings.agreed_price, 0)       AS agreed_price,
        COALESCE(bookings.agreed_price, 0)       AS agreedPrice,
        COALESCE(bookings.package_price, 0)      AS package_price,
        COALESCE(bookings.package_price, 0)      AS packagePrice,
        COALESCE(bookings.required_down_payment, 0) AS required_down_payment,
        COALESCE(bookings.required_down_payment, 0) AS requiredDownPayment,
        COALESCE(bookings.amount_paid, 0)        AS amount_paid,
        COALESCE(bookings.amount_paid, 0)        AS amountPaid,
        COALESCE(bookings.balance, 0)            AS balance,
        COALESCE(bookings.payment_status, 'Unpaid') AS payment_status,
        COALESCE(bookings.payment_status, 'Unpaid') AS paymentStatus,
        bookings.created_at                     AS createdAt
    `;
}

exports.handler = async (event) => {
    const method = event.httpMethod || event.requestContext?.http?.method;

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    let connection;

    try {
        const body = parseBody(event);
        const action = body.action;

        connection = await mysql.createConnection(dbConfig);

        // ── PUBLIC: create_booking ────────────────────────────────────────────
        if (action === "create_booking") {
            const {
                storeId,
                store_id,
                branchId,
                branch_id,
                bookingReference,
                booking_reference,
                bookingType,
                booking_type,
                name,
                facebookName,
                facebook_name,
                phone,
                email,
                date,
                event_date,
                eventTime,
                event_time,
                eventType,
                event_type,
                customOrder,
                custom_order,
                theme,
                venue,
                notes,
                status,
            } = body;

            const targetStoreId = Number(storeId || store_id);
            const targetBranchId = branchId || branch_id ? Number(branchId || branch_id) : null;

            const finalBookingReference = bookingReference || booking_reference || null;
            const finalBookingType = bookingType || booking_type || "";
            const finalDate = date || event_date;
            const finalEventTime = eventTime || event_time || null;
            const finalEventType = eventType || event_type || "Based on selected package";
            const finalCustomOrder = customOrder || custom_order || "";

            if (!targetStoreId || !finalBookingType || !name || !phone || !finalDate) {
                return response(400, {
                    error: "Missing required booking fields",
                });
            }

            const packageInput = getPackageInput(body);
            const packageId = getPackageIdFromInput(packageInput, body);
            const rawPackageName = getPackageNameFromInput(packageInput, body);

            const isCustom =
                String(finalBookingType).toLowerCase().includes("custom") ||
                Boolean(finalCustomOrder);

            let packageSnapshot = null;

            if (!isCustom) {
                packageSnapshot = await findPackageSnapshot(connection, {
                    storeId: targetStoreId,
                    branchId: targetBranchId,
                    packageId,
                    packageName: rawPackageName,
                    packageInput,
                });

                if (!packageSnapshot) {
                    return response(400, {
                        error: "Selected package was not found",
                    });
                }

                if (packageId && Number(packageSnapshot.id) !== Number(packageId)) {
                    return response(400, {
                        error: "Package mismatch: selected package ID does not match package snapshot",
                        selectedPackageId: Number(packageId),
                        snapshotPackageId: Number(packageSnapshot.id),
                        snapshotPackageName: packageSnapshot.name,
                    });
                }
            }

            if (
                rawPackageName &&
                normalizeText(packageSnapshot.name) !== normalizeText(rawPackageName)
            ) {
                return response(400, {
                    error: "Package mismatch: selected package name does not match package snapshot",
                    selectedPackageName: rawPackageName,
                    snapshotPackageName: packageSnapshot.name,
                });
            }

            const packagePrice = isCustom
                ? 0
                : toNumber(packageSnapshot?.package_price ?? packageSnapshot?.price ?? 0);

            const requiredDownPayment = isCustom
                ? 0
                : toNumber(
                    packageSnapshot?.down_payment_amount ??
                    packageSnapshot?.required_down_payment ??
                    0
                );

            const packageNameForSave = isCustom
                ? ""
                : packageSnapshot?.name || rawPackageName || "";

            const packageJsonForSave = packageSnapshot
                ? JSON.stringify(packageSnapshot)
                : packageInput && typeof packageInput === "object"
                    ? JSON.stringify(packageInput)
                    : null;

            const amountPaid = 0;
            const balance = isCustom ? 0 : packagePrice;
            const paymentStatus = "Unpaid";

            const [result] = await connection.execute(
                `
                    INSERT INTO bookings
                    (
                        store_id,
                        branch_id,
                        booking_reference,
                        booking_type,
                        name,
                        facebook_name,
                        phone,
                        email,
                        event_date,
                        event_time,
                        event_type,
                        package_name,
                        package_json,
                        packageJSON,
                        custom_order,
                        theme,
                        venue,
                        notes,
                        status,
                        agreed_price,
                        package_price,
                        required_down_payment,
                        amount_paid,
                        balance,
                        payment_status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    targetStoreId,
                    targetBranchId,
                    finalBookingReference,
                    finalBookingType,
                    name,
                    facebookName || facebook_name || null,
                    phone,
                    email || null,
                    finalDate,
                    finalEventTime,
                    finalEventType,
                    packageNameForSave,
                    packageJsonForSave,
                    packageJsonForSave,
                    finalCustomOrder,
                    theme || null,
                    venue || null,
                    notes || "",
                    status || "Pending Review",
                    null,
                    packagePrice,
                    requiredDownPayment,
                    amountPaid,
                    balance,
                    paymentStatus,
                ]
            );

            const bookingId = result.insertId;

            const bookingItemsToSave = isCustom
                ? normalizeBookingItemsForSave(getBookingItemsInput(body), {
                    bookingId,
                    storeId: targetStoreId,
                    branchId: targetBranchId,
                    sourceType: "custom",
                    packageId: null,
                })
                : normalizeBookingItemsForSave(packageSnapshot?.inclusions || [], {
                    bookingId,
                    storeId: targetStoreId,
                    branchId: targetBranchId,
                    sourceType: "package",
                    packageId: packageSnapshot?.id || packageId || null,
                });

            await insertBookingItems(connection, bookingItemsToSave);

            return response(201, {
                success: true,
                id: bookingId,
                package_price: packagePrice,
                required_down_payment: requiredDownPayment,
                balance,
                payment_status: paymentStatus,
                booking_items_saved: bookingItemsToSave.length,
            });
        }

        // ── PUBLIC: get_booking_by_reference ─────────────────────────────────
        if (action === "get_booking_by_reference") {
            const { bookingReference, booking_reference } = body;
            const ref = bookingReference || booking_reference;

            if (!ref) {
                return response(400, { error: "Missing bookingReference" });
            }

            const [rows] = await connection.execute(
                `
                    SELECT
                        ${bookingSelectFields()}
                    FROM bookings
                             LEFT JOIN branches
                                       ON bookings.branch_id = branches.id
                                           AND bookings.store_id = branches.store_id
                    WHERE bookings.booking_reference = ?
                        LIMIT 1
                `,
                [ref]
            );

            if (!rows.length) {
                return response(404, { error: "Booking not found" });
            }

            return response(200, { booking: rows[0] });
        }

        // ── PUBLIC: get_bookings_by_phone ─────────────────────────────────────
        if (action === "get_bookings_by_phone") {
            const { phone, storeId, store_id } = body;
            const targetStoreId = Number(storeId || store_id);

            if (!phone || !targetStoreId) {
                return response(400, { error: "Missing phone or storeId" });
            }

            const [rows] = await connection.execute(
                `
                    SELECT
                        ${bookingSelectFields()}
                    FROM bookings
                             LEFT JOIN branches
                                       ON bookings.branch_id = branches.id
                                           AND bookings.store_id = branches.store_id
                    WHERE bookings.phone = ?
                      AND bookings.store_id = ?
                    ORDER BY bookings.created_at DESC
                `,
                [phone, targetStoreId]
            );

            return response(200, { bookings: rows });
        }

        // ── PUBLIC: get_public_bookings ───────────────────────────────────────
        if (action === "get_public_bookings") {
            const { storeId, store_id } = body;
            const targetStoreId = Number(storeId || store_id);

            if (!targetStoreId) {
                return response(400, { error: "Missing storeId" });
            }

            const [rows] = await connection.execute(
                `
                    SELECT
                        id,
                        name,
                        event_date AS date,
                    status
                    FROM bookings
                    WHERE store_id = ?
                    ORDER BY created_at DESC
                `,
                [targetStoreId]
            );

            return response(200, { bookings: rows });
        }

        // ── PROTECTED: verify token ───────────────────────────────────────────
        let store_id;

        try {
            store_id = verifyProtectedStore(event);
        } catch (err) {
            return response(401, {
                error: err.message === "No token" ? "No token" : "Invalid token",
            });
        }

        if (!store_id) {
            return response(401, { error: "Invalid token store" });
        }

        // ── PROTECTED: get_booking_page_bookings ────────────────────────────────
        // Use this action on the OwnerBookings, ManagerBookings, and
        // StaffBookings screens. It returns the fields needed by those pages
        // without returning package_json/packageJSON for hundreds of records.
        if (action === "get_booking_page_bookings") {
            const { branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;

            let query = `
                SELECT
                    ${bookingPageSelectFields()}
                FROM bookings
                         LEFT JOIN branches
                                   ON bookings.branch_id = branches.id
                                       AND bookings.store_id = branches.store_id
                WHERE bookings.store_id = ?
            `;

            const params = [store_id];

            if (requestedBranchId) {
                query += ` AND bookings.branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            query += ` ORDER BY bookings.created_at DESC`;

            const [rows] = await connection.execute(query, params);

            return response(200, {
                bookings: rows,
                total: rows.length,
            });
        }

        // ── PROTECTED: get_dashboard_bookings ─────────────────────────────────
        // This endpoint is intentionally lightweight. The previous dashboard
        // request used get_bookings, which returned large package JSON fields
        // for every booking and could time out or exceed API response limits.
        if (action === "get_dashboard_bookings") {
            const { branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;

            let query = `
                SELECT
                    ${dashboardBookingSelectFields()}
                FROM bookings
                         LEFT JOIN branches
                                   ON bookings.branch_id = branches.id
                                       AND bookings.store_id = branches.store_id
                WHERE bookings.store_id = ?
            `;

            const params = [store_id];

            if (requestedBranchId) {
                query += ` AND bookings.branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            query += ` ORDER BY bookings.created_at DESC`;

            const [rows] = await connection.execute(query, params);

            return response(200, {
                bookings: rows,
                total: rows.length,
            });
        }

        // ── PROTECTED: get_bookings ───────────────────────────────────────────
        if (action === "get_bookings") {
            const { branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;

            let query = `
                SELECT
                    ${bookingSelectFields()}
                FROM bookings
                         LEFT JOIN branches
                                   ON bookings.branch_id = branches.id
                                       AND bookings.store_id = branches.store_id
                WHERE bookings.store_id = ?
            `;

            const params = [store_id];

            if (requestedBranchId) {
                query += ` AND bookings.branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            query += ` ORDER BY bookings.created_at DESC`;

            const [rows] = await connection.execute(query, params);

            return response(200, { bookings: rows });
        }

        // ── PROTECTED: get_booking_items ───────────────────────────────────────
        if (action === "get_booking_items") {
            const { booking_id, branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;

            if (!booking_id) {
                return response(400, { error: "Missing booking_id" });
            }

            let bookingQuery = `
                SELECT id, status, store_id, branch_id
                FROM bookings
                WHERE id = ?
                  AND store_id = ?
            `;

            const bookingParams = [Number(booking_id), store_id];

            if (requestedBranchId) {
                bookingQuery += ` AND branch_id = ?`;
                bookingParams.push(Number(requestedBranchId));
            }

            const [bookingRows] = await connection.execute(bookingQuery, bookingParams);

            if (!bookingRows.length) {
                return response(404, { error: "Booking not found" });
            }

            let itemQuery = `
                SELECT
                    id,
                    booking_id,
                    source_type,
                    package_id,
                    product_id,
                    variant_id,
                    product_name,
                    variant_name,
                    category,
                    booked_quantity,
                    reserved_quantity,
                    used_quantity,
                    restored_quantity,
                    unit_price,
                    estimated_subtotal,
                    used_subtotal,
                    inventory_status
                FROM booking_items
                WHERE booking_id = ?
                  AND store_id = ?
            `;

            const itemParams = [Number(booking_id), store_id];

            if (requestedBranchId) {
                itemQuery += ` AND branch_id = ?`;
                itemParams.push(Number(requestedBranchId));
            }

            itemQuery += ` ORDER BY id ASC`;

            const [items] = await connection.execute(itemQuery, itemParams);

            return response(200, {
                success: true,
                booking: bookingRows[0],
                items,
            });
        }

        // ── PROTECTED: update_status (enhanced) ────────────────────────────────
        if (action === "update_status") {
            const { booking_id, status, agreed_price, branch_id, branchId } = body;
            const usedItems = getUsedItemsInput(body);
            const requestedBranchId = branch_id || branchId;

            if (!booking_id || !status) return response(400, { error: "Missing booking_id or status" });

            const allowedStatuses = ["Pending Review","Confirmed","Preparing","Completed","Cancelled"];
            if (!allowedStatuses.includes(status)) return response(400, { error: "Invalid booking status" });

            let selectQuery = `
                SELECT id, status, store_id, branch_id, package_json, packageJSON
                FROM bookings
                WHERE id = ?
                  AND store_id = ?
            `;
            const selectParams = [Number(booking_id), store_id];
            if (requestedBranchId) { selectQuery += ` AND branch_id = ?`; selectParams.push(Number(requestedBranchId)); }

            const [rows] = await connection.execute(selectQuery, selectParams);
            if (!rows.length) return response(404, { error: "Booking not found" });

            console.log("COMPLETED BLOCK HIT");
            console.log("PACKAGE JSON:", rows[0].package_json);
            console.log("PACKAGE JSON 2:", rows[0].packageJSON);

            const currentStatus = rows[0].status || "Pending Review";
            const allowedTransitions = {
                "Pending Review": ["Confirmed","Cancelled"],
                "Confirmed": ["Preparing","Cancelled"],
                "Preparing": ["Completed","Cancelled"],
                "Completed": [],
                "Cancelled": [],
            };
            if (!allowedTransitions[currentStatus]?.includes(status)) {
                return response(400, { error: `Cannot move booking from ${currentStatus} to ${status}` });
            }

            let inventoryResult = {
                ok: true,
                reservedCount: 0,
                restoredCount: 0,
                restoredQuantity: 0,
                usedQuantity: 0,
            };

            await connection.beginTransaction();
            try {
                // 1️⃣ Update booking status
                let query = `UPDATE bookings SET status = ?`;
                const params = [status];
                if (agreed_price !== undefined && agreed_price !== null) { query += `, agreed_price = ?`; params.push(Number(agreed_price)); }
                query += ` WHERE id = ? AND store_id = ?`;
                params.push(Number(booking_id), store_id);
                if (requestedBranchId) { query += ` AND branch_id = ?`; params.push(Number(requestedBranchId)); }
                await connection.execute(query, params);

                // 2️⃣ Deduct stock if Completed
                // 2️⃣ Reserve/deduct inventory when booking is confirmed
                if (status === "Confirmed") {
                    inventoryResult = await reserveBookingInventory(connection, {
                        bookingId: Number(booking_id),
                        storeId: rows[0].store_id,
                        branchId: requestedBranchId || rows[0].branch_id || null,
                    });

                    if (!inventoryResult.ok) {
                        await connection.rollback();

                        return response(400, {
                            error: inventoryResult.error,
                        });
                    }
                }

                if (status === "Cancelled") {
                    inventoryResult = await restoreBookingInventoryOnCancel(connection, {
                        bookingId: Number(booking_id),
                        storeId: rows[0].store_id,
                        branchId: requestedBranchId || rows[0].branch_id || null,
                        usedItems,
                    });

                    if (!inventoryResult.ok) {
                        await connection.rollback();

                        return response(400, {
                            error: inventoryResult.error,
                        });
                    }
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            }

            return response(200, {
                success: true,
                status,
                reserved_items: inventoryResult?.reservedCount || 0,
                restored_items: inventoryResult?.restoredCount || 0,
                restored_quantity: inventoryResult?.restoredQuantity || 0,
                used_quantity: inventoryResult?.usedQuantity || 0,
            });
        }

        // ── PROTECTED: update_price for custom bookings ───────────────────────
        if (action === "update_price") {
            const {
                booking_id,
                agreed_price,
                required_down_payment,
                requiredDownPayment,
                branch_id,
                branchId,
            } = body;

            const requestedBranchId = branch_id || branchId;

            if (!booking_id || agreed_price === undefined || agreed_price === null) {
                return response(400, {
                    error: "Missing booking_id or agreed_price",
                });
            }

            const total = toNumber(agreed_price);
            const requiredDp = toNumber(
                required_down_payment ?? requiredDownPayment
            );

            if (total <= 0) {
                return response(400, {
                    error: "agreed_price must be greater than 0",
                });
            }

            if (requiredDp < 0) {
                return response(400, {
                    error: "required_down_payment cannot be negative",
                });
            }

            if (requiredDp > total) {
                return response(400, {
                    error: "required_down_payment cannot exceed agreed_price",
                });
            }

            let query = `
                UPDATE bookings
                SET
                    agreed_price = ?,
                    required_down_payment = ?,
                    balance = GREATEST(? - COALESCE(amount_paid, 0), 0),
                    payment_status = CASE
                                         WHEN COALESCE(amount_paid, 0) >= ? THEN 'Fully Paid'
                                         WHEN COALESCE(amount_paid, 0) >= ? AND ? > 0 THEN 'Down Payment Paid'
                                         WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partial'
                                         ELSE 'Down Payment Required'
                        END
                WHERE id = ?
                  AND store_id = ?
            `;

            const params = [
                total,
                requiredDp,
                total,
                total,
                requiredDp,
                requiredDp,
                Number(booking_id),
                store_id,
            ];

            if (requestedBranchId) {
                query += ` AND branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            await connection.execute(query, params);

            return response(200, {
                success: true,
                agreed_price: total,
                required_down_payment: requiredDp,
            });
        }

        // ── PROTECTED: update_payment ─────────────────────────────────────────
        if (action === "update_payment") {
            const {
                booking_id,
                amount_paid,
                balance,
                payment_status,
                branch_id,
                branchId,
            } = body;

            const requestedBranchId = branch_id || branchId;

            if (
                !booking_id ||
                amount_paid === undefined ||
                amount_paid === null ||
                !payment_status
            ) {
                return response(400, {
                    error: "Missing booking_id, amount_paid, or payment_status",
                });
            }

            const paid = toNumber(amount_paid);
            const safeBalance =
                balance !== undefined && balance !== null ? toNumber(balance) : null;

            let selectQuery = `
                SELECT id, status, store_id, branch_id
                FROM bookings
                WHERE id = ?
                  AND store_id = ?
            `;

            const selectParams = [Number(booking_id), store_id];

            if (requestedBranchId) {
                selectQuery += ` AND branch_id = ?`;
                selectParams.push(Number(requestedBranchId));
            }

            const [bookingRows] = await connection.execute(selectQuery, selectParams);

            if (!bookingRows.length) {
                return response(404, { error: "Booking not found" });
            }

            const currentStatus = bookingRows[0].status || "Pending Review";
            const willAutoConfirm =
                ["Down Payment Paid", "Fully Paid"].includes(payment_status) &&
                ["Pending Review", "Awaiting Down Payment"].includes(currentStatus);

            let query = `
                UPDATE bookings
                SET
                    amount_paid = ?,
                    payment_status = ?,
                    balance = CASE
                                  WHEN ? IS NULL THEN GREATEST(
                                          COALESCE(NULLIF(package_price, 0), NULLIF(agreed_price, 0), 0) - ?,
                                          0
                                                      )
                                  ELSE ?
                        END,
                    status = CASE
                                 WHEN ? IN ('Down Payment Paid', 'Fully Paid')
                                     AND status IN ('Pending Review', 'Awaiting Down Payment')
                                     THEN 'Confirmed'
                                 ELSE status
                        END
                WHERE id = ?
                  AND store_id = ?
            `;

            const params = [
                paid,
                payment_status,
                safeBalance,
                paid,
                safeBalance,
                payment_status,
                Number(booking_id),
                store_id,
            ];

            if (requestedBranchId) {
                query += ` AND branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            let inventoryResult = {
                ok: true,
                reservedCount: 0,
            };

            await connection.beginTransaction();

            try {
                await connection.execute(query, params);

                if (willAutoConfirm) {
                    inventoryResult = await reserveBookingInventory(connection, {
                        bookingId: Number(booking_id),
                        storeId: bookingRows[0].store_id,
                        branchId: requestedBranchId || bookingRows[0].branch_id || null,
                    });

                    if (!inventoryResult.ok) {
                        await connection.rollback();

                        return response(400, {
                            error: inventoryResult.error,
                        });
                    }
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            }

            return response(200, {
                success: true,
                amount_paid: paid,
                balance: safeBalance,
                payment_status,
                status: willAutoConfirm ? "Confirmed" : currentStatus,
                reserved_items: inventoryResult.reservedCount,
            });
        }

        return response(400, { error: "Invalid action" });
    } catch (err) {
        console.error("BOOKINGS LAMBDA ERROR:", err);

        return response(500, {
            error: err.message || "Bookings Lambda failed",
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};