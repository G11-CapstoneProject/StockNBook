/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

function jsonResponse(statusCode, headers, body) {
    return { statusCode, headers, body: JSON.stringify(body) };
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

function serverError(headers, error) {
    console.error("Packages Lambda error:", error);
    return jsonResponse(500, headers, {
        error: error instanceof Error ? error.message : "Internal server error",
    });
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function normalizeAction(value) {
    return toSafeString(value, 80)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

async function safeRollback(connection) {
    try {
        if (connection) await connection.rollback();
    } catch {
        // Ignore rollback errors.
    }
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

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = Number(branchId);
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) return false;
    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) return false;

    const [rows] = await connection.execute(
        `SELECT id
         FROM branches
         WHERE id = ?
           AND store_id = ?
             LIMIT 1`,
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
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
            `SELECT manager_name FROM managers WHERE id = ? AND store_id = ? LIMIT 1`,
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
            `SELECT staff_name FROM staff WHERE id = ? AND store_id = ? LIMIT 1`,
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
 * Writes one row to employee_actions. Called from inside the same DB
 * transaction as the package action it's logging, so the log and the
 * action succeed or fail together.
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

function buildPackageReference(id) {
    return `PKG-${String(id).padStart(6, "0")}`;
}

function normalizeInclusion(item, index = 0) {
    const productId = Number(
        firstDefined(item?.productId, item?.product_id) || 0
    );

    const rawVariantId = firstDefined(
        item?.variantId,
        item?.variant_id
    );

    const variantId =
        rawVariantId !== undefined &&
        rawVariantId !== null &&
        rawVariantId !== ""
            ? Number(rawVariantId)
            : null;

    const quantity = Math.max(
        0,
        Number(firstDefined(item?.quantity, item?.qty) || 0)
    );

    const unitSalesPrice = Number(
        firstDefined(
            item?.unitSalesPrice,
            item?.unit_sales_price,
            item?.unitPrice,
            item?.unit_price,
            item?.salesPrice,
            item?.sales_price,
            item?.price
        ) || 0
    );

    const productName = toSafeString(
        firstDefined(
            item?.productName,
            item?.product_name,
            item?.item,
            item?.name
        ),
        255
    );

    const variantName = toSafeString(
        firstDefined(
            item?.variantName,
            item?.variant_name,
            item?.variantLabel,
            item?.variant_label
        ),
        255
    );

    const lineValue =
        toNumber(
            firstDefined(
                item?.lineValue,
                item?.line_value,
                item?.lineTotal,
                item?.line_total
            )
        ) ?? unitSalesPrice * quantity;

    const availableStock = Number(
        firstDefined(
            item?.availableStock,
            item?.available_stock
        ) || 0
    );

    const inventoryKey =
        toSafeString(
            firstDefined(item?.inventoryKey, item?.inventory_key),
            255
        ) ||
        (variantId
            ? `product:${productId}:variant:${variantId}`
            : `product:${productId}:regular`) ||
        `package-item:${index}`;

    return {
        inventoryKey,
        productId,
        product_id: productId,
        variantId,
        variant_id: variantId,
        productName,
        product_name: productName,
        variantName,
        variant_name: variantName,
        quantity,
        unitSalesPrice,
        unit_sales_price: unitSalesPrice,
        unitPrice: unitSalesPrice,
        unit_price: unitSalesPrice,
        lineValue,
        line_value: lineValue,
        availableStock,
        available_stock: availableStock,

        // Legacy aliases are preserved for old saved package rows.
        item: item?.item || productName,
        variantLabel:
            item?.variantLabel ||
            item?.variant_label ||
            variantName,
        variant_label:
            item?.variant_label ||
            item?.variantLabel ||
            variantName,
    };
}

function parseInclusions(value) {
    let raw = [];

    try {
        if (Array.isArray(value)) {
            raw = value;
        } else if (typeof value === "string" && value.trim()) {
            const parsed = JSON.parse(value);
            raw = Array.isArray(parsed) ? parsed : [];
        }
    } catch {
        raw = [];
    }

    return raw.map(normalizeInclusion);
}

function normalizePackageRow(row) {
    return {
        id: Number(row.id),
        store_id: Number(row.store_id),
        branch_id: Number(row.branch_id),
        name: row.name || "",
        description: row.description || "",
        original_value: Number(row.original_value || 0),
        discount_type: row.discount_type || "amount",
        discount_value: Number(row.discount_value || 0),
        package_price: Number(row.package_price || 0),
        down_payment_amount: Number(row.down_payment_amount || 0),
        duration: row.duration || "",
        status: row.status || "Active",
        category: row.category || undefined,
        cover_image: row.cover_image || "",
        inclusions: parseInclusions(row.inclusions),
        created_at: row.created_at || "",
    };
}

async function getPackageById(
    connection,
    storeId,
    branchId,
    packageId
) {
    let query = `
        SELECT *
        FROM packages
        WHERE id = ?
          AND store_id = ?
    `;

    const params = [packageId, storeId];

    if (branchId) {
        query += " AND branch_id = ?";
        params.push(branchId);
    }

    query += " LIMIT 1";

    const [rows] = await connection.execute(query, params);

    return rows.length > 0
        ? normalizePackageRow(rows[0])
        : null;
}

function getIncomingPackage(body) {
    return {
        name: toSafeString(body.name, 255),
        description: toSafeString(body.description, 5000),
        category: toSafeString(body.category, 120),

        coverImage:
            typeof body.cover_image === "string"
                ? body.cover_image
                : typeof body.coverImage === "string"
                    ? body.coverImage
                    : "",

        originalValue:
            toNumber(firstDefined(body.original_value, body.originalValue)) ?? 0,

        discountType:
            toSafeString(
                firstDefined(body.discount_type, body.discountType),
                30
            ) || "amount",

        discountValue:
            toNumber(firstDefined(body.discount_value, body.discountValue)) ?? 0,

        packagePrice:
            toNumber(firstDefined(body.package_price, body.packagePrice)) ?? 0,

        downPaymentAmount:
            toNumber(
                firstDefined(
                    body.down_payment_amount,
                    body.downPaymentAmount
                )
            ) ?? 0,

        duration: toSafeString(body.duration, 100) || "N/A",
        status: toSafeString(body.status, 30) || "Active",

        inclusions: Array.isArray(body.inclusions)
            ? body.inclusions.map(normalizeInclusion)
            : [],
    };
}

function validatePackageInput(pkg) {
    if (!pkg.name) return "Package name is required.";

    if (pkg.inclusions.length === 0) {
        return "Please add at least one product inclusion.";
    }

    if (
        pkg.discountType !== "amount" &&
        pkg.discountType !== "percentage"
    ) {
        return "Invalid discount type.";
    }

    if (pkg.discountValue < 0) {
        return "Discount cannot be negative.";
    }

    if (
        pkg.discountType === "percentage" &&
        pkg.discountValue > 100
    ) {
        return "Percentage discount cannot exceed 100%.";
    }

    if (pkg.originalValue < 0) {
        return "Original value cannot be negative.";
    }

    if (pkg.packagePrice < 0) {
        return "Package price cannot be negative.";
    }

    if (pkg.downPaymentAmount < 0) {
        return "Down payment cannot be negative.";
    }

    if (pkg.downPaymentAmount > pkg.packagePrice) {
        return "Down payment cannot exceed package price.";
    }

    for (const inclusion of pkg.inclusions) {
        if (
            !Number.isInteger(inclusion.productId) ||
            inclusion.productId <= 0
        ) {
            return "Each package inclusion must contain a valid productId.";
        }

        if (!Number.isFinite(inclusion.quantity) || inclusion.quantity <= 0) {
            return "Each package inclusion must contain a valid quantity.";
        }
    }

    return "";
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
        return badRequest(headers, "Invalid JSON body.");
    }

    const action = normalizeAction(body.action);
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        // ── PUBLIC: get_public_packages for customer portal ─────────────
        // ── PUBLIC: GET PACKAGES FOR CUSTOMER BOOKING PORTAL ─────────────
        if (action === "get_public_packages") {
            const publicStoreId = Number(
                firstDefined(
                    body.store_id,
                    body.storeId
                )
            );

            const rawBranchId = firstDefined(
                body.branch_id,
                body.branchId
            );

            const publicBranchId =
                rawBranchId !== undefined &&
                rawBranchId !== null &&
                rawBranchId !== ""
                    ? Number(rawBranchId)
                    : null;

            console.log(
                "[PUBLIC PACKAGES] store:",
                publicStoreId,
                "branch:",
                publicBranchId
            );

            if (
                !Number.isInteger(publicStoreId) ||
                publicStoreId <= 0
            ) {
                return badRequest(
                    headers,
                    "Missing or invalid store_id."
                );
            }

            const storeExists =
                await ensureStoreExists(
                    connection,
                    publicStoreId
                );

            if (!storeExists) {
                return notFound(
                    headers,
                    "Store account not found."
                );
            }

            if (publicBranchId) {
                if (
                    !Number.isInteger(publicBranchId) ||
                    publicBranchId <= 0
                ) {
                    return badRequest(
                        headers,
                        "Invalid branch_id."
                    );
                }

                const branchExists =
                    await ensureBranchBelongsToStore(
                        connection,
                        publicBranchId,
                        publicStoreId
                    );

                if (!branchExists) {
                    return notFound(
                        headers,
                        "Branch not found for this store."
                    );
                }
            }

            let query = `
                SELECT *
                FROM packages
                WHERE store_id = ?
                  AND (
                    status IS NULL
                        OR TRIM(status) = ''
                        OR LOWER(TRIM(status)) = 'active'
                    )
            `;

            const params = [
                publicStoreId
            ];

            if (publicBranchId) {
                query += `
            AND branch_id = ?
        `;

                params.push(
                    publicBranchId
                );
            }

            query += `
        ORDER BY id DESC
    `;

            console.log(
                "[PUBLIC PACKAGES] QUERY:",
                query
            );

            console.log(
                "[PUBLIC PACKAGES] PARAMS:",
                params
            );

            const [rows] =
                await connection.execute(
                    query,
                    params
                );

            console.log(
                "[PUBLIC PACKAGES] ROW COUNT:",
                rows.length
            );

            /*
             * IMPORTANT:
             *
             * Use the SAME normalizer as the authenticated
             * get_packages action.
             *
             * This keeps the public customer response and
             * internal package response identical.
             */
            const packages =
                rows.map(normalizePackageRow);

            return jsonResponse(
                200,
                headers,
                {
                    success: true,
                    packages,
                    total: packages.length,
                }
            );
        }

        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(headers, "No token provided.");
        }

        let storeId;
        let tokenBranchId = null;
        let tokenRole = "";
        let decoded;

        try {
            const token = authHeader.replace(/^Bearer\s+/i, "");
            decoded = jwt.verify(token, JWT_SECRET);

            storeId = Number(decoded.store_id);
            tokenBranchId = decoded.branch_id
                ? Number(decoded.branch_id)
                : null;
            tokenRole = String(decoded.role || "").toLowerCase();
        } catch {
            return unauthorized(headers, "Invalid token.");
        }

        if (!Number.isInteger(storeId) || storeId <= 0) {
            return unauthorized(headers, "Invalid store in token.");
        }

        if (!(await ensureStoreExists(connection, storeId))) {
            return badRequest(headers, "Store account not found.");
        }

        const isBranchUser =
            tokenRole === "manager" ||
            tokenRole === "staff";

        const rawRequestedBranchId = firstDefined(
            body.branch_id,
            body.branchId
        );

        const requestedBranchId =
            rawRequestedBranchId !== undefined &&
            rawRequestedBranchId !== null &&
            rawRequestedBranchId !== ""
                ? Number(rawRequestedBranchId)
                : null;

        const activeBranchId =
            isBranchUser
                ? tokenBranchId
                : requestedBranchId;

        if (
            isBranchUser &&
            (!Number.isInteger(activeBranchId) || activeBranchId <= 0)
        ) {
            return badRequest(
                headers,
                "Missing branch_id for branch user."
            );
        }

        if (
            activeBranchId &&
            !(await ensureBranchBelongsToStore(
                connection,
                activeBranchId,
                storeId
            ))
        ) {
            return badRequest(
                headers,
                "Invalid branch for this store."
            );
        }

        if (action === "get_packages") {
            let query = `
                SELECT *
                FROM packages
                WHERE store_id = ?
            `;

            const params = [storeId];

            if (activeBranchId) {
                query += " AND branch_id = ?";
                params.push(activeBranchId);
            }

            query += " ORDER BY id DESC";

            const [rows] = await connection.execute(query, params);

            return jsonResponse(200, headers, {
                success: true,
                packages: rows.map(normalizePackageRow),
            });
        }

        if (action === "create_package") {
            if (!activeBranchId) {
                return badRequest(headers, "branch_id is required.");
            }

            const pkg = getIncomingPackage(body);
            const validationError = validatePackageInput(pkg);

            if (validationError) {
                return badRequest(headers, validationError);
            }

            const [duplicates] = await connection.execute(
                `SELECT id
                 FROM packages
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND LOWER(TRIM(name)) = LOWER(TRIM(?))
                     LIMIT 1`,
                [storeId, activeBranchId, pkg.name]
            );

            if (duplicates.length > 0) {
                return badRequest(
                    headers,
                    `Package "${pkg.name}" already exists in this branch.`
                );
            }

            await connection.beginTransaction();

            try {
                const [result] = await connection.execute(
                    `INSERT INTO packages
                     (
                         store_id,
                         branch_id,
                         name,
                         description,
                         original_value,
                         discount_type,
                         discount_value,
                         package_price,
                         down_payment_amount,
                         duration,
                         status,
                         category,
                         cover_image,
                         inclusions
                     )
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        storeId,
                        activeBranchId,
                        pkg.name,
                        pkg.description || null,
                        pkg.originalValue,
                        pkg.discountType,
                        pkg.discountValue,
                        pkg.packagePrice,
                        pkg.downPaymentAmount,
                        pkg.duration,
                        pkg.status,
                        pkg.category || null,
                        pkg.coverImage || null,
                        JSON.stringify(pkg.inclusions),
                    ]
                );

                const packageId = Number(result.insertId);

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
                    module: "Packages",
                    referenceNumber: buildPackageReference(packageId),
                    action: "Added package",
                    referenceId: String(packageId),
                    details: `Added ${pkg.name} to packages`,
                });

                await connection.commit();

                const createdPackage = await getPackageById(
                    connection,
                    storeId,
                    activeBranchId,
                    packageId
                );

                return jsonResponse(201, headers, {
                    success: true,
                    package: createdPackage,
                });
            } catch (error) {
                await safeRollback(connection);
                throw error;
            }
        }

        if (action === "update_package") {
            const packageId = Number(body.id);

            if (!Number.isInteger(packageId) || packageId <= 0) {
                return badRequest(headers, "Invalid package id.");
            }

            const existingPackage = await getPackageById(
                connection,
                storeId,
                activeBranchId,
                packageId
            );

            if (!existingPackage) {
                return notFound(headers, "Package not found.");
            }

            const pkg = getIncomingPackage(body);
            const validationError = validatePackageInput(pkg);

            if (validationError) {
                return badRequest(headers, validationError);
            }

            const branchId =
                activeBranchId || Number(existingPackage.branch_id);

            const [duplicates] = await connection.execute(
                `SELECT id
                 FROM packages
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND LOWER(TRIM(name)) = LOWER(TRIM(?))
                   AND id <> ?
                     LIMIT 1`,
                [storeId, branchId, pkg.name, packageId]
            );

            if (duplicates.length > 0) {
                return badRequest(
                    headers,
                    `Package "${pkg.name}" already exists in this branch.`
                );
            }

            await connection.beginTransaction();

            try {
                let query = `
                    UPDATE packages
                    SET
                        name = ?,
                        description = ?,
                        original_value = ?,
                        discount_type = ?,
                        discount_value = ?,
                        package_price = ?,
                        down_payment_amount = ?,
                        duration = ?,
                        status = ?,
                        category = ?,
                        cover_image = ?,
                        inclusions = ?
                    WHERE id = ?
                      AND store_id = ?
                `;

                const params = [
                    pkg.name,
                    pkg.description || null,
                    pkg.originalValue,
                    pkg.discountType,
                    pkg.discountValue,
                    pkg.packagePrice,
                    pkg.downPaymentAmount,
                    pkg.duration,
                    pkg.status,
                    pkg.category || null,
                    pkg.coverImage || null,
                    JSON.stringify(pkg.inclusions),
                    packageId,
                    storeId,
                ];

                if (activeBranchId) {
                    query += " AND branch_id = ?";
                    params.push(activeBranchId);
                }

                const [result] = await connection.execute(query, params);

                if (result.affectedRows === 0) {
                    await safeRollback(connection);
                    return notFound(headers, "Package not found.");
                }

                const actingEmployee = await getActingEmployee(
                    connection,
                    decoded,
                    tokenRole,
                    storeId
                );

                await logEmployeeAction(connection, {
                    storeId,
                    branchId,
                    employee: actingEmployee,
                    module: "Packages",
                    referenceNumber: buildPackageReference(packageId),
                    action: "Updated package",
                    referenceId: String(packageId),
                    details: existingPackage.name !== pkg.name
                        ? `Renamed ${existingPackage.name} to ${pkg.name}`
                        : `Updated details for ${pkg.name}`,
                });

                await connection.commit();

                const updatedPackage = await getPackageById(
                    connection,
                    storeId,
                    activeBranchId,
                    packageId
                );

                return jsonResponse(200, headers, {
                    success: true,
                    package: updatedPackage,
                });
            } catch (error) {
                await safeRollback(connection);
                throw error;
            }
        }

        if (action === "delete_package") {
            const packageId = Number(body.id);

            if (!Number.isInteger(packageId) || packageId <= 0) {
                return badRequest(headers, "Invalid package id.");
            }

            const existingPackage = await getPackageById(
                connection,
                storeId,
                activeBranchId,
                packageId
            );

            if (!existingPackage) {
                return notFound(headers, "Package not found.");
            }

            await connection.beginTransaction();

            try {
                let query = `
                    DELETE FROM packages
                    WHERE id = ?
                      AND store_id = ?
                `;

                const params = [packageId, storeId];

                if (activeBranchId) {
                    query += " AND branch_id = ?";
                    params.push(activeBranchId);
                }

                const [result] = await connection.execute(query, params);

                if (result.affectedRows === 0) {
                    await safeRollback(connection);
                    return notFound(headers, "Package not found.");
                }

                const actingEmployee = await getActingEmployee(
                    connection,
                    decoded,
                    tokenRole,
                    storeId
                );

                await logEmployeeAction(connection, {
                    storeId,
                    branchId: activeBranchId || Number(existingPackage.branch_id),
                    employee: actingEmployee,
                    module: "Packages",
                    referenceNumber: buildPackageReference(packageId),
                    action: "Deleted package",
                    referenceId: String(packageId),
                    details: `Removed ${existingPackage.name} from packages`,
                });

                await connection.commit();

                return jsonResponse(200, headers, { success: true });
            } catch (error) {
                await safeRollback(connection);
                throw error;
            }
        }

        return badRequest(headers, "Invalid action.");
    } catch (error) {
        await safeRollback(connection);
        return serverError(headers, error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};