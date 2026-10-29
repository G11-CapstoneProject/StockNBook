/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const fs = require("fs");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook",
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
             id,
             product_id AS productId,
             variant_values AS variantValues,
             variant_number AS variantNumber,
             stock,
             alert_level AS alertLevel,
             original_price AS originalPrice,
             sales_price AS salesPrice,
             pricing_method AS pricingMethod,
             markup_percentage AS markupPercentage,
             CASE WHEN EXISTS (
                 SELECT 1 FROM branch_inventory bi JOIN inventory_batches ib ON ib.branch_inventory_id=bi.id
                 WHERE bi.variant_id=product_variants.id AND ib.status='active' AND ib.remaining_quantity>0
             ) THEN (
                 SELECT MIN(ib.expiration_date) FROM branch_inventory bi
                                                         JOIN inventory_batches ib ON ib.branch_inventory_id=bi.id
                 WHERE bi.variant_id=product_variants.id AND ib.status='active' AND ib.remaining_quantity>0
             ) ELSE product_variants.expiration_date END AS expirationDate,
             created_at AS createdAt
         FROM product_variants
         WHERE product_id IN (${placeholders})
           AND deleted_at IS NULL
         ORDER BY id ASC`,
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


// V2 branch inventory is authoritative for sales/booking availability. This helper
// runs inside the SAME SQL transaction as a catalog creation or supplier receipt.
// Never repair pre-existing drift by copying products.stock into V2 balances.
async function creditBranchInventoryBatch(connection, {
    storeId, branchId, productId, variantId = null, quantity, expectedBefore,
    reorderLevel, costPrice, salesPrice, expirationDate = null, reference,
    actorId = null, actorRole = "system", actorName = "System", isOpening = false,
}) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isSafeInteger(expectedBefore) || expectedBefore < 0 ||
        expectedBefore + quantity > 2147483647) {
        throw new Error("Invalid stock quantity for synchronized receipt.");
    }
    const [matches] = await connection.execute(
        `SELECT id, quantity_on_hand FROM branch_inventory
         WHERE store_id=? AND branch_id=? AND product_id=? AND variant_id <=> ?
           AND status='active' LIMIT 1 FOR UPDATE`,
        [storeId,branchId,productId,variantId]);
    let inventory = matches[0];
    if (!inventory) {
        if (!isOpening || expectedBefore !== 0) {
            throw new Error("Branch inventory row is missing. Reconcile this product before receiving additional stock.");
        }
        const [insert] = await connection.execute(
            `INSERT INTO branch_inventory
             (store_id,branch_id,product_id,variant_id,quantity_on_hand,reorder_level,cost_price,sales_price,status)
             VALUES (?,?,?,?,0,?,?,?,'active')`,
            [storeId,branchId,productId,variantId,reorderLevel,costPrice,salesPrice]);
        inventory = {id: Number(insert.insertId),quantity_on_hand:0};
    }
    const before = Number(inventory.quantity_on_hand);
    const [batchRows] = await connection.execute(
        `SELECT COALESCE(SUM(remaining_quantity),0) AS total
         FROM inventory_batches WHERE branch_inventory_id=?`,[inventory.id]);
    const batchTotal = Number(batchRows[0]?.total || 0);
    // In a newly created product, a legacy trigger might have already populated
    // both ledgers. Do not double-credit such a complete opening balance.
    if (isOpening && before === quantity && batchTotal === quantity && expectedBefore === 0) {
        return {alreadySeeded:true,inventoryId:inventory.id};
    }
    if (before !== expectedBefore || batchTotal !== before) {
        throw new Error(
            `Stock ledger mismatch for product ${productId}${variantId ? ` variant ${variantId}` : ""}: `+
            `catalog=${expectedBefore}, branch=${before}, batches=${batchTotal}. `+
            `Reconcile verified receipts and reservations before receiving more stock.`);
    }
    const after = before + quantity;
    const batchCode = String(reference).slice(0,100);
    await connection.execute(
        `UPDATE branch_inventory SET quantity_on_hand=?,reorder_level=?,cost_price=?,sales_price=?
         WHERE id=?`,[after,reorderLevel,costPrice,salesPrice,inventory.id]);
    await connection.execute(
        `INSERT INTO inventory_batches
         (store_id,branch_id,branch_inventory_id,batch_code,received_quantity,remaining_quantity,
          unit_cost,received_at,expiration_date,status)
         VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,'active')`,
        [storeId,branchId,inventory.id,batchCode,quantity,quantity,costPrice,expirationDate]);
    await connection.execute(
        `INSERT INTO inventory_movements
         (store_id,branch_id,branch_inventory_id,movement_type,quantity_delta,
          quantity_before,quantity_after,reference_type,reference_id,actor_id,actor_role,actor_name,notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [storeId,branchId,inventory.id,isOpening?'OPENING_STOCK':'MANAGER_RECEIPT',
            quantity,before,after,isOpening?'PRODUCT_OPENING':'STOCK_RECEIPT',
            String(reference).slice(0,255),actorId,actorRole,actorName,
            isOpening?'New product opening stock':'Manager-authorized supplier stock receipt']);
    return {inventoryId:inventory.id,before,after};
}

// Physical stock corrections must also update V2 batches, not only products.stock.
// A correction is not a supplier receipt and does not create an invoice.
async function adjustSynchronizedStock(connection, {storeId,branchId,productId,variantId,
    before,target,requestKey,costPrice,expirationDate,employee,reason}) {
    const [rows]=await connection.execute(
        `SELECT id,quantity_on_hand FROM branch_inventory
         WHERE store_id=? AND branch_id=? AND product_id=? AND variant_id <=> ?
           AND status='active' LIMIT 1 FOR UPDATE`,[storeId,branchId,productId,variantId]);
    if(!rows.length) throw new Error('Active branch inventory is missing. Reconcile before correcting stock.');
    const inventory=rows[0];
    const branchBefore=Number(inventory.quantity_on_hand);
    const [batches]=await connection.execute(
        `SELECT id,remaining_quantity FROM inventory_batches WHERE branch_inventory_id=?
                                                               AND remaining_quantity>0 ORDER BY (expiration_date IS NULL) ASC,expiration_date ASC,received_at ASC,id ASC FOR UPDATE`,
        [inventory.id]);
    const batchBefore=batches.reduce((sum,b)=>sum+Number(b.remaining_quantity),0);
    if(before!==branchBefore || before!==batchBefore) throw new Error(
        `Stock mismatch: catalog ${before}, branch ${branchBefore}, batches ${batchBefore}. Reconcile before correcting.`);
    const [duplicates]=await connection.execute(
        `SELECT id FROM inventory_movements WHERE store_id=? AND branch_id=?
                                              AND reference_type='STOCK_ADJUSTMENT' AND reference_id=? LIMIT 1`,
        [storeId,branchId,requestKey]);
    if(duplicates.length) throw new Error('This stock correction was already processed. Refresh stock.');
    const delta=target-before;
    if(delta>0){
        await connection.execute(
            `INSERT INTO inventory_batches
             (store_id,branch_id,branch_inventory_id,batch_code,received_quantity,remaining_quantity,
              unit_cost,received_at,expiration_date,status)
             VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,'active')`,
            [storeId,branchId,inventory.id,`ADJ-${requestKey}`.slice(0,100),delta,delta,costPrice,expirationDate]);
    } else {
        let remaining=-delta;
        for(const batch of batches){
            if(remaining<=0)break;
            const used=Math.min(remaining,Number(batch.remaining_quantity));
            await connection.execute(
                `UPDATE inventory_batches SET remaining_quantity=remaining_quantity-?,
                                              status=CASE WHEN remaining_quantity-?=0 THEN 'depleted' ELSE status END WHERE id=?`,
                [used,used,batch.id]);
            remaining-=used;
        }
        if(remaining!==0)throw new Error('Batch balances cannot cover the correction. No stock was changed.');
    }
    await connection.execute(`UPDATE branch_inventory SET quantity_on_hand=? WHERE id=?`,[target,inventory.id]);
    await connection.execute(
        `INSERT INTO inventory_movements
         (store_id,branch_id,branch_inventory_id,movement_type,quantity_delta,quantity_before,
          quantity_after,reference_type,reference_id,actor_id,actor_role,actor_name,notes)
         VALUES(?,?,?,'STOCK_ADJUSTMENT',?,?,?,'STOCK_ADJUSTMENT',?,?,?,?,?)`,
        [storeId,branchId,inventory.id,delta,before,target,requestKey,employee.id,employee.role,employee.name,reason]);
}

// End-of-transaction verification catches unexpected DB triggers that would
// otherwise update a ledger a second time after the catalog UPDATE.
async function assertInventoryLineSynchronized(connection,{storeId,branchId,productId,variantId=null,expected}) {
    const [rows]=await connection.execute(
        `SELECT bi.quantity_on_hand AS branchStock,
                (SELECT COALESCE(SUM(b.remaining_quantity),0) FROM inventory_batches b
                 WHERE b.branch_inventory_id=bi.id) AS batchStock
         FROM branch_inventory bi
         WHERE bi.store_id=? AND bi.branch_id=? AND bi.product_id=? AND bi.variant_id <=> ?
           AND bi.status='active' LIMIT 1`,[storeId,branchId,productId,variantId]);
    const [catalog]=await connection.execute(variantId!=null
            ? `SELECT stock FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`
            : `SELECT stock FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL`,
        variantId!=null?[variantId,productId]:[productId,storeId,branchId]);
    if(!rows.length || !catalog.length || Number(rows[0].branchStock)!==expected ||
        Number(rows[0].batchStock)!==expected || Number(catalog[0].stock)!==expected) {
        throw new Error(`Inventory synchronization check failed for product ${productId} variant ${variantId ?? 'regular'}; transaction rolled back.`);
    }
}

async function requireSynchronizedInventoryTables(connection) {
    for (const name of ["branch_inventory","inventory_batches","inventory_movements"]) {
        if (!(await tableExists(connection,name))) {
            throw new Error(`Required synchronized inventory table ${name} is missing.`);
        }
    }
}

