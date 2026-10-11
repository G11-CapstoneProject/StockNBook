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
function equipmentInput(input) {
    const name = requiredText(input.name, 150, "Equipment name");
    const category = requiredText(input.category, 100, "Category");
    const alertLevel = whole(input.alertLevel, "Low availability alert");
    const rateCents = cents(input.rentalRatePerDay, "Rental rate per unit per day");
    return { name, category, alertLevel, rateCents };
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
    const [receipt] = await db.execute(`INSERT INTO rental_stock_receipts
                                        (store_id,branch_id,purchase_item_id,equipment_id,quantity_received,unit_purchase_cost,received_date,received_by)
                                        VALUES(?,?,?,?,?,?,?,?)`, [scope.storeId,scope.branchId,item.insertId,equipmentRow.id,purchase.quantity,
        intMoney(purchase.unitCents),purchase.purchaseDate,scope.actor]);
    const receivingNumber = `${prefix}-RRCV-${String(receipt.insertId).padStart(6, "0")}`;
    await db.execute("UPDATE rental_stock_receipts SET receiving_number=? WHERE id=?", [receivingNumber,receipt.insertId]);
    if (purchase.paidCents > 0) {
        await db.execute(`INSERT INTO rental_supplier_payments (purchase_id,amount,payment_date,request_key) VALUES(?,?,?,?)`,
            [purchaseId,intMoney(purchase.paidCents),purchase.purchaseDate,`INITIAL-${purchaseId}`]);
    }
    const oldQty = Number(equipmentRow.total_units);
    const nextQty = oldQty + purchase.quantity;
    if (!Number.isSafeInteger(nextQty) || nextQty > 2147483647) fail(400,"Equipment total would exceed allowed limits.");
    const oldCostCents = Math.round(Number(equipmentRow.average_unit_cost || 0) * 100);
    const nextAverageCents = Math.round((oldQty * oldCostCents + purchase.quantity * purchase.unitCents) / nextQty);
    await db.execute(`UPDATE rental_equipment SET total_units=?,average_unit_cost=?,last_supplier=? WHERE id=?`,
        [nextQty,intMoney(nextAverageCents),purchase.supplier,equipmentRow.id]);
    equipmentRow.total_units = nextQty;
    equipmentRow.average_unit_cost = intMoney(nextAverageCents);
    await appendMovement(db,scope,equipmentRow.id,"received",purchase.quantity,purchaseNumber,`Supplier: ${purchase.supplier}, Receipt: ${receivingNumber}`);
    return { purchaseId,purchaseNumber,receivingNumber,amountPaid:intMoney(purchase.paidCents),
        outstandingBalance:intMoney(purchase.totalCents-purchase.paidCents) };
}
async function createEquipment(db,scope,raw,source) {
    const e = equipmentInput(raw);
    const cid = await categoryId(db,scope,e.category);
    const [created] = await db.execute(`INSERT INTO rental_equipment
                                        (store_id,branch_id,category_id,name,name_key,alert_level,rental_rate_per_day)
                                        VALUES(?,?,?,?,?,?,?)`, [scope.storeId,scope.branchId,cid,e.name,key(e.name),e.alertLevel,intMoney(e.rateCents)]);
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
                const rentalRateCents = cents(line.rentalRatePerDay, "Rental rate per day");
                if (uniqueNames.has(key(name))) fail(400, `Duplicate rental equipment in workbook: ${name}`);
                uniqueNames.add(key(name));
                const lineCents = quantity * unitCents;
                totalCents += lineCents;
                if (!Number.isSafeInteger(totalCents) || totalCents > 99999999999999)
                    fail(400, "Combined supplier purchase total is too large.");
                normalizedRows.push({ name, category, quantity, unitCents, rentalRateCents });
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
                    rentalRatePerDay: intMoney(line.rentalRateCents)
                }, "import");
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
                const [receipt] = await db.execute(`INSERT INTO rental_stock_receipts
                                                    (store_id,branch_id,purchase_item_id,equipment_id,quantity_received,unit_purchase_cost,received_date,received_by)
                                                    VALUES(?,?,?,?,?,?,?,?)`, [scope.storeId,scope.branchId,item.insertId,line.equipmentId,
                    line.quantity,intMoney(line.unitCents),purchaseDate,scope.actor]);
                const receivingNumber = `${prefix}-RRCV-${String(receipt.insertId).padStart(6, "0")}`;
                await db.execute("UPDATE rental_stock_receipts SET receiving_number=? WHERE id=?", [receivingNumber,receipt.insertId]);
                await db.execute(`UPDATE rental_equipment SET total_units=?,average_unit_cost=?,last_supplier=?
                                  WHERE id=? AND store_id=? AND branch_id=?`,
                    [line.quantity,intMoney(line.unitCents),supplier,line.equipmentId,scope.storeId,scope.branchId]);
                await appendMovement(db,scope,line.equipmentId,"received",line.quantity,purchaseNumber,
                    `Supplier: ${supplier}, Receipt: ${receivingNumber}`);
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
            const rate = body.rentalRatePerDay == null ? Number(current.rental_rate_per_day) : intMoney(cents(body.rentalRatePerDay,"Rental rate"));
            const cat = await categoryId(db,scope,category);
            await db.execute(`UPDATE rental_equipment SET name=?,name_key=?,category_id=?,alert_level=?,rental_rate_per_day=? WHERE id=?`,
                [name,key(name),cat,alert,rate,current.id]);
            return { equipmentId:current.id,referenceNumber:current.equipment_number };
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
            const [r]=await db.execute(`INSERT INTO rental_maintenance_records
        (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,start_reason,
         condition_status,estimated_completion_date) VALUES(?,?,?,?,?,?,?,?)`,
                [scope.storeId,scope.branchId,current.id,qty,qty,reason,conditionStatus,estimate]);
            await db.execute("UPDATE rental_equipment SET maintenance_units=maintenance_units+? WHERE id=?",[qty,current.id]);
            const ref=`MNT-${String(r.insertId).padStart(6,"0")}`;
            await appendMovement(db,scope,current.id,"maintenance_started",qty,ref,reason);
            return {referenceNumber:ref};
        }
        case "complete_maintenance": {
            const current=await lockEquipment(db,scope,id(body.equipmentId,"Equipment ID"));
            const qty=whole(body.quantity,"Completed maintenance quantity",true);
            if (qty>Number(current.maintenance_units)) fail(409,"Cannot complete more maintenance units than are currently under repair.");
            const reason=requiredText(body.reason,500,"Repair completion notes");
            if(reason.length<5)fail(400,"Repair completion notes must have at least 5 characters.");
            const [open] = await db.execute(`SELECT id,quantity_remaining FROM rental_maintenance_records
                                             WHERE equipment_id=? AND store_id=? AND branch_id=? AND quantity_remaining>0 ORDER BY id ASC FOR UPDATE`,
                [current.id,scope.storeId,scope.branchId]);
            let remaining=qty, firstId=null;
            for(const row of open) {
                if (remaining===0) break;
                if (firstId===null) firstId=Number(row.id);
                const used=Math.min(remaining,Number(row.quantity_remaining));
                const fullyCompleted = used === Number(row.quantity_remaining);
                await db.execute(`UPDATE rental_maintenance_records SET quantity_remaining=quantity_remaining-?,
                                                                        completion_notes=?,completed_at=CASE WHEN ?=1 THEN NOW() ELSE completed_at END WHERE id=?`,
                    [used,reason,fullyCompleted ? 1 : 0,row.id]);
                remaining-=used;
            }
            if (remaining>0) fail(409,"Maintenance log does not match equipment stock. Reconcile records first.");
            await db.execute("UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?",[qty,current.id]);
            const ref=`MNT-${String(firstId).padStart(6,"0")}`;
            await appendMovement(db,scope,current.id,"maintenance_completed",qty,ref,reason);
            return {referenceNumber:ref};
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
                                               e.average_unit_cost AS averageUnitCost,e.last_supplier AS lastSupplier
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
                                                        m.condition_status AS status
                                                 FROM rental_maintenance_records m
                                                          LEFT JOIN rental_equipment e ON e.id=m.equipment_id
                                                     AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                 WHERE m.store_id=? AND m.branch_id=? AND m.quantity_remaining>0
                                                 ORDER BY m.opened_at DESC,m.id DESC LIMIT 1000`,
        [scope.storeId,scope.branchId]);
    const [categories]=await db.execute(`SELECT name FROM rental_categories WHERE store_id=? AND branch_id=? AND archived_at IS NULL ORDER BY name`,
        [scope.storeId,scope.branchId]);
    return {success:true, storeId:scope.storeId, branchId:scope.branchId, storeName:scope.storeName, branchName:scope.branchName, bookingSyncConnected: process.env.RENTAL_BOOKING_SYNC_ENABLED === "true", equipment:equipment.map(row=>({ ...row,id:Number(row.id),totalUnits:Number(row.totalUnits),
            rentedOutUnits:Number(row.rentedOutUnits),maintenanceUnits:Number(row.maintenanceUnits),missingUnits:Number(row.missingUnits),
            alertLevel:Number(row.alertLevel),active:Boolean(row.active),rentalRatePerDay:Number(row.rentalRatePerDay),
            averageUnitCost:row.averageUnitCost===null?null:Number(row.averageUnitCost)})),
        activity,
        maintenanceRecords:maintenanceRecords.map(row=>({
            ...row,id:Number(row.id),equipmentId:Number(row.equipmentId),
            quantityStarted:Number(row.quantityStarted),units:Number(row.units)
        })),
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
                                                   CASE WHEN m.id IS NOT NULL AND m.quantity_remaining=0 THEN 'cleared' ELSE w.inspection_status END AS inspectionStatus,
                                                   w.inspection_notes AS inspectionNotes
                                            FROM rental_booking_allocations a
                                                     JOIN rental_equipment e ON e.id=a.equipment_id AND e.store_id=a.store_id AND e.branch_id=a.branch_id AND e.archived_at IS NULL
                                                     JOIN bookings b ON b.booking_reference=a.booking_reference COLLATE utf8mb4_unicode_ci AND b.store_id=a.store_id AND b.branch_id=a.branch_id
                                                AND LOWER(b.status) IN ('confirmed','approved','completed')
                                                     LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
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
    return {success:true,equipment:equipment.map(x=>({...x,id:Number(x.id),totalUnits:Number(x.totalUnits),
            rentedOutUnits:Number(x.rentedOutUnits),maintenanceUnits:Number(x.maintenanceUnits),
            missingUnits:Number(x.missingUnits),alertLevel:Number(x.alertLevel)})),
        allocations:allocations.map(x=>({...x,allocationId:Number(x.allocationId),equipmentId:Number(x.equipmentId),quantity:Number(x.quantity)})),
        activity};
}
async function staffRentalMutation(db,scope,body) {
    const action=String(body.action||'');
    const allocationId=id(body.allocationId,'Rental allocation');
    // Lock equipment before the allocation to match other stock write operations.
    const [identity]=await db.execute(`SELECT equipment_id FROM rental_booking_allocations WHERE id=? AND store_id=? AND branch_id=?`,
        [allocationId,scope.storeId,scope.branchId]);
    if(!identity.length)fail(404,'Rental allocation does not belong to this branch.');
    const equipment=await lockEquipment(db,scope,Number(identity[0].equipment_id));
    const [allocations]=await db.execute(`SELECT a.*, w.prepared_at AS preparedAt, w.inspection_status AS inspectionStatus
                                          FROM rental_booking_allocations a
                                                   LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                                   JOIN bookings b ON b.booking_reference=a.booking_reference COLLATE utf8mb4_unicode_ci AND b.store_id=a.store_id AND b.branch_id=a.branch_id
                                              AND LOWER(b.status) IN ('confirmed','approved','completed')
                                          WHERE a.id=? AND a.store_id=? AND a.branch_id=? FOR UPDATE`,[allocationId,scope.storeId,scope.branchId]);
    if(!allocations.length)fail(409,'Only a confirmed, branch-owned booking allocation can be processed.');
    const a=allocations[0], qty=Number(a.quantity);
    if(!Number.isSafeInteger(qty)||qty<1)fail(409,'Rental booking quantity is invalid.');
    const ref=requiredText(a.booking_reference,100,'Booking reference');
    if(['prepare_rental_allocation','release_rental_allocation'].includes(action)) {
        const [eligible]=await db.execute(`SELECT id FROM bookings WHERE booking_reference=? AND store_id=? AND branch_id=?
                                                                     AND LOWER(status) IN ('confirmed','approved') LIMIT 1`,[ref,scope.storeId,scope.branchId]);
        if(!eligible.length)fail(409,'Only currently confirmed bookings can be prepared or released.');
    }
    const note=trim(body.notes,400);
    const workflowSql=`INSERT IGNORE INTO rental_staff_allocation_workflow (store_id,branch_id,allocation_id) VALUES (?,?,?)`;
    await db.execute(workflowSql,[scope.storeId,scope.branchId,allocationId]);
    const total=Number(equipment.total_units),out=Number(equipment.rented_out_units),hold=Number(equipment.maintenance_units),missing=Number(equipment.missing_units);
    if(action==='prepare_rental_allocation') {
        if(a.status!=='reserved'||a.preparedAt)fail(409,'This booking is already prepared or cannot be prepared.');
        await db.execute('UPDATE rental_staff_allocation_workflow SET prepared_at=NOW(),prepared_by=? WHERE allocation_id=?',[scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'prepared',qty,ref,'Equipment prepared for scheduled release');
    } else if(action==='release_rental_allocation') {
        if(a.status!=='reserved'||!a.preparedAt)fail(409,'Prepare this confirmed booking before release.');
        if(String(a.start_date).slice(0,10)>todayPh())fail(409,'This booking cannot be released before its scheduled start date.');
        if(qty>total-out-hold-missing)fail(409,'Not enough physically available units to release.');
        await db.execute(`UPDATE rental_booking_allocations SET status='checked_out' WHERE id=?`,[allocationId]);
        await db.execute('UPDATE rental_equipment SET rented_out_units=rented_out_units+? WHERE id=?',[qty,equipment.id]);
        await db.execute('UPDATE rental_staff_allocation_workflow SET released_at=NOW(),released_by=? WHERE allocation_id=?',[scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'rented_out',qty,ref,'Physical handover confirmed');
    } else if(action==='return_rental_allocation') {
        if(a.status!=='checked_out'||out<qty)fail(409,'Booking is not checked out or stock needs reconciliation.');
        await db.execute(`UPDATE rental_booking_allocations SET status='returned' WHERE id=?`,[allocationId]);
        // All returned units go on inspection hold; staff may not release unchecked equipment.
        await db.execute('UPDATE rental_equipment SET rented_out_units=rented_out_units-?,maintenance_units=maintenance_units+? WHERE id=?',[qty,qty,equipment.id]);
        await db.execute(`UPDATE rental_staff_allocation_workflow SET returned_at=NOW(),returned_by=?,inspection_status='pending' WHERE allocation_id=?`,[scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'returned',qty,ref,'Returned - held for inspection');
    } else if(action==='inspect_rental_allocation') {
        if(a.status!=='returned'||a.inspectionStatus!=='pending')fail(409,'Only returned equipment awaiting inspection can be inspected.');
        if(hold<qty)fail(409,'Inspection hold does not match equipment totals.');
        const result=String(body.condition||'');
        if(!['good','cleaning','damaged'].includes(result))fail(400,'Select good condition, needs cleaning, or damaged.');
        if(result==='damaged'&&note.length<5)fail(400,'Describe the damage (at least 5 characters).');
        if(result==='good')await db.execute('UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?',[qty,equipment.id]);
        if(result==='damaged'){
            const [record]=await db.execute(`INSERT INTO rental_maintenance_records
                                             (store_id,branch_id,equipment_id,quantity_started,quantity_remaining,start_reason)
                                             VALUES (?,?,?,?,?,?)`,[scope.storeId,scope.branchId,equipment.id,qty,qty,`Rental damage ${ref}: ${note}`]);
            await db.execute(`UPDATE rental_staff_allocation_workflow SET maintenance_record_id=? WHERE allocation_id=?`,
                [record.insertId,allocationId]);
        }
        await db.execute(`UPDATE rental_staff_allocation_workflow SET inspected_at=NOW(),inspected_by=?,
                                                                      inspection_status=?,inspection_notes=? WHERE allocation_id=?`,
            [scope.actor,result==='good'?'cleared':result,note||null,allocationId]);
        await appendMovement(db,scope,equipment.id,result==='damaged'?'damage_reported':'inspected',qty,ref,
            result==='good'?'Inspection passed':result==='cleaning'?'Cleaning needed':`Damage reported: ${note}`);
    } else if(action==='clean_rental_allocation') {
        if(a.status!=='returned'||a.inspectionStatus!=='cleaning'||hold<qty)fail(409,'No cleaning task is pending for this booking.');
        await db.execute('UPDATE rental_equipment SET maintenance_units=maintenance_units-? WHERE id=?',[qty,equipment.id]);
        await db.execute(`UPDATE rental_staff_allocation_workflow SET inspection_status='cleared',cleaned_at=NOW(),cleaned_by=? WHERE allocation_id=?`,[scope.actor,allocationId]);
        await appendMovement(db,scope,equipment.id,'cleaned',qty,ref,note||'Cleaning completed');
    } else fail(400,'Unsupported staff rental action.');
    return {referenceNumber:ref,allocationId};
}

const READ_ACTIONS = new Set(["get_manager_inventory","check_availability","get_rental_supplier_payables","get_rental_purchase_items"]);
const STAFF_READ_ACTIONS = new Set(["get_staff_rental_workspace"]);
const STAFF_WRITE_ACTIONS = new Set(["prepare_rental_allocation","release_rental_allocation",
    "return_rental_allocation","inspect_rental_allocation","clean_rental_allocation"]);
const WRITE_ACTIONS = new Set(["create_equipment","import_equipment","update_equipment","receive_equipment",
    "start_maintenance","complete_maintenance","create_rental_category","rename_rental_category",
    "archive_rental_category","pay_rental_supplier_purchase"]);

exports.handler = async (event) => {
    if((event?.requestContext?.http?.method||event?.httpMethod)==="OPTIONS")return reply(204,{});
    if((event?.requestContext?.http?.method||event?.httpMethod||"POST")!=="POST")return reply(405,{error:"Use POST."});
    let db;
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
        // Resolve the manager's assigned branch from the verified manager record,
        // not from the browser's branch_id. Owner must select a store-owned branch.
        let branchId = role==="owner" ? id(body.branch_id||body.branchId,"Branch ID") : null;
        let actor=trim(session.email,150)||role;
        db = await mysql.createConnection({
            ...dbConfig,
            timezone: "+08:00",
            dateStrings: true,
            connectTimeout: 10000,
        });
        if(role==="manager") {
            if (session.manager_id) {
                const [managers]=await db.execute(`SELECT branch_id AS branchId, manager_name AS managerName
                                                   FROM managers WHERE id=? AND store_id=? LIMIT 1`,[id(session.manager_id,"Manager ID"),storeId]);
                if(!managers.length) fail(403,"Manager account not found in this store.");
                branchId=id(managers[0].branchId,"Assigned branch");
                actor=trim(managers[0].managerName,150)||actor;
            } else {
                // Compatibility for old session tokens: a manager still needs an
                // explicitly assigned branch in the verified token.
                branchId=id(session.branch_id,"Assigned branch");
            }
        }
        if(role==="staff") {
            const staffId=id(session.staff_id,"Staff ID");
            const [staff]=await db.execute(`SELECT branch_id,staff_name,status,permissions FROM staff
                                            WHERE id=? AND store_id=? LIMIT 1`,[staffId,storeId]);
            if(!staff.length||!['active','accepted'].includes(String(staff[0].status).toLowerCase()))fail(403,"Active staff account required.");
            let permissions={};
            try {permissions=typeof staff[0].permissions==='string'?JSON.parse(staff[0].permissions):staff[0].permissions||{};}catch{}
            if(permissions.inventory!==true&&!['view','full'].includes(permissions.inventory_access))fail(403,"Inventory access is not assigned.");
            branchId=id(staff[0].branch_id,"Assigned branch");
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
        if(action==="get_manager_inventory")return reply(200,await getInventory(db,scope));
        if(action==="check_availability")return reply(200,await checkAvailability(db,scope,body));
        if(action==="get_rental_supplier_payables")return reply(200,await getPayables(db,scope));
        if(action==="get_rental_purchase_items")return reply(200,await getPurchaseItems(db,scope,body));
        const requestKey=requiredText(body.requestKey,90,"Request key");
        scope.requestKey=requestKey;
        await db.beginTransaction();
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
            return reply(200,JSON.parse(existing[0].response_json));
        }
        const result=STAFF_WRITE_ACTIONS.has(action) ? await staffRentalMutation(db,scope,body) : await mutate(db,scope,body);
        const output={success:true,...result};
        await db.execute(`UPDATE rental_api_requests SET response_json=? WHERE store_id=? AND branch_id=? AND request_key=?`,
            [JSON.stringify(output),storeId,branchId,requestKey]);
        await db.commit();
        return reply(action==="create_equipment"||action==="import_equipment"?201:200,output);
    } catch(err) {
        if(db)try{await db.rollback();}catch{}
        // Never expose internal SQL or connection errors to the caller.
        if(!err?.statusCode)console.error("Rental inventory backend:",err);
        const duplicate=err?.code==="ER_DUP_ENTRY";
        const status=err?.statusCode|| (duplicate?409:500);
        return reply(status,{success:false,error:err?.statusCode?err.message:
                duplicate?"A rental record with that name, number, or request key already exists.":"Unable to process rental request. Check server logs."});
    } finally { if(db)await db.end().catch(()=>{}); }
};
