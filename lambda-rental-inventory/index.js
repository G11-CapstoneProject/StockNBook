"use strict";
// Dedicated rental inventory Lambda. This module never queries or writes Sales products.
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

// LOCAL DEVELOPMENT ONLY: Uses the same JWT and database settings as your existing Sales Lambda.
// For deployment, move these into environment variables and rotate the shared credentials.
const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook",
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

const ALL_ACTIVITIES = new Set(["received", "rented_out", "returned", "maintenance_started",
    "maintenance_completed", "missing_reported", "missing_resolved", "adjustment", "prepared", "inspected", "cleaned", "damage_reported"]);

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
    const [rows] = await db.execute(`SELECT id, archived_at FROM rental_categories
                                     WHERE store_id=? AND branch_id=? AND category_key=? FOR UPDATE`, [scope.storeId, scope.branchId, catKey]);
    if (rows.length) {
        if (rows[0].archived_at != null) await db.execute("UPDATE rental_categories SET archived_at=NULL, name=? WHERE id=?", [name, rows[0].id]);
        return Number(rows[0].id);
    }
    const [r] = await db.execute("INSERT INTO rental_categories (store_id,branch_id,name,category_key) VALUES (?,?,?,?)",
        [scope.storeId, scope.branchId, name, catKey]);
    return Number(r.insertId);
}
async function branchCodes(db, scope) {
    const [rows] = await db.execute(`SELECT s.store_code AS storeCode, b.branch_code AS branchCode
                                     FROM branches b JOIN stores s ON s.id=b.store_id WHERE s.id=? AND b.id=? LIMIT 1`, [scope.storeId, scope.branchId]);
    if (!rows.length || !rows[0].storeCode || !rows[0].branchCode) fail(409, "Store/Branch codes are missing. Complete the existing StockNBook product-number migration first.");
    const code = v => { const s=String(v); if (!/^[A-Z0-9]{2,8}$/.test(s)) fail(409, "Stored branch/store code format is invalid."); return s; };
    return `${code(rows[0].storeCode)}-${code(rows[0].branchCode)}`;
}
async function lockBranch(db, scope) {
    const [rows] = await db.execute("SELECT id FROM branches WHERE id=? AND store_id=? FOR UPDATE", [scope.branchId, scope.storeId]);
    if (!rows.length) fail(403, "Branch not assigned to this store.");
}
async function lockEquipment(db, scope, equipmentId) {
    const [rows] = await db.execute(`SELECT * FROM rental_equipment WHERE id=? AND store_id=? AND branch_id=? AND archived_at IS NULL FOR UPDATE`,
        [equipmentId, scope.storeId, scope.branchId]);
    if (!rows.length) fail(404, "Active rental equipment not found in this branch.");
    return rows[0];
}
async function appendMovement(db, scope, equipmentId, type, quantity, ref, description = null) {
    if (!ALL_ACTIVITIES.has(type)) throw new Error("Internal rental movement type is invalid.");
    await db.execute(`INSERT INTO rental_stock_movements
                      (store_id,branch_id,equipment_id,type,quantity,reference_number,description,actor_name)
                      VALUES(?,?,?,?,?,?,?,?)`,
        [scope.storeId, scope.branchId, equipmentId, type, quantity, ref || null, description, scope.actor]);
}
async function receivePurchase(db, scope, equipmentRow, data, source) {
    // Parent equipment row MUST already be locked to protect the moving average.
    const purchase = purchaseData(data);
    const [r] = await db.execute(`INSERT INTO rental_purchase_transactions
                                  (store_id,branch_id,supplier,supplier_invoice_number,purchase_date,payment_method,purchase_total,payment_due_date,source)
                                  VALUES(?,?,?,?,?,?,?,?,?)`, [scope.storeId,scope.branchId,purchase.supplier,purchase.invoice,purchase.purchaseDate,
        purchase.paymentMethod,intMoney(purchase.totalCents),purchase.due,source]);
    const purchaseId = Number(r.insertId);
    const prefix = await branchCodes(db, scope);
    const purchaseNumber = `${prefix}-RPUR-${String(purchaseId).padStart(6, "0")}`;
    await db.execute("UPDATE rental_purchase_transactions SET purchase_number=? WHERE id=?", [purchaseNumber,purchaseId]);
    const [item] = await db.execute(`INSERT INTO rental_purchase_items (purchase_id,equipment_id,quantity_ordered,unit_purchase_cost)
                                     VALUES (?,?,?,?)`, [purchaseId,equipmentRow.id,purchase.quantity,intMoney(purchase.unitCents)]);
    // The Manager records the supplier purchase. Only Staff can physically receive it.
    await db.execute(`INSERT INTO rental_receiving_tasks
                      (store_id,branch_id,purchase_id,purchase_item_id,equipment_id,quantity_expected,unit_cost)
                      VALUES(?,?,?,?,?,?,?)`,
        [scope.storeId,scope.branchId,purchaseId,item.insertId,equipmentRow.id,purchase.quantity,intMoney(purchase.unitCents)]);
    if (purchase.paidCents > 0) {
        await db.execute(`INSERT INTO rental_supplier_payments (purchase_id,amount,payment_date,request_key) VALUES(?,?,?,?)`,
            [purchaseId,intMoney(purchase.paidCents),purchase.purchaseDate,`INITIAL-${purchaseId}`]);
    }
    // Stock, average unit cost, and stock movements are updated only after Staff confirms receipt.
    return {purchaseId,purchaseNumber,receivingNumber:null,amountPaid:intMoney(purchase.paidCents),
        outstandingBalance:intMoney(purchase.totalCents-purchase.paidCents),awaitingReceipt:true};
}
async function createEquipment(db,scope,raw,source, importedUnitCost = null) {
    const e = equipmentInput(raw, raw.initialPurchase?.unitCost ?? importedUnitCost);
    const cid = await categoryId(db,scope,e.category);
    const [created] = await db.execute(`INSERT INTO rental_equipment
                                        (store_id,branch_id,category_id,name,name_key,alert_level,rental_rate_per_day,
                                         pricing_method,pricing_recovery_days,
                                         pricing_residual_value,pricing_operating_cost_per_day,pricing_margin_percent,pricing_unit_cost_basis)
                                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [scope.storeId,scope.branchId,cid,e.name,key(e.name),e.alertLevel,e.pricing.rate,
            e.pricing.method,e.pricing.recoveryDays,e.pricing.residual,e.pricing.operating,e.pricing.margin,e.pricing.basis]);
    const equipmentId = Number(created.insertId);
    const prefix = await branchCodes(db,scope);
    const equipmentNumber = `${prefix}-EQ-${String(equipmentId).padStart(6,"0")}`;
    await db.execute("UPDATE rental_equipment SET equipment_number=? WHERE id=?",[equipmentNumber,equipmentId]);
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
            // One Excel workbook = one supplier purchase. Individual equipment are
            // separate receipt lines; invoice/payment is recorded only once.
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
            const supplier = requiredText(p.supplier, 150, "Supplier");
            const invoice = trim(p.supplierInvoiceNumber, 80) || null;
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
                    // Creation happens before the single purchase is recorded.
                    // Supply unit cost ONLY for cost-based formula validation.
                    initialPurchase: undefined
                }, "import", line.unitCents / 100);
                createdRows.push({ ...line, equipmentId: newEquipment.equipmentId,
                    equipmentNumber: newEquipment.equipmentNumber });
            }
            const [createdPurchase] = await db.execute(`INSERT INTO rental_purchase_transactions
                                                        (store_id,branch_id,supplier,supplier_invoice_number,purchase_date,payment_method,purchase_total,payment_due_date,source)
                                                        VALUES(?,?,?,?,?,?,?,?,?)`, [scope.storeId,scope.branchId,supplier,invoice,purchaseDate,
                paymentMethod,intMoney(totalCents),due,"import"]);
            const purchaseId = Number(createdPurchase.insertId);
            const prefix = await branchCodes(db, scope);
            const purchaseNumber = `${prefix}-RPUR-${String(purchaseId).padStart(6, "0")}`;
            await db.execute("UPDATE rental_purchase_transactions SET purchase_number=? WHERE id=?", [purchaseNumber,purchaseId]);
            if (paidCents > 0) await db.execute(`INSERT INTO rental_supplier_payments
                                                     (purchase_id,amount,payment_date,request_key) VALUES(?,?,?,?)`,
                [purchaseId,intMoney(paidCents),purchaseDate,`INITIAL-${purchaseId}`]);
            for (const line of createdRows) {
                const [item] = await db.execute(`INSERT INTO rental_purchase_items
                                                     (purchase_id,equipment_id,quantity_ordered,unit_purchase_cost) VALUES(?,?,?,?)`,
                    [purchaseId,line.equipmentId,line.quantity,intMoney(line.unitCents)]);
                await db.execute(`INSERT INTO rental_receiving_tasks
                                  (store_id,branch_id,purchase_id,purchase_item_id,equipment_id,quantity_expected,unit_cost)
                                  VALUES(?,?,?,?,?,?,?)`,
                    [scope.storeId,scope.branchId,purchaseId,item.insertId,line.equipmentId,line.quantity,intMoney(line.unitCents)]);
            }
            return { imported: createdRows.length, equipment: createdRows.map(line=>({
                    equipmentId:line.equipmentId,equipmentNumber:line.equipmentNumber,name:line.name
                })), purchaseId,purchaseNumber,purchaseTotal:intMoney(totalCents),
                amountPaid:intMoney(paidCents),outstandingBalance:intMoney(totalCents-paidCents),
                referenceNumber:purchaseNumber };
        }
        case "update_equipment": {
            const current = await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const name = requiredText(body.name,150,"Equipment name");
            const category = requiredText(body.category,100,"Category");
            const alert = whole(body.alertLevel,"Low availability alert");
            // Keep the saved cost basis stable across later supplier receipts.
            // Refreshing it requires an explicit manager action.
            const basis = Number(current.total_units) > 0
                ? (body.pricingRefreshBasis === true || current.pricing_unit_cost_basis == null
                    ? current.average_unit_cost : current.pricing_unit_cost_basis)
                : null;
            const pricing = rentalPricing(body, basis, Number(current.rental_rate_per_day));
            const cat = await categoryId(db,scope,category);
            await db.execute(`UPDATE rental_equipment SET name=?,name_key=?,category_id=?,alert_level=?,rental_rate_per_day=?,
                                                          pricing_method=?,pricing_recovery_days=?,
                                                          pricing_residual_value=?,pricing_operating_cost_per_day=?,pricing_margin_percent=?,pricing_unit_cost_basis=? WHERE id=?`,
                [name,key(name),cat,alert,pricing.rate,pricing.method,pricing.recoveryDays,
                    pricing.residual,pricing.operating,pricing.margin,pricing.basis,current.id]);
            return { equipmentId:current.id,referenceNumber:current.equipment_number };
        }
        case "receive_equipment": {
            const current=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const purchase=await receivePurchase(db,scope,current,body,"purchase");
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
            const [r]=await db.execute(`INSERT INTO rental_maintenance_records
                                        (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,start_reason,
                                         condition_status,estimated_completion_date) VALUES(?,?,?,?,?,?,?,?)`,
                [scope.storeId,scope.branchId,current.id,qty,qty,reason,conditionStatus,estimate]);
            await db.execute("UPDATE rental_equipment SET maintenance_units=maintenance_units+? WHERE id=?",[qty,current.id]);
            const ref=`MNT-${String(r.insertId).padStart(6,"0")}`;
            await appendMovement(db,scope,current.id,"maintenance_started",qty,ref,reason);
            return {referenceNumber:ref};
        }
        case "approve_maintenance_repair": {
            const maintenanceId=id(body.maintenanceId,"Maintenance record");
            // Lock equipment before the maintenance record to match stock lock ordering.
            const [identity]=await db.execute(`SELECT equipment_id FROM rental_maintenance_records
                                               WHERE id=? AND store_id=? AND branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
            if(!identity.length)fail(404,"Maintenance record not found.");
            const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
            const [records]=await db.execute(`SELECT id,quantity_remaining,repair_approved_at,condition_status FROM rental_maintenance_records
                                              WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[maintenanceId,scope.storeId,scope.branchId]);
            if(!records.length || Number(records[0].quantity_remaining)<=0)fail(409,"Maintenance is already completed.");
            if(records[0].condition_status === "Routine")
                fail(409,"Routine care is completed by Staff and does not require Manager approval.");
            if(records[0].repair_approved_at)fail(409,"This repair was already approved.");
            await db.execute(`UPDATE rental_maintenance_records SET repair_approved_at=NOW(),repair_approved_by=? WHERE id=?`,[scope.actor,maintenanceId]);
            return {referenceNumber:`MNT-${String(maintenanceId).padStart(6,"0")}`,equipmentId:equipment.id};
        }
        case "approve_repair_completion": {
            const requestId=id(body.requestId,"Repair completion request");
            const [identity]=await db.execute(`SELECT equipment_id FROM rental_maintenance_completion_requests
                                               WHERE id=? AND store_id=? AND branch_id=?`,[requestId,scope.storeId,scope.branchId]);
            if(!identity.length)fail(404,"Completion request not found.");
            const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
            const [requests]=await db.execute(`SELECT * FROM rental_maintenance_completion_requests
                                               WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[requestId,scope.storeId,scope.branchId]);
            const request=requests[0];
            if(request.status!=="pending")fail(409,"This request has already been reviewed.");
            const [records]=await db.execute(`SELECT quantity_remaining,repair_approved_at,condition_status FROM rental_maintenance_records
                                              WHERE id=? AND equipment_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                [request.maintenance_record_id,equipment.id,scope.storeId,scope.branchId]);
            const quantity=Number(request.quantity);
            if(!records.length || records[0].condition_status === "Routine" ||
                !records[0].repair_approved_at || Number(records[0].quantity_remaining)<quantity ||
                Number(equipment.maintenance_units)<quantity)fail(409,"Repair quantities or approval no longer match. Please refresh.");
            await db.execute(`UPDATE rental_maintenance_records SET quantity_remaining=quantity_remaining-?,completion_notes=?,
                                                                    completed_at=CASE WHEN quantity_remaining=? THEN NOW() ELSE completed_at END WHERE id=?`,
                [quantity,request.notes,quantity,request.maintenance_record_id]);
            await db.execute(`UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?`,[quantity,equipment.id]);
            await db.execute(`UPDATE rental_maintenance_completion_requests SET status='approved',reviewed_by=?,reviewed_at=NOW()
                              WHERE id=?`,[scope.actor,requestId]);
            const ref=`MNT-${String(request.maintenance_record_id).padStart(6,"0")}`;
            await appendMovement(db,scope,equipment.id,"maintenance_completed",quantity,ref,`Manager approved release: ${request.notes}`);
            return {referenceNumber:ref};
        }
        case "resolve_missing_equipment": {
            const reportId=id(body.reportId,"Missing equipment report");
            const resolution=String(body.resolution||"");
            if(!["found","writeoff"].includes(resolution))fail(400,"Choose Found or Approve Write-Off.");
            const [identity]=await db.execute(`SELECT equipment_id FROM rental_missing_unit_reports
                                               WHERE id=? AND store_id=? AND branch_id=?`,[reportId,scope.storeId,scope.branchId]);
            if(!identity.length)fail(404,"Missing-unit report not found.");
            const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
            const [reports]=await db.execute(`SELECT * FROM rental_missing_unit_reports WHERE id=?
                                                                                          AND store_id=? AND branch_id=? FOR UPDATE`,[reportId,scope.storeId,scope.branchId]);
            const report=reports[0],qty=Number(report.quantity);
            if(report.status!=="pending")fail(409,"This missing-unit report has already been reviewed.");
            if(qty>Number(equipment.missing_units))fail(409,"Missing unit counts need reconciliation.");
            const notes=requiredText(body.notes,500,"Resolution notes");
            if(notes.length<10)fail(400,"Explain the disposition of missing equipment (10+ characters).");
            if(resolution==="writeoff" && qty>Number(equipment.total_units)-Number(equipment.rented_out_units)-Number(equipment.maintenance_units))
                fail(409,"Cannot write off units committed to other equipment operations.");
            // Recovered units stay on hold until Staff inspects/cleans them.
            // They do not return directly to the rentable pool on Manager review.
            await db.execute(`UPDATE rental_equipment SET missing_units=missing_units-?,
                                                          maintenance_units=maintenance_units+?,total_units=total_units-? WHERE id=?`,
                [qty,resolution==="found"?qty:0,resolution==="writeoff"?qty:0,equipment.id]);
            if(resolution==="found"){
                await db.execute(`INSERT INTO rental_maintenance_records
                                  (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,
                                   start_reason,condition_status,booking_reference)
                                  VALUES(?,?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,qty,qty,
                    `Recovered missing equipment (report #${reportId}); Staff must inspect before marking cleaned. ${notes}`.slice(0,500),
                    'Routine',report.booking_reference||null]);
            }
            await db.execute(`UPDATE rental_missing_unit_reports SET status=?,resolved_by=?,resolved_at=NOW(),resolution_notes=?
                              WHERE id=?`,[resolution,scope.actor,notes,reportId]);
            await appendMovement(db,scope,equipment.id,resolution==="found"?"missing_resolved":"adjustment",qty,
                `MISS-${String(reportId).padStart(6,"0")}`,`${resolution==="found"?"Missing units recovered":"Manager-approved stock write-off"}: ${notes}`);
            // After this inventory transaction commits, re-check whether this
            // booking can automatically finish. Financial settlement stays in
            // Booking; resolving a missing-item investigation is not payment.
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
            const [allocated]=await db.execute(`SELECT id FROM rental_booking_allocations
                                                WHERE store_id=? AND branch_id=? AND equipment_id=? AND status IN ('reserved','checked_out') LIMIT 1`,
                [scope.storeId,scope.branchId,current.id]);
            if(allocated.length)fail(409,"Cannot retire equipment with an active or future rental allocation.");
            const [pending]=await db.execute(`SELECT id FROM rental_receiving_tasks WHERE equipment_id=?
                                                                                      AND store_id=? AND branch_id=? AND quantity_received<quantity_expected LIMIT 1`,
                [current.id,scope.storeId,scope.branchId]);
            if(pending.length)fail(409,"Confirm or resolve all pending supplier receipts before retiring equipment.");
            const units=Number(current.total_units);
            // An intentional full-stock retirement is audited rather than deleting purchases.
            await db.execute(`UPDATE rental_equipment SET total_units=0,archived_at=NOW() WHERE id=?`,[current.id]);
            if(units>0)await appendMovement(db,scope,current.id,"adjustment",units,current.equipment_number,
                `Equipment retired: ${reason}`);
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
            const [found]=await db.execute(`SELECT id FROM rental_categories WHERE store_id=? AND branch_id=? AND category_key=? AND archived_at IS NULL FOR UPDATE`,
                [scope.storeId,scope.branchId,key(previous)]);
            if(!found.length)fail(404,"Rental category not found.");
            await db.execute("UPDATE rental_categories SET name=?,category_key=? WHERE id=?",[updated,key(updated),found[0].id]);
            return {categoryId:found[0].id,referenceNumber:""};
        }
        case "archive_rental_category": {
            const name=requiredText(body.name,100,"Category name");
            const [found]=await db.execute(`SELECT id FROM rental_categories WHERE store_id=? AND branch_id=? AND category_key=? AND archived_at IS NULL FOR UPDATE`,
                [scope.storeId,scope.branchId,key(name)]);
            if(!found.length)fail(404,"Rental category not found.");
            const [inUse]=await db.execute("SELECT id FROM rental_equipment WHERE category_id=? LIMIT 1",[found[0].id]);
            if(inUse.length)fail(409,"This category has equipment or historical records; rename it instead of archiving.");
            await db.execute("UPDATE rental_categories SET archived_at=NOW() WHERE id=?",[found[0].id]);
            return {referenceNumber:""};
        }
        case "pay_rental_supplier_purchase": {
            const purchaseId=id(body.purchaseId,"Purchase ID");
            const paymentCents=cents(body.amount,"Payment amount");
            const date=isoDate(body.paymentDate,"Payment date");
            if(!paymentCents||date>todayPh())fail(400,"Payment must be positive and cannot be future-dated.");
            const [purchases]=await db.execute(`SELECT id,purchase_total,purchase_number FROM rental_purchase_transactions
                                                WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[purchaseId,scope.storeId,scope.branchId]);
            if(!purchases.length)fail(404,"Supplier purchase not found.");
            const [paid]=await db.execute("SELECT COALESCE(SUM(amount),0) AS paid FROM rental_supplier_payments WHERE purchase_id=?",[purchaseId]);
            const balance=Math.round(Number(purchases[0].purchase_total)*100)-Math.round(Number(paid[0].paid)*100);
            if(paymentCents>balance)fail(409,"Payment exceeds outstanding balance.");
            await db.execute("INSERT INTO rental_supplier_payments (purchase_id,amount,payment_date,request_key) VALUES(?,?,?,?)",
                [purchaseId,intMoney(paymentCents),date,scope.requestKey]);
            return {referenceNumber:purchases[0].purchase_number,outstandingBalance:intMoney(balance-paymentCents)};
        }
        default: fail(400,"Unsupported rental inventory action.");
    }
}
async function getInventory(db,scope) {
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
                                        FROM rental_equipment e JOIN rental_categories c ON c.id=e.category_id
                                        WHERE e.store_id=? AND e.branch_id=? ORDER BY e.created_at DESC,e.id DESC`, [scope.storeId,scope.branchId]);
    const [activity]=await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                              COALESCE(e.name,'Archived equipment') AS equipmentName,m.type,m.quantity,
                                              DATE_FORMAT(m.occurred_at,'%Y-%m-%dT%H:%i:%s+08:00') AS occurredAt,
                                              COALESCE(m.reference_number,'') AS referenceNumber
                                       FROM rental_stock_movements m LEFT JOIN rental_equipment e ON e.id=m.equipment_id
                                       WHERE m.store_id=? AND m.branch_id=? ORDER BY m.occurred_at DESC,m.id DESC LIMIT 100`,
        [scope.storeId,scope.branchId]);
    // Source of truth: open maintenance batches, not generic stock issues or mock rows.
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
                                                 FROM rental_maintenance_records m
                                                          LEFT JOIN rental_maintenance_completion_requests q ON q.maintenance_record_id=m.id AND q.status='pending'
                                                          LEFT JOIN rental_equipment e ON e.id=m.equipment_id
                                                     AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                 WHERE m.store_id=? AND m.branch_id=? AND m.quantity_remaining>0
                                                 ORDER BY m.opened_at DESC,m.id DESC LIMIT 1000`,
        [scope.storeId,scope.branchId]);
    // Preliminary damage was recorded by Staff when receiving the booking return.
    // It must be visible to the Manager, but it is NOT a confirmed repair or a
    // billable customer claim until Staff completes Inspect Return.
    const [pendingDamageObservations]=await db.execute(`SELECT a.id AS allocationId,
                                                               a.booking_reference AS bookingReference,
                                                               e.name AS equipmentName,
                                                               w.inspection_damaged_units AS observedDamagedUnits,
                                                               w.inspection_notes AS notes,
                                                               DATE_FORMAT(w.returned_at,'%Y-%m-%d') AS reportedAt
                                                        FROM rental_booking_allocations a
                                                                 JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                                                 JOIN rental_equipment e ON e.id=a.equipment_id
                                                            AND e.store_id=a.store_id AND e.branch_id=a.branch_id
                                                        WHERE a.store_id=? AND a.branch_id=? AND a.status='returned'
                                                          AND w.inspection_status='pending'
                                                          AND COALESCE(w.inspection_damaged_units,0)>0
                                                        ORDER BY w.returned_at DESC,a.id DESC LIMIT 200`,
        [scope.storeId,scope.branchId]);
    const [pendingReceipts]=await db.execute(`SELECT t.id,t.equipment_id AS equipmentId,
                                                     e.name AS equipmentName,p.purchase_number AS purchaseNumber,t.quantity_expected AS quantityExpected,
                                                     t.quantity_received AS quantityReceived
                                              FROM rental_receiving_tasks t JOIN rental_equipment e ON e.id=t.equipment_id
                                                                            JOIN rental_purchase_transactions p ON p.id=t.purchase_id
                                              WHERE t.store_id=? AND t.branch_id=? AND t.quantity_received<t.quantity_expected
                                              ORDER BY t.id DESC LIMIT 100`,[scope.storeId,scope.branchId]);
    const [missingReports]=await db.execute(`SELECT r.id,r.equipment_id AS equipmentId,e.name AS equipmentName,
                                                    r.quantity,r.reason,r.booking_reference AS bookingReference,
                                                    DATE_FORMAT(r.created_at,'%Y-%m-%d') AS reportedAt,r.reported_by AS reportedBy
                                             FROM rental_missing_unit_reports r JOIN rental_equipment e ON e.id=r.equipment_id
                                             WHERE r.store_id=? AND r.branch_id=? AND r.status='pending' ORDER BY r.created_at DESC,r.id DESC
                                                 LIMIT 200`,[scope.storeId,scope.branchId]);
    const [categories]=await db.execute(`SELECT name FROM rental_categories WHERE store_id=? AND branch_id=? AND archived_at IS NULL ORDER BY name`,
        [scope.storeId,scope.branchId]);
    return {success:true, storeId:scope.storeId, branchId:scope.branchId, storeName:scope.storeName, branchName:scope.branchName, bookingSyncConnected: process.env.RENTAL_BOOKING_SYNC_ENABLED === "true", equipment:equipment.map(row=>({ ...row,id:Number(row.id),totalUnits:Number(row.totalUnits),
            rentedOutUnits:Number(row.rentedOutUnits),maintenanceUnits:Number(row.maintenanceUnits),missingUnits:Number(row.missingUnits),
            alertLevel:Number(row.alertLevel),active:Boolean(row.active),rentalRatePerDay:Number(row.rentalRatePerDay),
            averageUnitCost:row.averageUnitCost===null?null:Number(row.averageUnitCost),
            pricingRecoveryDays:row.pricingRecoveryDays===null?null:Number(row.pricingRecoveryDays),
            pricingResidualValue:row.pricingResidualValue===null?null:Number(row.pricingResidualValue),
            pricingOperatingCostPerDay:row.pricingOperatingCostPerDay===null?null:Number(row.pricingOperatingCostPerDay),
            pricingMarginPercent:row.pricingMarginPercent===null?null:Number(row.pricingMarginPercent),
            pricingUnitCostBasis:row.pricingUnitCostBasis===null?null:Number(row.pricingUnitCostBasis)})),
        activity,
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
        pendingReceipts:pendingReceipts.map(r=>({...r,id:Number(r.id),equipmentId:Number(r.equipmentId),
            quantityExpected:Number(r.quantityExpected),quantityReceived:Number(r.quantityReceived)})),
        missingReports:missingReports.map(r=>({...r,id:Number(r.id),equipmentId:Number(r.equipmentId),quantity:Number(r.quantity)})),
        categories:categories.map(c=>c.name) };
}
async function getPayables(db,scope) {
    const [rows]=await db.execute(`SELECT p.id AS purchaseId,p.purchase_number AS purchaseNumber,p.supplier,
                                          p.supplier_invoice_number AS supplierInvoiceNumber,p.purchase_total AS purchaseTotal,
                                          p.payment_method AS paymentMethod,DATE_FORMAT(p.purchase_date,'%Y-%m-%d') AS purchaseDate,
                                          DATE_FORMAT(p.payment_due_date,'%Y-%m-%d') AS paymentDueDate,COALESCE(SUM(pay.amount),0) AS amountPaid
                                   FROM rental_purchase_transactions p LEFT JOIN rental_supplier_payments pay ON pay.purchase_id=p.id
                                   WHERE p.store_id=? AND p.branch_id=? GROUP BY p.id ORDER BY p.id DESC`,[scope.storeId,scope.branchId]);
    return {success:true,payables:rows.map(r=>{
            const purchaseTotal=Number(r.purchaseTotal),amountPaid=Number(r.amountPaid);
            return {...r,purchaseTotal,amountPaid,outstandingBalance:Math.max(0,Math.round((purchaseTotal-amountPaid)*100)/100),
                paymentStatus:amountPaid>=purchaseTotal?"Paid":amountPaid>0?"Partially Paid":"Unpaid"};
        })};
}
async function getPurchaseItems(db,scope,body) {
    const purchaseId=id(body.purchaseId,"Purchase ID");
    const [headers]=await db.execute(`SELECT id,purchase_number AS purchaseNumber,supplier,purchase_total AS purchaseTotal
                                      FROM rental_purchase_transactions WHERE id=? AND store_id=? AND branch_id=? LIMIT 1`,[purchaseId,scope.storeId,scope.branchId]);
    if(!headers.length)fail(404,"Purchase not found.");
    const [items]=await db.execute(`SELECT i.equipment_id AS equipmentId,e.equipment_number AS equipmentNumber,e.name,
                                           i.quantity_ordered AS quantity,i.unit_purchase_cost AS unitCost,
                                           i.quantity_ordered*i.unit_purchase_cost AS lineTotal
                                    FROM rental_purchase_items i JOIN rental_equipment e ON e.id=i.equipment_id
                                    WHERE i.purchase_id=? ORDER BY i.id`,[purchaseId]);
    return {success:true,purchase:headers[0],items};
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
    const [equipment]=await db.execute(`SELECT id,total_units,maintenance_units,missing_units FROM rental_equipment
                                        WHERE store_id=? AND branch_id=? AND archived_at IS NULL`,[scope.storeId,scope.branchId]);
    const [allocations]=await db.execute(`SELECT equipment_id AS equipmentId,quantity,
                                                 DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate,status
                                          FROM rental_booking_allocations WHERE store_id=? AND branch_id=? AND status IN ('reserved','checked_out')
                                                                            AND start_date<=? AND (end_date>=? OR status='checked_out')`,[scope.storeId,scope.branchId,to,from]);
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
    const [rows]=await db.execute(`SELECT id,equipment_number AS equipmentNumber,name,total_units AS totalUnits,
                                          rented_out_units AS rentedOutUnits,maintenance_units AS maintenanceUnits,
                                          missing_units AS missingUnits
                                   FROM rental_equipment
                                   WHERE id=? AND store_id=? AND branch_id=? AND archived_at IS NULL LIMIT 1`,
        [equipmentId,scope.storeId,scope.branchId]);
    if(!rows.length)fail(404,'Equipment not found in this branch.');
    const item=rows[0];
    const today=todayPh();
    if(date<today)fail(400,'Use today or a future date to plan rental availability. Past rentals are in activity history.');
    const [bookings]=await db.execute(`SELECT a.id AS allocationId,a.booking_reference AS bookingReference,
                                              a.quantity,DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                              DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,a.status
                                       FROM rental_booking_allocations a
                                                JOIN bookings b ON b.booking_reference=a.booking_reference COLLATE utf8mb4_unicode_ci
                                           AND b.store_id=a.store_id AND b.branch_id=a.branch_id
                                           AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                       WHERE a.store_id=? AND a.branch_id=? AND a.equipment_id=?
                                         AND a.status IN ('reserved','checked_out') AND a.start_date<=?
                                         AND (a.end_date>=? OR (a.status='checked_out' AND a.end_date<?))
                                       ORDER BY a.start_date,a.id LIMIT 300`,
        [scope.storeId,scope.branchId,equipmentId,date,date,today]);
    // The total must NOT be limited by the 300-row schedule preview. Always
    // aggregate all matching confirmed allocations for the selected date.
    const [summaryRows]=await db.execute(`SELECT COALESCE(SUM(a.quantity),0) AS bookedUnits,COUNT(*) AS allocationCount
                                          FROM rental_booking_allocations a
                                                   JOIN bookings b ON b.booking_reference=a.booking_reference COLLATE utf8mb4_unicode_ci
                                              AND b.store_id=a.store_id AND b.branch_id=a.branch_id
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

// Staff operations consume existing booking allocations; there is no equipment/catalog write access.
// Bookings must already be confirmed by the existing booking workflow.
async function staffRentalWorkspace(db, scope) {
    const [equipment] = await db.execute(`SELECT e.id,e.equipment_number AS equipmentNumber,e.name,c.name AS category,
                                                 e.total_units AS totalUnits,e.rented_out_units AS rentedOutUnits,e.maintenance_units AS maintenanceUnits,
                                                 e.missing_units AS missingUnits,e.alert_level AS alertLevel
                                          FROM rental_equipment e JOIN rental_categories c ON c.id=e.category_id
                                          WHERE e.store_id=? AND e.branch_id=? AND e.archived_at IS NULL ORDER BY e.name LIMIT 300`,
        [scope.storeId, scope.branchId]);
    const [allocations] = await db.execute(`SELECT a.id AS allocationId,a.booking_reference AS bookingReference,
                                                   a.equipment_id AS equipmentId,e.name AS equipmentName,e.equipment_number AS equipmentNumber,
                                                   a.quantity,DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                                   DATE_FORMAT(a.end_date,'%Y-%m-%d') AS endDate,a.status,
                                                   w.prepared_at AS preparedAt,w.returned_at AS returnedAt,
                                                   COALESCE(w.returned_received_units,a.quantity) AS returnedReceivedUnits,
                                                   COALESCE(w.inspection_cleaning_units,IF(w.inspection_status='cleaning',a.quantity,0)) AS cleaningUnits,
                                                   COALESCE(w.inspection_damaged_units,IF(w.inspection_status='damaged',a.quantity,0)) AS damagedUnits,
                                                   b.name AS clientName,b.booking_type AS bookingType,
                                                   b.package_name AS packageName,
                                                   DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate,
                                                   b.event_time AS eventTime,
                                                   COALESCE(b.agreed_price,0) AS bookingTotal,
                                                   COALESCE(b.amount_paid,0) AS amountPaid,
                                                   COALESCE(b.balance,0) AS bookingBalance,
                                                   f.refundable_deposit_required AS depositRequired,
                                                   f.deposit_collected AS depositCollected,
                                                   CASE WHEN w.inspection_status='damaged' AND m.id IS NOT NULL AND m.quantity_remaining=0
                                                            THEN 'cleared' ELSE w.inspection_status END AS inspectionStatus,
                                                   w.inspection_notes AS inspectionNotes
                                            FROM rental_booking_allocations a
                                                     JOIN rental_equipment e ON e.id=a.equipment_id AND e.store_id=a.store_id AND e.branch_id=a.branch_id AND e.archived_at IS NULL
                                                     JOIN bookings b ON b.booking_reference=a.booking_reference COLLATE utf8mb4_unicode_ci AND b.store_id=a.store_id AND b.branch_id=a.branch_id
                                                AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                                     LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                                     LEFT JOIN booking_financial_details f ON f.booking_id=b.id AND f.store_id=b.store_id AND f.branch_id=b.branch_id
                                                     LEFT JOIN rental_maintenance_records m ON m.id=w.maintenance_record_id
                                            WHERE a.store_id=? AND a.branch_id=? AND (a.status IN ('reserved','checked_out')
                                                OR (a.status='returned' AND (w.inspection_status IN ('pending','cleaning')
                                                    OR (w.inspection_status='damaged' AND COALESCE(m.quantity_remaining,0)>0))))
                                            ORDER BY a.end_date ASC,a.start_date ASC,a.id ASC LIMIT 300`,[scope.storeId,scope.branchId]);
    const [activity] = await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,COALESCE(e.name,'Archived equipment') AS equipmentName,
                                                m.type,m.quantity,DATE_FORMAT(m.occurred_at,'%Y-%m-%dT%H:%i:%s+08:00') AS occurredAt,
                                                COALESCE(m.reference_number,'') AS referenceNumber
                                         FROM rental_stock_movements m LEFT JOIN rental_equipment e ON e.id=m.equipment_id
                                         WHERE m.store_id=? AND m.branch_id=? ORDER BY m.occurred_at DESC,m.id DESC LIMIT 30`,[scope.storeId,scope.branchId]);
    const [pendingReceipts]=await db.execute(`SELECT t.id,t.equipment_id AS equipmentId,e.name AS equipmentName,
                                                     e.equipment_number AS equipmentNumber,p.purchase_number AS purchaseNumber,
                                                     t.quantity_expected AS quantityExpected,t.quantity_received AS quantityReceived
                                              FROM rental_receiving_tasks t JOIN rental_equipment e ON e.id=t.equipment_id
                                                                            JOIN rental_purchase_transactions p ON p.id=t.purchase_id
                                              WHERE t.store_id=? AND t.branch_id=? AND e.archived_at IS NULL AND t.quantity_received<t.quantity_expected
                                              ORDER BY t.id ASC LIMIT 200`,[scope.storeId,scope.branchId]);
    const [maintenanceTasks]=await db.execute(`SELECT m.id,m.equipment_id AS equipmentId,e.name AS equipmentName,
                                                      m.quantity_remaining AS units,m.start_reason AS reason,
                                                      m.condition_status AS conditionStatus,
                                                      IF(m.repair_approved_at IS NULL,0,1) AS repairApproved,
                                                      (SELECT COALESCE(SUM(q.quantity),0) FROM rental_maintenance_completion_requests q
                                                       WHERE q.maintenance_record_id=m.id AND q.status='pending') AS pendingUnits
                                               FROM rental_maintenance_records m JOIN rental_equipment e ON e.id=m.equipment_id
                                               WHERE m.store_id=? AND m.branch_id=? AND e.archived_at IS NULL AND m.quantity_remaining>0
                                               ORDER BY m.opened_at DESC LIMIT 200`,[scope.storeId,scope.branchId]);
    return {success:true,equipment:equipment.map(x=>({...x,id:Number(x.id),totalUnits:Number(x.totalUnits),
            rentedOutUnits:Number(x.rentedOutUnits),maintenanceUnits:Number(x.maintenanceUnits),
            missingUnits:Number(x.missingUnits),alertLevel:Number(x.alertLevel)})),
        allocations:allocations.map(x=>({...x,allocationId:Number(x.allocationId),equipmentId:Number(x.equipmentId),quantity:Number(x.quantity),
            returnedReceivedUnits:Number(x.returnedReceivedUnits),cleaningUnits:Number(x.cleaningUnits),damagedUnits:Number(x.damagedUnits),
            bookingTotal:Number(x.bookingTotal),amountPaid:Number(x.amountPaid),bookingBalance:Number(x.bookingBalance),
            depositRequired:x.depositRequired==null?null:Number(x.depositRequired),
            depositCollected:x.depositCollected==null?null:Number(x.depositCollected)})),
        activity,
        pendingReceipts:pendingReceipts.map(x=>({...x,id:Number(x.id),equipmentId:Number(x.equipmentId),
            quantityExpected:Number(x.quantityExpected),quantityReceived:Number(x.quantityReceived)})),
        maintenanceTasks:maintenanceTasks.map(x=>({...x,id:Number(x.id),equipmentId:Number(x.equipmentId),
            units:Number(x.units),repairApproved:Boolean(x.repairApproved),pendingUnits:Number(x.pendingUnits)}))};
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
                                                                        LEFT JOIN booking_sales_fulfillment sf ON sf.booking_item_id=bi.id
                AND sf.store_id=bi.store_id AND sf.branch_id=bi.branch_id
                                    WHERE bi.store_id=? AND bi.branch_id=?
                                      AND bi.booking_id=(SELECT id FROM bookings
                                                         WHERE store_id=? AND branch_id=? AND booking_reference=? LIMIT 1)
                                      AND bi.product_id IS NOT NULL AND bi.booked_quantity>0
                                      AND (sf.issued_at IS NULL OR COALESCE(bi.used_quantity,0)<bi.booked_quantity)`,
        [scope.storeId,scope.branchId,scope.storeId,scope.branchId,reference]);
    const [rentals]=await db.execute(`SELECT COUNT(*) AS pending FROM rental_booking_allocations
                                      WHERE store_id=? AND branch_id=? AND booking_reference=?
                                        AND status='reserved'`,[scope.storeId,scope.branchId,reference]);
    if(Number(sales[0]?.pending||0)===0 && Number(rentals[0]?.pending||0)===0) {
        await db.execute(`UPDATE bookings SET status='Released'
                          WHERE store_id=? AND branch_id=? AND booking_reference=?
                            AND status IN ('Confirmed','Preparing')`,[scope.storeId,scope.branchId,reference]);
    } else {
        await markRentalPreparation(db,scope,reference);
    }
}
async function settleReturnedRentalBooking(db,scope,reference) {
    const [bookingRows]=await db.execute(`SELECT id,status,agreed_price,amount_paid,balance FROM bookings
                                          WHERE store_id=? AND branch_id=? AND booking_reference=? FOR UPDATE`,
        [scope.storeId,scope.branchId,reference]);
    const booking=bookingRows[0];
    if(!booking || !['released','return inspection','pending settlement','preparing'].includes(String(booking.status||'').toLowerCase()))return;
    const [allocations]=await db.execute(`SELECT a.status,a.quantity,w.returned_received_units,w.inspected_at,w.inspection_status
                                          FROM rental_booking_allocations a
                                                   LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                          WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=?`,
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
    const [finance]=await db.execute(`SELECT refundable_deposit_required,deposit_collected,deposit_applied,deposit_refunded
                                      FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=?`,
        [booking.id,scope.storeId,scope.branchId]);
    if(!finance.length || Number(finance[0].deposit_collected)+0.005<Number(finance[0].refundable_deposit_required) ||
        Number(finance[0].deposit_collected)-Number(finance[0].deposit_applied)-Number(finance[0].deposit_refunded)>0.005)return;
    const [sales]=await db.execute(`SELECT COUNT(*) AS pending FROM booking_items bi
                                                                        LEFT JOIN booking_sales_fulfillment f ON f.booking_item_id=bi.id
                AND f.store_id=bi.store_id AND f.branch_id=bi.branch_id
                                    WHERE bi.booking_id=? AND bi.store_id=? AND bi.branch_id=?
                                      AND bi.product_id IS NOT NULL AND bi.booked_quantity>0
                                      AND (f.issued_at IS NULL OR COALESCE(bi.used_quantity,0)<bi.booked_quantity)`,
        [booking.id,scope.storeId,scope.branchId]);
    if(Number(sales[0]?.pending||0)>0)return;
    const [pendingMissing]=await db.execute(`SELECT COUNT(*) AS pending FROM rental_missing_unit_reports m
                                                                                 LEFT JOIN booking_customer_claims c ON c.source_type='missing'
                AND c.source_record_id=m.id AND c.booking_id=?
                                             WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                               AND (m.status='pending' OR (m.status='writeoff' AND c.id IS NULL))`,
        [booking.id,scope.storeId,scope.branchId,reference]);
    if(Number(pendingMissing[0]?.pending||0)>0)return;
    const [pendingDamage]=await db.execute(`SELECT COUNT(*) AS pending FROM rental_maintenance_records m
                                                                                LEFT JOIN booking_customer_claims c ON c.source_type='damage'
                AND c.source_record_id=m.id AND c.booking_id=?
                                            WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                              AND m.start_reason LIKE 'Rental damage %' AND c.id IS NULL`,
        [booking.id,scope.storeId,scope.branchId,reference]);
    if(Number(pendingDamage[0]?.pending||0)>0)return;
    const [pendingRecovery]=await db.execute(`SELECT COUNT(*) AS pending FROM rental_maintenance_records
                                              WHERE store_id=? AND branch_id=? AND booking_reference=?
                                                AND start_reason LIKE 'Recovered missing equipment (report #%'
                                                AND quantity_remaining>0`,[scope.storeId,scope.branchId,reference]);
    if(Number(pendingRecovery[0]?.pending||0)>0)return;
    // Check the actual monetary balance rather than trusting the claim's
    // status label. Even a mistakenly marked 'settled' claim must block
    // completion until every remaining customer payment is verified.
    const [claims]=await db.execute(`SELECT COUNT(*) AS pending FROM booking_customer_claims
                                     WHERE booking_id=? AND store_id=? AND branch_id=?
                                       AND status<>'waived'
                                       AND COALESCE(approved_amount,0)>
                                           COALESCE(amount_paid,0)+COALESCE(deposit_applied,0)+0.005`,
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
    const [bookingRows]=await db.execute(`SELECT id,status,agreed_price,amount_paid,balance
                                          FROM bookings WHERE store_id=? AND branch_id=? AND booking_reference=? LIMIT 1 FOR UPDATE`,
        [scope.storeId,scope.branchId,reference]);
    if(!bookingRows.length)fail(404,'Booking not found in this branch.');
    const booking=bookingRows[0];
    const bookingStatus=String(booking.status||'').toLowerCase();
    if(!(action==='release_rental_booking'?['confirmed','preparing']:['released','preparing']).includes(bookingStatus))
        fail(409,'Booking status does not permit this rental operation.');
    const [identities]=await db.execute(`SELECT a.id,a.equipment_id AS equipmentId
                                         FROM rental_booking_allocations a
                                         WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=?
                                         ORDER BY a.equipment_id,a.id`,[scope.storeId,scope.branchId,reference]);
    if(!identities.length)fail(409,'No rental equipment allocations were found for this booking.');
    // Lock all equipment rows in a stable order to keep totals consistent across
    // multiple allocations using the same equipment and other stock operations.
    const equipmentById=new Map();
    for(const equipmentId of [...new Set(identities.map(x=>Number(x.equipmentId)))].sort((a,b)=>a-b)) {
        equipmentById.set(equipmentId,await lockEquipment(db,scope,equipmentId));
    }
    const [lines]=await db.execute(`SELECT a.id,a.equipment_id AS equipmentId,a.quantity,a.status,
                                           DATE_FORMAT(a.start_date,'%Y-%m-%d') AS startDate,
                                           w.prepared_at AS preparedAt
                                    FROM rental_booking_allocations a
                                             LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                    WHERE a.store_id=? AND a.branch_id=? AND a.booking_reference=?
                                    ORDER BY a.equipment_id,a.id FOR UPDATE`,[scope.storeId,scope.branchId,reference]);
    if(lines.length!==identities.length)fail(409,'Booking equipment changed. Refresh and retry.');
    const qtyByEquipment=new Map();
    for(const line of lines) {
        const quantity=Number(line.quantity),equipmentId=Number(line.equipmentId);
        if(!Number.isSafeInteger(quantity)||quantity<1||!equipmentById.has(equipmentId))
            fail(409,'Booking equipment quantity or identity is invalid.');
        qtyByEquipment.set(equipmentId,(qtyByEquipment.get(equipmentId)||0)+quantity);
    }
    const note=trim(body.notes,400);
    if(action==='release_rental_booking') {
        const total=Number(booking.agreed_price),paid=Number(booking.amount_paid),balance=Number(booking.balance);
        if(!Number.isFinite(total)||total<=0||!Number.isFinite(paid)||!Number.isFinite(balance)
            ||paid+0.005<total||balance>0.005)
            fail(409,'The customer must pay the entire booking balance before equipment handover.');
        // Financial security deposit is separate from rental revenue. A zero
        // agreed deposit is valid (no policy, or documented Manager waiver).
        // Never hand equipment over while an agreed positive deposit is unpaid.
        const [depositTerms]=await db.execute(`SELECT refundable_deposit_required,deposit_collected
                                               FROM booking_financial_details
                                               WHERE booking_id=? AND store_id=? AND branch_id=? LIMIT 1 FOR UPDATE`,
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
            await db.execute(`UPDATE rental_booking_allocations SET status='checked_out' WHERE id=?`,[line.id]);
            await db.execute(`UPDATE rental_equipment SET rented_out_units=rented_out_units+?
                              WHERE id=? AND store_id=? AND branch_id=?`,[line.quantity,line.equipmentId,scope.storeId,scope.branchId]);
            await db.execute(`UPDATE rental_staff_allocation_workflow
                              SET released_at=NOW(),released_by=? WHERE allocation_id=?`,[scope.actor,line.id]);
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
            await db.execute(`UPDATE rental_booking_allocations SET status='returned' WHERE id=?`,[line.id]);
            // All returned units are on hold only if Staff chose Inspect Later.
            // Otherwise the condition check is complete: only damaged units stay
            // unavailable, and the remaining units have completed routine care.
            const holdUnits=inspectionDeferred?received:observedDamage;
            const status=inspectionDeferred&&received>0?'pending':observedDamage>0?'damaged':'cleared';
            await db.execute(`UPDATE rental_equipment SET rented_out_units=rented_out_units-?,
                                                          maintenance_units=maintenance_units+?,missing_units=missing_units+?
                              WHERE id=? AND store_id=? AND branch_id=?`,
                [quantity,holdUnits,missing,line.equipmentId,scope.storeId,scope.branchId]);
            let maintenanceRecordId=null;
            if(conditionChecked&&observedDamage>0){
                // Same existing booking-linked damage record consumed by Manager repair
                // approval and Booking Billing. Never create a second incident in inspection.
                const [record]=await db.execute(`INSERT INTO rental_maintenance_records
                                                 (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,start_reason,booking_reference)
                                                 VALUES(?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,line.equipmentId,
                    observedDamage,observedDamage,`Rental damage ${reference}: ${note}`,reference]);
                maintenanceRecordId=record.insertId;
            }
            await db.execute(`UPDATE rental_staff_allocation_workflow
                              SET returned_at=NOW(),returned_by=?,returned_received_units=?,
                                  inspected_at=IF(?=1,NOW(),NULL),inspected_by=IF(?=1,?,NULL),
                                  inspection_status=?,inspection_cleaning_units=0,
                                  inspection_damaged_units=?,inspection_notes=?,maintenance_record_id=?
                              WHERE allocation_id=?`,[scope.actor,received,conditionChecked?1:0,
                conditionChecked?1:0,scope.actor,status,observedDamage,
                observedDamage>0?(inspectionDeferred?`Reported damage - pending condition check (${observedDamage} units): ${note}`:note).slice(0,400):null,
                maintenanceRecordId,line.id]);
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
                const [report]=await db.execute(`INSERT INTO rental_missing_unit_reports
                                                 (store_id,branch_id,equipment_id,quantity,reason,reported_by,booking_reference)
                                                 VALUES(?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,line.equipmentId,missing,
                    `Booking ${reference}: ${note}`,scope.actor,reference]);
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
    const [identity]=await db.execute(`SELECT equipment_id FROM rental_booking_allocations WHERE id=? AND store_id=? AND branch_id=?`,
        [allocationId,scope.storeId,scope.branchId]);
    if(!identity.length)fail(404,'Rental allocation does not belong to this branch.');
    const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
    const [allocations]=await db.execute(`SELECT a.*, w.prepared_at AS preparedAt, w.inspection_status AS inspectionStatus,
                                                 w.returned_received_units AS returnedReceivedUnits,
                                                 w.inspection_cleaning_units AS cleaningUnits,
                                                 w.inspection_damaged_units AS damagedUnits,
                                                 w.inspection_notes AS inspectionNotes
                                          FROM rental_booking_allocations a
                                                   LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                                   JOIN bookings b ON b.booking_reference=a.booking_reference COLLATE utf8mb4_unicode_ci AND b.store_id=a.store_id AND b.branch_id=a.branch_id
                                              AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement','approved','completed')
                                          WHERE a.id=? AND a.store_id=? AND a.branch_id=? FOR UPDATE`,[allocationId,scope.storeId,scope.branchId]);
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
    const workflowSql=`INSERT IGNORE INTO rental_staff_allocation_workflow (store_id,branch_id,allocation_id) VALUES (?,?,?)`;
    await db.execute(workflowSql,[scope.storeId,scope.branchId,allocationId]);
    const total=Number(equipment.total_units),out=Number(equipment.rented_out_units),hold=Number(equipment.maintenance_units),missing=Number(equipment.missing_units);
    if(action==='prepare_rental_allocation') {
        if(a.status!=='reserved'||a.preparedAt)fail(409,'This booking is already prepared or cannot be prepared.');
        // Preparation means physically gathered and usable equipment, not a free-form status flag.
        // Staff-reported damage/holds may reduce stock after the booking was confirmed.
        if(qty>total-out-hold-missing)fail(409,'Not enough physically usable units to prepare this booking. Resolve damaged or missing stock first.');
        await db.execute('UPDATE rental_staff_allocation_workflow SET prepared_at=NOW(),prepared_by=? WHERE allocation_id=?',[scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'prepared',qty,ref,'Equipment prepared for scheduled release');
        await markRentalPreparation(db,scope,ref);
    } else if(action==='release_rental_allocation') {
        // Financial obligation is enforced in the rental Lambda, never just the browser.
        const [payment]=await db.execute(`SELECT agreed_price,amount_paid,balance,status
                                          FROM bookings WHERE store_id=? AND branch_id=? AND booking_reference=? LIMIT 1 FOR UPDATE`,
            [scope.storeId,scope.branchId,ref]);
        const bill=payment[0];
        const total=Number(bill?.agreed_price||0),paid=Number(bill?.amount_paid||0);
        if(!bill || !['confirmed','preparing'].includes(String(bill.status).toLowerCase()) ||
            !Number.isFinite(total)||total<=0||!Number.isFinite(paid)||paid+.005<total||Number(bill.balance||0)>.005)
            fail(409,'Customer must fully settle the booking balance before any rental equipment can be released.');
        if(a.status!=='reserved'||!a.preparedAt)fail(409,'Prepare this confirmed booking before release.');
        if(String(a.start_date).slice(0,10)>todayPh())fail(409,'This booking cannot be released before its scheduled start date.');
        if(qty>total-out-hold-missing)fail(409,'Not enough physically available units to release.');
        await db.execute(`UPDATE rental_booking_allocations SET status='checked_out' WHERE id=?`,[allocationId]);
        await db.execute('UPDATE rental_equipment SET rented_out_units=rented_out_units+? WHERE id=?',[qty,equipment.id]);
        await db.execute('UPDATE rental_staff_allocation_workflow SET released_at=NOW(),released_by=? WHERE allocation_id=?',[scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'rented_out',qty,ref,'Physical handover confirmed');
    } else if(action==='return_rental_allocation') {
        if(a.status!=='checked_out'||out<qty)fail(409,'Booking is not checked out or stock needs reconciliation.');
        // Reconcile every issued unit: received units are held for inspection;
        // missing units immediately become unavailable pending Manager resolution.
        const missingCount=whole(body.missingUnits ?? 0,'Missing units on return');
        if(missingCount>qty)fail(400,'Missing units cannot exceed the booking quantity.');
        if(missingCount>0&&note.length<5)fail(400,'Explain missing units in at least five characters.');
        const receivedCount=qty-missingCount;
        await db.execute(`UPDATE rental_booking_allocations SET status='returned' WHERE id=?`,[allocationId]);
        await db.execute(`UPDATE rental_equipment SET rented_out_units=rented_out_units-?,
                                                      maintenance_units=maintenance_units+?,missing_units=missing_units+? WHERE id=?`,
            [qty,receivedCount,missingCount,equipment.id]);
        await db.execute(`UPDATE rental_staff_allocation_workflow SET returned_at=NOW(),returned_by=?,
                                                                      returned_received_units=?,inspection_status=? WHERE allocation_id=?`,
            [scope.actor,receivedCount,receivedCount>0?'pending':'cleared',allocationId]);
        if(receivedCount>0)await appendMovement(db,scope,equipment.id,'returned',receivedCount,ref,'Physically returned - held for inspection');
        if(missingCount>0){
            const [report]=await db.execute(`INSERT INTO rental_missing_unit_reports
                                             (store_id,branch_id,equipment_id,quantity,reason,reported_by,booking_reference)
                                             VALUES(?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,missingCount,
                `Booking ${ref}: ${note}`,scope.actor,ref]);
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
            // Read the original observed damage and notes from the LOCKED workflow
            // record; ignore client-provided quantities to prevent silent rewriting.
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
        if(goodCount>0)await db.execute('UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?',[goodCount,equipment.id]);
        if(damagedCount>0){
            const [record]=await db.execute(`INSERT INTO rental_maintenance_records
                                             (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,start_reason,booking_reference)
                                             VALUES (?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,damagedCount,damagedCount,`Rental damage ${ref}: ${finalNote}`,ref]);
            await db.execute(`UPDATE rental_staff_allocation_workflow SET maintenance_record_id=? WHERE allocation_id=?`,
                [record.insertId,allocationId]);
        }
        const nextStatus=cleaningCount>0?'cleaning':damagedCount>0?'damaged':'cleared';
        await db.execute(`UPDATE rental_staff_allocation_workflow SET inspected_at=NOW(),inspected_by=?,
                                                                      inspection_status=?,inspection_notes=?,inspection_cleaning_units=?,inspection_damaged_units=? WHERE allocation_id=?`,
            [scope.actor,nextStatus,finalNote||null,cleaningCount,damagedCount,allocationId]);
        await appendMovement(db,scope,equipment.id,'inspected',receivedCount,ref,
            `Return condition finalized: ${goodCount} ready, ${cleaningCount} cleaning, ${damagedCount} damaged${finalNote?` - ${finalNote}`:''}`);
        if(damagedCount>0)await appendMovement(db,scope,equipment.id,'damage_reported',damagedCount,ref,
            `Damage held for Manager approval: ${finalNote}`);
        await settleReturnedRentalBooking(db,scope,ref);
    } else if(action==='clean_rental_allocation') {
        if(a.status!=='returned'||a.inspectionStatus!=='cleaning')fail(409,'No cleaning task is pending for this booking.');
        // NULL means an older whole-allocation cleaning record (before split inspections).
        const cleaningCount=a.cleaningUnits==null?qty:Number(a.cleaningUnits);
        const damagedCount=a.damagedUnits==null?0:Number(a.damagedUnits);
        if(!Number.isSafeInteger(cleaningCount)||cleaningCount<1||hold<cleaningCount)
            fail(409,'Cleaning hold quantity needs reconciliation.');
        await db.execute('UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?',[cleaningCount,equipment.id]);
        await db.execute(`UPDATE rental_staff_allocation_workflow SET inspection_status=?,inspection_cleaning_units=0,
                                                                      cleaned_at=NOW(),cleaned_by=? WHERE allocation_id=?`,
            [damagedCount>0?'damaged':'cleared',scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'cleaned',cleaningCount,ref,note||'Cleaning completed');
        await settleReturnedRentalBooking(db,scope,ref);
    } else fail(400,'Unsupported staff rental action.');
    return {referenceNumber:ref,allocationId};
}

async function staffRentalStockMutation(db,scope,body) {
    const action=String(body.action||"");
    if(action==="staff_receive_rental_purchase") {
        const taskId=id(body.taskId,"Purchase receiving task");
        const [identity]=await db.execute(`SELECT equipment_id FROM rental_receiving_tasks WHERE id=? AND store_id=? AND branch_id=?`,
            [taskId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Receiving task not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        const [tasks]=await db.execute(`SELECT t.*,p.purchase_number AS purchaseNumber,p.purchase_date AS purchaseDate
                                        FROM rental_receiving_tasks t JOIN rental_purchase_transactions p ON p.id=t.purchase_id
                                        WHERE t.id=? AND t.store_id=? AND t.branch_id=? FOR UPDATE`,[taskId,scope.storeId,scope.branchId]);
        const task=tasks[0];
        const quantity=whole(body.quantity,"Quantity received",true);
        const remaining=Number(task.quantity_expected)-Number(task.quantity_received);
        if(quantity>remaining)fail(409,`Only ${remaining} units remain to be received for this purchase.`);
        const newTotal=Number(equipment.total_units)+quantity;
        if(newTotal>2147483647)fail(409,"Stock quantity exceeds the equipment limit.");
        const newCostCents=Math.round((Number(equipment.total_units)*Math.round(Number(equipment.average_unit_cost)*100)+
            quantity*Math.round(Number(task.unit_cost)*100))/newTotal);
        // Some existing installations enforce one stock_receipts row per purchase item.
        // Accumulate partial deliveries in that existing receipt, and audit EACH delivery
        // in rental_stock_movements. Never insert a second row with the same purchase_item_id.
        const [existingReceipts]=await db.execute(`SELECT id,receiving_number FROM rental_stock_receipts
                                                   WHERE purchase_item_id=? AND equipment_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
            [task.purchase_item_id,equipment.id,scope.storeId,scope.branchId]);
        let receiptId;
        if(existingReceipts.length) {
            if(existingReceipts.length!==1)fail(409,"Purchase receipt records need reconciliation.");
            receiptId=Number(existingReceipts[0].id);
            await db.execute(`UPDATE rental_stock_receipts SET quantity_received=quantity_received+?,
                                                               received_date=?,received_by=? WHERE id=?`,[quantity,todayPh(),scope.actor,receiptId]);
        } else {
            const [receipt]=await db.execute(`INSERT INTO rental_stock_receipts
                                              (store_id,branch_id,purchase_item_id,equipment_id,quantity_received,unit_purchase_cost,received_date,received_by)
                                              VALUES(?,?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,task.purchase_item_id,equipment.id,quantity,
                Number(task.unit_cost),todayPh(),scope.actor]);
            receiptId=Number(receipt.insertId);
        }
        const prefix=await branchCodes(db,scope);
        const receiptNumber=`${prefix}-RRCV-${String(receiptId).padStart(6,"0")}`;
        if(!existingReceipts.length)await db.execute("UPDATE rental_stock_receipts SET receiving_number=? WHERE id=?",[receiptNumber,receiptId]);
        await db.execute(`UPDATE rental_equipment SET total_units=?,average_unit_cost=?,
                                                      last_supplier=(SELECT supplier FROM rental_purchase_transactions WHERE id=?) WHERE id=?`,
            [newTotal,intMoney(newCostCents),task.purchase_id,equipment.id]);
        await db.execute(`UPDATE rental_receiving_tasks SET quantity_received=quantity_received+?,
                                                            received_by=?,last_received_at=NOW() WHERE id=?`,[quantity,scope.actor,taskId]);
        await appendMovement(db,scope,equipment.id,"received",quantity,task.purchaseNumber,
            `Staff physically received: ${receiptNumber}`);
        return {referenceNumber:receiptNumber,taskId};
    }
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
            const [r]=await db.execute(`INSERT INTO rental_missing_unit_reports
                                            (store_id,branch_id,equipment_id,quantity,reason,reported_by)
                                        VALUES(?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,quantity,reason,scope.actor]);
            await db.execute(`UPDATE rental_equipment SET missing_units=missing_units+? WHERE id=?`,[quantity,equipment.id]);
            const ref=`MISS-${String(r.insertId).padStart(6,"0")}`;
            await appendMovement(db,scope,equipment.id,"missing_reported",quantity,ref,`Staff reported missing units: ${reason}`);
            return {referenceNumber:ref};
        }
        const [r]=await db.execute(`INSERT INTO rental_maintenance_records
                                    (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,start_reason,condition_status)
                                    VALUES(?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,quantity,quantity,reason,
            issueType === "routine" ? "Routine" : "For Inspection"]);
        await db.execute("UPDATE rental_equipment SET maintenance_units=maintenance_units+? WHERE id=?",[quantity,equipment.id]);
        const ref=`MNT-${String(r.insertId).padStart(6,"0")}`;
        await appendMovement(db,scope,equipment.id,"maintenance_started",quantity,ref,
            `${issueType === "routine" ? "Staff routine care" : "Staff reported damage"}: ${reason}`);
        return {referenceNumber:ref};
    }
    if(action==="staff_complete_routine_maintenance") {
        const maintenanceId=id(body.maintenanceId,"Routine maintenance record");
        const [identity]=await db.execute(`SELECT equipment_id FROM rental_maintenance_records
                                           WHERE id=? AND store_id=? AND branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Routine maintenance task not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        const [records]=await db.execute(`SELECT quantity_remaining,condition_status,repair_approved_at,booking_reference
                                          FROM rental_maintenance_records WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
            [maintenanceId,scope.storeId,scope.branchId]);
        const record=records[0];
        if(!record || record.condition_status!=="Routine" || record.repair_approved_at)
            fail(403,"Only routine cleaning and non-safety upkeep can be completed without Manager approval.");
        const qty=whole(body.quantity,"Completed routine-care units",true);
        if(qty>Number(record.quantity_remaining)||qty>Number(equipment.maintenance_units))
            fail(409,"The routine-care quantity is no longer available. Refresh this task.");
        const notes=requiredText(body.notes,500,"Routine-care completion notes");
        if(notes.length<5)fail(400,"Describe the completed work in at least 5 characters.");
        const [pending]=await db.execute(`SELECT COUNT(*) AS count FROM rental_maintenance_completion_requests
                                          WHERE maintenance_record_id=? AND status='pending'`,[maintenanceId]);
        if(Number(pending[0].count)>0)fail(409,"This maintenance record has a pending approval request.");
        await db.execute(`UPDATE rental_maintenance_records SET quantity_remaining=quantity_remaining-?,
                                                                completion_notes=?,completed_at=CASE WHEN quantity_remaining=? THEN NOW() ELSE completed_at END
                          WHERE id=?`,[qty,notes,qty,maintenanceId]);
        await db.execute(`UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?`,[qty,equipment.id]);
        const referenceNumber=`MNT-${String(maintenanceId).padStart(6,"0")}`;
        await appendMovement(db,scope,equipment.id,"maintenance_completed",qty,referenceNumber,
            `Staff completed routine cleaning/upkeep: ${notes}`);
        if(record.booking_reference)await settleReturnedRentalBooking(db,scope,record.booking_reference);
        return {referenceNumber};
    }
    if(action==="staff_submit_repair_completion") {
        const maintenanceId=id(body.maintenanceId,"Maintenance record");
        const [identity]=await db.execute(`SELECT equipment_id FROM rental_maintenance_records
                                           WHERE id=? AND store_id=? AND branch_id=?`,[maintenanceId,scope.storeId,scope.branchId]);
        if(!identity.length)fail(404,"Maintenance record not found.");
        const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
        const [records]=await db.execute(`SELECT quantity_remaining,repair_approved_at,condition_status FROM rental_maintenance_records
                                          WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[maintenanceId,scope.storeId,scope.branchId]);
        if(records[0]?.condition_status === "Routine")
            fail(409,"Use the routine-care completion action for this task.");
        if(!records[0]?.repair_approved_at)fail(409,"Manager repair approval is required before completion.");
        const quantity=whole(body.quantity,"Completed units",true);
        const [pending]=await db.execute(`SELECT COALESCE(SUM(quantity),0) AS total FROM rental_maintenance_completion_requests
                                          WHERE maintenance_record_id=? AND status='pending'`,[maintenanceId]);
        if(Number(pending[0].total)>0)fail(409,"A repair completion request is already awaiting Manager review.");
        if(quantity>Number(records[0].quantity_remaining))
            fail(409,"Completed quantity exceeds the remaining maintenance units.");
        const notes=requiredText(body.notes,500,"Repair completion notes");
        if(notes.length<5)fail(400,"Enter at least five characters describing the completed work.");
        const [r]=await db.execute(`INSERT INTO rental_maintenance_completion_requests
                                    (store_id,branch_id,equipment_id,maintenance_record_id,quantity,notes,requested_by)
                                    VALUES(?,?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,maintenanceId,quantity,notes,scope.actor]);
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

const READ_ACTIONS = new Set(["get_manager_inventory","check_availability","get_rental_supplier_payables","get_rental_purchase_items","get_owner_supplier_payables"]);
const STAFF_READ_ACTIONS = new Set(["get_staff_rental_workspace","get_staff_equipment_schedule"]);
const STAFF_WRITE_ACTIONS = new Set(["prepare_rental_allocation","release_rental_allocation",
    "return_rental_allocation","inspect_rental_allocation","clean_rental_allocation",
    "release_rental_booking","return_rental_booking",
    "staff_receive_rental_purchase","staff_report_equipment_issue","staff_submit_repair_completion",
    "staff_complete_routine_maintenance"]);
const WRITE_ACTIONS = new Set(["create_equipment","import_equipment","update_equipment","receive_equipment",
    "approve_maintenance_repair","approve_repair_completion","resolve_missing_equipment","archive_equipment",
    "create_rental_category","rename_rental_category",
    "archive_rental_category","pay_rental_supplier_purchase"]);

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
            db=await dbPool.getConnection();
            const [rows]=await db.execute(`SELECT p.id AS purchaseId,p.purchase_number AS purchaseNumber,
                                                  p.supplier,b.branch_name AS branchName,p.purchase_total AS purchaseTotal,
                                                  DATE_FORMAT(p.payment_due_date,'%Y-%m-%d') AS paymentDueDate,
                                                  COALESCE((SELECT SUM(pay.amount) FROM rental_supplier_payments pay
                                                            WHERE pay.purchase_id=p.id),0) AS amountPaid
                                           FROM rental_purchase_transactions p
                                                    LEFT JOIN branches b ON b.id=p.branch_id AND b.store_id=p.store_id
                                           WHERE p.store_id=? ORDER BY p.id DESC`,[storeId]);
            const payables=rows.map(r=>{
                const purchaseTotal=Number(r.purchaseTotal||0);
                const amountPaid=Number(r.amountPaid||0);
                const outstandingBalance=Math.max(0,Math.round((purchaseTotal-amountPaid)*100)/100);
                return {...r,purchaseTotal,amountPaid,outstandingBalance,
                    paymentStatus:outstandingBalance<0.005?"Paid":amountPaid>0?"Partially Paid":"Unpaid"};
            });
            return reply(200,{success:true,payables});
        }
        // Resolve the manager's assigned branch from the verified manager record,
        // not from the browser's branch_id. Owner must select a store-owned branch.
        let branchId = role==="owner" ? id(body.branch_id||body.branchId,"Branch ID") : null;
        let actor=trim(session.email,150)||role;
        db = await dbPool.getConnection();
        if(role==="manager") {
            const managerId=id(session.manager_id,"Manager ID");
            const [managers]=await db.execute(`SELECT branch_id AS branchId,manager_name AS managerName,status,permissions
                                               FROM managers WHERE id=? AND store_id=? LIMIT 1`,[managerId,storeId]);
            if(!managers.length || !['active','accepted'].includes(String(managers[0].status).toLowerCase()))
                fail(403,"An active Manager account is required.");
            branchId=id(managers[0].branchId,"Assigned branch");
            // A moved employee must sign in again; never authorize using a stale branch claim.
            if(Number(session.branch_id)!==branchId)fail(403,"Branch assignment changed. Please sign in again.");
            const access=rentalInventoryPermission(managers[0].permissions,"manager");
            if(access==="none")fail(403,"Inventory access is not assigned to this Manager.");
            if(WRITE_ACTIONS.has(action) && access!=="full")fail(403,"Full Inventory access is required to change equipment or supplier records.");
            actor=trim(managers[0].managerName,150)||actor;
        }
        if(role==="staff") {
            const staffId=id(session.staff_id,"Staff ID");
            const [staff]=await db.execute(`SELECT branch_id,staff_name,status,permissions FROM staff
                                            WHERE id=? AND store_id=? LIMIT 1`,[staffId,storeId]);
            if(!staff.length||!['active','accepted'].includes(String(staff[0].status).toLowerCase()))
                fail(403,"Active staff account required.");
            branchId=id(staff[0].branch_id,"Assigned branch");
            if(Number(session.branch_id)!==branchId)fail(403,"Branch assignment changed. Please sign in again.");
            const access=rentalInventoryPermission(staff[0].permissions,"staff");
            if(access==="none")fail(403,"Inventory access is not assigned to this Staff account.");
            if(STAFF_WRITE_ACTIONS.has(action) && access!=="full")
                fail(403,"Full Inventory access is required for rental receiving, releases, returns and condition tasks.");
            actor=trim(staff[0].staff_name,150)||actor;
        }
        const scope={storeId,branchId,actor,role,requestKey:""};
        const [branches]=await db.execute(`SELECT b.id,s.store_name AS storeName,b.branch_name AS branchName,
                                                  s.store_code AS storeCode,b.branch_code AS branchCode
                                           FROM branches b JOIN stores s ON s.id=b.store_id
                                           WHERE b.id=? AND b.store_id=? LIMIT 1`,[branchId,storeId]);
        if(!branches.length)fail(403,"Invalid branch or store association.");
        scope.storeName=branches[0].storeName;
        scope.branchName=branches[0].branchName;
        if(action==="get_staff_rental_workspace")return reply(200,await staffRentalWorkspace(db,scope));
        if(action==="get_staff_equipment_schedule")return reply(200,await staffEquipmentSchedule(db,scope,body));
        if(action==="get_manager_inventory")return reply(200,await getInventory(db,scope));
        if(action==="check_availability")return reply(200,await checkAvailability(db,scope,body));
        if(action==="get_rental_supplier_payables")return reply(200,await getPayables(db,scope));
        if(action==="get_rental_purchase_items")return reply(200,await getPurchaseItems(db,scope,body));
        const requestKey=requiredText(body.requestKey,90,"Request key");
        scope.requestKey=requestKey;
        await db.beginTransaction();
        transactionOpen = true;
        await lockBranch(db,scope);
        // One database-enforced idempotency key, shared across every rental write action.
        const [claimed]=await db.execute(`INSERT IGNORE INTO rental_api_requests
      (store_id,branch_id,request_key,action) VALUES(?,?,?,?)`,[storeId,branchId,requestKey,action]);
        if(!claimed.affectedRows){
            const [existing]=await db.execute(`SELECT action,response_json FROM rental_api_requests
                                               WHERE store_id=? AND branch_id=? AND request_key=? FOR UPDATE`,[storeId,branchId,requestKey]);
            if(existing[0]?.action!==action)fail(409,"This request key belongs to a different action.");
            if(!existing[0]?.response_json)fail(409,"The same operation is still being processed.");
            await db.commit();
            transactionOpen = false;
            return reply(200,JSON.parse(existing[0].response_json));
        }
        const result=STAFF_WRITE_ACTIONS.has(action)
            ? (["staff_receive_rental_purchase","staff_report_equipment_issue","staff_submit_repair_completion",
                "staff_complete_routine_maintenance"].includes(action)
                ? await staffRentalStockMutation(db,scope,body)
                : ['release_rental_booking','return_rental_booking'].includes(action)
                    ? await staffRentalBookingMutation(db,scope,body)
                    : await staffRentalMutation(db,scope,body))
            : await mutate(db,scope,body);
        const output={success:true,...result};
        await db.execute(`UPDATE rental_api_requests SET response_json=? WHERE store_id=? AND branch_id=? AND request_key=?`,
            [JSON.stringify(output),storeId,branchId,requestKey]);
        await db.commit();
        transactionOpen = false;
        // Missing-item resolution can be the LAST outstanding condition after
        // the customer has already paid. Recheck in a fresh transaction so
        // the physical equipment locks are released before locking bookings,
        // avoiding the opposite lock order used by Staff booking workflows.
        // A successful Inventory resolution must not be rolled back or falsely
        // reported as failed if this follow-up status sync cannot run.
        if(action==="resolve_missing_equipment" && result.bookingReference){
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