// Product creation and imports require a V2 row and one batch per stocked variant.
// Products with zero opening stock remain zero, and can receive their first batch later.
async function createOpeningBranchStock(connection, {storeId,branchId,productId,variants,stock,
    reorderLevel,costPrice,salesPrice,expirationDate,actorName}) {
    if (variants && variants.length) {
        for (const variant of variants) {
            if (Number(variant.stock) <= 0) continue;
            await creditBranchInventoryBatch(connection,{
                storeId,branchId,productId,variantId:Number(variant.id),
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
    // Keep a zero-stock V2 row for variants and regular products too, so a
    // subsequent first restock can lock an existing branch-scoped inventory row.
    const entries = variants && variants.length ? variants.map(v=>({id:Number(v.id),reorder:Number(v.alertLevel),
            cost:Number(v.originalPrice),price:Number(v.salesPrice)})) :
        [{id:null,reorder:Number(reorderLevel),cost:Number(costPrice),price:Number(salesPrice)}];
    for (const entry of entries) {
        const [found] = await connection.execute(
            `SELECT id FROM branch_inventory WHERE store_id=? AND branch_id=? AND product_id=?
                                               AND variant_id <=> ? AND status='active' LIMIT 1`,[storeId,branchId,productId,entry.id]);
        if (!found.length) await connection.execute(
            `INSERT INTO branch_inventory
             (store_id,branch_id,product_id,variant_id,quantity_on_hand,reorder_level,cost_price,sales_price,status)
             VALUES (?,?,?,?,0,?,?,?,'active')`,
            [storeId,branchId,productId,entry.id,entry.reorder,entry.cost,entry.price]);
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
            CASE WHEN EXISTS (
                SELECT 1 FROM branch_inventory bi
                                  JOIN inventory_batches ib ON ib.branch_inventory_id=bi.id
                WHERE bi.store_id=products.store_id AND bi.branch_id=products.branch_id
                  AND bi.product_id=products.id AND bi.variant_id IS NULL
                  AND ib.status='active' AND ib.remaining_quantity>0
            ) THEN (
                SELECT MIN(ib.expiration_date) FROM branch_inventory bi
                                                        JOIN inventory_batches ib ON ib.branch_inventory_id=bi.id
                WHERE bi.store_id=products.store_id AND bi.branch_id=products.branch_id
                  AND bi.product_id=products.id AND bi.variant_id IS NULL
                  AND ib.status='active' AND ib.remaining_quantity>0
            ) ELSE products.expiration_date END AS expirationDate,
            products.has_variants AS hasVariants,
            products.created_at AS createdAt
        FROM products
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

    // UI-only sellable quantity: the same active, non-expired branch batches
    // checked by POS and Bookings. Keep `stock` untouched for financial restock
    // and stock-correction concurrency checks. Never backfill legacy drift here.
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(new Date());
    const [balances] = await connection.execute(
        `SELECT bi.branch_id AS branchId, bi.product_id AS productId,
                bi.variant_id AS variantId, bi.quantity_on_hand AS onHand,
                COALESCE(SUM(CASE WHEN ib.status='active'
                    AND ib.remaining_quantity>0
                    AND (ib.expiration_date IS NULL OR ib.expiration_date>=?)
                                      THEN ib.remaining_quantity ELSE 0 END),0) AS eligibleBatches
         FROM branch_inventory bi
                  LEFT JOIN inventory_batches ib ON ib.branch_inventory_id=bi.id
         WHERE bi.store_id=? AND bi.status='active'
             ${activeBranchId ? 'AND bi.branch_id=?' : ''}
         GROUP BY bi.id,bi.branch_id,bi.product_id,bi.variant_id,bi.quantity_on_hand`,
        activeBranchId ? [today,storeId,activeBranchId] : [today,storeId]);
    const sellableByKey = new Map(balances.map(row => [
        `${Number(row.branchId)}:${Number(row.productId)}:${row.variantId==null?'regular':Number(row.variantId)}`,
        Math.max(0,Math.floor(Math.min(Number(row.onHand||0),Number(row.eligibleBatches||0))))
    ]));
    const enriched = await attachVariants(connection, rows);
    return enriched.map(product=>{
        const branchId=Number(product.branchId);
        const baseKey=`${branchId}:${Number(product.id)}`;
        const variants=(product.variants||[]).map(variant=>({
            ...variant,
            sellableStock:Math.max(0,Math.min(Number(variant.stock||0),
                sellableByKey.get(`${baseKey}:${Number(variant.id)}`)||0))
        }));
        const sellableStock=product.hasVariants
            ? variants.reduce((total,variant)=>total+variant.sellableStock,0)
            : Math.max(0,Math.min(Number(product.stock||0),
                sellableByKey.get(`${baseKey}:regular`)||0));
        return {...product,variants,sellableStock};
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
        "SELECT product_number AS productNumber, next_variant_sequence AS nextSequence FROM products WHERE id = ? FOR UPDATE",
        [productId]
    );
    if (!counterRows.length || !counterRows[0].productNumber) throw new Error("Parent Product Number is missing.");
    let sequence = Number(counterRows[0].nextSequence || 1);
    const generated = [];
    for (const variant of variants) {
        if (!variant.variantValues || !Object.keys(variant.variantValues).length) throw new Error("Variant values are required.");
        const variantNumber = `${counterRows[0].productNumber}-V${String(sequence++).padStart(3, "0")}`;
        const [result] = await connection.execute(
            `INSERT INTO product_variants
             (product_id, variant_number, variant_values, stock, alert_level, original_price,
              sales_price, pricing_method, markup_percentage, expiration_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, variantNumber, JSON.stringify(variant.variantValues), Number(variant.stock || 0),
                Number(variant.alertLevel || 0), Number(variant.originalPrice || 0),
                Number(variant.salesPrice || 0), variant.pricingMethod || "manual",
                variant.markupPercentage ?? null, variant.expirationDate || null]
        );
        generated.push({id: Number(result.insertId), variantNumber});
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
        `SELECT id, name
         FROM products
         WHERE store_id = ?
           AND branch_id = ?
           AND deleted_at IS NULL`,
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


async function ensureRestockHistoryTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS restock_history (
                                                       id BIGINT NOT NULL AUTO_INCREMENT,
                                                       store_id BIGINT NOT NULL,
                                                       branch_id BIGINT NOT NULL,
                                                       product_id BIGINT NOT NULL,
                                                       product_name VARCHAR(255) NOT NULL,
            variant_name VARCHAR(255) NULL,
            stock_before INT NOT NULL DEFAULT 0,
            quantity_added INT NOT NULL DEFAULT 0,
            current_stock INT NOT NULL DEFAULT 0,
            received_by VARCHAR(255) NULL,
            notes VARCHAR(500) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_restock_store (store_id),
            INDEX idx_restock_branch (branch_id),
            INDEX idx_restock_product (product_id),
            INDEX idx_restock_created_at (created_at)
            )
    `);
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

async function ensureInitialPurchaseTable(connection) {
    // Initialized only when a new product has initial supplier purchase details.
    // DDL happens BEFORE beginTransaction to avoid an implicit MySQL commit.
    if (await tableExists(connection, "inventory_initial_purchases")) return;
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS inventory_initial_purchases (
                                                                   id BIGINT NOT NULL AUTO_INCREMENT,
                                                                   store_id BIGINT NOT NULL,
                                                                   branch_id BIGINT NOT NULL,
                                                                   product_id BIGINT NOT NULL,
                                                                   supplier VARCHAR(150) NOT NULL,
            purchase_date DATE NOT NULL,
            supplier_invoice_number VARCHAR(80) NULL,
            payment_method VARCHAR(10) NOT NULL,
            purchase_total DECIMAL(14,2) NOT NULL,
            amount_paid DECIMAL(14,2) NOT NULL,
            outstanding_balance DECIMAL(14,2) NOT NULL,
            payment_due_date DATE NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_inventory_initial_product (product_id),
            INDEX idx_initial_purchase_store_branch (store_id, branch_id),
            INDEX idx_initial_purchase_due_date (payment_due_date)
            )
    `);
}

async function recordInitialPurchase(connection, storeId, branchId, productId, purchase) {
    if (!purchase) return;
    await connection.execute(
        `INSERT INTO inventory_initial_purchases
         (store_id, branch_id, product_id, supplier, supplier_invoice_number, purchase_date, payment_method,
          purchase_total, amount_paid, outstanding_balance, payment_due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [storeId, branchId, productId, purchase.supplier, purchase.supplierInvoiceNumber, purchase.purchaseDate,
            purchase.paymentMethod, purchase.purchaseTotal, purchase.amountPaid,
            purchase.outstandingBalance, purchase.paymentDueDate]
    );
}

async function findInitialPurchase(connection, storeId, branchId, productId, lock = false) {
    if (!(await tableExists(connection, "inventory_initial_purchases"))) return null;
    const [rows] = await connection.execute(
        `SELECT id, supplier, supplier_invoice_number AS supplierInvoiceNumber,
                DATE_FORMAT(purchase_date,'%Y-%m-%d') AS purchaseDate,
                payment_method AS paymentMethod, purchase_total AS purchaseTotal,
                amount_paid AS amountPaid, outstanding_balance AS outstandingBalance,
                DATE_FORMAT(payment_due_date,'%Y-%m-%d') AS paymentDueDate
         FROM inventory_initial_purchases
         WHERE store_id = ? AND branch_id = ? AND product_id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
        [storeId, branchId, productId]
    );
    return rows[0] || null;
}

async function updateInitialPurchase(connection, storeId, branchId, productId, purchase, existingRecord) {
    if (!purchase) return;
    if (!existingRecord) {
        await recordInitialPurchase(connection, storeId, branchId, productId, purchase);
        return;
    }
    await connection.execute(
        `UPDATE inventory_initial_purchases
         SET supplier = ?, supplier_invoice_number = ?, purchase_date = ?, payment_method = ?, amount_paid = ?,
             outstanding_balance = ?, payment_due_date = ?
         WHERE id = ? AND store_id = ? AND branch_id = ? AND product_id = ?`,
        [purchase.supplier, purchase.supplierInvoiceNumber, purchase.purchaseDate, purchase.paymentMethod,
            purchase.amountPaid, purchase.outstandingBalance, purchase.paymentDueDate,
            existingRecord.id, storeId, branchId, productId]
    );
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
async function updateSupplierPurchaseDetails(connection, {purchaseId, storeId, activeBranchId, details, expected, decoded, tokenRole}) {
    const invalid = (message, status = 400) => {
        const error = new Error(message);
        error.purchaseEditStatus = status;
        return error;
    };
    const snapshotFields = ["supplier", "supplierInvoiceNumber", "purchaseDate", "paymentMethod", "paymentDueDate", "purchaseTotal", "amountPaid"];
    if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0 ||
        !details || typeof details !== "object" || Array.isArray(details) ||
        !expected || typeof expected !== "object" || Array.isArray(expected) ||
        snapshotFields.some(key => !Object.prototype.hasOwnProperty.call(expected, key))) {
        throw invalid("Valid purchase details and the originally loaded purchase are required.");
    }
    const branchSql = activeBranchId ? " AND branch_id=?" : "";
    const branchParams = activeBranchId ? [activeBranchId] : [];
    await connection.beginTransaction();
    try {
        const [purchases] = await connection.execute(
            `SELECT id,branch_id AS branchId,purchase_number AS purchaseNumber,
                    supplier,supplier_invoice_number AS supplierInvoiceNumber,
                    DATE_FORMAT(purchase_date,'%Y-%m-%d') AS purchaseDate,
                    payment_method AS paymentMethod,purchase_total AS purchaseTotal,
                    DATE_FORMAT(payment_due_date,'%Y-%m-%d') AS paymentDueDate
             FROM inventory_purchase_transactions
             WHERE id=? AND store_id=?${branchSql} FOR UPDATE`,
            [purchaseId,storeId,...branchParams]);
        if (!purchases.length) throw invalid("Purchase not found in this store/branch.", 404);
        const current = purchases[0];
        const [payments] = await connection.execute(
            "SELECT id,amount FROM inventory_supplier_payments WHERE purchase_id=? ORDER BY id FOR UPDATE",
            [purchaseId]);
        const currentPaidCents = payments.reduce((sum,payment) => sum + Math.round(Number(payment.amount)*100), 0);
        let totalCents, expectedPaidCents, expectedTotalCents, revised;
        try {
            totalCents = exactMoney(current.purchaseTotal, "Original Purchase Total");
            expectedPaidCents = exactMoney(expected.amountPaid, "Previously Recorded Amount Paid");
            expectedTotalCents = exactMoney(expected.purchaseTotal, "Previously Recorded Purchase Total");
            exactMoney(details.amountPaid ?? 0, "Total Amount Paid");
            revised = getInitialPurchaseInput({initialPurchase:details}, 0, 0, [], totalCents/100);
        } catch (error) {
            throw invalid(error.message);
        }
        const headerChanged = snapshotFields.slice(0,5).some(key =>
            String(current[key] ?? "") !== String(expected[key] ?? ""));
        if (headerChanged || currentPaidCents !== expectedPaidCents || totalCents !== expectedTotalCents) {
            throw invalid("This purchase or its payments changed after you opened the editor. Close it and reopen Edit to load the latest details.", 409);
        }
        const targetPaidCents = exactMoney(revised.amountPaid, "Total Amount Paid");
        const delta = targetPaidCents-currentPaidCents;
        if (delta !== 0) {
            // Retain every historical payment; a signed entry records only the correction.
            await connection.execute(
                `INSERT INTO inventory_supplier_payments(purchase_id,amount,payment_date,request_key)
                 VALUES(?,?,?,?)`,
                [purchaseId,delta/100,revised.purchaseDate,
                    `PURCHASE-EDIT-${purchaseId}-${require("crypto").randomUUID()}`]);
        }
        await connection.execute(
            `UPDATE inventory_purchase_transactions
             SET supplier=?,supplier_invoice_number=?,purchase_date=?,payment_method=?,payment_due_date=?
             WHERE id=? AND store_id=? AND branch_id=?`,
            [revised.supplier,revised.supplierInvoiceNumber,revised.purchaseDate,
                revised.paymentMethod,revised.paymentDueDate,purchaseId,storeId,Number(current.branchId)]);
        const employee = await getActingEmployee(connection,decoded,tokenRole,storeId);
        await logEmployeeAction(connection, {
            storeId,branchId:Number(current.branchId),employee,module:"Inventory",
            referenceNumber:current.purchaseNumber || String(purchaseId),
            action:"Corrected supplier purchase",referenceId:String(purchaseId),
            details:`Corrected ${current.purchaseNumber || purchaseId} supplier/payment details (paid: ${currentPaidCents/100} -> ${targetPaidCents/100}); original total and stock receiving history preserved`,
        });
        await connection.commit();
        return {success:true,purchaseId,purchaseTotal:totalCents/100,
            amountPaid:targetPaidCents/100,outstandingBalance:(totalCents-targetPaidCents)/100};
    } catch (error) {
        await safeRollback(connection);
        throw error;
    }
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
async function createStockReceipt(connection, {storeId, branchId, purchaseId, lines, receivedDate, receivedBy, requestKey,
    legacySupplier, legacyInvoice, legacyPaymentMethod, legacyAmountPaid,
    legacyPurchaseTotal, legacyOutstandingBalance}) {
    if (!lines.length) throw new Error("Receipt must contain received stock.");
    const [r] = await connection.execute(
        `INSERT INTO inventory_stock_receipts
         (store_id, branch_id, product_id, purchase_id, supplier, supplier_invoice_number,
          received_date, payment_method, purchase_total, amount_paid, outstanding_balance,
          payment_due_date, received_by, request_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [storeId, branchId, lines[0].productId, purchaseId, legacySupplier, legacyInvoice,
            receivedDate, legacyPaymentMethod,
            legacyPurchaseTotal ?? roundMoney(lines.reduce((sum,l)=>sum+l.quantity*l.unitPurchaseCost,0)),
            legacyAmountPaid || 0, legacyOutstandingBalance ?? 0, receivedBy || "System", requestKey || null]
    );
    const receiptId = Number(r.insertId);
    await connection.execute("UPDATE inventory_stock_receipts SET receiving_number = ? WHERE id = ?",
        [`RCV-${String(receiptId).padStart(6,"0")}`, receiptId]);
    for (const line of lines) {
        const [createdItem] = await connection.execute(
            `INSERT INTO inventory_stock_receipt_items
             (receipt_id, product_id, variant_id, variant_name, quantity_received,
              unit_purchase_cost, expiration_date, purchase_item_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [receiptId, line.productId, line.variantId ?? null, line.variantName ?? null,
                line.quantity, line.unitPurchaseCost, line.expirationDate ?? null, line.purchaseItemId ?? null]
        );
        // One canonical Stock In movement per physical receipt line, including
        // initial stock. Payment settlement does not create stock movements.
        await connection.execute(
            `INSERT INTO inventory_stock_movements
             (store_id, branch_id, product_id, variant_id, receipt_item_id,
              movement, quantity, movement_date)
             VALUES (?, ?, ?, ?, ?, 'Stock In', ?, ?)`,
            [storeId,branchId,line.productId,line.variantId ?? null,Number(createdItem.insertId),line.quantity,receivedDate]
        );
    }
    return receiptId;
}
// CREATE purchase once; record its financial payment once even if the purchase has many variants/products.
async function createPurchaseLedger(connection, {storeId, branchId, input, lines, source, purchaseRef, requestKey, receivedBy,
    receivedDate, deliveredLines}) {
    const p = validatePurchaseHeader(input, lines);
    const [result] = await connection.execute(
        `INSERT INTO inventory_purchase_transactions
         (store_id, branch_id, source, import_ref, request_key, supplier, supplier_invoice_number,
          purchase_date, payment_method, purchase_total, payment_due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [storeId, branchId, source, purchaseRef || null, requestKey || null, p.supplier,
            p.supplierInvoiceNumber, p.purchaseDate, p.paymentMethod, p.totalCents/100, p.dueDate]
    );
    const purchaseId = Number(result.insertId);
    // Include the persisted store and branch codes in every new Purchase Number.
    const { storeCode, branchCode } = await getProductCodeContext(connection, storeId, branchId);
    await connection.execute("UPDATE inventory_purchase_transactions SET purchase_number = ? WHERE id = ?",
        [`${storeCode}-${branchCode}-PUR-${String(purchaseId).padStart(6, "0")}`, purchaseId]);
    const purchaseLines = [];
    for (const line of lines) {
        const [item] = await connection.execute(
            `INSERT INTO inventory_purchase_items
             (purchase_id, product_id, variant_id, quantity_ordered, unit_purchase_cost, expiration_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [purchaseId, line.productId, line.variantId ?? null, line.quantity,
                line.unitPurchaseCost, line.expirationDate ?? null]
        );
        purchaseLines.push({...line, purchaseItemId: Number(item.insertId)});
    }
    if (p.amountPaidCents > 0) {
        await connection.execute(
            `INSERT INTO inventory_supplier_payments (purchase_id, amount, payment_date)
             VALUES (?, ?, ?)`, [purchaseId, p.amountPaidCents/100, p.purchaseDate]);
    }
    // Invoice/order quantities can be greater than the first delivery.
    // Match physical receipts to ordered lines; never treat undelivered goods as on-hand stock.
    const physicalLines = deliveredLines === undefined ? purchaseLines : deliveredLines.map(delivery => {
        const item = purchaseLines.find(line => line.productId === delivery.productId &&
            (line.variantId ?? null) === (delivery.variantId ?? null));
        if (!item || delivery.quantity > item.quantity || delivery.quantity <= 0 ||
            exactMoney(item.unitPurchaseCost,"Purchase cost") !== exactMoney(delivery.unitPurchaseCost,"Received cost")) {
            throw new Error("Delivered quantities and costs must match their purchase lines.");
        }
        return {...delivery, purchaseItemId:item.purchaseItemId};
    });
    const receiptId = await createStockReceipt(connection, {
        storeId, branchId, purchaseId, lines: physicalLines,
        receivedDate: receivedDate || p.purchaseDate, receivedBy, requestKey,
        legacySupplier: p.supplier, legacyInvoice: p.supplierInvoiceNumber,
        legacyPaymentMethod: p.paymentMethod, legacyAmountPaid: p.amountPaidCents/100,
        legacyPurchaseTotal:p.totalCents/100,legacyOutstandingBalance:p.outstandingCents/100,
    });
    return {purchaseId, receiptId, purchaseTotal:p.totalCents/100,
        amountPaid:p.amountPaidCents/100, outstandingBalance:p.outstandingCents/100};
}
async function findCanonicalInitialPurchase(connection, storeId, branchId, productId) {
    const [rows] = await connection.execute(
        `SELECT p.id AS purchaseId, p.supplier, p.supplier_invoice_number AS supplierInvoiceNumber,
                DATE_FORMAT(p.purchase_date,'%Y-%m-%d') AS purchaseDate,
                p.payment_method AS paymentMethod, p.purchase_total AS purchaseTotal,
                DATE_FORMAT(p.payment_due_date,'%Y-%m-%d') AS paymentDueDate,
                (SELECT COUNT(DISTINCT item.product_id) FROM inventory_purchase_items item WHERE item.purchase_id=p.id) AS productCount,
                COALESCE((SELECT SUM(pay.amount) FROM inventory_supplier_payments pay WHERE pay.purchase_id=p.id),0) AS amountPaid
         FROM inventory_purchase_transactions p
                  INNER JOIN inventory_purchase_items pi ON pi.purchase_id=p.id
         WHERE p.store_id=? AND p.branch_id=? AND pi.product_id=? AND p.source IN ('add','import')
         ORDER BY p.id ASC LIMIT 1`, [storeId, branchId, productId]
    );
    if (!rows.length) return null;
    const entry = rows[0];
    return {...entry, purchaseTotal: Number(entry.purchaseTotal), amountPaid: Number(entry.amountPaid),
        outstandingBalance: roundMoney(Number(entry.purchaseTotal)-Number(entry.amountPaid))};
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
                `SELECT manager_name
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
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
                `SELECT staff_name
                 FROM staff
                 WHERE id = ?
                   AND store_id = ?
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
                `SELECT owner_name
                 FROM stores
                 WHERE id = ?
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

async function recordRestockHistory(
    connection,
    {
        storeId,
        branchId,
        beforeProduct,
        afterProduct,
        receivedBy,
    }
) {
    if (!beforeProduct || !afterProduct || !branchId) {
        return;
    }

    const beforeVariants = Array.isArray(beforeProduct.variants)
        ? beforeProduct.variants
        : [];

    const afterVariants = Array.isArray(afterProduct.variants)
        ? afterProduct.variants
        : [];

    const beforeHasVariants =
        Boolean(beforeProduct.hasVariants) || beforeVariants.length > 0;

    const afterHasVariants =
        Boolean(afterProduct.hasVariants) || afterVariants.length > 0;

    if (beforeHasVariants !== afterHasVariants) {
        return;
    }

    await ensureRestockHistoryTable(connection);

    if (!afterHasVariants) {
        const stockBefore = Number(beforeProduct.stock || 0);
        const currentStock = Number(afterProduct.stock || 0);
        const quantityAdded = currentStock - stockBefore;

        if (quantityAdded <= 0) {
            return;
        }

        await connection.execute(
            `INSERT INTO restock_history
             (
                 store_id,
                 branch_id,
                 product_id,
                 product_name,
                 variant_name,
                 stock_before,
                 quantity_added,
                 current_stock,
                 received_by
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branchId,
                Number(afterProduct.id),
                toSafeString(afterProduct.name || beforeProduct.name, 255),
                null,
                stockBefore,
                quantityAdded,
                currentStock,
                receivedBy,
            ]
        );

        return;
    }

    const previousVariants = new Map();

    for (const variant of beforeVariants) {
        const signature = getVariantSignature(
            variant.variantValues || {}
        );

        if (!signature) {
            continue;
        }

        previousVariants.set(signature, Number(variant.stock || 0));
    }

    for (const variant of afterVariants) {
        const signature = getVariantSignature(
            variant.variantValues || {}
        );

        if (!signature || !previousVariants.has(signature)) {
            continue;
        }

        const stockBefore = Number(previousVariants.get(signature) || 0);
        const currentStock = Number(variant.stock || 0);
        const quantityAdded = currentStock - stockBefore;

        if (quantityAdded <= 0) {
            continue;
        }

        await connection.execute(
            `INSERT INTO restock_history
             (
                 store_id,
                 branch_id,
                 product_id,
                 product_name,
                 variant_name,
                 stock_before,
                 quantity_added,
                 current_stock,
                 received_by
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branchId,
                Number(afterProduct.id),
                toSafeString(afterProduct.name || beforeProduct.name, 255),
                getVariantDisplayName(variant.variantValues),
                stockBefore,
                quantityAdded,
                currentStock,
                receivedBy,
            ]
        );
    }
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
 * transaction as the product action it's logging, so the log and the
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

async function allocateUniqueStoreCode(connection, storeId, storeName, slug) {
    const source = storeName || slug || `Store ${storeId}`;
    const base = buildReadableCode(source, STORE_CODE_STOP_WORDS, "STR");
    const compact = compactAlpha(source);
    const candidates = [base];

    for (let length = 4; length <= 7; length += 1) {
        const extra = compact.slice(0, Math.max(0, length - 3));
        const candidate = `${base}${extra}`.slice(0, length);
        if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    }

    for (let suffix = 0; suffix < 26; suffix += 1) {
        candidates.push(`${base}${String.fromCharCode(65 + suffix)}`);
    }

    for (const candidate of candidates) {
        const [rows] = await connection.execute(
            `SELECT id FROM stores
             WHERE store_code = ?
               AND id <> ?
                 LIMIT 1`,
            [candidate, storeId]
        );

        if (rows.length === 0) return candidate;
    }

    throw new Error("Unable to allocate a unique store code.");
}

async function allocateUniqueBranchCode(
    connection,
    storeId,
    branchId,
    branchName,
    address
) {
    const source = getBranchCodeSource(branchName, address);
    const base = buildReadableCode(source, BRANCH_CODE_STOP_WORDS, "BRN");
    const compact = compactAlpha(source);
    const candidates = [base];

    for (let length = 4; length <= 7; length += 1) {
        const extra = compact.slice(0, Math.max(0, length - 3));
        const candidate = `${base}${extra}`.slice(0, length);
        if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    }

    for (let suffix = 0; suffix < 26; suffix += 1) {
        candidates.push(`${base}${String.fromCharCode(65 + suffix)}`);
    }

    for (const candidate of candidates) {
        const [rows] = await connection.execute(
            `SELECT id FROM branches
             WHERE store_id = ?
               AND branch_code = ?
               AND id <> ?
                 LIMIT 1`,
            [storeId, candidate, branchId]
        );

        if (rows.length === 0) return candidate;
    }

    throw new Error("Unable to allocate a unique branch code.");
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
    // The branch row is locked by create_product before this helper runs.
    // Derive the current maximum from BOTH the sequence table and the actual
    // stored Product Nos. This makes the allocator self-healing even when
    // product_number_sequences is empty or behind existing products.
    const [sequenceRows] = await connection.execute(
        `SELECT last_sequence AS lastSequence
         FROM product_number_sequences
         WHERE store_id = ?
           AND branch_id = ?
             FOR UPDATE`,
        [storeId, branchId]
    );

    const [productRows] = await connection.execute(
        `SELECT COALESCE(
                        MAX(
                                CAST(
                                        SUBSTRING_INDEX(product_number, '-', -1)
                                    AS UNSIGNED
                                )
                        ),
                        0
                ) AS maxExistingSequence
         FROM products
         WHERE store_id = ?
           AND branch_id = ?
           AND deleted_at IS NULL
           AND product_number REGEXP
               '^[A-Za-z]{3,8}-[A-Za-z]{3,8}-[0-9]{3,}$'`,
        [storeId, branchId]
    );

    const sequenceValue = sequenceRows.length
        ? Number(sequenceRows[0].lastSequence || 0)
        : 0;

    const productValue = Number(
        productRows?.[0]?.maxExistingSequence || 0
    );

    const currentMaximum = Math.max(sequenceValue, productValue, 0);

    await connection.execute(
        `INSERT INTO product_number_sequences
             (store_id, branch_id, last_sequence)
         VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                                  last_sequence = GREATEST(last_sequence, VALUES(last_sequence)),
                                  updated_at = CURRENT_TIMESTAMP`,
        [storeId, branchId, currentMaximum]
    );

    return currentMaximum + 1;
}

async function commitProductSequence(connection, storeId, branchId, sequence) {
    await connection.execute(
        `INSERT INTO product_number_sequences
             (store_id, branch_id, last_sequence)
         VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                                  last_sequence = GREATEST(last_sequence, VALUES(last_sequence)),
                                  updated_at = CURRENT_TIMESTAMP`,
        [storeId, branchId, sequence]
    );
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

async function tableExists(connection, tableName) {
    const [rows] = await connection.execute(
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
             LIMIT 1`,
        [tableName]
    );

    return rows.length > 0;
}

async function tableHasColumn(connection, tableName, columnName) {
    const [rows] = await connection.execute(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
             LIMIT 1`,
        [tableName, columnName]
    );

    return rows.length > 0;
}

async function tableHasIndex(connection, tableName, indexName) {
    const [rows] = await connection.execute(
        `SELECT 1
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?
             LIMIT 1`,
        [tableName, indexName]
    );

    return rows.length > 0;
}

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
    if (await tableHasColumn(connection, tableName, columnName)) {
        return;
    }

    try {
        await connection.execute(
            `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`
        );
    } catch (error) {
        // Two API requests can reach this migration at the same time. In that
        // case request A may add the column after request B's INFORMATION_SCHEMA
        // check but before request B executes ALTER TABLE. Treat that race as
        // success instead of turning a valid request into HTTP 500.
        if (error?.code === "ER_DUP_FIELDNAME") {
            return;
        }
        throw error;
    }
}

async function addIndexIfMissing(connection, tableName, indexName, indexSql) {
    if (await tableHasIndex(connection, tableName, indexName)) {
        return;
    }

    try {
        await connection.execute(
            `ALTER TABLE ${tableName} ADD ${indexSql}`
        );
    } catch (error) {
        // Same race protection as addColumnIfMissing(). If another request has
        // already created the named index, the desired schema is already true.
        if (error?.code === "ER_DUP_KEYNAME") {
            return;
        }
        throw error;
    }
}

async function isProductNumberSchemaReady(connection) {
    const requiredStructure = await Promise.all([
        tableHasColumn(connection, "stores", "store_code"),
        tableHasColumn(connection, "branches", "branch_code"),
        tableHasColumn(connection, "products", "product_number"),
        tableExists(connection, "product_number_sequences"),
        tableHasIndex(connection, "stores", "uq_stores_store_code"),
        tableHasIndex(connection, "branches", "uq_branches_store_branch_code"),
        tableHasIndex(connection, "products", "uq_products_product_number"),
    ]);

    if (requiredStructure.some((ready) => !ready)) {
        return false;
    }

    const [missingStoreCodes] = await connection.execute(
        `SELECT id
         FROM stores
         WHERE store_code IS NULL OR TRIM(store_code) = ''
             LIMIT 1`
    );

    if (missingStoreCodes.length > 0) {
        return false;
    }

    const [missingBranchCodes] = await connection.execute(
        `SELECT id
         FROM branches
         WHERE branch_code IS NULL OR TRIM(branch_code) = ''
             LIMIT 1`
    );

    if (missingBranchCodes.length > 0) {
        return false;
    }

    const [missingProductNumbers] = await connection.execute(
        `SELECT id
         FROM products
         WHERE deleted_at IS NULL
           AND (
             product_number IS NULL
                 OR TRIM(product_number) = ''
                 OR product_number NOT REGEXP
                  '^[A-Za-z]{3,8}-[A-Za-z]{3,8}-[0-9]{3,}$'
             )
             LIMIT 1`
    );

    return missingProductNumbers.length === 0;
}

async function ensureProductNumberSchema(connection) {
    if (!(await tableExists(connection, "products"))) return;

    /*
     * IMPORTANT:
     * Do not use MySQL GET_LOCK() here.
     *
     * This function runs inside a normal API request. Multiple inventory,
     * dashboard, POS, and report requests can happen at the same time, so a
     * long-lived advisory lock can make every /api/products request wait and
     * eventually return HTTP 500.
     *
     * Instead:
     * 1. Use a very cheap fast-path once the schema/data are already ready.
     * 2. Keep every DDL operation idempotent.
     * 3. Backfill only when something is actually missing.
     *
     * Product-number allocation itself is protected separately by a row lock
     * on the branch during create_product.
     */
    if (await isProductNumberSchemaReady(connection)) {
        return;
    }

    await addColumnIfMissing(
        connection,
        "stores",
        "store_code",
        "store_code VARCHAR(8) NULL AFTER id"
    );

    await addColumnIfMissing(
        connection,
        "branches",
        "branch_code",
        "branch_code VARCHAR(8) NULL AFTER id"
    );

    await addColumnIfMissing(
        connection,
        "products",
        "product_number",
        "product_number VARCHAR(40) NULL AFTER id"
    );

    await connection.execute(
        `CREATE TABLE IF NOT EXISTS product_number_sequences (
                                                                 store_id BIGINT NOT NULL,
                                                                 branch_id BIGINT NOT NULL,
                                                                 last_sequence INT NOT NULL DEFAULT 0,
                                                                 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                 ON UPDATE CURRENT_TIMESTAMP,
                                                                 PRIMARY KEY (store_id, branch_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // Generate a stable store code only for stores that still need one.
    const [stores] = await connection.execute(
        `SELECT id, store_name, slug, store_code
         FROM stores
         WHERE store_code IS NULL OR TRIM(store_code) = ''
         ORDER BY id ASC`
    );

    for (const store of stores) {
        const code = await allocateUniqueStoreCode(
            connection,
            Number(store.id),
            store.store_name,
            store.slug
        );

        await connection.execute(
            `UPDATE stores
             SET store_code = ?
             WHERE id = ?
               AND (store_code IS NULL OR TRIM(store_code) = '')`,
            [code, Number(store.id)]
        );
    }

    // Generate a stable branch code only for branches that still need one.
    const [branches] = await connection.execute(
        `SELECT id, store_id, branch_name, address, branch_code
         FROM branches
         WHERE branch_code IS NULL OR TRIM(branch_code) = ''
         ORDER BY store_id ASC, id ASC`
    );

    for (const branch of branches) {
        const code = await allocateUniqueBranchCode(
            connection,
            Number(branch.store_id),
            Number(branch.id),
            branch.branch_name,
            branch.address
        );

        await connection.execute(
            `UPDATE branches
             SET branch_code = ?
             WHERE id = ?
               AND (branch_code IS NULL OR TRIM(branch_code) = '')`,
            [code, Number(branch.id)]
        );
    }

    // Backfill ONLY products that are missing the new business Product No.
    const [products] = await connection.execute(
        `SELECT
             products.id,
             products.store_id,
             products.branch_id,
             products.product_number,
             stores.store_code,
             branches.branch_code
         FROM products
                  INNER JOIN stores
                             ON stores.id = products.store_id
                  LEFT JOIN branches
                            ON branches.id = products.branch_id
                                AND branches.store_id = products.store_id
         WHERE products.deleted_at IS NULL
           AND (
             products.product_number IS NULL
                 OR TRIM(products.product_number) = ''
                 OR products.product_number NOT REGEXP
                  '^[A-Za-z]{3,8}-[A-Za-z]{3,8}-[0-9]{3,}$'
             )
         ORDER BY products.store_id ASC,
                  products.branch_id ASC,
                  products.id ASC`
    );

    const branchState = new Map();

    for (const product of products) {
        const storeId = Number(product.store_id);
        const branchId = Number(product.branch_id || 0);

        if (!storeId || !branchId || !product.store_code || !product.branch_code) {
            continue;
        }

        const key = `${storeId}:${branchId}`;

        if (!branchState.has(key)) {
            const [maxRows] = await connection.execute(
                `SELECT COALESCE(
                                MAX(
                                        CAST(
                                                SUBSTRING_INDEX(product_number, '-', -1)
                                            AS UNSIGNED
                                        )
                                ),
                                0
                        ) AS maximum
                 FROM products
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND product_number REGEXP
                       '^[A-Za-z]{3,8}-[A-Za-z]{3,8}-[0-9]{3,}$'`,
                [storeId, branchId]
            );

            branchState.set(
                key,
                Number(maxRows?.[0]?.maximum || 0)
            );
        }

        const nextSequence = Number(branchState.get(key) || 0) + 1;
        branchState.set(key, nextSequence);

        const replacement = buildProductNumber(
            String(product.store_code),
            String(product.branch_code),
            nextSequence
        );

        await connection.execute(
            `UPDATE products
             SET product_number = ?
             WHERE id = ?
               AND (
                 product_number IS NULL
                     OR TRIM(product_number) = ''
                     OR product_number NOT REGEXP
                      '^[A-Za-z]{3,8}-[A-Za-z]{3,8}-[0-9]{3,}$'
                 )`,
            [replacement, Number(product.id)]
        );
    }

    // Sync the sequence table to the actual Product Nos. already stored.
    const [sequenceMaximums] = await connection.execute(
        `SELECT
             store_id,
             branch_id,
             COALESCE(
                     MAX(
                             CAST(
                                     SUBSTRING_INDEX(product_number, '-', -1)
                                 AS UNSIGNED
                             )
                     ),
                     0
             ) AS maximum
         FROM products
         WHERE branch_id IS NOT NULL
           AND product_number REGEXP
               '^[A-Za-z]{3,8}-[A-Za-z]{3,8}-[0-9]{3,}$'
         GROUP BY store_id, branch_id`
    );

    for (const row of sequenceMaximums) {
        await commitProductSequence(
            connection,
            Number(row.store_id),
            Number(row.branch_id),
            Number(row.maximum || 0)
        );
    }

    await addIndexIfMissing(
        connection,
        "stores",
        "uq_stores_store_code",
        "UNIQUE INDEX uq_stores_store_code (store_code)"
    );

    await addIndexIfMissing(
        connection,
        "branches",
        "uq_branches_store_branch_code",
        "UNIQUE INDEX uq_branches_store_branch_code (store_id, branch_code)"
    );

    await addIndexIfMissing(
        connection,
        "products",
        "uq_products_product_number",
        "UNIQUE INDEX uq_products_product_number (product_number)"
    );
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
    if (await tableExists(connection, "order_items")) {
        const [rows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM order_items
             WHERE product_id = ?`,
            [productId]
        );

        counts.posSales = Number(rows[0]?.total || 0);
        if (counts.posSales > 0) {
            history.push("POS sales history");
        }
    }

    // Booking history and unresolved bookings. Pending Review, Confirmed and
    // Preparing are considered active because the booking has not yet reached
    // a final Completed/Cancelled state.
    if (
        await tableExists(connection, "booking_items") &&
        await tableExists(connection, "bookings")
    ) {
        const [historyRows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM booking_items
             WHERE product_id = ?`,
            [productId]
        );

        counts.bookings = Number(historyRows[0]?.total || 0);
        if (counts.bookings > 0) {
            history.push("booking history");
        }

        const [activeRows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM booking_items bi
                      INNER JOIN bookings b
                                 ON b.id = bi.booking_id
             WHERE bi.product_id = ?
               AND LOWER(TRIM(COALESCE(b.status, ''))) IN
                   ('pending review','approved','approved - awaiting payment','awaiting payment','confirmed','preparing','released','return inspection','pending settlement','event in progress')`,
            [productId]
        );

        counts.activeBookings = Number(activeRows[0]?.total || 0);
        if (counts.activeBookings > 0) {
            blockers.push(
                "This product is used by an active booking. Complete or cancel the booking before removing the product."
            );
        }
    }

    // Packages are stored primarily in packages.inclusions as JSON in the
    // current StockNBook implementation. Read and inspect the JSON in JS so the
    // check remains compatible with MySQL/TiDB JSON/text storage.
    if (await tableExists(connection, "packages")) {
        const packageColumns = {
            branchId: await tableHasColumn(connection, "packages", "branch_id"),
            status: await tableHasColumn(connection, "packages", "status"),
            inclusions: await tableHasColumn(connection, "packages", "inclusions"),
        };

        if (packageColumns.inclusions) {
            let packageQuery = `
                SELECT id, name,
                       ${packageColumns.status ? "status" : "'Active' AS status"},
                       inclusions
                FROM packages
                WHERE store_id = ?
            `;
            const packageParams = [storeId];

            if (activeBranchId && packageColumns.branchId) {
                packageQuery += " AND branch_id = ?";
                packageParams.push(activeBranchId);
            }

            const [packageRows] = await connection.execute(
                packageQuery,
                packageParams
            );

            for (const pkg of packageRows) {
                const inclusions = parsePackageInclusions(pkg.inclusions);
                if (!packageIncludesProduct(inclusions, productId)) continue;

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
        }
    }

    // Backward compatibility for installations that use a normalized
    // package_items table in addition to the packages.inclusions JSON field.
    if (
        await tableExists(connection, "package_items") &&
        await tableHasColumn(connection, "package_items", "product_id")
    ) {
        const [packageItemRows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM package_items
             WHERE product_id = ?`,
            [productId]
        );

        const normalizedPackageHistory = Number(packageItemRows[0]?.total || 0);
        if (normalizedPackageHistory > 0) {
            if (counts.packages === 0) history.push("package history");
            counts.packages = Math.max(counts.packages, normalizedPackageHistory);
        }

        if (
            await tableHasColumn(connection, "package_items", "package_id") &&
            await tableExists(connection, "packages") &&
            await tableHasColumn(connection, "packages", "status")
        ) {
            const [activePackageRows] = await connection.execute(
                `SELECT COUNT(*) AS total
                 FROM package_items pi
                          INNER JOIN packages p
                                     ON p.id = pi.package_id
                 WHERE pi.product_id = ?
                   AND LOWER(TRIM(COALESCE(p.status, ''))) = 'active'`,
                [productId]
            );

            const normalizedActivePackages = Number(activePackageRows[0]?.total || 0);
            if (normalizedActivePackages > 0 && counts.activePackages === 0) {
                blockers.push(
                    "This product is included in an active package. Remove it from the package first."
                );
            }
            counts.activePackages = Math.max(
                counts.activePackages,
                normalizedActivePackages
            );
        }
    }

    // Restock history is optional and is created by this Lambda when needed.
    if (
        await tableExists(connection, "restock_history") &&
        await tableHasColumn(connection, "restock_history", "product_id")
    ) {
        const [rows] = await connection.execute(
            `SELECT COUNT(*) AS total
             FROM restock_history
             WHERE product_id = ?`,
            [productId]
        );

        counts.restocks = Number(rows[0]?.total || 0);
        if (counts.restocks > 0) {
            history.push("restock history");
        }
    }

    if (await tableExists(connection, "inventory_purchase_items")) {
        const [rows] = await connection.execute(
            `SELECT COUNT(*) AS total FROM inventory_purchase_items WHERE product_id=?`, [productId]);
        if (Number(rows[0]?.total || 0) > 0) history.push("supplier purchase history");
    }

    // A supplier purchase is a financial record and must survive product removal.
    if (await tableExists(connection, "inventory_initial_purchases")) {
        const [purchaseRows] = await connection.execute(
            `SELECT COUNT(*) AS total FROM inventory_initial_purchases
             WHERE store_id = ? AND product_id = ?`,
            [storeId, productId]
        );
        if (Number(purchaseRows[0]?.total || 0) > 0) {
            history.push("initial supplier purchase / payable history");
        }
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

    const referenceCount = async (table, name) => {
        if (!(await tableExists(connection, table)) ||
            !(await tableHasColumn(connection, table, "product_id"))) return 0;
        const hasVariantId = await tableHasColumn(connection, table, "variant_id");
        // A NULL variant_id can be a legacy, unallocated reference to any
        // variant of this product. Never silently treat it as unrelated.
        const [rows] = await connection.execute(
            `SELECT COUNT(*) AS total FROM ${table} WHERE product_id=?` +
            (hasVariantId ? " AND (variant_id=? OR variant_id IS NULL)" : ""),
            hasVariantId ? [productId, variantId] : [productId]
        );
        const count = Number(rows[0]?.total || 0);
        counts[name] = count;
        if (count > 0) history.push(name);
        return count;
    };

    await referenceCount("order_items", "POS sales history");
    await referenceCount("inventory_purchase_items", "supplier purchase history");
    await referenceCount("inventory_stock_receipt_items", "stock receipt history");
    await referenceCount("inventory_stock_movements", "stock movement history");
    await referenceCount("inventory_stock_adjustments", "stock adjustment history");

    // This legacy table records variant_name instead of a stable variant id.
    // Treat product-level history as a reference rather than deleting its data.
    await referenceCount("restock_history", "restock history");
    await referenceCount("inventory_initial_purchases", "initial purchase history");

    if (await tableExists(connection, "booking_items") &&
        await tableExists(connection, "bookings") &&
        await tableHasColumn(connection, "booking_items", "product_id")) {
        const hasVariantId = await tableHasColumn(connection, "booking_items", "variant_id");
        const condition = hasVariantId ? " AND (bi.variant_id=? OR bi.variant_id IS NULL)" : "";
        const args = hasVariantId ? [productId, variantId] : [productId];
        const [rows] = await connection.execute(
            `SELECT COUNT(*) AS total FROM booking_items bi WHERE bi.product_id=?${condition}`, args
        );
        counts.bookings = Number(rows[0]?.total || 0);
        if (counts.bookings > 0) history.push("booking history");
        const [activeRows] = await connection.execute(
            `SELECT COUNT(*) AS total FROM booking_items bi
                                               JOIN bookings b ON b.id=bi.booking_id
             WHERE bi.product_id=?${condition}
               AND LOWER(TRIM(COALESCE(b.status,''))) IN ('pending review','approved','approved - awaiting payment','awaiting payment','confirmed','preparing','released','return inspection','pending settlement','event in progress')`, args
        );
        if (Number(activeRows[0]?.total || 0) > 0) {
            blockers.push("This variant may be needed for an active booking. Complete or cancel the booking first.");
        }
    }

    // JSON package inclusions can be product-level or variant-specific.
    // Product-level inclusions are ambiguous, so protect all child variants.
    if (await tableExists(connection, "packages") &&
        await tableHasColumn(connection, "packages", "inclusions")) {
        const hasBranch = await tableHasColumn(connection, "packages", "branch_id");
        const hasStatus = await tableHasColumn(connection, "packages", "status");
        const [rows] = await connection.execute(
            `SELECT id, name, ${hasStatus ? "status" : "'Active' AS status"}, inclusions
             FROM packages WHERE store_id=?` +
            (activeBranchId && hasBranch ? " AND branch_id=?" : ""),
            activeBranchId && hasBranch ? [storeId, activeBranchId] : [storeId]
        );
        for (const pkg of rows) {
            const matched = parsePackageInclusions(pkg.inclusions).some(item => {
                if (!item || typeof item !== "object") return false;
                const itemProductId = Number(item.productId ?? item.product_id ?? item.id ?? 0);
                const itemVariantId = item.variantId ?? item.variant_id;
                return itemProductId === productId &&
                    (itemVariantId == null || itemVariantId === "" || Number(itemVariantId) === variantId);
            });
            if (!matched) continue;
            history.push("package history");
            if (normalizeRemovalStatus(pkg.status) === "active") {
                blockers.push(`This variant may be used in active package "${toSafeString(pkg.name, 120) || pkg.id}". Remove it from the package first.`);
            }
        }
    }
    if (await tableExists(connection, "package_items") &&
        await tableHasColumn(connection, "package_items", "product_id")) {
        const hasVariantId = await tableHasColumn(connection, "package_items", "variant_id");
        const condition = hasVariantId ? " AND (pi.variant_id=? OR pi.variant_id IS NULL)" : "";
        const args = hasVariantId ? [productId, variantId] : [productId];
        const [rows] = await connection.execute(
            `SELECT COUNT(*) AS total FROM package_items pi WHERE pi.product_id=?${condition}`, args
        );
        if (Number(rows[0]?.total || 0) > 0) history.push("package history");
        if (await tableExists(connection, "packages") &&
            await tableHasColumn(connection, "packages", "status") &&
            await tableHasColumn(connection, "package_items", "package_id")) {
            const [active] = await connection.execute(
                `SELECT COUNT(*) AS total FROM package_items pi
                                                   JOIN packages p ON p.id=pi.package_id
                 WHERE pi.product_id=?${condition}
                   AND LOWER(TRIM(COALESCE(p.status,'')))='active'`, args
            );
            if (Number(active[0]?.total || 0) > 0) {
                blockers.push("This variant may be used in an active package. Remove that package inclusion first.");
            }
        }
    }
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
    let sql = `SELECT id, name, product_number AS productNumber, has_variants AS hasVariants,
                      branch_id AS branchId FROM products
               WHERE id=? AND store_id=? AND deleted_at IS NULL`;
    const params = [productId, storeId];
    if (activeBranchId) { sql += " AND branch_id=?"; params.push(activeBranchId); }
    sql += " FOR UPDATE";
    const [products] = await connection.execute(sql, params);
    if (!products.length || !Number(products[0].hasVariants)) {
        const err = new Error("Active variant product not found.");
        err.removalStatus = 404;
        throw err;
    }
    const product = products[0];
    const [variants] = await connection.execute(
        `SELECT id, variant_number AS variantNumber, variant_values AS variantValues,
                expiration_date, stock
         FROM product_variants
         WHERE id=? AND product_id=? AND deleted_at IS NULL FOR UPDATE`,
        [variantId, productId]
    );
    if (!variants.length) {
        const err = new Error("The selected variant is no longer active. Refresh inventory.");
        err.removalStatus = 404;
        throw err;
    }
    const variant = variants[0];
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
            `UPDATE product_variants SET deleted_at=NOW()
             WHERE id=? AND product_id=? AND deleted_at IS NULL`, [variantId, productId]
        );
        if (!Number(result.affectedRows)) throw new Error("Variant was not archived.");
    } else {
        const [result] = await connection.execute(
            `DELETE FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`,
            [variantId, productId]
        );
        if (!Number(result.affectedRows)) throw new Error("Variant was not deleted.");
    }

    // Never remove or change sibling variants. Update only the parent summary,
    // using remaining ACTIVE variants. Archive an empty parent but keep its
    // identifiers and transaction references intact.
    const [remaining] = await connection.execute(
        `SELECT stock, alert_level AS alertLevel, original_price AS originalPrice,
                sales_price AS salesPrice
         FROM product_variants WHERE product_id=? AND deleted_at IS NULL`, [productId]
    );
    if (remaining.length) {
        const stock = getVariantTotalStock(remaining);
        const alert = getVariantTotalAlert(remaining);
        const cost = getMinVariantPrice(remaining, "originalPrice");
        const price = getMinVariantPrice(remaining, "salesPrice");
        await connection.execute(
            `UPDATE products SET stock=?, alert_level=?, original_price=?, sales_price=?
             WHERE id=? AND store_id=? AND deleted_at IS NULL`,
            [stock, alert, cost, price, productId, storeId]
        );
    } else {
        await connection.execute(
            `UPDATE products SET stock=0, alert_level=0, deleted_at=NOW()
             WHERE id=? AND store_id=? AND deleted_at IS NULL`,
            [productId, storeId]
        );
    }
    await logEmployeeAction(connection, {
        storeId, branchId: Number(product.branchId), employee,
        module: "Inventory", referenceNumber: variant.variantNumber || product.productNumber || String(variantId),
        action: mode === "archive" ? "Archived variant" : "Permanently deleted variant",
        referenceId: String(productId),
        details: `${mode === "archive" ? "Archived" : "Deleted"} variant ${getVariantDisplayName(parseVariantValues(variant.variantValues))} (${variant.variantNumber || variantId}) of ${product.name}; sibling variants unchanged`,
    });
    return { mode, impact: { ...impact, mode } };
}

async function archiveProduct(connection, storeId, activeBranchId, productId) {
    await connection.execute(
        `UPDATE product_variants
         SET deleted_at = COALESCE(deleted_at, NOW())
         WHERE product_id = ?`,
        [productId]
    );

    let query = `
        UPDATE products
        SET deleted_at = NOW()
        WHERE id = ?
          AND store_id = ?
          AND deleted_at IS NULL
    `;
    const params = [productId, storeId];

    if (activeBranchId) {
        query += " AND branch_id = ?";
        params.push(activeBranchId);
    }

    const [result] = await connection.execute(query, params);
    return Number(result.affectedRows || 0);
}

async function permanentlyDeleteProduct(
    connection,
    storeId,
    activeBranchId,
    productId
) {
    // Variants are safe to physically remove only after the impact check proves
    // that no transaction/package/booking/restock history depends on the product.
    await connection.execute(
        "DELETE FROM product_variants WHERE product_id = ?",
        [productId]
    );

    let query = `
        DELETE FROM products
        WHERE id = ?
          AND store_id = ?
          AND deleted_at IS NULL
    `;
    const params = [productId, storeId];

    if (activeBranchId) {
        query += " AND branch_id = ?";
        params.push(activeBranchId);
    }

    const [result] = await connection.execute(query, params);
    return Number(result.affectedRows || 0);
}

/* OWNER STOCK CONDITION: live Sales + Rental item types, counted ONCE per branch.
 * Important: no demo quantities, no purchase-cost-based revenue, no stock writes.
 * Priority: equipment on hold -> expiring/expired -> low availability -> slow -> healthy.
 */
async function loadOwnerStockCondition(connection, {storeId, branchId, asOfDate}) {
    const cutoff = new Date(`${asOfDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const slowStart = cutoff.toISOString().slice(0, 10);
    const expires = new Date(`${asOfDate}T00:00:00Z`);
    expires.setUTCDate(expires.getUTCDate() + 30);
    const expiryLimit = expires.toISOString().slice(0, 10);
    const counts = {healthy:0, expiring:0, low:0, slow:0, maintenance:0};
    const conditions = new Set();
    const present = async table => (await tableExists(connection,table));
    const status = ({maintenance=false,expiring=false,low=false,slow=false}) =>
        maintenance ? 'maintenance' : expiring ? 'expiring' : low ? 'low' : slow ? 'slow' : 'healthy';
    const date = v => String(v ?? '').slice(0, 10);
    const args = [storeId, ...(branchId ? [branchId] : [])];
    let productHistory = false, rentalHistory = false;

    if (await present('products')) {
        const hasVariants = await present('product_variants');
        const [rows] = await connection.execute(`SELECT p.id,p.branch_id AS branchId,p.stock,
                                                        p.alert_level AS alertLevel,DATE_FORMAT(p.expiration_date,'%Y-%m-%d') AS expiresAt,p.has_variants AS hasVariants,
                                                        DATE_FORMAT(p.created_at,'%Y-%m-%d') AS createdDate,
                                                        ${hasVariants ? "v.id AS variantId,v.stock AS variantStock,v.alert_level AS variantAlert,DATE_FORMAT(v.expiration_date,'%Y-%m-%d') AS variantExpiry" :
                                                                'NULL AS variantId,NULL AS variantStock,NULL AS variantAlert,NULL AS variantExpiry'}
                                                 FROM products p ${hasVariants ? 'LEFT JOIN product_variants v ON v.product_id=p.id AND v.deleted_at IS NULL' : ''}
                                                 WHERE p.store_id=? AND p.deleted_at IS NULL ${branchId ? 'AND p.branch_id=?' : ''}
                                                 ORDER BY p.id`, args);
        const products = new Map();
        for (const row of rows) {
            const id = Number(row.id);
            if (!products.has(id)) products.set(id,{...row,variants:[]});
            if (row.variantId != null) products.get(id).variants.push(row);
        }
        const recentlySold = new Set();
        if (await present('orders') && await present('order_items') &&
            await tableHasColumn(connection,'order_items','product_id')) {
            productHistory = true;
            const [sales] = await connection.execute(`SELECT DISTINCT oi.product_id AS productId
                                                      FROM orders o JOIN order_items oi ON oi.order_id=o.order_id AND oi.store_id=o.store_id
                                                      WHERE o.store_id=? ${branchId ? 'AND o.branch_id=?' : ''} AND o.order_date>=?
                AND LOWER(TRIM(COALESCE(o.status,''))) NOT IN
                ('pending','pending payment','unpaid','cancelled','canceled','refunded','void','voided','draft','failed')`,
                [...args,slowStart]);
            sales.forEach(row=>recentlySold.add(Number(row.productId)));
        }
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
    }
    if (await present('rental_equipment')) {
        const recentlyRented = new Set();
        if (await present('rental_stock_movements')) {
            rentalHistory = true;
            const [moves] = await connection.execute(`SELECT DISTINCT equipment_id AS equipmentId
                                                      FROM rental_stock_movements WHERE store_id=? ${branchId ? 'AND branch_id=?' : ''}
                AND type='rented_out' AND occurred_at>=?`, [...args,slowStart]);
            moves.forEach(row=>recentlyRented.add(Number(row.equipmentId)));
        }
        const [rows] = await connection.execute(`SELECT id,branch_id AS branchId,total_units AS totalUnits,
                                                        rented_out_units AS rentedOut,maintenance_units AS maintenanceUnits,
                                                        missing_units AS missingUnits,alert_level AS alertLevel,
                                                        DATE_FORMAT(created_at,'%Y-%m-%d') AS createdDate
                                                 FROM rental_equipment WHERE store_id=? ${branchId ? 'AND branch_id=?' : ''}
            AND archived_at IS NULL`, args);
        for(const row of rows) {
            const available = Math.max(0, Number(row.totalUnits||0)-Number(row.rentedOut||0)-
                Number(row.maintenanceUnits||0)-Number(row.missingUnits||0));
            const maintenance = Number(row.maintenanceUnits)>0 || Number(row.missingUnits)>0;
            const low = available===0 || (Number(row.alertLevel)>0 && available<=Number(row.alertLevel));
            const slow = rentalHistory && Number(row.totalUnits)>0 && date(row.createdDate) &&
                date(row.createdDate)<=slowStart && !recentlyRented.has(Number(row.id));
            conditions.add(`rental:${Number(row.branchId)}:${Number(row.id)}`);
            counts[status({maintenance,low,slow})]++;
        }
    }
    return {counts,total:conditions.size,asOfDate};
}

/* Only posted/recorded rental-item charges are revenue. The live rental rate,
 * supplier purchases and physical releases are NOT revenue evidence.
 * Supports an explicit booking allocation charge snapshot or an itemized ledger.
 */
async function loadOwnerRecordedRentalRevenue(connection,{storeId,branchId,dateFrom,dateTo}) {
    const schemaTables = ['rental_revenue_entries','rental_booking_allocations','rental_staff_allocation_workflow'];
    const [schema] = await connection.execute(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName
                                               FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
                                                                                 AND TABLE_NAME IN ('rental_revenue_entries','rental_booking_allocations','rental_staff_allocation_workflow')`);
    const columnSet = new Set(schema.map(r=>`${r.tableName}.${r.columnName}`));
    const has = (t,c) => columnSet.has(`${t}.${c}`);
    const branchSql = branchId ? ' AND r.branch_id=?' : '';
    const args = [storeId,...(branchId?[branchId]:[]),dateFrom,dateTo];
    let rows = [], available = false, method = null;
    if (['store_id','branch_id','equipment_id','amount','revenue_date'].every(c=>has('rental_revenue_entries',c))) {
        available=true; method='ledger';
        [rows] = await connection.execute(`SELECT r.branch_id AS branchId,r.equipment_id AS equipmentId,
                                                  COALESCE(e.name,'Archived rental equipment') AS equipmentName,
                                                  DATE_FORMAT(r.revenue_date,'%Y-%m-%d') AS revenueDate,r.amount AS revenueAmount
                                           FROM rental_revenue_entries r LEFT JOIN rental_equipment e ON e.id=r.equipment_id
                                               AND e.store_id=r.store_id AND e.branch_id=r.branch_id
                                           WHERE r.store_id=? ${branchSql} AND r.revenue_date>=? AND r.revenue_date<=?`,args);
    } else if (['store_id','branch_id','equipment_id','status','end_date'].every(c=>has('rental_booking_allocations',c))) {
        // Accept only a SAVED charge, never multiply today's catalog rate by an old rental.
        const savedCharge = ['rental_charge_total','charged_total','line_total']
            .find(c=>has('rental_booking_allocations',c));
        if(savedCharge && await tableExists(connection,'rental_equipment')) {
            const workflow = has('rental_staff_allocation_workflow','returned_at') &&
                has('rental_staff_allocation_workflow','allocation_id');
            available=true;method='allocation';
            const dateExpression = workflow ? 'DATE(COALESCE(w.returned_at,a.end_date))' : 'DATE(a.end_date)';
            [rows] = await connection.execute(`SELECT a.branch_id AS branchId,a.equipment_id AS equipmentId,
                                                      COALESCE(e.name,'Archived rental equipment') AS equipmentName,
                                                      DATE_FORMAT(${dateExpression},'%Y-%m-%d') AS revenueDate,
                                                      a.${savedCharge} AS revenueAmount
                                               FROM rental_booking_allocations a
                                                        LEFT JOIN rental_equipment e ON e.id=a.equipment_id AND e.store_id=a.store_id AND e.branch_id=a.branch_id
                                                   ${workflow ? 'LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id' : ''}
                                               WHERE a.store_id=? ${branchId ? 'AND a.branch_id=?' : ''}
                                                 AND a.status='returned' AND ${dateExpression}>=? AND ${dateExpression}<=?`,args);
        }
    }
    if (!available) return {available:false,rows:[],warnings:[
            'Rental-item charges are not stored in the supplied booking/inventory schema. Record an agreed rental charge per booking item (or post entries to a rental revenue ledger) to enable this report.'
        ]};
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
    return {available:true,rows:normalized,warnings:[],method};
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
    const [schemaRows] = await connection.execute(
        `SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName
         FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('orders','order_items')`, []);
    const columns = new Set(schemaRows.map(row => `${row.tableName}.${row.columnName}`));
    const hasColumns = (table, names) => names.every(name => columns.has(`${table}.${name}`));
    const posAvailable = hasColumns("orders", ["order_id", "store_id", "branch_id", "order_date", "total", "status"]);
    const itemsAvailable = hasColumns("order_items", ["id", "order_id", "store_id", "quantity", "line_total"]);
    let rows = [];
    if (posAvailable) {
        const optionalItem = (column, alias) => itemsAvailable && columns.has(`order_items.${column}`)
            ? `oi.${column} AS ${alias}` : `NULL AS ${alias}`;
        const [salesRows] = await connection.execute(
            `SELECT o.order_id AS orderId,o.branch_id AS branchId,b.branch_name AS branchName,
                    DATE_FORMAT(o.order_date,'%Y-%m-%d') AS orderDate,o.total AS orderTotal,
                    ${optionalItem("id", "itemId")},${optionalItem("product_id", "productId")},
                    ${optionalItem("product_name", "productName")},${optionalItem("quantity", "quantity")},
                    ${optionalItem("line_total", "lineTotal")},${optionalItem("cost_price_at_sale", "costPriceAtSale")}
             FROM orders o LEFT JOIN branches b ON b.id=o.branch_id AND b.store_id=o.store_id
                 ${itemsAvailable ? "LEFT JOIN order_items oi ON oi.order_id=o.order_id AND oi.store_id=o.store_id" : ""}
             WHERE o.store_id=? AND o.order_date>=? AND o.order_date<=?${branchId ? " AND o.branch_id=?" : ""}
               AND LOWER(TRIM(COALESCE(o.status,''))) NOT IN
                 ('pending','pending payment','unpaid','cancelled','canceled','refunded','void','voided','draft','failed')
             ORDER BY o.order_date,o.order_id${itemsAvailable ? ",oi.id" : ""} LIMIT 100001`,
            [storeId, dateFrom, dateTo, ...(branchId ? [branchId] : [])]);
        if (salesRows.length > 100000) {
            const error = new Error("This report contains too many sales items. Choose a shorter date range or one branch.");
            error.ownerInventoryStatus = 400;
            throw error;
        }
        rows = salesRows;
    }
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
                        COALESCE(SUM(ib.remaining_quantity),0) AS eligibleBatches
                 FROM branch_inventory bi
                          LEFT JOIN inventory_batches ib ON ib.branch_inventory_id=bi.id
                     AND ib.status='active' AND ib.remaining_quantity>0
                     AND (ib.expiration_date IS NULL OR ib.expiration_date>=?)
                 WHERE bi.store_id=? AND bi.branch_id=? AND bi.status='active'
                 GROUP BY bi.id,bi.product_id,bi.variant_id,bi.quantity_on_hand`,
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
                `SELECT branch_id,status,permissions FROM managers WHERE id=? AND store_id=? LIMIT 1`,
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
                `SELECT branch_id,status,permissions FROM staff WHERE id=? AND store_id=? LIMIT 1`,
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
                `SELECT permissions FROM staff WHERE id=? AND store_id=? AND branch_id=? LIMIT 1`,
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
        await ensureProductNumberSchema(connection);

        /* STAFF INVENTORY: branch-scoped operational workflow, separate from purchasing.
         * Tables are deployed by migrations/2026-10-11_staff_inventory_operations.sql.
         * This action MUST NOT use receive_stock: that action creates a financial purchase.
         */
        if (["get_staff_inventory_workspace", "get_staff_inventory_activity", "get_staff_receiving_permissions", "set_staff_receiving_permission", "authorize_staff_stock_receipt",
            "complete_staff_stock_receipt", "cancel_staff_stock_receipt", "report_staff_stock_shortage", "resolve_staff_stock_shortage", "report_staff_stock_condition", "resolve_staff_stock_condition"].includes(action)) {
            if (!(await tableExists(connection, "staff_stock_receiving_tasks")) ||
                !(await tableExists(connection, "staff_stock_shortage_reports"))) {
                return jsonResponse(503, headers, { error: "The Staff Inventory SQL migration is required before using these operations." });
            }
            if (!(await tableExists(connection, "staff_stock_condition_reports"))) {
                return jsonResponse(503, headers, { error: "The Staff product condition reports SQL migration is required." });
            }
            if (!activeBranchId) return badRequest(headers, "An assigned branch is required.");
            if (!["owner", "manager", "staff"].includes(tokenRole)) return unauthorized(headers, "Inventory access denied.");
            if (tokenRole === "manager") {
                const managerId=Number(decoded?.manager_id);
                const [managers]= await connection.execute(
                    `SELECT permissions,status FROM managers WHERE id=? AND store_id=? AND branch_id=? LIMIT 1`,
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
                    `SELECT id, permissions, status FROM staff WHERE id=? AND store_id=? AND branch_id=? LIMIT 1`,
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
                     FROM staff WHERE store_id=? AND branch_id=?`,[storeId,activeBranchId]);
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
                     FROM inventory_movements m
                         JOIN branch_inventory bi ON bi.id=m.branch_inventory_id AND bi.store_id=m.store_id AND bi.branch_id=m.branch_id
                         JOIN products p ON p.id=bi.product_id AND p.store_id=bi.store_id AND p.branch_id=bi.branch_id
                         LEFT JOIN product_variants pv ON pv.id=bi.variant_id AND pv.product_id=p.id
                     WHERE ${where.join(' AND ')}
                     ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
                    [...params, limit+1, (page-1)*limit]);
                return jsonResponse(200,headers,{success:true,movements:rows.slice(0,limit),hasMore:rows.length>limit,page});
            }
            if (action === "get_staff_inventory_workspace") {
                const [receivingTasks] = await connection.execute(
                    `SELECT t.id, t.product_id AS productId, t.variant_id AS variantId,
                            p.name AS productName, p.product_number AS productNumber,
                            pv.variant_values AS variantValues,
                            t.authorized_quantity AS authorizedQuantity,
                            COALESCE(t.received_quantity,0) AS alreadyReceived,
                            (t.authorized_quantity - COALESCE(t.received_quantity,0)) AS quantity,
                            t.last_receiving_notes AS lastReceivingNotes,
                            t.delivery_reference AS deliveryReference, t.expiration_date AS expirationDate,
                            t.status, t.notes, t.created_at AS createdAt
                     FROM staff_stock_receiving_tasks t
                              JOIN products p ON p.id=t.product_id AND p.store_id=t.store_id AND p.branch_id=t.branch_id
                              LEFT JOIN product_variants pv ON pv.id=t.variant_id AND pv.product_id=p.id
                     WHERE t.store_id=? AND t.branch_id=? AND t.status='pending' AND p.deleted_at IS NULL
                     ORDER BY t.created_at DESC, t.id DESC LIMIT 40`, [storeId,activeBranchId]);
                const [shortages] = await connection.execute(
                    `SELECT r.id, r.product_id AS productId, r.variant_id AS variantId,
                            p.name AS productName, r.stock_snapshot AS stockSnapshot,
                            r.reorder_snapshot AS reorderSnapshot, r.notes,
                            r.created_at AS createdAt
                     FROM staff_stock_shortage_reports r
                              JOIN products p ON p.id=r.product_id AND p.store_id=r.store_id AND p.branch_id=r.branch_id
                     WHERE r.store_id=? AND r.branch_id=? AND r.status='open'
                     ORDER BY r.created_at DESC LIMIT 100`, [storeId,activeBranchId]);
                const [conditionReports] = await connection.execute(
                    `SELECT r.id, r.product_id AS productId, r.variant_id AS variantId,
                            p.name AS productName, r.issue_type AS issueType, r.notes,
                            COALESCE(pv.expiration_date,p.expiration_date) AS expirationDate,
                            r.created_at AS createdAt
                     FROM staff_stock_condition_reports r
                              JOIN products p ON p.id=r.product_id AND p.store_id=r.store_id AND p.branch_id=r.branch_id
                              LEFT JOIN product_variants pv ON pv.id=r.variant_id AND pv.product_id=p.id
                     WHERE r.store_id=? AND r.branch_id=? AND r.status='open'
                     ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
                    [storeId,activeBranchId]);
                const [movements] = await connection.execute(
                    `SELECT m.id, m.created_at AS at, p.name AS productName,
                            pv.variant_values AS variantValues, m.movement_type AS kind,
                            m.quantity_delta AS quantity, m.reference_type AS referenceType,
                            m.reference_id AS reference, m.actor_name AS actorName
                     FROM inventory_movements m
                         JOIN branch_inventory bi ON bi.id=m.branch_inventory_id AND bi.store_id=m.store_id AND bi.branch_id=m.branch_id
                         JOIN products p ON p.id=bi.product_id AND p.store_id=bi.store_id AND p.branch_id=bi.branch_id
                         LEFT JOIN product_variants pv ON pv.id=bi.variant_id AND pv.product_id=p.id
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
                    `SELECT id, permissions FROM staff WHERE id=? AND store_id=? AND branch_id=? LIMIT 1 FOR UPDATE`,
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
                    `UPDATE staff SET permissions = JSON_SET(COALESCE(permissions,JSON_OBJECT()),'$.inventory_stock_receive', JSON_EXTRACT(?, '$')) WHERE id=? AND store_id=? AND branch_id=?`,
                    [String(body.allowed), targetStaffId, storeId, activeBranchId]);
                await logEmployeeAction(connection, {storeId,branchId:activeBranchId,employee,module:"Inventory",
                    action:body.allowed ? "Granted staff receiving access" : "Revoked staff receiving access",
                    referenceId:String(targetStaffId),details:"Staff receiving permission updated"});
                await connection.commit();
                return jsonResponse(200,headers,{success:true,allowed:body.allowed});
            }
            if (action === "authorize_staff_stock_receipt") {
                if (tokenRole !== "manager" && tokenRole !== "owner") return unauthorized(headers,"Only the manager or owner can authorize receiving tasks.");
                const {productId,variantId,valid} = itemIdentity();
                const quantity = Number(body.quantity);
                const deliveryReference = toSafeString(body.deliveryReference,100);
                const notes = toSafeString(body.notes,500);
                let expirationDate;
                try { expirationDate = normalizeOptionalDate(body.expirationDate); }
                catch (e) { return badRequest(headers,e.message); }
                if (!valid || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000 ||
                    !/^[a-zA-Z0-9][a-zA-Z0-9 _./-]{2,99}$/.test(deliveryReference)) {
                    return badRequest(headers,"Valid product, quantity and delivery reference (3–100 characters) are required.");
                }
                const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
                if (expirationDate && expirationDate < today) return badRequest(headers,"An expired batch cannot be authorized for receiving.");
                const [products] = await connection.execute(
                    `SELECT id, has_variants FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL`,
                    [productId,storeId,activeBranchId]);
                if (!products.length) return notFound(headers,"Product not in this branch.");
                if (Boolean(products[0].has_variants) !== (variantId !== null)) return badRequest(headers,"Select the exact product variant.");
                if (variantId !== null) {
                    const [variants] = await connection.execute(`SELECT id FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`,[variantId,productId]);
                    if (!variants.length) return badRequest(headers,"Variant unavailable.");
                }
                // Require a mapped V2 row before authorization; POS uses this ledger.
                const [inventory] = await connection.execute(
                    `SELECT id FROM branch_inventory WHERE store_id=? AND branch_id=? AND product_id=? AND variant_id <=> ? AND status='active'`,
                    [storeId,activeBranchId,productId,variantId]);
                if (!inventory.length) return badRequest(headers,"V2 branch inventory is missing for this item. Reconcile inventory before creating a receiving task.");
                try {
                    await connection.execute(
                        `INSERT INTO staff_stock_receiving_tasks (store_id,branch_id,product_id,variant_id,authorized_quantity,delivery_reference,expiration_date,notes,authorized_by)
                         VALUES (?,?,?,?,?,?,?,?,?)`,
                        [storeId,activeBranchId,productId,variantId,quantity,deliveryReference,expirationDate,notes,employee.id]);
                } catch (err) { if (err?.code === "ER_DUP_ENTRY") return jsonResponse(409,headers,{error:"A task already exists for this item and delivery reference."}); throw err; }
                return jsonResponse(201,headers,{success:true});
            }
            if (action === "cancel_staff_stock_receipt") {
                if (!["manager","owner"].includes(tokenRole)) return unauthorized(headers,"Manager authorization required.");
                const taskId=Number(body.taskId);
                if (!Number.isSafeInteger(taskId)||taskId<1) return badRequest(headers,"Invalid receiving task.");
                const [result] = await connection.execute(`UPDATE staff_stock_receiving_tasks
                                                           SET status='cancelled' WHERE id=? AND store_id=? AND branch_id=? AND status='pending'`,
                    [taskId,storeId,activeBranchId]);
                if (!result.affectedRows) return jsonResponse(409,headers,{error:"Task already completed, cancelled, or unavailable."});
                return jsonResponse(200,headers,{success:true});
            }
            if (action === "complete_staff_stock_receipt") {
                if (tokenRole !== "staff" || !allowedReceiving) return unauthorized(headers,"Only designated stock receiving staff may complete this task.");
                const taskId = Number(body.taskId);
                const requestKey = toSafeString(body.requestKey,80);
                if (!Number.isSafeInteger(taskId) || taskId < 1 || !/^[a-zA-Z0-9-]{12,80}$/.test(requestKey)) {
                    return badRequest(headers,"Valid receiving task and unique request key required.");
                }
                if (!(await tableExists(connection,"restock_history"))) return jsonResponse(503,headers,{error:"Restock history table must exist before receiving stock."});
                if (!(await tableExists(connection,"inventory_movements")) ||
                    !(await tableExists(connection,"inventory_batches"))) {
                    return jsonResponse(503,headers,{error:"V2 inventory movement and batch tables are required."});
                }
                if (!(await tableExists(connection,"staff_stock_receipt_events"))) {
                    return jsonResponse(503,headers,{error:"Run the partial receiving SQL migration before recording receipts."});
                }
                await connection.beginTransaction();
                const [tasks] = await connection.execute(
                    `SELECT * FROM staff_stock_receiving_tasks WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                    [taskId,storeId,activeBranchId]);
                const task = tasks[0];
                if (!task) { await safeRollback(connection);return notFound(headers,"Receiving task unavailable."); }
                // Each partial receipt gets its own idempotency event. Retry with the same
                // requestKey returns success without increasing stock twice.
                const [existingReceipt] = await connection.execute(
                    `SELECT id, received_quantity AS receivedQuantity FROM staff_stock_receipt_events
                     WHERE store_id=? AND branch_id=? AND task_id=? AND request_key=? LIMIT 1`,
                    [storeId,activeBranchId,taskId,requestKey]);
                if (existingReceipt.length) {
                    await safeRollback(connection);
                    return jsonResponse(200,headers,{success:true,alreadyProcessed:true,
                        quantity:Number(existingReceipt[0].receivedQuantity)});
                }
                // Preserve idempotent retries for receipts completed before this migration.
                if (task.status === "received" && task.request_key === requestKey) {
                    await safeRollback(connection);
                    return jsonResponse(200,headers,{success:true,alreadyProcessed:true});
                }
                if (task.status !== "pending") {await safeRollback(connection);return jsonResponse(409,headers,{error:"This receiving task was already processed."});}
                const remaining = Number(task.authorized_quantity) - Number(task.received_quantity || 0);
                const quantity = body.receivedQuantity == null ? remaining : Number(body.receivedQuantity);
                const receivingNotes = toSafeString(body.receivingNotes,500);
                if (!Number.isSafeInteger(remaining) || remaining < 1 ||
                    !Number.isSafeInteger(quantity) || quantity < 1 || quantity > remaining) {
                    await safeRollback(connection);
                    return badRequest(headers,`Actual acceptable quantity must be between 1 and ${remaining}.`);
                }
                if (quantity < remaining && receivingNotes.length < 5) {
                    await safeRollback(connection);
                    return badRequest(headers,"Explain the partial delivery in at least 5 characters.");
                }
                const dateParts = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
                const part = kind => dateParts.find(p=>p.type===kind)?.value||"";
                const today = `${part("year")}-${part("month")}-${part("day")}`;
                if (task.expiration_date && new Date(task.expiration_date).toISOString().slice(0,10) < today) {
                    await safeRollback(connection);return jsonResponse(409,headers,{error:"The delivery's approved expiration date is now in the past. Ask the Manager to review the batch."});
                }
                const [products] = await connection.execute(
                    `SELECT id,name,has_variants,product_number,stock FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL FOR UPDATE`,
                    [task.product_id,storeId,activeBranchId]);
                if (!products.length) {await safeRollback(connection);return jsonResponse(409,headers,{error:"Product no longer active."});}
                const product = products[0];
                const variantId = task.variant_id == null ? null : Number(task.variant_id);
                const [inventory] = await connection.execute(
                    `SELECT id,quantity_on_hand,cost_price FROM branch_inventory
                     WHERE store_id=? AND branch_id=? AND product_id=? AND variant_id <=> ? AND status='active' LIMIT 1 FOR UPDATE`,
                    [storeId,activeBranchId,task.product_id,variantId]);
                if (!inventory.length) {await safeRollback(connection);return jsonResponse(409,headers,{error:"V2 inventory row missing; ask a manager to reconcile stock."});}
                const before = Number(inventory[0].quantity_on_hand);
                if (!Number.isSafeInteger(before) || before + quantity > 2147483647) {await safeRollback(connection);return badRequest(headers,"Stock quantity out of range.");}
                // Staff receipts also require consistent V2 balances. A missing
                // historical batch must be reconciled rather than masked by receipt.
                const [batchCounts]=await connection.execute(
                    `SELECT COALESCE(SUM(remaining_quantity),0) AS total
                     FROM inventory_batches WHERE branch_inventory_id=?`,[inventory[0].id]);
                if (Number(batchCounts[0]?.total||0)!==before) {
                    await safeRollback(connection);
                    return jsonResponse(409,headers,{error:"Inventory batch balance differs from branch stock. Ask the Manager to reconcile this product first."});
                }
                if (variantId !== null) {
                    const [v] = await connection.execute(`SELECT id,stock FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL FOR UPDATE`,[variantId,task.product_id]);
                    if (!v.length) {await safeRollback(connection);return jsonResponse(409,headers,{error:"Variant no longer available."});}
                    if (Number(v[0].stock)!==before || Number(product.stock)+quantity>2147483647) {await safeRollback(connection);return jsonResponse(409,headers,{error:"Inventory quantities need Manager reconciliation before receiving."});}
                    await connection.execute(`UPDATE product_variants SET stock=stock+? WHERE id=?`,[quantity,variantId]);
                }
                if (variantId === null && Number(product.stock)!==before) {
                    await safeRollback(connection);return jsonResponse(409,headers,{error:"Stock differs between POS and product inventory; ask the Manager to reconcile it."});
                }
                const [receiptEvent] = await connection.execute(
                    `INSERT INTO staff_stock_receipt_events
                     (store_id,branch_id,task_id,request_key,received_quantity,received_by,receiving_notes)
                     VALUES (?,?,?,?,?,?,?)`,
                    [storeId,activeBranchId,taskId,requestKey,quantity,staffId,receivingNotes || null]);
                const receiptEventId = Number(receiptEvent.insertId);
                await connection.execute(`UPDATE products SET stock=stock+? WHERE id=? AND store_id=? AND branch_id=?`,[quantity,task.product_id,storeId,activeBranchId]);
                await connection.execute(`UPDATE branch_inventory SET quantity_on_hand=quantity_on_hand+? WHERE id=?`,[quantity,inventory[0].id]);
                await connection.execute(
                    `INSERT INTO inventory_batches (store_id,branch_id,branch_inventory_id,batch_code,received_quantity,remaining_quantity,unit_cost,received_at,expiration_date,status)
                     VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,'active')`,
                    [storeId,activeBranchId,inventory[0].id,`STAFF-RCV-${task.id}-${receiptEventId}`.slice(0,100),quantity,quantity,Number(inventory[0].cost_price),task.expiration_date]);
                await connection.execute(
                    `INSERT INTO inventory_movements (store_id,branch_id,branch_inventory_id,movement_type,quantity_delta,quantity_before,quantity_after,
                                                      reference_type,reference_id,actor_id,actor_role,actor_name,notes)
                     VALUES (?,?,?,'STAFF_RECEIPT',?,?,?,'STAFF_RECEIVING_TASK',?,?,?,?,?)`,
                    [storeId,activeBranchId,inventory[0].id,quantity,before,before+quantity,String(task.id),staffId,"staff",employee.name,`Delivery: ${task.delivery_reference}${receivingNotes ? `; ${receivingNotes}` : ""}`]);
                const variantName = variantId != null ? `Variant ${variantId}` : null;
                await connection.execute(
                    `INSERT INTO restock_history (store_id,branch_id,product_id,product_name,variant_name,stock_before,quantity_added,current_stock,received_by)
                     VALUES (?,?,?,?,?,?,?,?,?)`,
                    [storeId,activeBranchId,task.product_id,product.name,variantName,before,quantity,before+quantity,employee.name]);
                await connection.execute(
                    `UPDATE staff_stock_receiving_tasks
                     SET received_quantity=received_quantity+?,
                         status=CASE WHEN received_quantity+?>=authorized_quantity THEN 'received' ELSE 'pending' END,
                         received_by=?,received_at=CURRENT_TIMESTAMP,request_key=?,last_receiving_notes=?
                     WHERE id=?`,
                    [quantity,quantity,staffId,requestKey,receivingNotes || null,taskId]);
                await assertInventoryLineSynchronized(connection,{
                    storeId,branchId:activeBranchId,productId:task.product_id,variantId,
                    expected:before+quantity});
                await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,module:"Inventory",
                    referenceNumber:product.product_number,action:"Received authorized stock",referenceId:String(taskId),
                    details:`Received ${quantity} units of ${product.name} for delivery ${task.delivery_reference}; ${remaining-quantity} pending${receivingNotes ? `; ${receivingNotes}` : ""}`});
                await connection.commit();
                return jsonResponse(200,headers,{success:true,quantity,reference:task.delivery_reference,
                    remainingQuantity:remaining-quantity,completed:quantity===remaining});
            }

            if (action === "report_staff_stock_condition") {
                if (!["staff","manager"].includes(tokenRole)) return unauthorized(headers,"Only branch operations may report product conditions.");
                const {productId,variantId,valid}=itemIdentity();
                const issueType=String(body.issueType || "").trim().toLowerCase();
                const notes=toSafeString(body.notes,500);
                if (!valid || !["expired","expiring","damaged"].includes(issueType) || notes.length<5)
                    return badRequest(headers,"Select a product, valid issue type, and at least 5 characters of notes.");
                await connection.beginTransaction();
                const [products] = await connection.execute(
                    `SELECT id,has_variants,expiration_date,product_number,name FROM products
                     WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL FOR UPDATE`,
                    [productId,storeId,activeBranchId]);
                if (!products.length) {await safeRollback(connection);return notFound(headers,"Product not in this branch.");}
                if (Boolean(products[0].has_variants)!==(variantId!==null)) {await safeRollback(connection);return badRequest(headers,"Select the correct product variant.");}
                let expiry=products[0].expiration_date;
                if (variantId!==null) {
                    const [variants]=await connection.execute(`SELECT id,expiration_date FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`,[variantId,productId]);
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
                const [duplicate]=await connection.execute(
                    `SELECT id FROM staff_stock_condition_reports WHERE store_id=? AND branch_id=? AND product_id=?
                                                                    AND variant_id <=> ? AND issue_type=? AND status='open' LIMIT 1`,
                    [storeId,activeBranchId,productId,variantId,issueType]);
                if (duplicate.length) {await safeRollback(connection);return jsonResponse(409,headers,{error:"This product condition is already reported and awaiting review."});}
                const [created] = await connection.execute(
                    `INSERT INTO staff_stock_condition_reports
                     (store_id,branch_id,product_id,variant_id,issue_type,notes,reported_by)
                     VALUES (?,?,?,?,?,?,?)`,
                    [storeId,activeBranchId,productId,variantId,issueType,notes,employee.id]);
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
                    `UPDATE staff_stock_condition_reports SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP
                     WHERE id=? AND store_id=? AND branch_id=? AND status='open'`,
                    [employee.id,reportId,storeId,activeBranchId]);
                if (!updated.affectedRows) return notFound(headers,"Report already resolved or unavailable.");
                return jsonResponse(200,headers,{success:true});
            }
            if (action === "report_staff_stock_shortage") {
                if (tokenRole !== "staff" && tokenRole !== "manager") return unauthorized(headers,"Not permitted.");
                const {productId,variantId,valid} = itemIdentity();
                const notes=toSafeString(body.notes,500);
                if (!valid || notes.length < 5) return badRequest(headers,"Select an item and enter at least 5 characters of notes.");
                const [products] = await connection.execute(`SELECT id,stock,alert_level,has_variants,product_number,name FROM products
                                                             WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL`,[productId,storeId,activeBranchId]);
                if (!products.length) return notFound(headers,"Product not in your branch.");
                let stock=Number(products[0].stock),reorder=Number(products[0].alert_level);
                if (products[0].has_variants) {
                    if (variantId == null) return badRequest(headers,"Select the specific variant.");
                    const [v] = await connection.execute(`SELECT stock,alert_level FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`,[variantId,productId]);
                    if (!v.length) return badRequest(headers,"Variant unavailable.");
                    stock=Number(v[0].stock);reorder=Number(v[0].alert_level);
                } else if (variantId != null) return badRequest(headers,"This product does not have variants.");
                try {
                    await connection.beginTransaction();
                    const [insert] = await connection.execute(`INSERT INTO staff_stock_shortage_reports
                                                               (store_id,branch_id,product_id,variant_id,stock_snapshot,reorder_snapshot,notes,reported_by)
                                                               VALUES (?,?,?,?,?,?,?,?)`,[storeId,activeBranchId,productId,variantId,stock,reorder,notes,employee.id]);
                    await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,module:"Inventory",
                        referenceNumber:products[0].product_number,action:"Reported stock shortage",referenceId:String(insert.insertId),details:notes});
                    await connection.commit();
                } catch(err) {await safeRollback(connection);if(err?.code === "ER_DUP_ENTRY") return jsonResponse(409,headers,{error:"A shortage report is already open for this item."});throw err;}
                return jsonResponse(201,headers,{success:true});
            }
            if (action === "resolve_staff_stock_shortage") {
                if (!["manager","owner"].includes(tokenRole)) return unauthorized(headers,"Manager authorization required.");
                const reportId=Number(body.reportId);
                if (!Number.isSafeInteger(reportId)||reportId<1) return badRequest(headers,"A valid shortage report is required.");
                const [result] = await connection.execute(`UPDATE staff_stock_shortage_reports SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP
                                                           WHERE id=? AND store_id=? AND branch_id=? AND status='open'`,[employee.id,reportId,storeId,activeBranchId]);
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
            if (!(await tableExists(connection, "inventory_stock_receipts")) ||
                !(await tableExists(connection, "inventory_stock_receipt_items")) ||
                !(await tableExists(connection, "inventory_purchase_transactions"))) {
                return jsonResponse(200, headers, { success: true, stockInMovements: [] });
            }
            const hasCreatedAt = await tableHasColumn(connection, "inventory_stock_receipts", "created_at");
            const dateExpression = hasCreatedAt ? "r.created_at" : "r.received_date";
            const displayDate = hasCreatedAt ? "r.created_at" : "DATE_FORMAT(r.received_date, '%Y-%m-%d')";
            const [rows] = await connection.execute(
                `SELECT ri.product_id AS productId,
                        COALESCE(p.name, 'Archived Product') AS productName,
                        ri.variant_name AS variantName,
                        ri.quantity_received AS quantity,
                        ${displayDate} AS recordedAt,
                        pt.purchase_number AS purchaseNumber,
                        pt.source AS purchaseSource
                 FROM inventory_stock_receipt_items ri
                          INNER JOIN inventory_stock_receipts r ON r.id = ri.receipt_id
                          LEFT JOIN inventory_purchase_transactions pt
                                    ON pt.id = r.purchase_id AND pt.store_id = r.store_id
                                        AND pt.branch_id = r.branch_id
                          LEFT JOIN products p ON p.id = ri.product_id AND p.store_id = r.store_id
                     AND p.branch_id = r.branch_id
                 WHERE r.store_id = ? AND r.branch_id = ?
                   AND ri.quantity_received > 0
                   AND ${dateExpression} >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                 ORDER BY ${dateExpression} DESC, ri.id DESC
                     LIMIT 500`,
                [storeId, activeBranchId]
            );
            return jsonResponse(200, headers, { success: true, stockInMovements: rows });
        }

        // Read-only, branch-scoped date lookup for Manager Inventory's
        // "Last Stock In" column. Only positive stock increases qualify.
        if (action === "get_last_stock_in") {
            if (!activeBranchId) return badRequest(headers, "A branch is required.");
            if (!(await tableExists(connection, "restock_history")) ||
                !(await tableExists(connection,"inventory_stock_receipts"))) {
                return jsonResponse(200, headers, { success: true, stockInRecords: [] });
            }
            const [rows] = await connection.execute(
                `SELECT events.productId, events.variantId, events.variantName,
                        DATE_FORMAT(MAX(events.stockInDate),'%Y-%m-%d') AS stockInDate
                 FROM (
                          SELECT rh.product_id AS productId, CAST(NULL AS SIGNED) AS variantId,
                                 rh.variant_name AS variantName,
                                 COALESCE(rh.received_date,DATE(rh.created_at)) AS stockInDate,
                                 rh.store_id AS storeId,rh.branch_id AS branchId
                          FROM restock_history rh WHERE rh.quantity_added>0
                          UNION ALL
                          SELECT ri.product_id AS productId,ri.variant_id AS variantId,
                                 ri.variant_name AS variantName,r.received_date AS stockInDate,
                                 r.store_id AS storeId,r.branch_id AS branchId
                          FROM inventory_stock_receipt_items ri
                                   JOIN inventory_stock_receipts r ON r.id=ri.receipt_id
                          WHERE ri.quantity_received>0
                      ) AS events
                          JOIN products p ON p.id=events.productId AND p.store_id=events.storeId
                     AND p.branch_id=events.branchId AND p.deleted_at IS NULL
                 WHERE events.storeId=? AND events.branchId=?
                   AND events.stockInDate <= CURRENT_DATE()
                 GROUP BY events.productId,events.variantId,events.variantName`,
                [storeId,activeBranchId]
            );
            // An Added movement must show the quantity actually received when
            // the product was created, never the current stock after POS sales.
            // Each Add Product / Import purchase stores its original item units.
            let initialStockQuantities = [];
            if (await tableExists(connection, "inventory_purchase_transactions") &&
                await tableExists(connection, "inventory_purchase_items")) {
                const [initialRows] = await connection.execute(
                    `SELECT pi.product_id AS productId,
                            SUM(pi.quantity_ordered) AS initialQuantity
                     FROM inventory_purchase_items pi
                              JOIN inventory_purchase_transactions pt ON pt.id = pi.purchase_id
                              JOIN products p ON p.id = pi.product_id
                     WHERE pt.store_id = ? AND pt.branch_id = ?
                       AND pt.source IN ('add', 'import')
                       AND p.store_id = ? AND p.branch_id = ?
                       AND p.deleted_at IS NULL
                     GROUP BY pi.product_id`,
                    [storeId, activeBranchId, storeId, activeBranchId]
                );
                initialStockQuantities = initialRows;
            }
            return jsonResponse(200, headers, { success: true, stockInRecords: rows, initialStockQuantities });
        }


        if (action === "get_stock_suppliers") {
            if (!["owner", "manager"].includes(tokenRole)) {
                return unauthorized(headers, "Supplier purchasing information is restricted to Managers and Owners.");
            }
            if (!activeBranchId) return badRequest(headers, "A branch is required.");
            const suppliers = new Set();
            for (const table of ["inventory_initial_purchases", "inventory_stock_receipts"]) {
                if (!(await tableExists(connection, table))) continue;
                const [rows] = await connection.execute(
                    `SELECT DISTINCT supplier FROM ${table}
                     WHERE store_id = ? AND branch_id = ? AND supplier IS NOT NULL`,
                    [storeId, activeBranchId]);
                for (const row of rows) {
                    if (String(row.supplier || "").trim()) suppliers.add(String(row.supplier).trim());
                }
            }
            return jsonResponse(200, headers, { success: true, suppliers: [...suppliers].sort() });
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
            if (!(await tableExists(connection, "inventory_purchase_transactions")) ||
                !(await tableExists(connection, "inventory_stock_receipts")) ||
                !(await tableExists(connection, "inventory_stock_receipt_items"))) {
                return badRequest(headers, "Run the Receive Stock SQL migration before receiving stock.");
            }
            try { await requireSynchronizedInventoryTables(connection); }
            catch (error) { return jsonResponse(503,headers,{error:error.message}); }
            const requestKey = toSafeString(body.requestKey, 80);
            if (!requestKey) return badRequest(headers, "Receiving request key is required to prevent duplicate stock receipts.");
            await connection.beginTransaction();
            // Lock the parent product to serialize concurrent receives for it.
            const [lockedProducts] = await connection.execute(
                `SELECT id, name, has_variants, product_number, stock,
                        original_price, sales_price, pricing_method, markup_percentage, alert_level FROM products
                 WHERE id = ? AND store_id = ? AND branch_id = ? AND deleted_at IS NULL
                     FOR UPDATE`, [productId, storeId, activeBranchId]);
            if (!lockedProducts.length) { await safeRollback(connection); return notFound(headers, "Product not found."); }
            const [previous] = await connection.execute(
                `SELECT id, purchase_id AS purchaseId FROM inventory_stock_receipts
                 WHERE store_id=? AND branch_id=? AND request_key=? LIMIT 1`,
                [storeId, activeBranchId, requestKey]);
            if (previous.length) {
                await connection.commit();
                return jsonResponse(200, headers, {success:true, alreadyProcessed:true,
                    receiptId:previous[0].id, purchaseId:previous[0].purchaseId});
            }
            const current = lockedProducts[0];
            const isVariantProduct = Number(current.has_variants) === 1;
            const variants = new Map();
            if (isVariantProduct) {
                const [rows] = await connection.execute(
                    `SELECT id, stock, variant_values, original_price, sales_price, alert_level,
                            pricing_method, markup_percentage FROM product_variants
                     WHERE product_id = ? AND deleted_at IS NULL FOR UPDATE`, [productId]);
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
                // Moving weighted average uses units still on hand, NOT the
                // entire history of purchases. Original receipt unit costs are
                // preserved in inventory_stock_receipt_items for auditing.
                const averageCost = roundMoney((currentStock * oldAverageCost +
                    line.quantity * line.unitPurchaseCost) / (currentStock + line.quantity));
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
            const receiptId = ledger.receiptId;
            const purchaseId = ledger.purchaseId;
            const totalQuantity = cleanLines.reduce((sum, line) => sum + line.quantity, 0);
            // Lock and credit V2 quantities BEFORE changing catalog stock; any
            // mismatch rolls the entire financial receipt and stock change back.
            const actingEmployee = await getActingEmployee(connection, decoded, tokenRole, storeId);
            for (const [lineIndex,line] of receiptLines.entries()) {
                const match = isVariantProduct ? variants.get(line.variantId) : current;
                await creditBranchInventoryBatch(connection,{
                    storeId,branchId:activeBranchId,productId,variantId:line.variantId,
                    quantity:line.quantity,expectedBefore:line.stockBefore,
                    reorderLevel:Number(match.alert_level ?? match.alertLevel ?? current.alert_level ?? 0),
                    costPrice:line.averageCost,salesPrice:line.selectedPrice,
                    expirationDate:line.expirationDate,
                    reference:`RCV-${receiptId}-${lineIndex + 1}`,
                    actorId:Number(decoded?.manager_id||decoded?.owner_id||0)||null,
                    actorRole:tokenRole,actorName:actingEmployee.name,
                });
            }
            for (const line of receiptLines) {
                if (line.variantId !== null) {
                    await connection.execute(
                        `UPDATE product_variants
                         SET stock = stock + ?, original_price = ?, sales_price = ?,
                             pricing_method = ?, markup_percentage = ?
                         WHERE id = ? AND product_id = ? AND deleted_at IS NULL`,
                        [line.quantity, line.averageCost, line.selectedPrice,
                            line.selectedMethod, line.selectedMarkup, line.variantId, productId]);
                }
                await connection.execute(
                    `INSERT INTO restock_history
                     (store_id, branch_id, product_id, product_name, variant_name,
                      stock_before, quantity_added, current_stock, received_by, received_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [storeId, activeBranchId, productId, toSafeString(current.name), line.variantName,
                        line.stockBefore, line.quantity, line.stockBefore + line.quantity,
                        receivedBy, receivedDate]);
            }
            if (isVariantProduct) {
                // Parent product's display prices follow the updated variant rows.
                // Preserve its existing pricing method: variant pricing is individual.
                const [updatedVariants] = await connection.execute(
                    `SELECT original_price, sales_price FROM product_variants
                     WHERE product_id = ? AND deleted_at IS NULL`, [productId]);
                const minimumPositive = (field) => {
                    const prices = updatedVariants.map(row => Number(row[field]))
                        .filter(price => Number.isFinite(price) && price > 0);
                    return prices.length ? Math.min(...prices) : 0;
                };
                await connection.execute(
                    `UPDATE products SET stock = stock + ?, original_price = ?, sales_price = ?
                     WHERE id = ? AND store_id = ? AND branch_id = ?`,
                    [totalQuantity, minimumPositive("original_price"), minimumPositive("sales_price"),
                        productId, storeId, activeBranchId]);
            } else {
                const line = receiptLines[0];
                await connection.execute(
                    `UPDATE products SET stock = stock + ?, original_price = ?, sales_price = ?,
                                         pricing_method = ?, markup_percentage = ?
                     WHERE id = ? AND store_id = ? AND branch_id = ?`,
                    [totalQuantity, line.averageCost, line.selectedPrice, line.selectedMethod,
                        line.selectedMarkup, productId, storeId, activeBranchId]);
            }
            for (const line of receiptLines) {
                await assertInventoryLineSynchronized(connection,{
                    storeId,branchId:activeBranchId,productId,variantId:line.variantId,
                    expected:line.stockBefore+line.quantity});
            }
            await logEmployeeAction(connection, {
                storeId, branchId: activeBranchId, employee: actingEmployee,
                module: "Inventory", referenceNumber: current.product_number || String(productId),
                action: "Restocked inventory", referenceId: String(productId),
                details: `Received ${totalQuantity} unit(s) of ${current.name} from ${supplier} (Receipt #${receiptId})`,
            });
            await connection.commit();
            return jsonResponse(200, headers, {
                success: true, receiptId, purchaseId, receivingNumber:`RCV-${String(receiptId).padStart(6,"0")}`,
                totalQuantity, purchaseTotal: ledger.purchaseTotal,
                amountPaid: ledger.amountPaid,
                outstandingBalance: ledger.outstandingBalance,
            });
        }

        if (action === "get_supplier_payables") {
            // Owners can view all of their store's branches. Managers stay
            // restricted to the assigned branch from their verified token.
            if (!["owner", "manager"].includes(tokenRole)) return unauthorized(headers, "Not permitted.");
            const branchSql = activeBranchId ? " AND p.branch_id=?" : "";
            const branchParams = activeBranchId ? [activeBranchId] : [];
            const [rows] = await connection.execute(
                `SELECT p.id AS purchaseId, p.branch_id AS branchId,
                        b.branch_name AS branchName, p.purchase_number AS purchaseNumber,
                        p.supplier, p.supplier_invoice_number AS supplierInvoiceNumber,
                        p.purchase_total AS purchaseTotal, p.payment_method AS paymentMethod,
                        DATE_FORMAT(p.purchase_date,'%Y-%m-%d') AS purchaseDate,
                        DATE_FORMAT(p.payment_due_date,'%Y-%m-%d') AS paymentDueDate,
                        COALESCE((SELECT SUM(pay.amount) FROM inventory_supplier_payments pay
                                  WHERE pay.purchase_id=p.id),0) AS amountPaid
                 FROM inventory_purchase_transactions p
                          LEFT JOIN branches b ON b.id=p.branch_id AND b.store_id=p.store_id
                 WHERE p.store_id=?${branchSql}
                 ORDER BY p.id DESC`, [storeId, ...branchParams]);
            const payables=rows.map(row=>({...row, purchaseTotal:Number(row.purchaseTotal),amountPaid:Number(row.amountPaid),
                outstandingBalance:Math.max(0,roundMoney(Number(row.purchaseTotal)-Number(row.amountPaid))),
                paymentStatus:Number(row.amountPaid)>=Number(row.purchaseTotal)?"Paid":Number(row.amountPaid)>0?"Partially Paid":"Unpaid"}));
            return jsonResponse(200,headers,{success:true,payables});
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
            const purchaseId=Number(body.purchaseId);
            if(!Number.isInteger(purchaseId)||purchaseId<=0)return badRequest(headers,"Valid purchase ID required.");
            const branchSql=activeBranchId?" AND branch_id=?":"";
            const branchParams=activeBranchId?[activeBranchId]:[];
            const [headersFound]=await connection.execute(
                `SELECT id,purchase_number AS purchaseNumber,supplier,purchase_total AS purchaseTotal
                 FROM inventory_purchase_transactions
                 WHERE id=? AND store_id=?${branchSql} LIMIT 1`,
                [purchaseId,storeId,...branchParams]);
            if(!headersFound.length)return notFound(headers,"Purchase not found in this store/branch.");
            const [rows]=await connection.execute(
                `SELECT pi.product_id AS productId,p.product_number AS productNumber,
                        COALESCE(p.name,'Archived product') AS productName,
                        pi.variant_id AS variantId, v.variant_number AS variantNumber,v.variant_values AS variantValues,
                        pi.quantity_ordered AS quantity,pi.unit_purchase_cost AS unitCost,
                        (pi.quantity_ordered*pi.unit_purchase_cost) AS lineTotal
                 FROM inventory_purchase_items pi
                          LEFT JOIN products p ON p.id=pi.product_id AND p.store_id=?
                          LEFT JOIN product_variants v ON v.id=pi.variant_id AND v.product_id=pi.product_id
                 WHERE pi.purchase_id=? ORDER BY pi.id`,[storeId,purchaseId]);
            return jsonResponse(200,headers,{success:true,purchase:headersFound[0],items:rows.map(row=>({
                    ...row,quantity:Number(row.quantity),unitCost:Number(row.unitCost),lineTotal:roundMoney(Number(row.lineTotal)),
                    variantValues:parseVariantValues(row.variantValues)
                }))});
        }
        if (action === "pay_supplier_purchase") {
            if (!["owner", "manager"].includes(tokenRole)) return unauthorized(headers,"Not permitted.");
            const purchaseId=Number(body.purchaseId), requestKey=toSafeString(body.requestKey,80);
            if (!Number.isInteger(purchaseId) || purchaseId<=0 || !requestKey) return badRequest(headers,"Purchase and payment reference required.");
            let amountCents,date;
            try {amountCents=exactMoney(body.amount,"Amount paid");date=normalizeOptionalDate(body.paymentDate);}
            catch(error) {return badRequest(headers,error.message);}
            if (amountCents<=0 || !date) return badRequest(headers,"Positive payment and payment date are required.");
            if (date > new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Manila"})) {
                return badRequest(headers,"Payment Date cannot be in the future.");
            }
            const branchSql=activeBranchId?" AND branch_id=?":"";
            const branchParams=activeBranchId?[activeBranchId]:[];
            await connection.beginTransaction();
            const [rows]=await connection.execute(
                `SELECT id,purchase_total AS purchaseTotal FROM inventory_purchase_transactions
                 WHERE id=? AND store_id=?${branchSql} FOR UPDATE`,[purchaseId,storeId,...branchParams]);
            if (!rows.length){await safeRollback(connection);return notFound(headers,"Purchase not found.");}
            const [existingPayment]=await connection.execute(
                `SELECT id FROM inventory_supplier_payments WHERE purchase_id=? AND request_key=? LIMIT 1`,[purchaseId,requestKey]);
            if (existingPayment.length){await connection.commit();return jsonResponse(200,headers,{success:true,alreadyProcessed:true});}
            const [paidRows]=await connection.execute(
                `SELECT COALESCE(SUM(amount),0) AS amountPaid FROM inventory_supplier_payments WHERE purchase_id=?`,[purchaseId]);
            const balanceCents=exactMoney(rows[0].purchaseTotal,"Purchase total")-exactMoney(paidRows[0].amountPaid,"Amount paid");
            if (amountCents>balanceCents){await safeRollback(connection);return badRequest(headers,"Payment exceeds remaining balance.");}
            await connection.execute(`INSERT INTO inventory_supplier_payments (purchase_id,amount,payment_date,request_key)
                                      VALUES (?,?,?,?)`,[purchaseId,amountCents/100,date,requestKey]);
            await connection.commit();
            return jsonResponse(200,headers,{success:true,outstandingBalance:(balanceCents-amountCents)/100});
        }

        if (action === "adjust_stock") {
            if (!["owner","manager"].includes(tokenRole) || !activeBranchId) return unauthorized(headers,"Not permitted.");
            const productId=Number(body.productId), variantId=body.variantId==null?null:Number(body.variantId);
            const expected=Number(body.expectedStock), target=Number(body.newStock);
            const reason=toSafeString(body.reason,500),requestKey=toSafeString(body.requestKey,80);
            if(!Number.isInteger(productId)||productId<=0 || (variantId!==null && (!Number.isInteger(variantId)||variantId<=0)) ||
                !Number.isInteger(expected)||expected<0||!Number.isInteger(target)||target<0 || target>2147483647 ||
                reason.length<8 || !requestKey) return badRequest(headers,"Provide valid current/corrected stock, a reason of at least 8 characters, and a request reference.");
            // Use the existing structured adjustment ledger when available;
            // otherwise log the correction in the existing employee_actions
            // audit history. No additional table is required for this change.
            const hasAdjustmentLedger = await tableExists(connection, "inventory_stock_adjustments");
            await connection.beginTransaction();
            const [products]=await connection.execute(
                `SELECT id,name,product_number AS productNumber,stock,has_variants AS hasVariants FROM products
                 WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL FOR UPDATE`,
                [productId,storeId,activeBranchId]);
            if(!products.length){await safeRollback(connection);return notFound(headers,"Product not found in this branch.");}
            const p=products[0];
            if (hasAdjustmentLedger) {
                const [duplicates] = await connection.execute(
                    "SELECT id,stock_after AS newStock FROM inventory_stock_adjustments WHERE store_id=? AND branch_id=? AND request_key=? LIMIT 1",
                    [storeId,activeBranchId,requestKey]);
                if (duplicates.length) {await connection.commit();return jsonResponse(200,headers,{success:true,alreadyProcessed:true,newStock:Number(duplicates[0].newStock)});}
            }
            let current, aggregateStock=target;
            if(Boolean(p.hasVariants)) {
                if(variantId===null){await safeRollback(connection);return badRequest(headers,"Select a specific variant to adjust.");}
                const [variants]=await connection.execute(
                    `SELECT id,stock FROM product_variants WHERE product_id=? AND deleted_at IS NULL ORDER BY id FOR UPDATE`,[productId]);
                const selected=variants.find(row=>Number(row.id)===variantId);
                if(!selected){await safeRollback(connection);return badRequest(headers,"Variant not found.");}
                current=Number(selected.stock);
                aggregateStock=variants.reduce((sum,row)=>sum+Number(row.id===variantId?target:row.stock),0);
            }else{
                if(variantId!==null){await safeRollback(connection);return badRequest(headers,"This product has no variants.");}
                current=Number(p.stock);
            }
            if(current!==expected){await safeRollback(connection);return badRequest(headers,`Stock changed since opening this dialog (now ${current}). Reopen and retry.`);}
            if(target===current){await safeRollback(connection);return badRequest(headers,"Corrected quantity must differ from current stock.");}
            if(aggregateStock>2147483647){await safeRollback(connection);return badRequest(headers,"Total stock would exceed the supported limit.");}
            // Reconcile the V2 count and expiration-aware batch ledger in the
            // very same transaction. Fail closed on pre-existing drift.
            const employee=await getActingEmployee(connection,decoded,tokenRole,storeId);
            const [priceInfo]=await connection.execute(
                variantId!==null
                    ? `SELECT original_price AS cost FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL`
                    : `SELECT original_price AS cost FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL`,
                variantId!==null?[variantId,productId]:[productId,storeId,activeBranchId]);
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
            await adjustSynchronizedStock(connection,{storeId,branchId:activeBranchId,productId,variantId,
                before:current,target,requestKey,costPrice:Number(priceInfo[0].cost),
                expirationDate:correctionExpiry||null,employee,reason});
            // A correction is never a purchase receipt or POS sale.
            if(variantId!==null) await connection.execute("UPDATE product_variants SET stock=? WHERE id=? AND product_id=?",[target,variantId,productId]);
            await connection.execute("UPDATE products SET stock=? WHERE id=? AND store_id=? AND branch_id=?",[aggregateStock,productId,storeId,activeBranchId]);
            if (hasAdjustmentLedger) {
                await connection.execute(
                    `INSERT INTO inventory_stock_adjustments
                     (store_id,branch_id,product_id,variant_id,stock_before,stock_after,quantity_change,reason,employee_name,employee_role,request_key)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                    [storeId,activeBranchId,productId,variantId,current,target,target-current,reason,employee.name,employee.role,requestKey]);
            }
            await assertInventoryLineSynchronized(connection,{
                storeId,branchId:activeBranchId,productId,variantId,expected:target});
            await logEmployeeAction(connection,{storeId,branchId:activeBranchId,employee,
                module:"Inventory",referenceNumber:p.productNumber||String(productId),action:"Corrected stock level",referenceId:String(productId),
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
            const canonical = await findCanonicalInitialPurchase(connection, storeId, Number(product.branchId), productId);
            if (canonical) {
                return jsonResponse(200,headers,{purchase:tokenRole==="owner"?canonical:{
                        supplier:canonical.supplier,purchaseDate:canonical.purchaseDate,paymentMethod:canonical.paymentMethod}});
            }
            if (!(await tableExists(connection, "inventory_initial_purchases"))) {
                return jsonResponse(200, headers, { purchase: null });
            }
            const [rows] = await connection.execute(
                `SELECT supplier,
                        DATE_FORMAT(purchase_date, '%Y-%m-%d') AS purchaseDate,
                        payment_method AS paymentMethod,
                        purchase_total AS purchaseTotal,
                        amount_paid AS amountPaid,
                        outstanding_balance AS outstandingBalance,
                        DATE_FORMAT(payment_due_date, '%Y-%m-%d') AS paymentDueDate
                 FROM inventory_initial_purchases
                 WHERE store_id = ? AND branch_id = ? AND product_id = ? LIMIT 1`,
                [storeId, Number(product.branchId), productId]
            );
            const row = rows[0];
            if (!row) return jsonResponse(200, headers, { purchase: null });
            const purchase = tokenRole === "owner" ? {
                supplier: row.supplier, purchaseDate: row.purchaseDate,
                paymentMethod: row.paymentMethod,
                purchaseTotal: Number(row.purchaseTotal),
                amountPaid: Number(row.amountPaid),
                outstandingBalance: Number(row.outstandingBalance),
                paymentDueDate: row.paymentDueDate,
            } : {
                supplier: row.supplier, purchaseDate: row.purchaseDate,
                paymentMethod: row.paymentMethod,
            };
            return jsonResponse(200, headers, { purchase });
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
                if (!(await tableExists(connection,"inventory_purchase_transactions"))) {
                    throw new Error("Run the transaction-based inventory SQL migration before importing.");
                }
                await connection.beginTransaction();
                await connection.execute("SELECT id FROM branches WHERE id = ? AND store_id = ? FOR UPDATE", [activeBranchId, storeId]);
                const {storeCode, branchCode} = await getProductCodeContext(connection, storeId, activeBranchId);
                const actingEmployee = await getActingEmployee(connection, decoded, tokenRole, storeId);
                // Only older multi-purchase imports carry user-entered refs.
                // New one-purchase imports have no manual import reference.
                for (const invoice of purchases.values()) {
                    if (singlePurchaseMode) continue;
                    const [existingRefs] = await connection.execute(
                        `SELECT id FROM inventory_purchase_transactions
                         WHERE store_id = ? AND branch_id = ? AND source='import' AND LOWER(import_ref) = ? LIMIT 1`,
                        [storeId, activeBranchId, invoice.ref.toLowerCase()]
                    );
                    if (existingRefs.length) throw new Error(`Purchase Ref ${invoice.ref} already exists in this branch.`);
                }
                const created = [];
                const pendingInvoices = new Map();
                for (const item of clean) {
                    if (await findExistingProductByName(connection, storeId, activeBranchId, item.name)) {
                        throw new Error(`Product "${item.name}" already exists in this branch.`);
                    }
                    const sequence = await reserveNextProductSequence(connection, storeId, activeBranchId);
                    const productNumber = buildProductNumber(storeCode, branchCode, sequence);
                    const [insert] = await connection.execute(
                        `INSERT INTO products (product_number, store_id, branch_id, package_id, package_name,
                                               name, category, stock, alert_level, original_price, sales_price,
                                               pricing_method, markup_percentage, expiration_date, has_variants)
                         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [productNumber, storeId, activeBranchId, item.name, item.category, item.stock,
                            item.alertLevel, item.cost, item.price, item.pricing.pricingMethod,
                            item.pricing.markupPercentage, item.expirationDate, item.hasVariants ? 1 : 0]
                    );
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
                        ? (await connection.execute(
                            `SELECT id,stock,alert_level AS alertLevel,original_price AS originalPrice,
                                    sales_price AS salesPrice,expiration_date AS expirationDate
                             FROM product_variants WHERE product_id=? AND deleted_at IS NULL ORDER BY id`,
                            [saved.id]))[0] : [];
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
            if (initialPurchase && !(await tableExists(connection,"inventory_purchase_transactions"))) {
                return badRequest(headers,"Run the transaction-based inventory migration before saving supplier stock.");
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
            const productNumber = buildProductNumber(
                storeCode,
                branchCode,
                nextProductSequence
            );

            const [result] = await connection.execute(
                `INSERT INTO products
                 (product_number, store_id, branch_id, package_id, package_name, name, category, stock, alert_level, original_price, sales_price, pricing_method, markup_percentage, expiration_date, has_variants)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    productNumber,
                    storeId,
                    activeBranchId,
                    packageId,
                    packageName || null,
                    name,
                    category,
                    stock,
                    alertLevel,
                    originalPrice,
                    salesPrice,
                    pricing.pricingMethod,
                    pricing.markupPercentage,
                    expirationDate,
                    hasVariants ? 1 : 0,
                ]
            );

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
            const savedOpeningVariants=hasVariants ? (await connection.execute(
                `SELECT id,stock,alert_level AS alertLevel,original_price AS originalPrice,
                        sales_price AS salesPrice,expiration_date AS expirationDate
                 FROM product_variants WHERE product_id=? AND deleted_at IS NULL ORDER BY id`,
                [productId]))[0] : [];
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
            await connection.execute("SELECT id FROM products WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE",
                [id,storeId,Number(existing.branchId)]);
            if (hasVariants) {
                const [lockedVariants]=await connection.execute(
                    "SELECT id,stock FROM product_variants WHERE product_id=? AND deleted_at IS NULL FOR UPDATE",[id]);
                const lockedMap=new Map(lockedVariants.map(v=>[Number(v.id),Number(v.stock)]));
                if (existingVariants.some(v=>lockedMap.get(Number(v.id))!==Number(v.stock))) {
                    await safeRollback(connection);
                    return badRequest(headers,"Stock changed while you were editing. Reload and try again.");
                }
            } else {
                const [lockedProducts]=await connection.execute("SELECT stock FROM products WHERE id=? FOR UPDATE",[id]);
                if (!lockedProducts.length || Number(lockedProducts[0].stock)!==stableStock) {
                    await safeRollback(connection);
                    return badRequest(headers,"Stock changed while you were editing. Reload and try again.");
                }
            }

            let purchaseChangeLog = "";
            if (editPurchaseDetails != null) {
                const branchForEdit = Number(existing.branchId);
                const canonical = await findCanonicalInitialPurchase(connection, storeId, branchForEdit, id);
                if (canonical) {
                    // Lock one shared purchase header. Editing a shared import updates the
                    // purchase ONCE, never one balance per product.
                    const [lockedPurchases] = await connection.execute(
                        `SELECT id,purchase_number AS purchaseNumber,purchase_total AS purchaseTotal,
                                supplier,supplier_invoice_number AS invoiceNumber,
                                DATE_FORMAT(purchase_date,'%Y-%m-%d') AS purchaseDate,
                                payment_method AS paymentMethod,
                                DATE_FORMAT(payment_due_date,'%Y-%m-%d') AS dueDate
                         FROM inventory_purchase_transactions
                         WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [canonical.purchaseId,storeId,branchForEdit]);
                    if (!lockedPurchases.length) {
                        await safeRollback(connection);
                        return badRequest(headers,"The original purchase was changed. Reopen Edit Product.");
                    }
                    const original = lockedPurchases[0];
                    let revised;
                    try {
                        revised = getInitialPurchaseInput({initialPurchase:editPurchaseDetails},
                            stableStock,originalPrice,incomingVariants,Number(original.purchaseTotal));
                    } catch (error) {
                        await safeRollback(connection);
                        return badRequest(headers,error.message);
                    }
                    const [paymentRows] = await connection.execute(
                        `SELECT id,amount,request_key FROM inventory_supplier_payments
                         WHERE purchase_id=? ORDER BY id FOR UPDATE`,[original.id]);
                    const currentPaidCents = paymentRows.reduce((sum,row)=>sum+Math.round(Number(row.amount)*100),0);
                    const targetPaidCents = exactMoney(revised.amountPaid,"Amount Paid");
                    if (editPurchaseDetails.expectedAmountPaid !== undefined &&
                        exactMoney(editPurchaseDetails.expectedAmountPaid,"Previously Recorded Amount Paid") !== currentPaidCents) {
                        await safeRollback(connection);
                        return badRequest(headers,"Supplier payments have changed since you opened Edit Product. Reopen the dialog before saving.");
                    }
                    const totalCents = exactMoney(original.purchaseTotal,"Original Purchase Total");
                    if (targetPaidCents > totalCents || targetPaidCents < 0) {
                        await safeRollback(connection);
                        return badRequest(headers,"Amount Paid must be between zero and the original purchase total.");
                    }
                    // Existing supplier payments remain intact. A signed correction entry
                    // changes the payable total without deleting a historical payment row.
                    const delta = targetPaidCents-currentPaidCents;
                    if (delta !== 0) {
                        await connection.execute(
                            `INSERT INTO inventory_supplier_payments(purchase_id,amount,payment_date,request_key)
                             VALUES(?,?,?,?)`,
                            [original.id,delta/100,revised.purchaseDate,
                                `EDIT-CORRECTION-${id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`]);
                    }
                    await connection.execute(
                        `UPDATE inventory_purchase_transactions
                         SET supplier=?,supplier_invoice_number=?,purchase_date=?,
                             payment_method=?,payment_due_date=?
                         WHERE id=? AND store_id=? AND branch_id=?`,
                        [revised.supplier,revised.supplierInvoiceNumber,revised.purchaseDate,
                            revised.paymentMethod,revised.paymentDueDate,original.id,storeId,branchForEdit]);
                    purchaseChangeLog = `Corrected ${original.purchaseNumber || original.id} supplier/payment details (paid: ${currentPaidCents/100} -> ${targetPaidCents/100}); original total preserved`;
                } else {
                    // Older StockNBook records may have only the legacy initial purchase.
                    const legacy = await findInitialPurchase(connection,storeId,branchForEdit,id,true);
                    if (!legacy) {
                        await safeRollback(connection);
                        return badRequest(headers,"No original supplier purchase exists for this product. Do not create a new purchase through Edit Product.");
                    }
                    let revised;
                    try {
                        revised = getInitialPurchaseInput({initialPurchase:editPurchaseDetails},
                            stableStock,originalPrice,incomingVariants,Number(legacy.purchaseTotal));
                    } catch(error) {
                        await safeRollback(connection);
                        return badRequest(headers,error.message);
                    }
                    await updateInitialPurchase(connection,storeId,branchForEdit,id,revised,legacy);
                    purchaseChangeLog = `Corrected legacy initial purchase ${legacy.id}; original total preserved`;
                }
            }

            let query = `
                UPDATE products
                SET
                    package_id = ?,
                    package_name = ?,
                    name = ?,
                    category = ?,
                    stock = ?,
                    alert_level = ?,
                    original_price = ?,
                    sales_price = ?,
                    pricing_method = ?,
                    markup_percentage = ?,
                    expiration_date = ?,
                    has_variants = ?
                WHERE id = ?
                  AND store_id = ?
            `;

            const params = [
                packageId,
                packageName || null,
                name,
                category,
                stableStock,
                alertLevel,
                originalPrice,
                salesPrice,
                pricing.pricingMethod,
                pricing.markupPercentage,
                expirationDate,
                hasVariants ? 1 : 0,
                id,
                storeId,
            ];

            if (activeBranchId) {
                query += " AND branch_id = ?";
                params.push(activeBranchId);
            }

            const [result] = await connection.execute(query, params);

            if (result.affectedRows === 0) {
                await safeRollback(connection);
                return notFound(headers, "Product not found");
            }

            // Never DELETE+INSERT existing variants. Their IDs/variant numbers anchor POS,
            // purchases, receipts, bookings, and audit references.
            if (hasVariants) {
                for (const v of incomingVariants) {
                    if (v.id) {
                        await connection.execute(
                            `UPDATE product_variants SET variant_values=?, alert_level=?, original_price=?,
                                                         sales_price=?, pricing_method=?, markup_percentage=?, expiration_date=?
                             WHERE id=? AND product_id=? AND deleted_at IS NULL`,
                            [JSON.stringify(v.variantValues),v.alertLevel,v.originalPrice,v.salesPrice,
                                v.pricingMethod,v.markupPercentage,v.expirationDate,v.id,id]);
                    }
                }
                const added=incomingVariants.filter(v=>!v.id);
                if (added.length) {
                    const addedRows=await insertProductVariants(connection,id,added);
                    await requireSynchronizedInventoryTables(connection);
                    for (const [index,row] of addedRows.entries()) {
                        const v=added[index];
                        await connection.execute(
                            `INSERT INTO branch_inventory
                             (store_id,branch_id,product_id,variant_id,quantity_on_hand,reorder_level,cost_price,sales_price,status)
                             VALUES (?,?,?,?,0,?,?,?,'active')`,
                            [storeId,Number(existing.branchId),id,row.id,v.alertLevel,v.originalPrice,v.salesPrice]);
                    }
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
                const [lockedProducts]=await connection.execute(
                    `SELECT id FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL FOR UPDATE`,
                    [id,storeId,Number(existing.branchId)]);
                if (!lockedProducts.length) {
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
                await connection.execute(
                    `SELECT id FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL FOR UPDATE`,
                    [id,storeId,Number(existing.branchId)]);
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