/* eslint-disable @typescript-eslint/no-require-imports */

const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const { createHash } = require("crypto");
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


let bookingItemsCostSchemaCache = null;

async function getBookingItemsCostSchema(connection) {
    if (bookingItemsCostSchemaCache) {
        return bookingItemsCostSchemaCache;
    }

    const [columnRows] = await connection.query(`SHOW COLUMNS FROM booking_items`);
    const availableColumns = new Set(
        columnRows.map((row) => String(row.Field || row.field || "").toLowerCase())
    );

    bookingItemsCostSchemaCache = {
        quantityColumn: [
            "used_quantity",
            "booked_quantity",
            "quantity",
            "reserved_quantity",
        ].find((column) => availableColumns.has(column)) || null,
        hasUnitCost: availableColumns.has("unit_cost"),
    };

    return bookingItemsCostSchemaCache;
}

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

function normalizeDateFilter(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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

// Public package selection must be resolved entirely from the database.
// Client-supplied package names/prices are only cross-checks, never a fallback.
async function findPackageSnapshot(connection, {storeId, branchId, packageId}) {
    if (!Number.isSafeInteger(Number(packageId)) || Number(packageId) <= 0 ||
        !Number.isSafeInteger(Number(branchId)) || Number(branchId) <= 0) return null;
    const [rows] = await connection.execute(`
        SELECT id, name, package_price, down_payment_amount, duration, status, inclusions
        FROM packages
        WHERE id=? AND store_id=? AND branch_id=?
          AND (status IS NULL OR TRIM(status)='' OR LOWER(TRIM(status))='active')
            LIMIT 1`, [Number(packageId), Number(storeId), Number(branchId)]);
    return rows.length ? packageSnapshotFromRow(rows[0]) : null;
}

// Rental equipment is stored separately from consumable Sales booking_items.
// Quotes come from the database (never client-supplied prices). They are NOT revenue
// until Staff completes the physical rental and the allocation is returned.
function rentalDate(value, label) {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
        throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
    }
    return text;
}
function rentalDays(from, to) {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    if (days < 1 || days > 30) throw new Error("Rental period must be from 1 to 30 calendar days.");
    return days;
}
// One calculation for public quotations, the submission check and final confirmation.
// The highest overlapping quantity on any day is the restriction for a date range.
// Checked-out items remain unavailable through today if overdue (same as confirmation).
function rentalPeakReserved(allocations, from, to, today) {
    const changes=new Map();
    for(const allocation of allocations) {
        const status=String(allocation.status);
        if(status!=='reserved'&&status!=='checked_out')continue;
        const first=String(allocation.startDate)>from?String(allocation.startDate):from;
        const heldEnd=status==='checked_out'&&String(allocation.endDate)<today?today:String(allocation.endDate);
        const last=heldEnd<to?heldEnd:to;
        if(first>last)continue;
        changes.set(first,(changes.get(first)||0)+Number(allocation.quantity));
        const following=new Date(Date.parse(`${last}T00:00:00Z`)+86400000).toISOString().slice(0,10);
        changes.set(following,(changes.get(following)||0)-Number(allocation.quantity));
    }
    let active=0,peak=0;
    for(const [,change] of [...changes].sort(([a],[b])=>a.localeCompare(b))){
        active+=change;peak=Math.max(peak,active);
    }
    return peak;
}
function rentalTodayManila() {
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part=type=>parts.find(p=>p.type===type)?.value||'';
    return `${part('year')}-${part('month')}-${part('day')}`;
}
async function rentalOverlapAllocations(connection,{storeId,branchId,equipmentId,from,to}) {
    const [rows]=await connection.execute(`SELECT quantity,status,
                                                  DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
                                                  DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate
                                           FROM rental_booking_allocations
                                           WHERE store_id=? AND branch_id=? AND equipment_id=?
                                             AND status IN ('reserved','checked_out')
                                             AND start_date<=? AND (end_date>=? OR status='checked_out')`,
        [storeId,branchId,equipmentId,to,from]);
    return rows;
}
function rentalMoneyCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100)))
        throw new Error("Invalid rental price in catalog.");
    return Math.round(n * 100);
}
function parseRentalSelection(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > 30) throw new Error("Select at most 30 rental equipment types.");
    const seen = new Set();
    return raw.map(line => {
        const equipmentId = Number(line?.equipmentId);
        const quantity = Number(line?.quantity);
        if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0 ||
            !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || seen.has(equipmentId))
            throw new Error("Rental equipment selections must have unique IDs and valid quantities.");
        seen.add(equipmentId);
        return {equipmentId, quantity,expectedDailyRate:line.expectedDailyRate};
    });
}
async function saveRentalRequestLines(connection,{bookingId,storeId,branchId,reference,startDate,endDate,lines}) {
    if (!lines.length) return {amount:0,count:0};
    const days = rentalDays(startDate,endDate);
    let totalCents=0;
    // Read active catalog entries server-side; do not trust client-supplied amounts.
    for (const line of [...lines].sort((a,b)=>a.equipmentId-b.equipmentId)) {
        const [equipment] = await connection.execute(`SELECT id,name,rental_rate_per_day,total_units,maintenance_units,missing_units
                                                      FROM rental_equipment WHERE id=? AND store_id=? AND branch_id=? AND archived_at IS NULL LIMIT 1`,
            [line.equipmentId,storeId,branchId]);
        if (!equipment.length) throw new Error("Selected rental equipment is unavailable in this branch.");
        const e=equipment[0];
        if (Number(e.total_units)-Number(e.maintenance_units)-Number(e.missing_units)<line.quantity)
            throw new Error(`${e.name}: selected quantity exceeds physical rental stock.`);
        // Read-only availability check. Pending Review is NOT a reservation;
        // an overlapping confirmation is still serialized by confirmRentalAllocations.
        const overlaps=await rentalOverlapAllocations(connection,{
            storeId,branchId,equipmentId:line.equipmentId,from:startDate,to:endDate
        });
        const peak=rentalPeakReserved(overlaps,startDate,endDate,rentalTodayManila());
        const remaining=Math.max(0,Number(e.total_units)-Number(e.maintenance_units)-Number(e.missing_units)-peak);
        if(line.quantity>remaining)
            throw rentalError(`${e.name}: only ${remaining} unit(s) available for ${startDate} to ${endDate}. Please reduce the quantity or choose another date.`);
        const cents=rentalMoneyCents(e.rental_rate_per_day);
        if(line.expectedDailyRate!==undefined&&rentalMoneyCents(line.expectedDailyRate)!==cents)
            throw rentalError(`${e.name}: the daily rental rate changed. Refresh the page before requesting this booking.`);
        if (cents<=0) throw new Error(`${e.name}: daily rental price has not been set.`);
        const lineCents=cents*line.quantity*days;
        if (!Number.isSafeInteger(lineCents)) throw new Error("Rental quotation is too large.");
        totalCents+=lineCents;
        await connection.execute(`INSERT INTO booking_rental_items
                                  (booking_id,store_id,branch_id,booking_reference,equipment_id,equipment_name,quantity,start_date,end_date,
                                   billable_days,daily_rate_snapshot,agreed_line_total)
                                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [bookingId,storeId,branchId,reference,line.equipmentId,e.name,line.quantity,startDate,endDate,days,cents/100,lineCents/100]);
    }
    if (!Number.isSafeInteger(totalCents)) throw new Error("Rental quotation total is too large.");
    return {amount:totalCents/100,count:lines.length};
}
async function rentalQuoteTotal(connection,bookingId,storeId,branchId) {
    const [rows]=await connection.execute(`SELECT COALESCE(SUM(agreed_line_total),0) AS rentalTotal,COUNT(*) AS lineCount
                                           FROM booking_rental_items WHERE booking_id=? AND store_id=? AND branch_id=?`,[bookingId,storeId,branchId]);
    return {total:Number(rows[0].rentalTotal),count:Number(rows[0].lineCount)};
}
function rentalError(message) {const e=new Error(message);e.rentalValidation=true;return e;}
// The equipment row lock serializes reservations of one equipment type, including
// overlapping dates and different booking references. Everything runs in the
// same transaction as the booking's Confirmed/Cancelled status transition.
async function confirmRentalAllocations(connection,{bookingId,storeId,branchId,price}) {
    const [lines]=await connection.execute(`SELECT equipment_id AS equipmentId,quantity,
                                                   DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
                                                   DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate,
                                                   booking_reference AS bookingReference,agreed_line_total AS lineTotal
                                            FROM booking_rental_items WHERE booking_id=? AND store_id=? AND branch_id=? ORDER BY equipment_id FOR UPDATE`,
        [bookingId,storeId,branchId]);
    if(!lines.length)return;
    const agreed=Number(price);
    const minimum=lines.reduce((sum,l)=>sum+Math.round(Number(l.lineTotal)*100),0)/100;
    if(!Number.isFinite(agreed)||agreed<minimum-0.005)
        throw rentalError(`Set an agreed booking price of at least ₱${minimum.toFixed(2)} before confirming this rental.`);
    for(const line of lines) {
        const [eq]=await connection.execute(`SELECT id,total_units,maintenance_units,missing_units FROM rental_equipment
                                             WHERE id=? AND store_id=? AND branch_id=? AND archived_at IS NULL FOR UPDATE`,
            [line.equipmentId,storeId,branchId]);
        if(!eq.length)throw rentalError("Rental equipment was archived. Update the request before confirming.");
        const from=String(line.startDate).slice(0,10),to=String(line.endDate).slice(0,10);
        const existing=await rentalOverlapAllocations(connection,{
            storeId,branchId,equipmentId:line.equipmentId,from,to
        });
        const peak=rentalPeakReserved(existing,from,to,rentalTodayManila());
        const physical=Number(eq[0].total_units)-Number(eq[0].maintenance_units)-Number(eq[0].missing_units);
        if(physical-peak<Number(line.quantity))throw rentalError(`Not enough rental equipment for ${from} to ${to}. Choose another date or reduce quantity.`);
        await connection.execute(`INSERT INTO rental_booking_allocations
                                  (store_id,branch_id,booking_reference,equipment_id,quantity,start_date,end_date,status,rental_charge_total)
                                  VALUES (?,?,?,?,?,?,?,'reserved',?)`,
            [storeId,branchId,line.bookingReference,line.equipmentId,line.quantity,from,to,line.lineTotal]);
    }
}
async function cancelRentalAllocations(connection,{bookingId,storeId,branchId}) {
    const [rows]=await connection.execute(`SELECT a.id,a.status FROM rental_booking_allocations a
                                                                         JOIN booking_rental_items r ON r.booking_reference=a.booking_reference AND r.equipment_id=a.equipment_id
        AND r.store_id=a.store_id AND r.branch_id=a.branch_id
                                           WHERE r.booking_id=? AND a.store_id=? AND a.branch_id=? FOR UPDATE`,[bookingId,storeId,branchId]);
    if(rows.some(r=>r.status==='checked_out'))
        throw rentalError("Receive the checked-out rental equipment before cancelling this booking.");
    if(rows.some(r=>r.status==='returned'))
        throw rentalError("Returned rentals already contain fulfilled charges; contact an administrator for refund adjustments.");
    for(const row of rows)if(row.status==='reserved')
        await connection.execute("UPDATE rental_booking_allocations SET status='cancelled' WHERE id=?",[row.id]);
}
async function requireRentalReturnBeforeCompletion(connection,{bookingId,storeId,branchId}) {
    const [rows]=await connection.execute(`SELECT a.status FROM rental_booking_allocations a
                                                                    JOIN booking_rental_items r ON r.booking_reference=a.booking_reference AND r.equipment_id=a.equipment_id
        AND r.store_id=a.store_id AND r.branch_id=a.branch_id
                                           WHERE r.booking_id=? AND a.store_id=? AND a.branch_id=?`,[bookingId,storeId,branchId]);
    if(rows.some(x=>x.status!=='returned'))throw rentalError("Receive and account for rented equipment before completing the booking.");
    const [requests]=await connection.execute(`SELECT COUNT(*) AS total FROM booking_rental_items
                                               WHERE booking_id=? AND store_id=? AND branch_id=?`,[bookingId,storeId,branchId]);
    if(Number(requests[0].total)>rows.length)throw rentalError("Rental allocation is missing. Confirm the booking correctly before completion.");
}


// A rental booking may close only when every physical return was inspected and every
// booking-linked loss/damage incident received a Manager decision. Financial decisions
// use the EXISTING claims ledger; routine cleaning and repair can proceed separately.
async function requireRentalIncidentSettlement(db,{bookingId,storeId,branchId,allowOutstanding=false}) {
    const [books]=await db.execute(`SELECT booking_reference FROM bookings
                                    WHERE id=? AND store_id=? AND branch_id=? LIMIT 1`,[bookingId,storeId,branchId]);
    if(!books.length)throw rentalError('Booking not found for equipment reconciliation.');
    const reference=books[0].booking_reference;
    const [uninspected]=await db.execute(`SELECT COUNT(*) AS pending FROM rental_booking_allocations a
                                                                              LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                          WHERE a.store_id=? AND a.branch_id=?
                                            AND a.booking_reference COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
                                            AND a.status='returned' AND COALESCE(w.returned_received_units,a.quantity)>0
                                            AND (w.inspected_at IS NULL OR w.inspection_status='pending')`,[storeId,branchId,reference]);
    if(Number(uninspected[0].pending)>0)
        throw rentalError('Staff must inspect all physically returned rental equipment before completing the booking.');
    const [recoveredPending]=await db.execute(`SELECT COUNT(*) AS pending
                                               FROM rental_maintenance_records WHERE store_id=? AND branch_id=? AND booking_reference=?
                                                                                 AND start_reason LIKE 'Recovered missing equipment (report #%'
                                                                                 AND quantity_remaining>0`,[storeId,branchId,reference]);
    if(Number(recoveredPending[0]?.pending||0)>0)
        throw rentalError('Recovered missing equipment must be inspected by Staff before the booking is completed.');
    const [missing]=await db.execute(`SELECT m.status,c.status AS claimStatus,c.approved_amount AS amount,
                                             c.amount_paid AS paid,c.deposit_applied AS applied
                                      FROM rental_missing_unit_reports m LEFT JOIN booking_customer_claims c
                                                                                   ON c.source_type='missing' AND c.source_record_id=m.id AND c.booking_id=?
                                      WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?`,
        [bookingId,storeId,branchId,reference]);
    for(const issue of missing){
        if(issue.status==='pending')throw rentalError('Manager must review missing rental equipment before booking completion.');
        if(issue.status==='writeoff'&&!issue.claimStatus)
            throw rentalError('Manager must approve or waive the verified missing-equipment charge.');
        if(!allowOutstanding&&issue.claimStatus!=='waived'&&Number(issue.paid)+Number(issue.applied)+0.005<Number(issue.amount))
            throw rentalError('Settle the approved missing-equipment charge or apply the held security deposit.');
    }
    const [damage]=await db.execute(`SELECT c.status AS claimStatus,c.approved_amount AS amount,
                                            c.amount_paid AS paid,c.deposit_applied AS applied
                                     FROM rental_maintenance_records m LEFT JOIN booking_customer_claims c
                                                                                 ON c.source_type='damage' AND c.source_record_id=m.id AND c.booking_id=?
                                     WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                       AND m.start_reason LIKE 'Rental damage %'`,[bookingId,storeId,branchId,reference]);
    for(const issue of damage){
        if(!issue.claimStatus)throw rentalError('Manager must approve or waive the booking-linked damage charge.');
        if(!allowOutstanding&&issue.claimStatus!=='waived'&&Number(issue.paid)+Number(issue.applied)+0.005<Number(issue.amount))
            throw rentalError('Settle the approved equipment-damage charge or apply the held security deposit.');
    }
    if(!allowOutstanding){
        // Never complete or refund an underpaid claim, even if its status label was
        // prematurely marked "settled". Deposit application is not cash received.
        const [unpaid]=await db.execute(`SELECT COUNT(*) AS outstanding FROM booking_customer_claims
                                         WHERE booking_id=? AND store_id=? AND branch_id=?
                                           AND status<>'waived'
                                           AND COALESCE(approved_amount,0)>COALESCE(amount_paid,0)+COALESCE(deposit_applied,0)+0.005`,
            [bookingId,storeId,branchId]);
        if(Number(unpaid[0]?.outstanding||0)>0)
            throw rentalError('Record and verify all additional customer payments before completing the booking or refunding the deposit.');
    }
}


// Customer-review records are store-scoped, not a shared blacklist between tenants.
// A phone number is only a lookup clue. The Manager explicitly confirms its owner
// before applying a review flag. Never expose a matching flag in the public portal.
function customerPhoneHash(phone) {
    let digits=String(phone||'').replace(/\D/g,'');
    if(digits.startsWith('00'))digits=digits.slice(2);
    if(digits.length===11 && digits.startsWith('09'))digits='63'+digits.slice(1);
    else if(digits.length===10 && digits.startsWith('9'))digits='63'+digits;
    if(!/^639\d{9}$/.test(digits))return null;
    return createHash('sha256').update(digits).digest('hex');
}
async function getCustomerReviewProfile(db,storeId,phone) {
    const phoneHash=customerPhoneHash(phone);
    if(!phoneHash)return null;
    const [rows]=await db.execute(`SELECT review_required AS reviewRequired,
                                          identity_verified AS identityVerified,reason,updated_by AS updatedBy,
                                          DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i') AS updatedAt
                                   FROM booking_customer_review_profiles WHERE store_id=? AND phone_hash=? LIMIT 1`,
        [storeId,phoneHash]);
    return rows[0]||null;
}
async function requireCustomerReviewClear(db,{bookingId,storeId,branchId,phone}) {
    const review=await getCustomerReviewProfile(db,storeId,phone);
    if(!review || !review.reviewRequired || !review.identityVerified)return;
    const [overrides]=await db.execute(`SELECT id FROM booking_customer_case_events
                                        WHERE store_id=? AND branch_id=? AND booking_id=? AND event_type='confirmation_exception'
                                          AND customer_phone_hash=?
                                          AND created_at >= (SELECT updated_at FROM booking_customer_review_profiles
                                                             WHERE store_id=? AND phone_hash=?)
                                            LIMIT 1`,[storeId,branchId,bookingId,customerPhoneHash(phone),storeId,customerPhoneHash(phone)]);
    if(!overrides.length)throw rentalError('Customer review required. A Manager must verify the customer and document an exception for this booking before confirmation.');
}
async function requirePhysicalAndIncidentDecision(db,{bookingId,storeId,branchId}) {
    const [bill]=await db.execute(`SELECT agreed_price,amount_paid FROM bookings
                                   WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[bookingId,storeId,branchId]);
    if(!bill.length || Number(bill[0].agreed_price||0)<=0 ||
        Number(bill[0].amount_paid||0)+0.005<Number(bill[0].agreed_price))
        throw rentalError('Original booking price must be fully paid.');
    const [sales]=await db.execute(`SELECT COUNT(*) AS pendingCount
                                    FROM booking_items bi LEFT JOIN booking_sales_fulfillment f
                                                                    ON f.booking_item_id=bi.id AND f.store_id=bi.store_id AND f.branch_id=bi.branch_id
                                    WHERE bi.booking_id=? AND bi.store_id=? AND bi.branch_id=?
                                      AND bi.product_id IS NOT NULL AND bi.booked_quantity>0
                                      AND bi.inventory_status='reserved'
                                      AND (f.issued_at IS NULL OR COALESCE(bi.used_quantity,0)<bi.booked_quantity)`,
        [bookingId,storeId,branchId]);
    if(Number(sales[0]?.pendingCount||0)>0)
        throw rentalError('Physically hand over all consumable inclusions first.');
    await requireRentalReturnBeforeCompletion(db,{bookingId,storeId,branchId});
    await requireRentalIncidentSettlement(db,{bookingId,storeId,branchId,allowOutstanding:true});
}

// Final booking completion is automatic, but only after physical return, inspection,
// claims and the separate refundable deposit ledger have all been reconciled.
async function automaticallyCompleteSettledBooking(db,bookingId,storeId,branchId) {
    const [books]=await db.execute(`SELECT status,agreed_price,amount_paid,balance FROM bookings
                                    WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[bookingId,storeId,branchId]);
    const booking=books[0];
    if(String(booking?.status||'').toLowerCase()!=='pending settlement')return false;
    if(!(Number(booking.agreed_price)>0) || Number(booking.amount_paid)+0.005<Number(booking.agreed_price)
        || Number(booking.balance)>0.005)return false;
    const [details]=await db.execute(`SELECT refundable_deposit_required,deposit_collected,deposit_applied,deposit_refunded
                                      FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=?`,
        [bookingId,storeId,branchId]);
    if(!details.length)return false;
    const f=details[0];
    if(Number(f.deposit_collected)+0.005<Number(f.refundable_deposit_required) ||
        Number(f.deposit_collected)-Number(f.deposit_applied)-Number(f.deposit_refunded)>0.005)return false;
    const [sales]=await db.execute(`SELECT COUNT(*) AS pending FROM booking_items bi
                                                                        LEFT JOIN booking_sales_fulfillment sf ON sf.booking_item_id=bi.id
                AND sf.store_id=bi.store_id AND sf.branch_id=bi.branch_id
                                    WHERE bi.booking_id=? AND bi.store_id=? AND bi.branch_id=?
                                      AND bi.product_id IS NOT NULL AND bi.booked_quantity>0
                                      AND (sf.issued_at IS NULL OR COALESCE(bi.used_quantity,0)<bi.booked_quantity)`,
        [bookingId,storeId,branchId]);
    if(Number(sales[0]?.pending||0)>0)return false;
    // These existing validation functions check all rental returns, inspection,
    // pending physical incidents and paid/waived/applied loss/damage claims.
    try {
        await requireRentalReturnBeforeCompletion(db,{bookingId,storeId,branchId});
        await requireRentalIncidentSettlement(db,{bookingId,storeId,branchId});
    } catch(err) {
        if(err?.rentalValidation)return false;
        throw err;
    }
    const [pendingCleaning]=await db.execute(`SELECT COUNT(*) AS pending
                                              FROM rental_booking_allocations a
                                                       LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                                       JOIN booking_rental_items ri ON ri.booking_reference=a.booking_reference
                                                  AND ri.equipment_id=a.equipment_id AND ri.store_id=a.store_id AND ri.branch_id=a.branch_id
                                              WHERE ri.booking_id=? AND a.store_id=? AND a.branch_id=?
                                                AND COALESCE(w.returned_received_units,a.quantity)>0
                                                AND (w.inspected_at IS NULL OR w.inspection_status IN ('pending','cleaning'))`,
        [bookingId,storeId,branchId]);
    if(Number(pendingCleaning[0]?.pending||0)>0)return false;
    const [result]=await db.execute(`UPDATE bookings SET status='Completed'
                                     WHERE id=? AND store_id=? AND branch_id=? AND status='Pending Settlement'`,
        [bookingId,storeId,branchId]);
    return result.affectedRows===1;
}

// Booking billing: prices come from store policy; a deposit is a refundable LIABILITY.
function financeCurrency(value,label='Amount') {
    const raw=Number(value);
    if(!Number.isFinite(raw)||raw<0||raw>100000000||Math.abs(raw*100-Math.round(raw*100))>0.00001)
        throw rentalError(`${label} must be a non-negative amount with at most two decimal places.`);
    return Math.round(raw*100)/100;
}
function financePositive(value,label='Amount') {
    const n=financeCurrency(value,label);if(n<=0)throw rentalError(`${label} must be positive.`);return n;
}
async function getFeePolicy(db,storeId,branchId){
    const [rows]=await db.execute(`SELECT p.* FROM booking_fee_policies p
                                                       JOIN branches br ON br.id=p.branch_id AND br.store_id=p.store_id
                                   WHERE p.store_id=? AND p.branch_id=? LIMIT 1`,[storeId,branchId]);
    const row=rows[0]||{};
    return {deliveryFee:Number(row.delivery_fee||0),setupFee:Number(row.setup_fee||0),
        // Refundable rental security deposits are chosen per booking by the Manager.
        // No branch/Owner minimum is imposed on new booking quotations.
        refundableDeposit:0,
        depositPolicy:'optional',
        deliveryIncludedPackage:!!row.delivery_included_package,
        setupIncludedPackage:!!row.setup_included_package};
}
async function getBookingStatement(db,bookingId,storeId,branchId,includeWaiverReason=false){
    const [bs]=await db.execute(`SELECT id,booking_reference AS reference,name,phone,booking_type AS bookingType,
                                        package_name AS packageName,DATE_FORMAT(event_date,'%Y-%m-%d') AS eventDate,
                                        status,agreed_price AS agreedPrice,package_price AS packagePrice,
                                        required_down_payment AS downPayment,amount_paid AS bookingPayments,balance
                                 FROM bookings WHERE id=? AND store_id=? AND branch_id=? LIMIT 1`,[bookingId,storeId,branchId]);
    if(!bs.length)throw rentalError('Booking not found in assigned branch.');
    const b=bs[0];
    const [d]=await db.execute('SELECT * FROM booking_financial_details WHERE booking_id=?',[bookingId]);
    const [items]=await db.execute(`SELECT equipment_name AS name,quantity,billable_days AS days,
                                           daily_rate_snapshot AS dailyRate,agreed_line_total AS amount FROM booking_rental_items
                                    WHERE booking_id=? AND store_id=? AND branch_id=? ORDER BY id`,[bookingId,storeId,branchId]);
    const [salesItems]=await db.execute(`SELECT product_name AS name,variant_name AS variantName,
                                                booked_quantity AS quantity,unit_price AS unitPrice,estimated_subtotal AS amount
                                         FROM booking_items WHERE booking_id=? AND store_id=? AND branch_id=?
                                                              AND source_type='custom' ORDER BY id`,[bookingId,storeId,branchId]);
    const [claims]=await db.execute(`SELECT c.id,c.source_type AS sourceType,c.source_record_id AS sourceId,
                                            COALESCE(e.name,CONCAT('Equipment #',c.equipment_id)) AS equipmentName,
                                            c.quantity,c.reason,c.approved_amount AS amount,c.amount_paid AS amountPaid,
                                            c.deposit_applied AS depositApplied,c.status
                                     FROM booking_customer_claims c LEFT JOIN rental_equipment e
                                                                              ON e.id=c.equipment_id AND e.store_id=c.store_id AND e.branch_id=c.branch_id
                                     WHERE c.booking_id=? AND c.store_id=? AND c.branch_id=? ORDER BY c.id`,[bookingId,storeId,branchId]);
    const fin=d[0]||{};
    const numbers={packageBase:Number(fin.package_base??b.packagePrice??0),rentalSubtotal:Number(fin.rental_subtotal??0),
        deliveryFee:Number(fin.delivery_fee||0),setupFee:Number(fin.setup_fee||0),
        depositRequired:Number(fin.refundable_deposit_required||0),depositCollected:Number(fin.deposit_collected||0),
        depositApplied:Number(fin.deposit_applied||0),depositRefunded:Number(fin.deposit_refunded||0)};
    const salesSubtotal=salesItems.reduce((sum,item)=>sum+Number(item.amount||0),0);
    const agreedCharges=numbers.packageBase+salesSubtotal+numbers.rentalSubtotal+numbers.deliveryFee+numbers.setupFee;
    const claimBalance=claims.reduce((sum,c)=>sum+Math.max(0,Number(c.amount)-Number(c.amountPaid)-Number(c.depositApplied)),0);
    return {booking:{id:b.id,reference:b.reference,name:b.name,eventDate:b.eventDate,status:b.status,
            bookingType:b.bookingType,packageName:b.packageName,agreedPrice:b.agreedPrice,
            downPayment:Number(b.downPayment||0),bookingPayments:Number(b.bookingPayments||0),balance:Number(b.balance||0)},
        ...numbers,depositWaiverReason:includeWaiverReason?(fin.deposit_waiver_reason||null):null,
        salesSubtotal,agreedCharges,claimBalance,
        salesItems:salesItems.map(i=>({...i,quantity:Number(i.quantity),unitPrice:Number(i.unitPrice),amount:Number(i.amount)})),depositHeld:Math.max(0,numbers.depositCollected-numbers.depositApplied-numbers.depositRefunded),
        rentalItems:items.map(x=>({...x,quantity:Number(x.quantity),days:Number(x.days),dailyRate:Number(x.dailyRate),amount:Number(x.amount)})),
        claims:claims.map(x=>({...x,amount:Number(x.amount),amountPaid:Number(x.amountPaid),depositApplied:Number(x.depositApplied)}))};
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

// A public customer can submit product IDs, but cannot assign them to another
// branch or supply arbitrary sale prices. Confirm the authoritative product/variant
// details before writing custom booking_items.
async function validatePublicBookingSalesItems(connection, rawItems, storeId, branchId) {
    if (!Array.isArray(rawItems) || rawItems.length > 150)
        throw rentalError('Invalid custom inventory selection.');
    const result=[];
    const seenItems=new Set();
    for (const item of rawItems) {
        const productId=Number(item.productId ?? item.product_id ?? item.id);
        const rawVariantId=item.variantId ?? item.variant_id;
        const variantId=rawVariantId ? Number(rawVariantId) : null;
        const qty=Number(item.quantity ?? item.qty ?? 1);
        const itemKey=`${productId}:${variantId ?? 'regular'}`;
        if(seenItems.has(itemKey))throw rentalError('Duplicate product or variant selected for this booking.');
        seenItems.add(itemKey);
        if(!Number.isSafeInteger(productId)||productId<=0||
            (variantId!==null && (!Number.isSafeInteger(variantId)||variantId<=0))||
            !Number.isSafeInteger(qty)||qty<=0||qty>100000)
            throw rentalError('Invalid product or quantity in the custom booking.');
        const [products]=await connection.execute(
            `SELECT id,name,category,sales_price,has_variants,expiration_date
             FROM products WHERE id=? AND store_id=? AND branch_id=? AND deleted_at IS NULL LIMIT 1`,
            [productId,storeId,branchId]);
        const p=products[0];
        if(!p)throw rentalError(`Product #${productId} is not available from the selected branch.`);
        const dateText=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
        const today=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Manila'}).format(new Date());
        // Date eligibility is checked from real batches before approval/reservation,
        // not from a possibly stale catalog expiration date.
        let price=Number(p.sales_price||0),variantName='';
        if(Number(p.has_variants)===1 || variantId!==null){
            if(variantId===null)throw rentalError(`Select a variant for ${p.name}.`);
            if(Number(p.has_variants)!==1)throw rentalError(`${p.name} does not use variants.`);
            const [variants]=await connection.execute(
                `SELECT id,sales_price,variant_values,expiration_date FROM product_variants
                 WHERE id=? AND product_id=? AND deleted_at IS NULL LIMIT 1`,[variantId,productId]);
            const v=variants[0];
            if(!v) throw rentalError(`Selected variant is unavailable for ${p.name}.`);
            price=Number(v.sales_price||0);
            try {const values=typeof v.variant_values==='string'?JSON.parse(v.variant_values):v.variant_values;
                variantName=Object.values(values||{}).map(String).join(', ');}catch{variantName='';}
        }
        if(!Number.isFinite(price)||price<0)throw rentalError('Invalid product price in catalog.');
        const expected=item.salesPrice ?? item.sales_price ?? item.unitPrice;
        if(expected!==undefined && rentalMoneyCents(expected)!==rentalMoneyCents(price))
            throw rentalError(`Price changed for ${p.name}. Refresh the booking quotation.`);
        result.push({productId,variantId,quantity:qty,productName:p.name,
            variantName,category:p.category||'',salesPrice:price});
    }
    return result;
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


async function getBookingV2InventoryForUpdate(connection, storeId, branchId, productId, variantId) {
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

async function consumeBookingV2Batches(connection, inventoryId, quantity, eventDate) {
    let remaining = Math.max(0, Number(quantity || 0));
    if (remaining <= 0) return;

    const [batches] = await connection.execute(
        `SELECT id, remaining_quantity
         FROM inventory_batches
         WHERE branch_inventory_id = ? AND remaining_quantity > 0
           AND status = 'active'
           AND (expiration_date IS NULL OR expiration_date >= ?)
         ORDER BY (expiration_date IS NULL) ASC,
                  expiration_date ASC,
                  received_at ASC,
                  id ASC
             FOR UPDATE`,
        [inventoryId,eventDate]
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
        throw rentalError(
            `Sellable stock is short by ${remaining} unit(s) for inventory #${inventoryId} on ${eventDate}. ` +
            `Check available, non-expired batches before confirming this booking.`
        );
    }
}

async function addBookingReturnBatch(connection, inventoryRow, quantity, bookingId, bookingItemId) {
    const qty = Math.max(0, Number(quantity || 0));
    if (qty <= 0) return;

    const batchCode = `V2-BKG-RETURN-${bookingId}-${bookingItemId}-${inventoryRow.id}`.slice(0, 100);
    await connection.execute(
        `INSERT INTO inventory_batches
         (store_id, branch_id, branch_inventory_id, batch_code,
          received_quantity, remaining_quantity, unit_cost, received_at,
          expiration_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, 'active')`,
        [
            inventoryRow.store_id,
            inventoryRow.branch_id,
            inventoryRow.id,
            batchCode,
            qty,
            qty,
            Number(inventoryRow.cost_price || 0),
        ]
    );
}

async function adjustBookingV2Inventory(connection, options) {
    const row = await getBookingV2InventoryForUpdate(
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

    const delta = Number(options.quantityDelta || 0);
    const before = Number(row.quantity_on_hand || 0);
    const after = before + delta;

    if (after < 0) {
        throw new Error(
            `Database V2 stock mismatch for product ${options.productId}. Available: ${before}, needed: ${Math.abs(delta)}.`
        );
    }

    if (delta < 0) {
        await consumeBookingV2Batches(connection, row.id, Math.abs(delta),options.eventDate);
    } else if (delta > 0) {
        await addBookingReturnBatch(
            connection,
            row,
            delta,
            options.bookingId,
            options.bookingItemId
        );
    }

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
         VALUES (?, ?, ?, ?, ?, ?, ?, 'BOOKING', ?, ?, ?, ?, ?)`,
        [
            options.storeId,
            options.branchId,
            row.id,
            options.movementType,
            delta,
            before,
            after,
            String(options.bookingId),
            actor.id ?? null,
            actor.role || null,
            actor.name || null,
            options.notes || null,
        ]
    );
}

async function reserveBookingInventory(connection, options) {
    const { bookingId, storeId, branchId, actor = null } = options;
    if(!Number.isSafeInteger(Number(branchId))||Number(branchId)<=0)
        throw rentalError('A valid booking branch is required for inventory reservation.');
    const [bookingDateRows]=await connection.execute(
        `SELECT DATE_FORMAT(event_date,'%Y-%m-%d') AS eventDate FROM bookings
         WHERE id=? AND store_id=? AND branch_id=?`,[bookingId,storeId,branchId]);
    if(!bookingDateRows.length)throw rentalError('Booking is not assigned to this inventory branch.');
    const eventDate=bookingDateRows[0].eventDate;

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

        if (!productId || !Number.isSafeInteger(bookedQty) || bookedQty<=0)
            throw rentalError('A booking item is missing its valid product or quantity.');
        if (qtyToReserve<=0) continue;
        // Check the actual item/variant against the booking's event date.
        const [productCheck]=await connection.execute(
            `SELECT p.id,p.expiration_date,p.deleted_at,p.has_variants,
                    pv.id AS variant_found,pv.expiration_date AS variant_expiration,pv.deleted_at AS variant_deleted
             FROM products p LEFT JOIN product_variants pv ON pv.product_id=p.id AND pv.id <=> ?
             WHERE p.id=? AND p.store_id=? AND p.branch_id=? LIMIT 1 FOR UPDATE`,
            [variantId,productId,storeId,branchId]);
        const product=productCheck[0];
        // Do not reject fresh batches based on an old catalog-level expiration.
        // consumeBookingV2Batches below enforces per-batch expiry on eventDate.
        if(!product || product.deleted_at ||
            (variantId && (!product.variant_found||product.variant_deleted)) ||
            (!variantId && Number(product.has_variants)===1))
            throw rentalError(`One booking item is inactive for ${eventDate}. Refresh the branch inventory.`);

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

        await adjustBookingV2Inventory(connection, {
            storeId,
            branchId,
            productId,
            variantId,
            quantityDelta: -qtyToReserve,
            eventDate,
            movementType: "BOOKING_RESERVE",
            bookingId,
            bookingItemId,
            actor,
            notes: `Reserved ${qtyToReserve} unit(s) for ${itemLabel}.`,
        });

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
    const { bookingId, storeId, branchId, usedItems = [], actor = null } = options;

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

        // Never restore units already physically issued through the Staff Sales queue,
        // even if a caller supplies a lower manually reported used quantity.
        const usedQty = Math.max(Number(item.used_quantity || 0), getUsedQuantityForItem(item, usedItems));

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

        if (qtyToRestore > 0) {
            await adjustBookingV2Inventory(connection, {
                storeId,
                branchId,
                productId,
                variantId,
                quantityDelta: qtyToRestore,
                movementType: "BOOKING_RELEASE",
                bookingId,
                bookingItemId,
                actor,
                notes: `Released ${qtyToRestore} unused reserved unit(s) for ${itemLabel}.`,
            });
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


// CONDITIONAL BOOKING APPROVAL: independent of front-end labels or client-provided flags.
// Note: the migration booking_conditional_approval.sql is required.
function catalogOnlyBookingText(text, items = null, rentals = null) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return items === null && rentals === null ? true :
        ![...(items||[]),...(rentals||[])].length;
    const entries = lines.filter(line => !/^(Selected inventory items:|Additional request:)$/i.test(line));
    if (!entries.every(line => /^.{1,255} x [1-9]\d*(?: x [1-9]\d* day\(s\))? = ₱[\d,]+(?:\.\d{1,2})?$/i.test(line))) return false;
    // When called from a confirmation, compare every description against actual
    // verified sale/rental lines. Do not classify arbitrary 'x N = ₱X' text as catalog.
    if (items === null || rentals === null) return true;
    const requirements = [];
    for (const item of items) {
        if (String(item.source_type).toLowerCase() !== 'custom') continue;
        requirements.push({name:String(item.product_name||'').toLowerCase(),
            qty:Number(item.booked_quantity||0),days:null,amount:Number(item.estimated_subtotal||0)});
    }
    for (const item of rentals) requirements.push({name:String(item.equipment_name||'').toLowerCase(),
        qty:Number(item.quantity||0),days:Number(item.billable_days||0),amount:Number(item.agreed_line_total||0)});
    if (requirements.length !== entries.length) return false;
    const pending=[...requirements];
    for (const line of entries) {
        const match=line.match(/^(.*?) x (\d+)(?: x (\d+) day\(s\))? = ₱([\d,]+(?:\.\d{1,2})?)$/i);
        if (!match) return false;
        const name=match[1].toLowerCase(), qty=Number(match[2]), days=match[3]?Number(match[3]):null,
            amount=Number(match[4].replaceAll(',',''));
        const index=pending.findIndex(item=>name.includes(item.name)&&item.qty===qty&&item.days===days&&
            Math.abs(item.amount-amount)<=0.01);
        if(index<0)return false;
        pending.splice(index,1);
    }
    return pending.length===0;
}

// A saved package snapshot is a contract for what Sales stock must be reserved.
// If a line disappeared or its quantity changed, do not confirm a partial package.
function packageInclusionsMatchBookedLines(snapshot, bookedItems) {
    const inclusions=Array.isArray(snapshot?.inclusions)?snapshot.inclusions:[];
    if(!inclusions.length)return false;
    const expected=new Map();
    for(const line of inclusions) {
        const product=Number(line.productId ?? line.product_id);
        const variant=Number(line.variantId ?? line.variant_id ?? 0);
        const qty=Number(line.quantity ?? line.qty);
        if(!Number.isSafeInteger(product)||product<=0||!Number.isSafeInteger(variant)||variant<0||
            !Number.isSafeInteger(qty)||qty<=0)return false;
        const key=`${product}:${variant}`;
        if(expected.has(key))return false;
        expected.set(key,qty);
    }
    const actual=new Map();
    for(const line of bookedItems){
        if(String(line.source_type).toLowerCase()!=='package')continue;
        const key=`${Number(line.product_id)}:${Number(line.variant_id||0)}`;
        if(actual.has(key))return false;
        actual.set(key,Number(line.booked_quantity));
    }
    return actual.size===expected.size&&[...expected].every(([key,qty])=>actual.get(key)===qty);
}

async function loadBookingApproval(connection, id, storeId, branchId) {
    const [rows] = await connection.execute(
        `SELECT status, reason FROM booking_approval_requests
         WHERE booking_id=? AND store_id=? AND branch_id=? LIMIT 1`,
        [id,storeId,branchId]
    );
    return rows[0] || null;
}

async function inspectBookingForConfirmation(connection, {bookingId,storeId,branchId,lock=false}) {
    const [rows] = await connection.execute(
        `SELECT id,store_id,branch_id,status,booking_reference,name,booking_type,custom_order,
                package_json,package_price,agreed_price,required_down_payment,amount_paid,phone,
                booking_no_dp_approved_by
         FROM bookings WHERE id=? AND store_id=? AND branch_id=? ${lock ? "FOR UPDATE" : ""}`,
        [bookingId,storeId,branchId]
    );
    const booking=rows[0];
    if(!booking)throw rentalError('Booking does not belong to your assigned branch.');
    if(!['Pending Review','Awaiting Down Payment'].includes(normalizeBookingStatus(booking.status)))
        throw rentalError('Only a reviewed, not-yet-confirmed booking can be approved or confirmed.');

    const reasons=[];
    const isCustom=String(booking.booking_type||'').toLowerCase().includes('custom');
    const [items]=await connection.execute(
        `SELECT source_type,product_id,variant_id,product_name,booked_quantity,unit_price,estimated_subtotal
         FROM booking_items WHERE booking_id=? AND store_id=? AND branch_id=?`,
        [bookingId,storeId,branchId]);
    const [rentals]=await connection.execute(
        `SELECT r.quantity,r.billable_days,r.daily_rate_snapshot,r.agreed_line_total,
                e.name AS equipment_name
         FROM booking_rental_items r JOIN rental_equipment e
                                          ON e.id=r.equipment_id AND e.store_id=r.store_id AND e.branch_id=r.branch_id
         WHERE r.booking_id=? AND r.store_id=? AND r.branch_id=?`,
        [bookingId,storeId,branchId]);
    if(isCustom && !catalogOnlyBookingText(booking.custom_order,items,rentals))
        reasons.push('Customer requested work outside the verified catalog; Manager must review scope and quotation.');
    const [charges]=await connection.execute(
        `SELECT package_base,rental_subtotal,delivery_fee,setup_fee
         FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=? LIMIT 1`,
        [bookingId,storeId,branchId]);
    if(!charges.length)reasons.push('Booking quotation is missing; Manager must review the charges.');
    const billing=charges[0]||{};
    const packageBase=Number(billing.package_base||0);
    const salesTotal=items.filter(x=>String(x.source_type).toLowerCase()==='custom')
        .reduce((a,i)=>a+Number(i.estimated_subtotal||0),0);
    const rentalTotal=rentals.reduce((a,i)=>a+Number(i.agreed_line_total||0),0);
    const baseline=Math.round((packageBase+salesTotal+rentalTotal+
        Number(billing.delivery_fee||0)+Number(billing.setup_fee||0))*100)/100;
    if(Math.abs(Number(billing.rental_subtotal||0)-rentalTotal)>0.01)
        reasons.push('Rental item charges do not match the saved quotation.');
    if(rentals.some(i=>Math.abs(Number(i.agreed_line_total||0)-Number(i.quantity||0)*Number(i.billable_days||0)*Number(i.daily_rate_snapshot||0))>0.01))
        reasons.push('One or more rental line amounts are inconsistent.');
    if(items.some(i=>!Number.isFinite(Number(i.unit_price)) || Number(i.booked_quantity)<=0 ||
        (String(i.source_type).toLowerCase()==='custom' &&
            Math.abs(Number(i.estimated_subtotal||0)-Number(i.unit_price||0)*Number(i.booked_quantity||0))>0.01)))
        reasons.push('One or more catalog item amounts are inconsistent.');
    if(!isCustom && (!booking.package_json || Number(booking.package_price||0)<=0))
        reasons.push('Package details or price need Manager verification.');
    if(!isCustom && !packageInclusionsMatchBookedLines(safeParseJSON(booking.package_json),items))
        reasons.push('Package inventory lines are missing or inconsistent with its saved inclusions.');
    if(isCustom && !items.length && !rentals.length)
        reasons.push('There are no verified catalog items; custom scope requires Manager review.');
    const agreed=Number(booking.agreed_price||0);
    if(!Number.isFinite(agreed)||agreed<=0)
        reasons.push('The agreed booking price has not been set.');
    if(Math.abs(agreed-baseline)>0.01)
        reasons.push('Agreed price differs from the authorized catalog quotation.');
    const down=Number(booking.required_down_payment||0);
    const paid=Number(booking.amount_paid||0);
    if(!Number.isFinite(down)||down<0||down>agreed)
        reasons.push('Down-payment terms are invalid.');
    if(!Number.isFinite(paid)||paid<0||paid>agreed+0.005)
        reasons.push('Recorded customer payment is invalid.');
    const approval=await loadBookingApproval(connection,bookingId,storeId,branchId);
    if(approval?.status==='pending')reasons.push('Staff escalated this request; Manager confirmation is required.');
    if(approval?.status==='rejected')reasons.push('Manager rejected this booking; Staff cannot confirm it.');
    return {booking,approval,reasons,baseline,standardEligible:reasons.length===0};
}

// The pre-payment review checks current stock without changing balances or allocations.
// The authoritative reservation repeats these checks inside a locking transaction.
async function checkAvailableBeforePayment(db,{bookingId,storeId,branchId}) {
    const [bk]=await db.execute(`SELECT DATE_FORMAT(event_date,'%Y-%m-%d') AS eventDate
                                 FROM bookings WHERE id=? AND store_id=? AND branch_id=?`,[bookingId,storeId,branchId]);
    if(!bk.length || !bk[0].eventDate)throw rentalError('Booking event date is missing.');
    const [sales]=await db.execute(`SELECT product_id,variant_id,booked_quantity FROM booking_items
                                    WHERE booking_id=? AND store_id=? AND branch_id=?`,[bookingId,storeId,branchId]);
    for(const line of sales){
        const [p]=await db.execute(`SELECT p.name,p.deleted_at,DATE_FORMAT(p.expiration_date,'%Y-%m-%d') AS pExpiry,
                                           v.deleted_at AS vDeleted,DATE_FORMAT(v.expiration_date,'%Y-%m-%d') AS vExpiry,
                                           bi.quantity_on_hand AS available
                                    FROM products p LEFT JOIN product_variants v ON v.product_id=p.id AND v.id <=> ?
            LEFT JOIN branch_inventory bi ON bi.product_id=p.id AND bi.variant_id <=> ?
                                        AND bi.store_id=p.store_id AND bi.branch_id=p.branch_id AND bi.status='active'
                                    WHERE p.id=? AND p.store_id=? AND p.branch_id=? LIMIT 1`,
            [line.variant_id,line.variant_id,line.product_id,storeId,branchId]);
        const row=p[0];
        if(!row || row.deleted_at || row.vDeleted || Number(row.available||0)<Number(line.booked_quantity))
            throw rentalError('Insufficient sales inventory for the requested booking inclusions.');
        // Legacy product/variant expiry dates are not proof that a newly
        // received batch is expired. Check actual eligible batches below.
        // Approval must use the same expiration-aware batch availability as
        // the Items tab and the actual reservation transaction.
        const [eligible] = await db.execute(
            `SELECT COALESCE(SUM(batch.remaining_quantity),0) AS available
             FROM inventory_batches batch
             JOIN branch_inventory bi ON bi.id=batch.branch_inventory_id
             WHERE bi.store_id=? AND bi.branch_id=? AND bi.product_id=?
               AND bi.variant_id <=> ? AND bi.status='active'
               AND batch.status='active' AND batch.remaining_quantity>0
               AND (batch.expiration_date IS NULL OR batch.expiration_date>=?)`,
            [storeId,branchId,line.product_id,line.variant_id,bk[0].eventDate]);
        if(Number(eligible[0]?.available||0)<Number(line.booked_quantity))
            throw rentalError(`Not enough eligible inventory batches for ${row.name} on the event date.`);
    }
    const [rentals]=await db.execute(`SELECT equipment_id,quantity,
                                             DATE_FORMAT(start_date,'%Y-%m-%d') AS fromDate,
                                             DATE_FORMAT(end_date,'%Y-%m-%d') AS toDate FROM booking_rental_items
                                      WHERE booking_id=? AND store_id=? AND branch_id=?`,[bookingId,storeId,branchId]);
    for(const line of rentals){
        const [rows]=await db.execute(`SELECT total_units,maintenance_units,missing_units FROM rental_equipment
                                       WHERE id=? AND store_id=? AND branch_id=? AND archived_at IS NULL`,
            [line.equipment_id,storeId,branchId]);
        if(!rows.length)throw rentalError('Requested rental equipment is no longer active.');
        const overlaps=await rentalOverlapAllocations(db,{storeId,branchId,equipmentId:line.equipment_id,
            from:line.fromDate,to:line.toDate});
        const peak=rentalPeakReserved(overlaps,line.fromDate,line.toDate,rentalTodayManila());
        if(Number(rows[0].total_units)-Number(rows[0].maintenance_units)-Number(rows[0].missing_units)-peak<Number(line.quantity))
            throw rentalError('Rental equipment is no longer available for the requested date range.');
    }
}
function requireBookingDeposit(booking){
    const total=Number(booking.agreed_price??booking.package_price??0);
    const dp=Number(booking.required_down_payment??0), paid=Number(booking.amount_paid??0);
    if(!Number.isFinite(total)||total<=0||!Number.isFinite(dp)||dp<0||dp>total||!Number.isFinite(paid)||paid<0||paid>total+.005)
        throw rentalError('The agreed booking price or payment terms are invalid.');
    if(paid+.005<dp)throw rentalError('Verify and record the required down payment before confirming and allocating items.');
    if(dp<=0 && !String(booking.booking_no_dp_approved_by||'').trim())
        throw rentalError('No-DP reservations require an explicit Manager authorization.');
    // No time limit applies to down-payment confirmation. Verify the payment amount only.
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
        // Staff Management saves `bookings: true` together with the
        // fine-grained `bookings_access`. Prefer the explicit access level.
        ? ["bookings_access", "booking_access", "bookings"]
        : ["pos", "pos_access", "sales_access"];
    const selected = keys.find((key) => Object.prototype.hasOwnProperty.call(values, key));
    if (!selected) return role === "manager" ? "full" : "none";
    const access = values[selected];
    if (moduleName === "bookings" && role === "staff") {
        // Even "full" Staff booking access is scoped to standard-confirm
        // and escalation actions; it is never Manager-level write access.
        if (access === "full" || access === "standard" || access === "confirm_standard") return "standard";
        // Legacy boolean permission values still grant reading only.
        if (access === true || access === 1 || access === "1" || access === "true" ||
            access === "view" || access === "view_only" || access === "viewOnly") return "view";
        return "none";
    }
    if (access === true || access === 1 || access === "1" || access === "true" || access === "full") return "full";
    if (access === "standard" || access === "confirm_standard") return "standard";
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

// Use the inventory permission field saved by Staff Management. Booking
// authorization does not control the Inventory module, and neither does POS.
async function getStaffSalesInventoryAccess(connection, decoded) {
    if(String(decoded?.role || '').toLowerCase()!=='staff') return 'none';
    const storeId=Number(decoded?.store_id),branchId=Number(decoded?.branch_id),staffId=Number(decoded?.staff_id);
    if(![storeId,branchId,staffId].every(value=>Number.isSafeInteger(value)&&value>0)) return 'none';
    const [rows]=await connection.execute(`SELECT permissions FROM staff WHERE id=? AND store_id=?
                                                                           AND branch_id=? AND LOWER(status)='active' LIMIT 1`,[staffId,storeId,branchId]);
    if(!rows.length)return 'none';
    let permissions=rows[0].permissions;
    if(typeof permissions==='string'){
        try{permissions=JSON.parse(permissions);}catch{return 'none';}
    }
    if(!permissions || typeof permissions!=='object')return 'none';
    const access=permissions.inventory_access !== undefined ? permissions.inventory_access : permissions.inventory;
    if(access===true||access===1||access==='true'||access==='full')return 'full';
    if(access==='view'||access==='view_only'||access==='viewOnly')return 'view';
    return 'none';
}

function verifyProtectedStore(event) {
    const authHeader = getAuthHeader(event);

    if (!authHeader) {
        throw new Error("No token");
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);

    return {
        storeId: Number(decoded.store_id || decoded.storeId || 0),
        tokenRole: String(decoded.role || "").toLowerCase(),
        tokenBranchId: decoded.branch_id ? Number(decoded.branch_id) : null,
        decoded,
    };
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
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
 * transaction as the booking action it's logging, so the log and the
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

function buildBookingReference(row, id) {
    return row?.booking_reference || `BKG-${String(id).padStart(6, "0")}`;
}

// Canonical booking statuses. Any casing/spacing variant coming from the
// frontend or already sitting in the DB gets mapped to one of these, so
// status-transition checks never fail due to a stray "confirmed" vs
// "Confirmed" mismatch.
const CANONICAL_BOOKING_STATUSES = [
    "Pending Review",
    "Awaiting Down Payment",
    "Confirmed",
    "Preparing",
    "Released",
    "Return Inspection",
    "Pending Settlement",
    "Completed",
    "Cancelled",
];

function normalizeBookingStatus(value) {
    const clean = String(value ?? "").trim().toLowerCase();

    const match = CANONICAL_BOOKING_STATUSES.find(
        (canonical) => canonical.toLowerCase() === clean
    );

    if (match) return match;

    // Accept the common "canceled" (one L) spelling too.
    if (clean === "canceled") return "Cancelled";

    return null;
}

const packagePriceExpr = `
    COALESCE(
        NULLIF(bookings.package_price, 0),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.package_price')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.price')), '') AS DECIMAL(10,2)),
        0
    )
`;

const requiredDownPaymentExpr = `
    COALESCE(
        NULLIF(bookings.required_down_payment, 0),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.down_payment_amount')), '') AS DECIMAL(10,2)),
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bookings.package_json, '$.required_down_payment')), '') AS DECIMAL(10,2)),
        0
    )
`;

const totalPriceExpr = `
    CASE
        WHEN LOWER(COALESCE(bookings.booking_type, '')) LIKE '%custom%'
             OR COALESCE(bookings.custom_order, '') <> ''
        THEN COALESCE(NULLIF(bookings.agreed_price, 0), 0)
        ELSE COALESCE(NULLIF(bookings.agreed_price,0),${packagePriceExpr})
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
        bookings.event_end_date         AS eventEndDate,
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
        bookings.event_end_date                 AS eventEndDate,
        bookings.event_time                     AS eventTime,
        bookings.event_type                     AS eventType,
        bookings.event_type                     AS eventName,
        bookings.package_name                   AS package,
        bookings.package_name                   AS packageName,
        appr.status AS approvalStatus,
        appr.reason AS approvalReason,
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


// Limit enforcement when paid access ends; existing records remain accessible.
// This duplicates the read-only eligibility rule from lambda-auth so a
// direct Lambda request cannot bypass the owner dashboard's plan limits.
async function effectiveSubscriptionLimit(connection, storeId, resourceColumn) {
    const allowed = new Set(['max_inventory', 'max_bookings']);
    if (!allowed.has(resourceColumn)) throw new Error('Unsupported plan limit');
    const [subRows] = await connection.execute(
        `SELECT p.max_inventory, p.max_bookings, p.price, sub.expires_at,
                LOWER(sub.status) AS status,
                CASE WHEN sub.expires_at IS NULL OR DATE(sub.expires_at) >= CURDATE()
             THEN 1 ELSE 0 END AS not_expired
         FROM subscriptions sub JOIN plans p ON p.id = sub.plan_id
         WHERE sub.store_id = ? ORDER BY sub.id DESC LIMIT 1`, [storeId]);
    const paid = subRows[0];
    let eligible = !!paid && ['active', 'expiring'].includes(paid.status) &&
        Number(paid.not_expired) === 1;
    if (paid && !eligible && ['active', 'expiring'].includes(paid.status) && Number(paid.price) > 0) {
        const [columns] = await connection.query('SHOW COLUMNS FROM payments');
        const available = new Set(columns.map((c) => c.Field));
        const dateColumn = ['created_at', 'submitted_at', 'payment_date'].find((name) => available.has(name));
        if (dateColumn) {
            const [graceRows] = await connection.execute(
                `SELECT id FROM payments WHERE store_id = ? AND UPPER(status) = 'PENDING'
                                           AND DATE(${dateColumn}) <= DATE(?)
                                           AND CURDATE() <= DATE_ADD(DATE(?), INTERVAL 2 DAY)
                    LIMIT 1`, [storeId, paid.expires_at, paid.expires_at]);
            eligible = graceRows.length > 0;
        }
    }
    let plan = eligible ? paid : null;
    if (!plan) {
        const [starter] = await connection.execute(
            `SELECT max_inventory, max_bookings FROM plans
             WHERE is_archived = 0 AND (LOWER(name) = 'starter' OR price = 0)
             ORDER BY price ASC, id ASC LIMIT 1`);
        plan = starter[0] || null;
    }
    if (!plan) throw new Error('No effective subscription plan is configured.');
    const limit = Number(plan[resourceColumn] || 0);
    return limit > 0 ? limit : null;
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

        connection = await dbPool.getConnection();

        // Store-wide discovery is public, but booking/catalog actions must specify a branch.
        if (action === "get_public_branches") {
            const sid = Number(body.storeId ?? body.store_id);
            if (!Number.isSafeInteger(sid) || sid <= 0)
                return response(400,{error:"Valid store ID required."});
            const [branches] = await connection.execute(
                'SELECT id, branch_name AS branchName FROM branches WHERE store_id=? ORDER BY branch_name,id LIMIT 100', [sid]);
            return response(200,{branches:branches.map(b=>({id:Number(b.id),name:String(b.branchName)}))});
        }

        // PUBLIC: limited rental catalog for the selected storefront/branch.
        // Read-only; prices are reloaded from the DB on submit.
        if (action === "get_public_rental_catalog") {
            const targetStoreId=Number(body.storeId ?? body.store_id);
            const requestedBranch=Number(body.branchId ?? body.branch_id ?? 0);
            if(!Number.isSafeInteger(targetStoreId)||targetStoreId<=0||
                !Number.isSafeInteger(requestedBranch)||requestedBranch<=0)
                return response(400,{error:"Select a valid branch before viewing rental equipment."});
            const startInput=body.startDate ?? body.start_date;
            const endInput=body.endDate ?? body.end_date;
            const withDates=startInput!=null&&endInput!=null&&startInput!==''&&endInput!=='';
            if(!withDates && ((startInput!=null&&startInput!=='')||(endInput!=null&&endInput!=='')))
                return response(400,{error:'Select both rental start and end dates.'});
            let startDate=null,endDate=null;
            if(withDates){
                try {
                    startDate=rentalDate(startInput,'Rental start date');
                    endDate=rentalDate(endInput,'Rental end date');
                    rentalDays(startDate,endDate);
                }catch(error){return response(400,{error:error.message});}
            }
            const [branches]=await connection.execute(
                'SELECT id,branch_name AS branchName FROM branches WHERE store_id=? AND id=? LIMIT 1',
                [targetStoreId,requestedBranch]);
            if(!branches.length)return response(404,{error:"Branch not found for this store."});
            const [items]=await connection.execute(`SELECT id,name,rental_rate_per_day AS dailyRate,
                                                           total_units AS totalUnits,rented_out_units AS rentedOutUnits,
                                                           maintenance_units AS maintenanceUnits,missing_units AS missingUnits
                                                    FROM rental_equipment WHERE store_id=? AND branch_id=? AND archived_at IS NULL
                                                                            AND rental_rate_per_day>0 AND total_units>maintenance_units+missing_units
                                                    ORDER BY name LIMIT 200`,[targetStoreId,requestedBranch]);
            // Always calculate today's date-aware bookable units for the public
            // catalog preview, even before the customer selects event dates.
            // Selections/checkout still require explicit dates and server checks.
            const today=rentalTodayManila();
            const queryFrom=withDates && startDate<today?startDate:today;
            const queryTo=withDates && endDate>today?endDate:today;
            const allocationsByEquipment=new Map();
            if(items.length){
                const ids=items.map(e=>Number(e.id));
                const placeholders=ids.map(()=>'?').join(',');
                const [allocations]=await connection.execute(`SELECT equipment_id AS equipmentId,quantity,status,
                                                                     DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
                                                                     DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate
                                                              FROM rental_booking_allocations
                                                              WHERE store_id=? AND branch_id=? AND equipment_id IN (${placeholders})
                                                                AND status IN ('reserved','checked_out')
                                                                AND start_date<=? AND (end_date>=? OR status='checked_out')`,
                    [targetStoreId,requestedBranch,...ids,queryTo,queryFrom]);
                for(const allocation of allocations){
                    const id=Number(allocation.equipmentId);
                    if(!allocationsByEquipment.has(id))allocationsByEquipment.set(id,[]);
                    allocationsByEquipment.get(id).push(allocation);
                }
            }
            return response(200,{branchId:requestedBranch,branchName:branches[0].branchName,
                startDate,endDate,availabilityForDates:withDates,
                equipment:items.map(e=>{
                    const capacity=Math.max(0,Number(e.totalUnits)-Number(e.maintenanceUnits)-Number(e.missingUnits));
                    const physicallyAvailable=Math.max(0,capacity-Number(e.rentedOutUnits));
                    const allocations=allocationsByEquipment.get(Number(e.id))||[];
                    const reservedToday=rentalPeakReserved(allocations,today,today,today);
                    const bookableToday=Math.max(0,capacity-reservedToday);
                    const reservedForDates=withDates?rentalPeakReserved(allocations,startDate,endDate,today):null;
                    return {id:Number(e.id),name:e.name,dailyRate:Number(e.dailyRate),physicallyAvailable,
                        bookableToday,reservedForDates,availableForDates:withDates?Math.max(0,capacity-reservedForDates):null};
                })});
        }

        if (action === 'get_public_booking_fees') {
            const sid=Number(body.storeId||body.store_id),bid=Number(body.branchId||body.branch_id);
            if(!Number.isSafeInteger(sid)||sid<=0||!Number.isSafeInteger(bid)||bid<=0)
                return response(400,{error:'Store and branch required.'});
            const [br]=await connection.execute('SELECT id FROM branches WHERE id=? AND store_id=?',[bid,sid]);
            if(!br.length)return response(404,{error:'Branch not found.'});
            return response(200,{policy:await getFeePolicy(connection,sid,bid)});
        }
        if (action === 'get_public_booking_statement') {
            // Booking reference AND matching contact details are required to access customer finances.
            const ref=String(body.bookingReference||'').trim(),phone=String(body.phone||'').trim();
            if(!ref||!phone)return response(400,{error:'Booking reference and phone required.'});
            const [bs]=await connection.execute('SELECT id,store_id,branch_id FROM bookings WHERE booking_reference=? AND phone=? LIMIT 1',[ref,phone]);
            if(!bs.length)return response(404,{error:'Booking not found.'});
            return response(200,{statement:await getBookingStatement(connection,bs[0].id,bs[0].store_id,bs[0].branch_id)});
        }

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
            const rawBranchId = branchId ?? branch_id;
            const targetBranchId = Number(rawBranchId);
            if (!Number.isSafeInteger(targetStoreId) || targetStoreId <= 0 ||
                !Number.isSafeInteger(targetBranchId) || targetBranchId <= 0)
                return response(400,{error:"Select a valid store branch before submitting a booking."});
            const [selectedBranches] = await connection.execute(
                'SELECT id FROM branches WHERE id=? AND store_id=? LIMIT 1',
                [targetBranchId,targetStoreId]);
            if (!selectedBranches.length)
                return response(400,{error:"The selected branch does not belong to this store."});

            let rentalSelections;
            try {rentalSelections=parseRentalSelection(body.rentalItems);}
            catch(error) {return response(400,{error:error.message});}
            if(rentalSelections.length && (!targetBranchId || !Number.isSafeInteger(targetBranchId) || targetBranchId<=0))
                return response(400,{error:"Select a valid rental branch before booking equipment."});
            // Event start/end belong to the booking even when no equipment is rented.
            // Keep the legacy rentalEndDate input accepted for older portal clients.
            const requestedStart = date || event_date;
            const requestedEnd = body.eventEndDate || body.event_end_date || body.rentalEndDate || requestedStart;
            let finalEventEndDate = null;
            try {
                if (requestedStart) {
                    const validStart = rentalDate(requestedStart, 'Event start date');
                    finalEventEndDate = rentalDate(requestedEnd, 'Event end date');
                    rentalDays(validStart, finalEventEndDate);
                    if (body.rentalEndDate && body.eventEndDate && body.rentalEndDate !== body.eventEndDate)
                        throw new Error('Rental end date must match the selected event end date.');
                }
            } catch(error) { return response(400,{error:error.message}); }
            let rentalStartDate=null,rentalEndDate=null;
            if(rentalSelections.length){
                try {rentalStartDate=rentalDate(requestedStart,'Event date');
                    rentalEndDate=finalEventEndDate;
                    const nowParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
                    const datePart=type=>nowParts.find(x=>x.type===type)?.value||'';
                    const today=`${datePart('year')}-${datePart('month')}-${datePart('day')}`;
                    if(rentalStartDate<today)throw new Error('Rental start date cannot be in the past.');
                } catch(error){return response(400,{error:error.message});}
            }
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

            // Enforce monthly new-booking capacity without touching existing
            // bookings, including those already promised to customers.
            const bookingLimit = await effectiveSubscriptionLimit(connection, targetStoreId, 'max_bookings');
            if (bookingLimit !== null) {
                const [monthlyCount] = await connection.execute(
                    `SELECT COUNT(*) AS total FROM bookings
                     WHERE store_id = ? AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                       AND created_at < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')`,
                    [targetStoreId]
                );
                if (Number(monthlyCount[0]?.total || 0) >= bookingLimit) {
                    return response(409, {
                        error: `This store has reached its ${bookingLimit} new bookings for this month. Existing reservations remain available.`,
                        code: 'SUBSCRIPTION_BOOKING_LIMIT',
                    });
                }
            }

            const packageInput = getPackageInput(body);
            const packageId = getPackageIdFromInput(packageInput, body);
            const rawPackageName = getPackageNameFromInput(packageInput, body);

            // The booking type is explicit: a package request cannot bypass
            // database package validation by adding a custom-order description.
            const normalizedType=String(finalBookingType).trim().toLowerCase();
            if (!normalizedType.includes('package') && !normalizedType.includes('custom'))
                return response(400,{error:'Choose Package Booking or Custom Request.'});
            const isCustom=normalizedType.includes('custom');

            let packageSnapshot = null;

            if (!isCustom) {
                if (!Number.isSafeInteger(packageId) || packageId <= 0)
                    return response(400,{error:"Please select a valid package from the branch catalog."});
                packageSnapshot = await findPackageSnapshot(connection, {
                    storeId: targetStoreId,
                    branchId: targetBranchId,
                    packageId,
                    packageName: rawPackageName,
                    packageInput,
                });

                if (!packageSnapshot) {
                    return response(400, {
                        error: "Selected package is not active or does not belong to this branch.",
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
                rawPackageName && packageSnapshot &&
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
            if(!isCustom && body.expectedPackagePrice !== undefined &&
                rentalMoneyCents(body.expectedPackagePrice)!==rentalMoneyCents(packagePrice))
                return response(409,{error:'This package price has changed. Refresh the quotation before booking.'});

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

            await connection.beginTransaction();
            try {
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
                            event_end_date,
                            event_time,
                            event_type,
                            package_name,
                            package_json,
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
                        finalEventEndDate,
                        finalEventTime,
                        finalEventType,
                        packageNameForSave,
                        packageJsonForSave,
                        finalCustomOrder,
                        theme || null,
                        venue || null,
                        notes || "",
                        "Pending Review", // Public clients cannot create confirmed bookings.
                        null,
                        packagePrice,
                        requiredDownPayment,
                        amountPaid,
                        balance,
                        paymentStatus,
                    ]
                );

                const bookingId = result.insertId;

                const verifiedCustomItems = isCustom ? await validatePublicBookingSalesItems(
                    connection,getBookingItemsInput(body),targetStoreId,targetBranchId) : [];
                // A package is a fixed-price collection of branch-owned Sales items.
                // Resolve every inclusion from the live product/variant catalog: old
                // package JSON must never silently bypass stock or branch checks.
                const verifiedPackageItems = isCustom ? [] : await validatePublicBookingSalesItems(
                    connection,
                    (packageSnapshot?.inclusions || []).map(item => {
                        const qty=Number(item.quantity ?? item.qty);
                        if(!Number.isSafeInteger(qty)||qty<1)
                            throw rentalError('Package has an invalid inventory quantity. Ask the branch to correct its package.');
                        return {
                            productId: item.productId ?? item.product_id,
                            variantId: item.variantId ?? item.variant_id ?? null,
                            quantity: qty,
                        };
                    }),
                    targetStoreId,targetBranchId
                );
                if (!isCustom && !verifiedPackageItems.length)
                    throw rentalError('This package does not have valid inventory inclusions. Ask the branch to review its package.');
                const bookingItemsToSave = normalizeBookingItemsForSave(
                    isCustom ? verifiedCustomItems : verifiedPackageItems, {
                        bookingId,
                        storeId: targetStoreId,
                        branchId: targetBranchId,
                        sourceType: isCustom ? "custom" : "package",
                        packageId: isCustom ? null : packageSnapshot?.id || packageId || null,
                    });

                await insertBookingItems(connection, bookingItemsToSave);
                let rentalQuote={amount:0,count:0};
                if(rentalSelections.length){
                    if(!finalBookingReference || String(finalBookingReference).length>100)
                        throw rentalError("Rental bookings need a booking reference of at most 100 characters.");
                    const [duplicate]=await connection.execute(`SELECT id FROM bookings
                                                                WHERE store_id=? AND booking_reference=? AND id<>? LIMIT 1`,
                        [targetStoreId,finalBookingReference,bookingId]);
                    if(duplicate.length)throw rentalError("Booking reference is already used. Try again.");
                    rentalQuote=await saveRentalRequestLines(connection,{
                        bookingId,storeId:targetStoreId,branchId:targetBranchId,reference:finalBookingReference,
                        startDate:rentalStartDate,endDate:rentalEndDate,lines:rentalSelections
                    });
                }
                // Snapshot optional services and the refundable deposit separately from rental revenue.
                const policy=await getFeePolicy(connection,targetStoreId,targetBranchId);
                const expectedPolicy=body.expectedFeePolicy;
                if(expectedPolicy && (rentalMoneyCents(expectedPolicy.deliveryFee)!==rentalMoneyCents(policy.deliveryFee)||
                    rentalMoneyCents(expectedPolicy.setupFee)!==rentalMoneyCents(policy.setupFee)||
                    rentalMoneyCents(expectedPolicy.refundableDeposit)!==rentalMoneyCents(policy.refundableDeposit)||
                    (expectedPolicy.depositPolicy && expectedPolicy.depositPolicy!==policy.depositPolicy)||
                    Boolean(expectedPolicy.deliveryIncludedPackage)!==policy.deliveryIncludedPackage||
                    Boolean(expectedPolicy.setupIncludedPackage)!==policy.setupIncludedPackage))
                    throw rentalError('Service fees or deposit policy changed. Refresh the booking quotation.');
                const services=body.requestedServices||{};
                const wantsDelivery=services.delivery===true;
                const wantsSetup=services.setup===true;
                const delivery=wantsDelivery&&!(packageSnapshot&&policy.deliveryIncludedPackage)?policy.deliveryFee:0;
                const setup=wantsSetup&&!(packageSnapshot&&policy.setupIncludedPackage)?policy.setupFee:0;
                const quoteTotal=Math.round((packagePrice+rentalQuote.amount+delivery+setup)*100)/100;
                await connection.execute(`INSERT INTO booking_financial_details
                                          (booking_id,store_id,branch_id,package_base,rental_subtotal,delivery_fee,setup_fee,refundable_deposit_required)
                                          VALUES (?,?,?,?,?,?,?,?)`,[bookingId,targetStoreId,targetBranchId,packagePrice,rentalQuote.amount,
                    delivery,setup,0]);
                // For catalog-only custom requests, save the quote directly from verified
                // Products/Rental line prices. Free-form bespoke work must be reviewed by Manager.
                const customSalesTotal=bookingItemsToSave.filter(i=>i.sourceType==='custom')
                    .reduce((sum,i)=>sum+Number(i.estimatedSubtotal||0),0);
                const authoritativeTotal=Math.round((quoteTotal+customSalesTotal)*100)/100;
                const [savedRentalLines]=await connection.execute(
                    `SELECT equipment_name,quantity,billable_days,agreed_line_total
                     FROM booking_rental_items WHERE booking_id=? AND store_id=? AND branch_id=?`,
                    [bookingId,targetStoreId,targetBranchId]);
                const savedSalesLines=bookingItemsToSave.map(item=>({
                    source_type:item.sourceType,product_name:item.productName,
                    booked_quantity:item.bookedQuantity,estimated_subtotal:item.estimatedSubtotal,
                }));
                const verifiedCatalogOnly = !isCustom || catalogOnlyBookingText(
                    finalCustomOrder,savedSalesLines,savedRentalLines);
                if(verifiedCatalogOnly && authoritativeTotal>0) {
                    await connection.execute(`UPDATE bookings SET agreed_price=?,balance=? WHERE id=?`,
                        [authoritativeTotal,authoritativeTotal,bookingId]);
                }
                await connection.commit();
                return response(201, {
                    success: true,
                    id: bookingId,
                    quoted_booking_charges:authoritativeTotal,
                    refundable_deposit_required:0,
                    service_fees:{delivery,setup},
                    package_price: packagePrice,
                    required_down_payment: requiredDownPayment,
                    balance:verifiedCatalogOnly ? authoritativeTotal : balance,
                    agreed_price:verifiedCatalogOnly && authoritativeTotal>0 ? authoritativeTotal : null,
                    payment_status: paymentStatus,
                    booking_items_saved: bookingItemsToSave.length,
                    rental_items_saved: rentalQuote.count,
                    rental_quoted_subtotal: rentalQuote.amount,
                });
            } catch(error) {await connection.rollback();
                if(error.rentalValidation||rentalSelections.length)return response(409,{error:error.message});
                throw error;
            }
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
        let tokenRole;
        let tokenBranchId;
        let decodedToken;

        try {
            const auth = verifyProtectedStore(event);
            store_id = auth.storeId;
            tokenRole = auth.tokenRole;
            tokenBranchId = auth.tokenBranchId;
            decodedToken = auth.decoded;
        } catch (err) {
            return response(401, {
                error: err.message === "No token" ? "No token" : "Invalid token",
            });
        }

        if (!store_id) {
            return response(401, { error: "Invalid token store" });
        }

        // Owner sees the store; Managers and Staff are restricted to their active
        // employee record and JWT-assigned branch regardless of client body.
        if (!["owner", "manager", "staff"].includes(tokenRole)) {
            return response(403, { error: "Business account role required." });
        }
        const bookingAccess = await getOperationalAccess(connection, decodedToken, "bookings");
        const salesQueueActions = new Set([
            "get_staff_sales_booking_queue", "prepare_staff_sales_booking_item", "release_staff_sales_booking",
        ]);
        // Full Inventory permission suffices for physical Sales fulfillment, even
        // when the Staff has no separate Booking Management write permission.
        const salesInventoryAccess = salesQueueActions.has(action) && tokenRole === "staff"
            ? await getStaffSalesInventoryAccess(connection, decodedToken) : "none";
        if (bookingAccess === "none" && !(tokenRole === "staff" && salesQueueActions.has(action) &&
            salesInventoryAccess !== "none")) {
            return response(403, { error: "Bookings access is not permitted for this account." });
        }
        if (tokenRole === 'staff' && new Set([
            'assess_booking_confirmation','confirm_standard_booking',
            'request_booking_approval','advance_staff_booking'
        ]).has(action)) {
            return response(403,{error:'Staff Bookings is view-only. Use Staff Inventory to prepare, release and inspect items.'});
        }
        const bookingReadActions = new Set([
            "get_booking_page_bookings", "get_dashboard_bookings", "get_bookings", "get_booking_items", "get_booking_financial_statement", "get_booking_claim_sources", "get_customer_review_case", "get_booking_fee_policy", "get_staff_sales_booking_queue",
        ]);
        const standardStaffActions = new Set([
            // Physical consumable fulfilment is authorized by Inventory access,
            // never by the read-only Staff Booking module.
            'prepare_staff_sales_booking_item', 'release_staff_sales_booking',
        ]);
        if (tokenRole === 'staff' && !bookingReadActions.has(action) &&
            !(standardStaffActions.has(action) && ['standard','full'].includes(bookingAccess)) &&
            !(salesQueueActions.has(action) && salesInventoryAccess === 'full')) {
            return response(403, { error: "Staff requires authorized Bookings operations access for this action." });
        }
        if(tokenRole === 'manager' && bookingAccess !== 'full' && !bookingReadActions.has(action)) {
            return response(403, { error: "Full Bookings access is required for this action." });
        }

        // Item cost data is an Owner financial KPI, not an operational Staff view.
        if (action === "get_booking_costs" && tokenRole !== "owner") {
            return response(403, { error: "Only the Owner can access booking cost details." });
        }
        if (tokenRole === "manager" || tokenRole === "staff") {
            if (!Number.isSafeInteger(tokenBranchId) || tokenBranchId <= 0) {
                return response(403, { error: "A valid assigned branch is required." });
            }
            const requestedBranch = body.branch_id ?? body.branchId;
            if (requestedBranch !== undefined && requestedBranch !== null && requestedBranch !== "" &&
                Number(requestedBranch) !== tokenBranchId) {
                return response(403, { error: "You cannot access a different branch." });
            }
            body.branch_id = tokenBranchId;
            body.branchId = tokenBranchId;
        }

        // Staff Sales Operations Queue: branch-scoped, existing confirmed bookings only.
        // Read returns reserved CONSUMABLE product inclusions, never rental equipment.
        if (salesQueueActions.has(action)) {
            if (tokenRole !== 'staff') return response(403,{error:'Staff operations account required.'});
            if (salesInventoryAccess === 'none') return response(403,{error:'Inventory access is required.'});
            const branchId = Number(tokenBranchId);
            if (action === 'get_staff_sales_booking_queue') {
                const [rows] = await connection.execute(`SELECT b.id AS bookingId,b.booking_reference AS reference,
                                                                b.name AS clientName,b.booking_type AS bookingType,b.package_name AS packageName,
                                                                DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate,b.event_time AS eventTime,
                                                                b.agreed_price AS bookingTotal,b.amount_paid AS amountPaid,b.balance,
                                                                bi.id AS itemId,bi.product_name AS productName,bi.variant_name AS variantName,
                                                                bi.booked_quantity AS quantity,
                                                                f.prepared_at AS preparedAt,f.issued_at AS issuedAt
                                                         FROM bookings b JOIN booking_items bi ON bi.booking_id=b.id
                                                             AND bi.store_id=b.store_id AND bi.branch_id=b.branch_id
                                                                         LEFT JOIN booking_sales_fulfillment f ON f.booking_item_id=bi.id
                                                             AND f.store_id=b.store_id AND f.branch_id=b.branch_id
                                                         WHERE b.store_id=? AND b.branch_id=?
                                                           AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement')
                                                           AND bi.inventory_status='reserved' AND bi.product_id IS NOT NULL
                                                           AND bi.booked_quantity>0 AND COALESCE(bi.used_quantity,0)=0
                                                           AND f.issued_at IS NULL
                                                         ORDER BY b.event_date,b.id,bi.id LIMIT 1000`,[store_id,branchId]);
                const groups = new Map();
                for(const row of rows){
                    let booking=groups.get(Number(row.bookingId));
                    if(!booking){
                        booking={bookingId:Number(row.bookingId),reference:String(row.reference||''),
                            clientName:String(row.clientName||'Customer'),bookingType:String(row.bookingType||''),
                            packageName:String(row.packageName||''),eventDate:String(row.eventDate||''),
                            eventTime:String(row.eventTime||''),bookingTotal:Number(row.bookingTotal),
                            amountPaid:Number(row.amountPaid),balance:Number(row.balance),items:[]};
                        groups.set(Number(row.bookingId),booking);
                    }
                    booking.items.push({itemId:Number(row.itemId),productName:String(row.productName||'Product'),
                        variantName:String(row.variantName||''),quantity:Number(row.quantity),
                        prepared:!!row.preparedAt,issued:!!row.issuedAt});
                }
                return response(200,{success:true,canOperateSalesQueue:salesInventoryAccess==='full',
                    bookings:[...groups.values()]});
            }
            if(salesInventoryAccess!=='full')return response(403,{error:'Full Inventory access is required for physical booking preparation and handover.'});
            const bookingId=Number(body.booking_id);
            if(!Number.isSafeInteger(bookingId)||bookingId<1)return response(400,{error:'Valid booking ID required.'});
            await connection.beginTransaction();
            try {
                const [bookings]=await connection.execute(`SELECT id,booking_reference,status,
                                                                  DATE_FORMAT(event_date,'%Y-%m-%d') AS eventDay,
                                                                  agreed_price,amount_paid,balance FROM bookings
                                                           WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,[bookingId,store_id,branchId]);
                if(!bookings.length)throw rentalError('Booking is not in your assigned branch.');
                const booking=bookings[0];
                if(!['confirmed','preparing','released','return inspection','pending settlement'].includes(String(booking.status||'').toLowerCase()))
                    throw rentalError('Only confirmed or preparing bookings can be fulfilled.');
                const [lines]=await connection.execute(`SELECT id,booked_quantity,reserved_quantity,
                                                               used_quantity,inventory_status,unit_price,product_name
                                                        FROM booking_items WHERE booking_id=? AND store_id=? AND branch_id=?
                                                                             AND product_id IS NOT NULL AND booked_quantity>0 ORDER BY id FOR UPDATE`,
                    [bookingId,store_id,branchId]);
                if(!lines.length)throw rentalError('This booking has no Sales inventory inclusions.');
                if(lines.some(line=>String(line.inventory_status)!=='reserved'||
                    Number(line.reserved_quantity)!==Number(line.booked_quantity)||
                    Number(line.used_quantity||0)>0))
                    throw rentalError('Sales inclusions have already been used, cancelled, or need reconciliation.');
                const [records]=await connection.execute(`SELECT booking_item_id AS itemId,prepared_at AS preparedAt,
                                                                 issued_at AS issuedAt FROM booking_sales_fulfillment
                                                          WHERE store_id=? AND branch_id=? AND booking_id=? FOR UPDATE`,[store_id,branchId,bookingId]);
                const recordById=new Map(records.map(r=>[Number(r.itemId),r]));
                const employee=await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                if(action==='prepare_staff_sales_booking_item'){
                    const itemId=Number(body.item_id);
                    const line=lines.find(item=>Number(item.id)===itemId);
                    if(!line||!Number.isSafeInteger(itemId)||itemId<1)
                        throw rentalError('Select a valid product inclusion in this booking.');
                    if(recordById.get(itemId)?.preparedAt||recordById.get(itemId)?.issuedAt)
                        throw rentalError('This product was already prepared or handed over.');
                    await connection.execute(`INSERT INTO booking_sales_fulfillment
                                              (booking_item_id,booking_id,store_id,branch_id,prepared_at,prepared_by)
                                              VALUES (?,?,?,?,NOW(),?)`,[itemId,bookingId,store_id,branchId,employee.name]);
                    await connection.execute(`UPDATE bookings SET status='Preparing'
                                              WHERE id=? AND store_id=? AND branch_id=? AND status='Confirmed'`,
                        [bookingId,store_id,branchId]);
                    await logEmployeeAction(connection,{storeId:store_id,branchId,employee,module:'Bookings',
                        referenceNumber:String(booking.booking_reference),referenceId:String(bookingId),
                        action:'Prepared Sales booking inclusion',details:`Prepared ${line.booked_quantity} × ${line.product_name}`});
                }else{
                    const total=Number(booking.agreed_price),paid=Number(booking.amount_paid),balance=Number(booking.balance);
                    if(!Number.isFinite(total)||total<=0||!Number.isFinite(paid)||!Number.isFinite(balance)||
                        paid+0.005<total||balance>0.005)throw rentalError('Full verified booking payment is required before Sales product handover.');
                    const [rentalCount]=await connection.execute(`SELECT COUNT(*) AS count FROM booking_rental_items
                                                                  WHERE booking_id=? AND store_id=? AND branch_id=?`,
                        [bookingId,store_id,branchId]);
                    if(Number(rentalCount[0]?.count||0)>0){
                        const [depositTerms]=await connection.execute(`SELECT refundable_deposit_required,deposit_collected
                                                                       FROM booking_financial_details
                                                                       WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                            [bookingId,store_id,branchId]);
                        if(!depositTerms.length)throw rentalError('Booking security-deposit terms are unavailable. Ask the Manager to review Billing.');
                        const required=Number(depositTerms[0].refundable_deposit_required);
                        const collected=Number(depositTerms[0].deposit_collected);
                        if(depositTerms[0].refundable_deposit_required==null ||
                            !Number.isFinite(required)||required<0 || !Number.isFinite(collected)||collected<0 ||
                            collected+0.005<required)
                            throw rentalError('Collect the full agreed refundable security deposit before releasing booking items.');
                    }
                    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
                    const eventDay=String(booking.eventDay||'');
                    if(eventDay>today)throw rentalError('Sales products cannot be released before their scheduled event date.');
                    if(lines.some(line=>!recordById.get(Number(line.id))?.preparedAt||recordById.get(Number(line.id))?.issuedAt))
                        throw rentalError('Every Sales product inclusion must be prepared and not yet handed over.');
                    for(const line of lines){
                        const quantity=Number(line.booked_quantity);
                        await connection.execute(`UPDATE booking_sales_fulfillment SET issued_at=NOW(),issued_by=?
                                                  WHERE booking_item_id=? AND booking_id=? AND store_id=? AND branch_id=? AND issued_at IS NULL`,
                            [employee.name,line.id,bookingId,store_id,branchId]);
                        // Inventory was deducted at confirmation; only mark physical usage.
                        await connection.execute(`UPDATE booking_items SET used_quantity=?,used_subtotal=?,updated_at=CURRENT_TIMESTAMP
                                                  WHERE id=? AND booking_id=? AND store_id=? AND branch_id=?`,
                            [quantity,Math.round(quantity*Number(line.unit_price||0)*100)/100,line.id,bookingId,store_id,branchId]);
                    }
                    const [rentals]=await connection.execute(`SELECT COUNT(*) AS remaining
                                                              FROM rental_booking_allocations
                                                              WHERE store_id=? AND branch_id=? AND booking_reference=?
                                                                AND status='reserved'`,
                        [store_id,branchId,booking.booking_reference]);
                    const [rentalExpected]=await connection.execute(`SELECT COUNT(*) AS expected
                                                                     FROM booking_rental_items
                                                                     WHERE store_id=? AND branch_id=? AND booking_id=?`,
                        [store_id,branchId,bookingId]);
                    const [rentalAllocated]=await connection.execute(`SELECT COUNT(*) AS actual
                                                                      FROM rental_booking_allocations
                                                                      WHERE store_id=? AND branch_id=? AND booking_reference=?`,
                        [store_id,branchId,booking.booking_reference]);
                    if(Number(rentals[0]?.remaining||0)===0 &&
                        Number(rentalExpected[0]?.expected||0)===Number(rentalAllocated[0]?.actual||0)) {
                        await connection.execute(`UPDATE bookings SET status='Released'
                                                  WHERE id=? AND store_id=? AND branch_id=? AND status IN ('Confirmed','Preparing')`,
                            [bookingId,store_id,branchId]);
                    }
                    if(Number(rentalExpected[0]?.expected||0)===0 &&
                        Number(rentals[0]?.remaining||0)===0) {
                        await connection.execute(`UPDATE bookings SET status='Pending Settlement'
                                                  WHERE id=? AND store_id=? AND branch_id=? AND status='Released'`,
                            [bookingId,store_id,branchId]);
                    }
                    await automaticallyCompleteSettledBooking(connection,bookingId,store_id,branchId);
                    await logEmployeeAction(connection,{storeId:store_id,branchId,employee,module:'Bookings',
                        referenceNumber:String(booking.booking_reference),referenceId:String(bookingId),
                        action:'Released complete Sales booking inclusions',
                        details:`Physically handed over ${lines.length} Sales product lines; inventory was already reserved.`});
                }
                await connection.commit();
                return response(200,{success:true,bookingReference:booking.booking_reference});
            }catch(error){
                await connection.rollback();
                if(error.rentalValidation)return response(409,{error:error.message});
                throw error;
            }
        }

        // Owner-configured branch service fees and deposits (no client-supplied prices).
        if (action === 'get_booking_fee_policy') {
            const branchId=Number(body.branchId||body.branch_id);
            if(tokenRole!=='owner' && branchId!==Number(tokenBranchId))return response(403,{error:'Different branch.'});
            const [branches]=await connection.execute('SELECT id FROM branches WHERE id=? AND store_id=?',[branchId,store_id]);
            if(!branches.length)return response(404,{error:'Branch not found.'});
            return response(200,{policy:await getFeePolicy(connection,store_id,branchId)});
        }
        if (action === 'set_booking_fee_policy') {
            if(tokenRole!=='owner')return response(403,{error:'Only Owner sets fee policies.'});
            const branchId=Number(body.branchId);
            const [br]=await connection.execute('SELECT id FROM branches WHERE id=? AND store_id=?',[branchId,store_id]);
            if(!br.length)return response(404,{error:'Store branch not found.'});
            const delivery=financeCurrency(body.deliveryFee,'Delivery fee');
            const setup=financeCurrency(body.setupFee,'Setup fee');
            // Branch service fees remain Owner-configurable. Rental security
            // deposits are optional and set by the Manager per booking.
            const depositMode='optional';
            const deposit=0;
            await connection.execute(`INSERT INTO booking_fee_policies
                                      (store_id,branch_id,delivery_fee,setup_fee,refundable_deposit,rental_deposit_policy,delivery_included_package,setup_included_package)
                                      VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE delivery_fee=VALUES(delivery_fee),setup_fee=VALUES(setup_fee),
                                          refundable_deposit=VALUES(refundable_deposit),rental_deposit_policy=VALUES(rental_deposit_policy),
                                          delivery_included_package=VALUES(delivery_included_package),
                                          setup_included_package=VALUES(setup_included_package)`,
                [store_id,branchId,delivery,setup,deposit,depositMode,body.deliveryIncludedPackage?1:0,body.setupIncludedPackage?1:0]);
            return response(200,{success:true,policy:await getFeePolicy(connection,store_id,branchId)});
        }
        // Manager customer follow-up and future-booking review. These actions NEVER
        // transfer money, issue refunds, notify the customer or adjudicate liability.
        if (new Set(['get_customer_review_case','record_customer_case_event',
            'set_customer_review','authorize_customer_booking_exception',
            'waive_unpaid_customer_claim']).has(action)) {
            const bookingId=Number(body.bookingId||body.booking_id);
            if(!Number.isSafeInteger(bookingId)||bookingId<=0)
                return response(400,{error:'Valid booking ID is required.'});
            const [matched]=await connection.execute(`SELECT id,store_id,branch_id,
                                                             booking_reference AS reference,phone,email,facebook_name AS facebookName,name,status FROM bookings
                                                      WHERE id=? AND store_id=? LIMIT 1`,[bookingId,store_id]);
            if(!matched.length)return response(404,{error:'Booking not found.'});
            const book=matched[0],branchId=Number(book.branch_id);
            if(tokenRole!=='manager'||Number(tokenBranchId)!==branchId ||
                (action!=='get_customer_review_case'&&bookingAccess!=='full'))
                return response(403,{error:'Assigned-branch Manager permission is required.'});
            const phoneHash=customerPhoneHash(book.phone);
            const person=await getActingEmployee(connection,decodedToken,tokenRole,store_id);
            const actor=String(person.name||'Manager').slice(0,150);
            if(action==='get_customer_review_case'){
                const profile=await getCustomerReviewProfile(connection,store_id,book.phone);
                const [events]=await connection.execute(`SELECT id,event_type AS eventType,
                                                                notes,channel,DATE_FORMAT(follow_up_on,'%Y-%m-%d') AS followUpOn,
                                                                actor_name AS actorName,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt
                                                         FROM booking_customer_case_events WHERE store_id=? AND branch_id=? AND booking_id=?
                                                         ORDER BY id DESC LIMIT 60`,[store_id,branchId,bookingId]);
                // Other bookings are queried only if the Manager has already verified
                // and deliberately flagged the customer's identity. A typed name alone
                // is never used as evidence of a repeat offender.
                let earlierOutstanding=[];
                if(phoneHash && profile?.identityVerified && profile?.reviewRequired){
                    // The Manager sees only previous debts from the assigned branch.
                    const [scoped]=await connection.execute(`SELECT b.booking_reference AS reference,
                                                                    b.phone,COALESCE(SUM(GREATEST(c.approved_amount-c.amount_paid-c.deposit_applied,0)),0) AS due
                                                             FROM booking_customer_claims c JOIN bookings b ON b.id=c.booking_id AND b.store_id=c.store_id
                                                             WHERE c.store_id=? AND b.branch_id=? AND b.id<>? AND c.status='approved'
                                                             GROUP BY b.id,b.booking_reference,b.phone HAVING due>0.005`,[store_id,branchId,bookingId]);
                    earlierOutstanding=scoped.filter(row=>customerPhoneHash(row.phone)===phoneHash)
                        .map(({reference,due})=>({reference,due:Number(due)}));
                }
                const [activeClaims]=await connection.execute(`SELECT
                                                                   COALESCE(SUM(GREATEST(approved_amount-amount_paid-deposit_applied,0)),0) AS due
                                                               FROM booking_customer_claims WHERE booking_id=? AND store_id=? AND branch_id=? AND status='approved'`,
                    [bookingId,store_id,branchId]);
                const latestScheduledFollowUp=events.find(entry=>entry.followUpOn)?.followUpOn||null;
                const claimDue=Number(activeClaims[0]?.due||0);
                const followUpOverdue=claimDue>0&&!!latestScheduledFollowUp&&
                    latestScheduledFollowUp<new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
                return response(200,{case:{profile,events,earlierOutstanding,
                        claimDue,latestScheduledFollowUp,followUpOverdue,bookingStatus:book.status,
                        contact:{phone:String(book.phone||''),email:String(book.email||''),facebookName:String(book.facebookName||'')},
                        identityLookupAvailable:!!phoneHash}});
            }
            if(bookingAccess!=='full')return response(403,{error:'Full Booking access is required.'});
            const reason=String(body.notes||body.reason||'').trim().slice(0,500);
            if(reason.length<10)return response(400,{error:'Explain the action in at least 10 characters.'});
            const eventName=String(body.eventType||'');
            const followUp=String(body.followUpOn||'').trim();
            if(followUp && (!/^\d{4}-\d{2}-\d{2}$/.test(followUp)||
                Number.isNaN(Date.parse(`${followUp}T12:00:00Z`))))
                return response(400,{error:'Use a valid follow-up date.'});
            const channel=String(body.channel||'none').trim().slice(0,30);
            const insertEvent=async(type,notes=reason)=>connection.execute(`INSERT INTO booking_customer_case_events
                                                                            (booking_id,store_id,branch_id,event_type,customer_phone_hash,channel,notes,follow_up_on,actor_name)
                                                                            VALUES(?,?,?,?,?,?,?,?,?)`,[bookingId,store_id,branchId,type,phoneHash,channel,notes,followUp||null,actor]);
            if(action==='record_customer_case_event'){
                if(!['contact_attempt','notice_recorded','customer_response','dispute_recorded',
                    'payment_promise','collection_escalation'].includes(eventName))
                    return response(400,{error:'Invalid case activity.'});
                await insertEvent(eventName);
                return response(200,{success:true});
            }
            if(action==='set_customer_review'){
                if(!phoneHash)return response(409,{error:'A valid verified customer contact is required before managing a future-booking review.'});
                const hold=body.reviewRequired===true;
                if(hold && body.identityVerified!==true)
                    return response(409,{error:'Verify that the customer controls the contact information before placing a review flag.'});
                await connection.beginTransaction();
                try{
                    await connection.execute(`INSERT INTO booking_customer_review_profiles
                                              (store_id,phone_hash,review_required,identity_verified,reason,updated_by)
                                              VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
                                                  review_required=VALUES(review_required),identity_verified=VALUES(identity_verified),
                                                  reason=VALUES(reason),updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP`,
                        [store_id,phoneHash,hold?1:0,hold?1:0,reason,actor]);
                    await insertEvent(hold?'review_placed':'review_cleared');
                    await connection.commit();
                }catch(e){await connection.rollback();throw e;}
                return response(200,{success:true});
            }
            if(action==='authorize_customer_booking_exception'){
                const profile=await getCustomerReviewProfile(connection,store_id,book.phone);
                if(!profile?.reviewRequired || !profile?.identityVerified)
                    return response(409,{error:'This booking has no verified customer-review restriction.'});
                if(!['pending review','awaiting down payment'].includes(String(book.status||'').trim().toLowerCase()))
                    return response(409,{error:'An exception is only valid before booking confirmation.'});
                const [previous]=await connection.execute(`SELECT id FROM booking_customer_case_events
                                                           WHERE store_id=? AND branch_id=? AND booking_id=? AND event_type='confirmation_exception'
                                                             AND customer_phone_hash=? AND created_at >= (SELECT updated_at FROM booking_customer_review_profiles
                                                                                                          WHERE store_id=? AND phone_hash=?) LIMIT 1`,
                    [store_id,branchId,bookingId,phoneHash,store_id,phoneHash]);
                if(previous.length)return response(409,{error:'This booking already has a Manager exception.'});
                await insertEvent('confirmation_exception');
                return response(200,{success:true});
            }
            if(action==='waive_unpaid_customer_claim'){
                const claimId=Number(body.claimId);
                if(!Number.isSafeInteger(claimId)||claimId<=0)return response(400,{error:'Select a valid claim.'});
                await connection.beginTransaction();
                try{
                    const [claims]=await connection.execute(`SELECT id,status,approved_amount,amount_paid,deposit_applied
                                                             FROM booking_customer_claims WHERE id=? AND booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [claimId,bookingId,store_id,branchId]);
                    if(!claims.length||claims[0].status!=='approved')throw rentalError('Only an existing approved claim can be waived.');
                    if(Number(claims[0].amount_paid)>0 || Number(claims[0].deposit_applied)>0)
                        throw rentalError('Recorded claim payments or applied deposits cannot be erased. Reconcile refunds through an audited financial correction first.');
                    await connection.execute(`UPDATE booking_customer_claims SET status='waived',approved_amount=0,reason=CONCAT(LEFT(reason,260),' | Waived: ',?) WHERE id=?`,
                        [reason.slice(0,200),claimId]);
                    await insertEvent('claim_waived_after_dispute',
                        `Previously approved ₱${Number(claims[0].approved_amount).toFixed(2)} waived after documented Manager investigation. ${reason}`.slice(0,500));
                    await automaticallyCompleteSettledBooking(connection,bookingId,store_id,branchId);
                    await connection.commit();
                }catch(e){await connection.rollback();if(e.rentalValidation)return response(409,{error:e.message});throw e;}
                return response(200,{success:true});
            }

        }

        if(action==='close_booking_outstanding_claim')
            return response(409,{error:'Booking cannot be completed with unpaid claims. Use Pending Settlement until everything is resolved.'});

        if(action==='get_booking_financial_statement'||action==='get_booking_claim_sources'||
            action==='approve_booking_claim'||action==='waive_booking_claim'||action==='record_booking_financial_event'||
            action==='settle_booking_security_deposit') {
            const bookingId=Number(body.bookingId||body.booking_id);
            if(!Number.isSafeInteger(bookingId)||bookingId<=0)return response(400,{error:'Valid booking ID required.'});
            const [bs]=await connection.execute('SELECT id,store_id,branch_id,booking_reference FROM bookings WHERE id=? AND store_id=?',[bookingId,store_id]);
            if(!bs.length)return response(404,{error:'Booking not found.'});
            const book=bs[0];
            if(tokenRole!=='owner'&&Number(book.branch_id)!==Number(tokenBranchId))return response(403,{error:'Different branch.'});
            if(action==='get_booking_financial_statement')
                return response(200,{statement:await getBookingStatement(connection,bookingId,store_id,book.branch_id,
                        tokenRole==='manager'||tokenRole==='owner'),
                    viewerRole:tokenRole,canWrite:bookingAccess==='full'});
            if(action==='get_booking_claim_sources'){
                // These are the documented booking incidents, not arbitrary Manager-entered fees.
                // An issue with an approved/waived decision is no longer selectable.
                const [missing]=await connection.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                                                 COALESCE(e.name,CONCAT('Equipment #',m.equipment_id)) AS equipmentName,
                                                                 GREATEST(0,m.quantity-COALESCE((SELECT SUM(mv.quantity) FROM rental_stock_movements mv
                                                                                                 WHERE mv.store_id=m.store_id AND mv.branch_id=m.branch_id
                                                                                                   AND mv.equipment_id=m.equipment_id AND mv.type='missing_resolved'
                                                                                                   AND mv.reference_number=CONCAT('MISS-',LPAD(m.id,6,'0'))),0)) AS quantity,
                                                                 m.reason,m.status,c.status AS decisionStatus
                                                          FROM rental_missing_unit_reports m LEFT JOIN booking_customer_claims c
                                                                                                       ON c.source_type='missing' AND c.source_record_id=m.id AND c.booking_id=?
                                                                                             LEFT JOIN rental_equipment e
                                                                                                       ON e.id=m.equipment_id AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                          WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?`,
                    [bookingId,store_id,book.branch_id,book.booking_reference]);
                const [damage]=await connection.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                                                COALESCE(e.name,CONCAT('Equipment #',m.equipment_id)) AS equipmentName,
                                                                m.quantity_started AS quantity,m.start_reason AS reason,
                                                                m.quantity_remaining AS outstanding,c.status AS decisionStatus
                                                         FROM rental_maintenance_records m LEFT JOIN booking_customer_claims c
                                                                                                     ON c.source_type='damage' AND c.source_record_id=m.id AND c.booking_id=?
                                                                                           LEFT JOIN rental_equipment e
                                                                                                     ON e.id=m.equipment_id AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                         WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                                           AND m.start_reason LIKE 'Rental damage %'`,
                    [bookingId,store_id,book.branch_id,book.booking_reference]);
                const [recoveredInspections]=await connection.execute(`SELECT COUNT(*) AS pending
                                                                       FROM rental_maintenance_records WHERE store_id=? AND branch_id=? AND booking_reference=?
                                                                                                         AND start_reason LIKE 'Recovered missing equipment (report #%'
                                                                                                         AND quantity_remaining>0`,[store_id,book.branch_id,book.booking_reference]);
                return response(200,{missing,damage,recoveryInspectionPending:Number(recoveredInspections[0]?.pending||0)>0});
            }
            // Manager settlement from Booking Quick Actions. The whole decision,
            // deposit application, optional customer claim payment, and refund are
            // committed together. No customer charge without a documented Staff
            // damage/loss incident; a refundable deposit is never rental revenue.
            if(action==='settle_booking_security_deposit') {
                if(tokenRole!=='manager'||bookingAccess!=='full'||Number(tokenBranchId)!==Number(book.branch_id))
                    return response(403,{error:'Assigned-branch Manager permission is required to settle deposits.'});
                const requestKey=String(body.requestKey||'').trim();
                if(!/^[A-Za-z0-9_-]{12,85}$/.test(requestKey))
                    return response(400,{error:'A unique settlement request key is required.'});
                const mode=String(body.mode||'');
                if(!['refund','damage','combined'].includes(mode))
                    return response(400,{error:'Choose a valid security deposit settlement mode.'});
                const refundAmount=financeCurrency(body.refundAmount??0,'Refund amount');
                const receivedAmount=financeCurrency(body.additionalPaymentReceived??0,'Additional payment received');
                if(mode==='refund'&&receivedAmount>0)
                    return response(400,{error:'Additional claim payment requires a documented damage/missing incident.'});
                if(receivedAmount>0&&body.paymentVerified!==true)
                    return response(400,{error:'Verify that the additional customer payment was actually received.'});
                if(refundAmount>0&&body.refundVerified!==true)
                    return response(400,{error:'Confirm that the refund has actually been given to the customer.'});
                const sourceType=String(body.sourceType||'');
                const sourceId=Number(body.sourceId);
                if(mode==='damage'&&(!['damage','missing'].includes(sourceType)||
                    !Number.isSafeInteger(sourceId)||sourceId<=0))
                    return response(400,{error:'Select a Staff-recorded damage or confirmed missing-item incident.'});
                const newCharge=mode==='damage'||mode==='combined' ? financeCurrency(body.chargeAmount??0,'Approved customer charge') : 0;
                const reason=String(body.reason||'').trim().slice(0,500);
                if(mode==='combined'&&refundAmount>0)return response(400,{error:'Finish the combined charge first; refund remaining deposits in a separate verified action.'});
                const branchId=Number(book.branch_id);
                await connection.beginTransaction();
                try {
                    const keys=[`${requestKey}-ap`,`${requestKey}-cash`,`${requestKey}-rf`];
                    const [prior]=await connection.execute(`SELECT id FROM booking_financial_events
                                                            WHERE store_id=? AND (request_key IN (?,?,?) OR request_key LIKE ?) LIMIT 1`,
                        [store_id,...keys,`${requestKey}-%`]);
                    if(prior.length){
                        await connection.rollback();
                        return response(200,{success:true,alreadyRecorded:true});
                    }
                    const [locked]=await connection.execute(`SELECT status,agreed_price,amount_paid,balance
                                                             FROM bookings WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [bookingId,store_id,branchId]);
                    if(String(locked[0]?.status||'').toLowerCase()!=='pending settlement')
                        throw rentalError('Security deposit settlement is available only after Staff finishes return inspection (Pending Settlement).');
                    if(!(Number(locked[0].agreed_price)>0)||
                        Number(locked[0].amount_paid)+0.005<Number(locked[0].agreed_price)||
                        Number(locked[0].balance)>0.005)
                        throw rentalError('Booking price must be fully paid before return settlement.');
                    await requireRentalReturnBeforeCompletion(connection,{bookingId,storeId:store_id,branchId});
                    const [unchecked]=await connection.execute(`SELECT COUNT(*) AS pending
                                                                FROM rental_booking_allocations a
                                                                         JOIN booking_rental_items ri ON ri.booking_reference=a.booking_reference
                                                                    AND ri.equipment_id=a.equipment_id AND ri.store_id=a.store_id AND ri.branch_id=a.branch_id
                                                                         LEFT JOIN rental_staff_allocation_workflow w ON w.allocation_id=a.id
                                                                WHERE ri.booking_id=? AND a.store_id=? AND a.branch_id=?
                                                                  AND COALESCE(w.returned_received_units,a.quantity)>0
                                                                  AND (w.inspected_at IS NULL OR w.inspection_status IN ('pending','cleaning'))`,
                        [bookingId,store_id,branchId]);
                    if(Number(unchecked[0]?.pending||0)>0)
                        throw rentalError('Staff must finish return inspection and cleaning before financial settlement.');
                    const [details]=await connection.execute(`SELECT refundable_deposit_required,deposit_collected,deposit_applied,deposit_refunded
                                                              FROM booking_financial_details
                                                              WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [bookingId,store_id,branchId]);
                    if(!details.length)throw rentalError('Booking financial details are missing.');
                    const d=details[0];
                    if(Number(d.deposit_collected)+0.005<Number(d.refundable_deposit_required))
                        throw rentalError('The agreed security deposit has not been fully collected.');
                    const heldCents=Math.round((Number(d.deposit_collected)-Number(d.deposit_applied)-Number(d.deposit_refunded))*100);
                    if(heldCents<0)throw rentalError('Refundable deposit ledger needs reconciliation.');
                    const refundCents=Math.round(refundAmount*100);
                    const cashCents=Math.round(receivedAmount*100);
                    let applyCents=0,claimId=null,createdClaim=false,pendingLossesResolved=0;
                    const employee=await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                    const saveEvent=async(type,amount,claim,key)=>{
                        if(amount<=0)return;
                        await connection.execute(`INSERT INTO booking_financial_events
                                                  (booking_id,store_id,branch_id,claim_id,event_type,amount,request_key,actor_role,actor_name)
                                                  VALUES(?,?,?,?,?,?,?,?,?)`,
                            [bookingId,store_id,branchId,claim,type,amount,key,'manager',String(employee.name||'Manager').slice(0,150)]);
                    };
                    if(mode==='damage'){
                        const table=sourceType==='missing'?'rental_missing_unit_reports':'rental_maintenance_records';
                        const [sources]=await connection.execute(`SELECT id,equipment_id,
                                                                         ${sourceType==='missing'?'quantity':'quantity_started'} AS quantity,
                                                                         ${sourceType==='missing'?'status':'start_reason'} AS issueState
                                                                  FROM ${table} WHERE id=? AND store_id=? AND branch_id=? AND booking_reference=? FOR UPDATE`,
                            [sourceId,store_id,branchId,book.booking_reference]);
                        if(!sources.length)throw rentalError('The selected incident is not linked to this booking.');
                        if(sourceType==='missing'){
                            const [recoveries]=await connection.execute(`SELECT COALESCE(SUM(quantity),0) AS recovered
                                                                         FROM rental_stock_movements WHERE store_id=? AND branch_id=? AND equipment_id=?
                                                                                                       AND type='missing_resolved' AND reference_number=?`,
                                [store_id,branchId,sources[0].equipment_id,`MISS-${String(sourceId).padStart(6,'0')}`]);
                            const remaining=Number(sources[0].quantity)-Number(recoveries[0].recovered);
                            if(!Number.isSafeInteger(remaining)||remaining<1)
                                throw rentalError('All missing units have already been recovered. Refresh this incident.');
                            sources[0].quantity=remaining;
                        }
                        if(sourceType==='missing'&&sources[0].issueState==='pending'){
                            // The Manager decides permanent loss in the Booking settlement itself.
                            // Keep the stock deduction, report resolution, and customer claim in ONE transaction.
                            if(body.confirmPermanentLoss!==true)
                                throw rentalError('Confirm permanent loss for the Staff-recorded missing item before approving its charge or waiver.');
                            if(reason.length<10)
                                throw rentalError('Explain the verified missing-item decision (at least 10 characters).');
                            const qty=Number(sources[0].quantity);
                            const [equipment]=await connection.execute(`SELECT id,total_units,rented_out_units,maintenance_units,missing_units
                                                                        FROM rental_equipment WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                                [sources[0].equipment_id,store_id,branchId]);
                            if(!equipment.length||!Number.isSafeInteger(qty)||qty<1||
                                qty>Number(equipment[0].missing_units)||
                                qty>Number(equipment[0].total_units)-Number(equipment[0].rented_out_units)-Number(equipment[0].maintenance_units))
                                throw rentalError('Missing-unit stock quantities need reconciliation before confirming the loss.');
                            await connection.execute(`UPDATE rental_equipment
                                                      SET missing_units=missing_units-?,total_units=total_units-? WHERE id=?`,
                                [qty,qty,equipment[0].id]);
                            await connection.execute(`UPDATE rental_missing_unit_reports
                                                      SET status='writeoff',resolved_by=?,resolved_at=NOW(),resolution_notes=? WHERE id=?`,
                                [String(employee.name||'Manager').slice(0,150),reason,sourceId]);
                            await connection.execute(`INSERT INTO rental_stock_movements
                                                      (store_id,branch_id,equipment_id,type,quantity,reference_number,description,actor_name)
                                                      VALUES(?,?,?,'adjustment',?,?,?,?)`,
                                [store_id,branchId,equipment[0].id,qty,`MISS-${String(sourceId).padStart(6,'0')}`,
                                    `Booking-confirmed permanent loss: ${reason}`.slice(0,500),String(employee.name||'Manager').slice(0,150)]);
                        } else if(sourceType==='missing'&&sources[0].issueState!=='writeoff'){
                            throw rentalError('This missing item was found or already resolved. Refresh the booking incidents.');
                        }
                        if(sourceType==='damage'&&!String(sources[0].issueState||'').startsWith('Rental damage '))
                            throw rentalError('The damage charge must relate to a documented Staff return-inspection incident.');
                        const [claims]=await connection.execute(`SELECT * FROM booking_customer_claims
                                                                 WHERE booking_id=? AND store_id=? AND branch_id=?
                                                                   AND source_type=? AND source_record_id=? FOR UPDATE`,
                            [bookingId,store_id,branchId,sourceType,sourceId]);
                        let claim=claims[0];
                        if(!claim){
                            // Zero is an explicit Manager waiver, never an implicit payment.
                            // All documented incidents still get an auditable decision.
                            if(reason.length<10)throw rentalError('Document why the customer is responsible (at least 10 characters).');
                            const [created]=await connection.execute(`INSERT INTO booking_customer_claims
                                                                      (booking_id,store_id,branch_id,source_type,source_record_id,equipment_id,quantity,reason,approved_amount,status,approved_by)
                                                                      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
                                [bookingId,store_id,branchId,sourceType,sourceId,sources[0].equipment_id,
                                    sources[0].quantity,reason,newCharge,newCharge>0?'approved':'waived',String(employee.name||'Manager').slice(0,150)]);
                            claimId=Number(created.insertId);
                            createdClaim=true;
                            claim={id:claimId,approved_amount:newCharge,amount_paid:0,deposit_applied:0,status:newCharge>0?'approved':'waived'};
                        }else {
                            if(claim.status!=='approved')throw rentalError('This incident is already waived or settled. Choose an unpaid approved claim.');
                            claimId=Number(claim.id);
                        }
                        const outstandingCents=Math.round((Number(claim.approved_amount)-Number(claim.amount_paid)-Number(claim.deposit_applied))*100);
                        if(outstandingCents<=0&&!createdClaim)throw rentalError('The selected incident has no outstanding approved charge.');
                        applyCents=Math.min(heldCents,Math.max(0,outstandingCents));
                        if(cashCents>outstandingCents-applyCents)
                            throw rentalError('Additional customer payment exceeds the unpaid damage/missing-item charge.');
                        await saveEvent('deposit_applied',applyCents/100,claimId,keys[0]);
                        await saveEvent('claim_paid',cashCents/100,claimId,keys[1]);
                        if(applyCents>0)await connection.execute(`UPDATE booking_financial_details
                                                                  SET deposit_applied=deposit_applied+? WHERE booking_id=? AND store_id=? AND branch_id=?`,
                            [applyCents/100,bookingId,store_id,branchId]);
                        if(claim.status!=='waived')await connection.execute(`UPDATE booking_customer_claims
                                                                             SET status=IF(approved_amount<=amount_paid+deposit_applied+?+?+0.005,'settled','approved'),
                                                                                 deposit_applied=deposit_applied+?,amount_paid=amount_paid+?
                                                                             WHERE id=? AND booking_id=? AND store_id=? AND branch_id=?`,
                            [applyCents/100,cashCents/100,applyCents/100,cashCents/100,claimId,bookingId,store_id,branchId]);
                    }
                    if(mode==='combined'){
                        // The Manager enters ONE total charge for the entire Staff-recorded
                        // return, not an arbitrary per-item price. Keep incident-specific
                        // claim rows for audit, but attach this combined amount only once.
                        // Additional affected items covered by a positive combined charge
                        // receive a settled companion record (not a waiver). No duplicate
                        // customer charge is generated.
                        const [missingSources]=await connection.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                                                                GREATEST(0,m.quantity-COALESCE((SELECT SUM(mv.quantity) FROM rental_stock_movements mv
                                                                                                                WHERE mv.store_id=m.store_id AND mv.branch_id=m.branch_id
                                                                                                                  AND mv.equipment_id=m.equipment_id AND mv.type='missing_resolved'
                                                                                                                  AND mv.reference_number=CONCAT('MISS-',LPAD(m.id,6,'0'))),0)) AS quantity,
                                                                                m.status AS issueState,COALESCE(e.name,CONCAT('Equipment #',m.equipment_id)) AS equipmentName
                                                                         FROM rental_missing_unit_reports m
                                                                                  LEFT JOIN rental_equipment e ON e.id=m.equipment_id AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                                         WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                                                         ORDER BY m.id FOR UPDATE`,[store_id,branchId,book.booking_reference]);
                        const [damageSources]=await connection.execute(`SELECT m.id,m.equipment_id AS equipmentId,
                                                                               m.quantity_started AS quantity,m.start_reason AS issueState,
                                                                               COALESCE(e.name,CONCAT('Equipment #',m.equipment_id)) AS equipmentName
                                                                        FROM rental_maintenance_records m
                                                                                 LEFT JOIN rental_equipment e ON e.id=m.equipment_id AND e.store_id=m.store_id AND e.branch_id=m.branch_id
                                                                        WHERE m.store_id=? AND m.branch_id=? AND m.booking_reference=?
                                                                          AND m.start_reason LIKE 'Rental damage %'
                                                                        ORDER BY m.id FOR UPDATE`,[store_id,branchId,book.booking_reference]);
                        const sources=[...damageSources.map(r=>({...r,sourceType:'damage'})),
                            ...missingSources.filter(r=>['pending','writeoff'].includes(String(r.issueState).toLowerCase())
                                && Number(r.quantity)>0).map(r=>({...r,sourceType:'missing'}))];
                        if(!sources.length)throw rentalError('No Staff-recorded damaged or missing equipment is available for a combined charge.');
                        const [existingClaims]=await connection.execute(`SELECT * FROM booking_customer_claims
                                                                         WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,[bookingId,store_id,branchId]);
                        const existingBySource=new Map(existingClaims.map(c=>[`${c.source_type}:${c.source_record_id}`,c]));
                        const pendingLosses=sources.filter(r=>r.sourceType==='missing'&&r.issueState==='pending');
                        // Staff-reported missing rental units are permanent losses in this workflow.
                        // Managers set ONE combined customer charge; they do not select a
                        // separate Found/Permanently Lost resolution. Ignore no contrary
                        // client choice: old clients attempting Found must refresh.
                        if(Array.isArray(body.missingResolutions)&&body.missingResolutions.some(
                            r=>String(r?.resolution||'')!=='writeoff'))
                            throw rentalError('Missing items are treated as permanent loss. Refresh the booking page.');
                        // Reuse the combined-charge reason; already-reviewed claims may
                        // have no new charge field, so retain a clear audit fallback.
                        const decisionNotes=(reason?reason:
                            'Permanent loss based on Staff-recorded missing equipment at return').slice(0,500);
                        const billableSources=sources;
                        const undecided=billableSources.filter(r=>!existingBySource.has(`${r.sourceType}:${r.id}`));
                        if(!undecided.length&&newCharge>0)
                            throw rentalError('No unreviewed affected equipment remains. Do not charge previously decided claims again.');
                        if(undecided.length&&!reason)
                            throw rentalError('Explain the combined customer charge or waiver.');
                        // Each missing-item decision and customer ledger movement is
                        // part of the SAME transaction; a failure rolls back everything.
                        pendingLossesResolved=pendingLosses.length;
                        for(const r of pendingLosses){
                            const qty=Number(r.quantity);
                            const [eq]=await connection.execute(`SELECT id,total_units,rented_out_units,maintenance_units,missing_units
                                                                 FROM rental_equipment WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                                [r.equipmentId,store_id,branchId]);
                            if(!eq.length||!Number.isSafeInteger(qty)||qty<1||qty>Number(eq[0].missing_units)||
                                qty>Number(eq[0].total_units)-Number(eq[0].rented_out_units)-Number(eq[0].maintenance_units))
                                throw rentalError('Missing equipment stock quantities need reconciliation before permanent loss is recorded.');
                            // The report is locked and only pending reports are processed,
                            // preventing the stock deduction from being applied twice.
                            await connection.execute(`UPDATE rental_equipment SET missing_units=missing_units-?,
                                                                                  total_units=total_units-? WHERE id=?`,[qty,qty,eq[0].id]);
                            await connection.execute(`UPDATE rental_missing_unit_reports
                                                      SET status='writeoff',resolved_by=?,resolved_at=NOW(),resolution_notes=?
                                                      WHERE id=? AND status='pending'`,
                                [String(employee.name||'Manager').slice(0,150),
                                    `Automatically recorded as permanent loss in booking settlement: ${decisionNotes}`.slice(0,500),r.id]);
                            await connection.execute(`INSERT INTO rental_stock_movements
                                                      (store_id,branch_id,equipment_id,type,quantity,reference_number,description,actor_name)
                                                      VALUES(?,?,?,?,?,?,?,?)`,
                                [store_id,branchId,eq[0].id,'adjustment',qty,
                                    `MISS-${String(r.id).padStart(6,'0')}`,
                                    `Booking permanent loss: ${decisionNotes}`.slice(0,500),
                                    String(employee.name||'Manager').slice(0,150)]);
                        }
                        const affectedNames=undecided.map(r=>r.equipmentName).join(', ').slice(0,180);
                        const activeClaims=[];
                        // Pre-existing approved balances are honored, never overwritten.
                        for(const c of existingClaims){
                            if(c.status==='waived')continue;
                            // A prematurely labelled 'settled' claim with a real unpaid
                            // balance must still be collected before booking completion.
                            const outstanding=Math.round((Number(c.approved_amount)-Number(c.amount_paid)-Number(c.deposit_applied))*100);
                            if(outstanding>0)activeClaims.push({id:Number(c.id),due:outstanding});
                        }
                        for(let i=0;i<undecided.length;i++){
                            const r=undecided[i];
                            const amount=i===0?newCharge:0;
                            const combinedReason=(i===0
                                ? `Combined booking-wide ${amount>0?'charge':'waiver'} for ${undecided.length} newly reviewed item(s) (${affectedNames}): ${reason}`
                                : `Covered by the same combined booking-wide charge; no separate charge for ${r.equipmentName}. ${reason}`).slice(0,500);
                            const [created]=await connection.execute(`INSERT INTO booking_customer_claims
                                                                      (booking_id,store_id,branch_id,source_type,source_record_id,equipment_id,quantity,reason,approved_amount,status,approved_by)
                                                                      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
                                [bookingId,store_id,branchId,r.sourceType,r.id,r.equipmentId,r.quantity,
                                    combinedReason,amount,amount>0?'approved':newCharge>0?'settled':'waived',String(employee.name||'Manager').slice(0,150)]);
                            createdClaim=true;
                            if(amount>0)activeClaims.push({id:Number(created.insertId),due:Math.round(amount*100)});
                        }
                        const totalDueCents=activeClaims.reduce((n,c)=>n+c.due,0);
                        if(cashCents>Math.max(0,totalDueCents-Math.min(heldCents,totalDueCents)))
                            throw rentalError('Additional customer payment exceeds the combined unpaid damage/missing charge.');
                        let availableDeposit=Math.min(heldCents,totalDueCents);
                        let availableCash=cashCents;
                        for(let i=0;i<activeClaims.length;i++){
                            const c=activeClaims[i];
                            const fromDeposit=Math.min(c.due,availableDeposit);
                            availableDeposit-=fromDeposit;
                            const fromCash=Math.min(c.due-fromDeposit,availableCash);
                            availableCash-=fromCash;
                            const claimKey=`${requestKey}-${i}`;
                            await saveEvent('deposit_applied',fromDeposit/100,c.id,`${claimKey}-ap`);
                            await saveEvent('claim_paid',fromCash/100,c.id,`${claimKey}-cash`);
                            if(fromDeposit||fromCash)await connection.execute(`UPDATE booking_customer_claims
                                                                               SET status=IF(approved_amount<=amount_paid+deposit_applied+?+?+0.005,'settled','approved'),
                                                                                   deposit_applied=deposit_applied+?,amount_paid=amount_paid+?
                                                                               WHERE id=? AND booking_id=? AND store_id=? AND branch_id=?`,
                                [fromDeposit/100,fromCash/100,fromDeposit/100,fromCash/100,c.id,bookingId,store_id,branchId]);
                        }
                        applyCents=Math.min(heldCents,totalDueCents);
                        if(applyCents>0)await connection.execute(`UPDATE booking_financial_details
                                                                  SET deposit_applied=deposit_applied+? WHERE booking_id=? AND store_id=? AND branch_id=?`,
                            [applyCents/100,bookingId,store_id,branchId]);
                    }
                    if(refundCents>heldCents-applyCents)
                        throw rentalError('Refund amount exceeds the security deposit still held after charges.');
                    if(refundCents>0){
                        // Never refund money while any incident remains undecided or
                        // any approved claim has an unpaid balance.
                        await requireRentalIncidentSettlement(connection,{bookingId,storeId:store_id,branchId});
                        await saveEvent('deposit_refunded',refundCents/100,null,keys[2]);
                        await connection.execute(`UPDATE booking_financial_details SET deposit_refunded=deposit_refunded+?
                                                  WHERE booking_id=? AND store_id=? AND branch_id=?`,
                            [refundCents/100,bookingId,store_id,branchId]);
                    }
                    if(mode==='refund'&&refundCents<=0&&heldCents>0)
                        throw rentalError('Enter a positive refund amount, or select damage settlement with a documented incident.');
                    if((mode==='damage'||mode==='combined')&&!createdClaim&&applyCents===0&&cashCents===0&&refundCents===0&&
                        !(mode==='combined'&&pendingLossesResolved>0))
                        throw rentalError('No amount was settled. Record a verified additional payment or choose another outstanding claim.');
                    // The existing completion validator rechecks all returns,
                    // inspections, customer claims, and fully reconciled deposits.
                    const completed=await automaticallyCompleteSettledBooking(connection,bookingId,store_id,branchId);
                    await connection.commit();
                    return response(200,{success:true,completed,
                        appliedDeposit:applyCents/100,additionalPaymentRecorded:cashCents/100,
                        amountRefunded:refundCents/100});
                }catch(e){
                    await connection.rollback();
                    if(e.rentalValidation||e.code==='ER_DUP_ENTRY')
                        return response(409,{error:e.rentalValidation?e.message:'This claim/settlement was already recorded. Refresh before retrying.'});
                    throw e;
                }
            }
            if(action==='approve_booking_claim'||action==='waive_booking_claim') {
                if(tokenRole!=='manager'||bookingAccess!=='full')
                    return response(403,{error:'Manager with Full Booking access must review equipment claims.'});
                const source=String(body.sourceType||'');
                if(!['missing','damage'].includes(source))return response(400,{error:'Choose missing or damage.'});
                const sourceId=Number(body.sourceId);
                if(!Number.isSafeInteger(sourceId)||sourceId<=0)return response(400,{error:'Choose a valid equipment incident.'});
                const waiver=action==='waive_booking_claim';
                const amount=waiver?0:financePositive(body.amount,'Claim charge');
                const reason=String(body.reason||'').trim().slice(0,500);
                if(reason.length<10)return response(400,{error:'Document the charge or waiver reason (at least 10 characters).'});
                const table=source==='missing'?'rental_missing_unit_reports':'rental_maintenance_records';
                const [sources]=await connection.execute(`SELECT equipment_id,
                                                                 ${source==='missing'?'quantity':'quantity_started'} AS quantity,
                                                                 ${source==='missing'?'status':'start_reason'} AS issueState
                                                          FROM ${table} WHERE id=? AND store_id=? AND branch_id=? AND booking_reference=?`,
                    [sourceId,store_id,book.branch_id,book.booking_reference]);
                if(!sources.length)return response(409,{error:'This booking has no matching documented equipment incident.'});
                if(source==='missing'){
                    const [recoveries]=await connection.execute(`SELECT COALESCE(SUM(quantity),0) AS recovered
                                                                 FROM rental_stock_movements WHERE store_id=? AND branch_id=? AND equipment_id=?
                                                                                               AND type='missing_resolved' AND reference_number=?`,
                        [store_id,book.branch_id,sources[0].equipment_id,`MISS-${String(sourceId).padStart(6,'0')}`]);
                    sources[0].quantity=Number(sources[0].quantity)-Number(recoveries[0].recovered);
                    if(!Number.isSafeInteger(sources[0].quantity)||sources[0].quantity<1)
                        return response(409,{error:'There are no unrecovered units to charge for this report.'});
                }
                if(source==='missing'&&sources[0].issueState!=='writeoff')
                    return response(409,{error:'Resolve and confirm the equipment loss in Manager Rental Inventory first. Found equipment cannot be billed or waived as a loss.'});
                if(source==='damage'&&!String(sources[0].issueState||'').startsWith('Rental damage '))
                    return response(409,{error:'Only rental-return inspection damage can be charged to this customer.'});
                const managerEmployee=await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                try {
                    await connection.execute(`INSERT INTO booking_customer_claims
                                              (booking_id,store_id,branch_id,source_type,source_record_id,equipment_id,quantity,reason,approved_amount,status,approved_by)
                                              VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[bookingId,store_id,book.branch_id,source,sourceId,
                        sources[0].equipment_id,sources[0].quantity,reason,amount,waiver?'waived':'approved',
                        String(managerEmployee.name||'Manager').slice(0,150)]);
                } catch(e) {
                    if(e.code==='ER_DUP_ENTRY')return response(409,{error:'This physical incident already has a recorded charge or waiver.'});
                    throw e;
                }
                await automaticallyCompleteSettledBooking(connection,bookingId,store_id,Number(book.branch_id));
                return response(200,{success:true,statement:await getBookingStatement(connection,bookingId,store_id,book.branch_id)});
            }
            // All financial movements are append-only and require a unique request key.
            if(tokenRole==='owner')return response(403,{error:'Use an authorized branch transaction account for settlements.'});
            const type=String(body.eventType||'');
            if(!['deposit_received','deposit_refunded','deposit_applied','claim_paid'].includes(type))
                return response(400,{error:'Invalid financial event.'});
            if((type==='deposit_refunded'||type==='deposit_applied')&&tokenRole!=='manager')
                return response(403,{error:'Manager authorization required for deposit refunds or allocations.'});
            const amount=financePositive(body.amount,'Payment amount');
            const requestKey=String(body.requestKey||'').trim();
            if(!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey))return response(400,{error:'Unique transaction key required.'});
            const claimId=type==='deposit_applied'||type==='claim_paid'?Number(body.claimId):null;
            await connection.beginTransaction();
            try{
                const [prior]=await connection.execute(`SELECT id FROM booking_financial_events WHERE store_id=? AND request_key=?`,[store_id,requestKey]);
                if(prior.length){await connection.rollback();return response(200,{success:true,alreadyRecorded:true});}
                const [details]=await connection.execute(`SELECT * FROM booking_financial_details
                                                          WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,[bookingId,store_id,book.branch_id]);
                if(!details.length)throw rentalError('This booking has no financial snapshot. Existing bookings require migration/backfill.');
                const d=details[0];
                const held=Math.round((Number(d.deposit_collected)-Number(d.deposit_applied)-Number(d.deposit_refunded))*100)/100;
                let claim=null;
                if(claimId!==null){
                    const [c]=await connection.execute(`SELECT * FROM booking_customer_claims WHERE id=? AND booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [claimId,bookingId,store_id,book.branch_id]);
                    if(!c.length||c[0].status==='waived')throw rentalError('Active approved claim not found.');
                    claim=c[0];
                    const outstanding=Number(claim.approved_amount)-Number(claim.amount_paid)-Number(claim.deposit_applied);
                    if(amount>outstanding+0.005)throw rentalError('Amount exceeds outstanding claim.');
                }
                if(type==='deposit_received'&&amount>Number(d.refundable_deposit_required)-Number(d.deposit_collected)+0.005)
                    throw rentalError('Deposit collected exceeds the agreed refundable deposit.');
                if((type==='deposit_refunded'||type==='deposit_applied')&&amount>held+0.005)
                    throw rentalError('Not enough refundable deposit is held.');
                if(type==='deposit_refunded'){
                    await requireRentalIncidentSettlement(connection,{bookingId,storeId:store_id,branchId:book.branch_id});
                    const [bookingStatus]=await connection.execute('SELECT status FROM bookings WHERE id=? AND store_id=? FOR UPDATE',[bookingId,store_id]);
                    if(!['pending settlement','completed','cancelled'].includes(String(bookingStatus[0]?.status||'').toLowerCase()))
                        throw rentalError('Refund the deposit only after Staff has returned and inspected the booking, or after a reconciled cancellation.');
                    const [unsettled]=await connection.execute(`SELECT COUNT(*) AS pending FROM booking_customer_claims
                                                                WHERE booking_id=? AND status='approved' AND approved_amount>amount_paid+deposit_applied`,[bookingId]);
                    if(Number(unsettled[0].pending)>0)throw rentalError('Resolve outstanding loss/damage claims before refunding the deposit.');
                    const [unreturned]=await connection.execute(`SELECT COUNT(*) AS pending FROM booking_rental_items i
                                                                                                     JOIN rental_booking_allocations a ON a.store_id=i.store_id AND a.branch_id=i.branch_id
                        AND a.booking_reference COLLATE utf8mb4_unicode_ci=i.booking_reference COLLATE utf8mb4_unicode_ci
                        AND a.equipment_id=i.equipment_id
                                                                 WHERE i.booking_id=? AND a.status IN ('reserved','checked_out')`,[bookingId]);
                    if(Number(unreturned[0].pending)>0)throw rentalError('Rental equipment must be returned or cancelled before deposit refund.');
                }
                if(type==='deposit_applied'&&claim===null)throw rentalError('Choose an approved loss or damage claim.');
                await connection.execute(`INSERT INTO booking_financial_events
                                          (booking_id,store_id,branch_id,claim_id,event_type,amount,request_key,actor_role,actor_name)
                                          VALUES(?,?,?,?,?,?,?,?,?)`,[bookingId,store_id,book.branch_id,claimId,type,amount,requestKey,
                    tokenRole,tokenRole]);
                const map={deposit_received:'deposit_collected',deposit_refunded:'deposit_refunded',deposit_applied:'deposit_applied'};
                if(map[type])await connection.execute(`UPDATE booking_financial_details SET ${map[type]}=${map[type]}+? WHERE booking_id=?`,[amount,bookingId]);
                if(claim!==null){await connection.execute(`UPDATE booking_customer_claims SET
                                                                                              ${type==='deposit_applied'?'deposit_applied':'amount_paid'}=${type==='deposit_applied'?'deposit_applied':'amount_paid'}+?,
                                                                                              status=IF(approved_amount<=amount_paid+deposit_applied,'settled','approved') WHERE id=?`,[amount,claimId]);}
                await automaticallyCompleteSettledBooking(connection,bookingId,store_id,Number(book.branch_id));
                await connection.commit();
            }catch(e){await connection.rollback();if(e.rentalValidation)return response(409,{error:e.message});throw e;}
            return response(200,{success:true,statement:await getBookingStatement(connection,bookingId,store_id,book.branch_id)});
        }

        if (action === 'get_owner_booking_financial_overview') {
            if(tokenRole!=='owner')return response(403,{error:'Owner-only financial report.'});
            const [fees]=await connection.execute(`SELECT
                                                       COALESCE(SUM(CASE WHEN LOWER(b.status)='completed' AND b.event_date<=CURDATE() THEN f.delivery_fee ELSE 0 END),0) AS delivery,
                                                       COALESCE(SUM(CASE WHEN LOWER(b.status)='completed' AND b.event_date<=CURDATE() THEN f.setup_fee ELSE 0 END),0) AS setup,
                                                       COALESCE(SUM(f.deposit_collected-f.deposit_refunded-f.deposit_applied),0) AS heldDeposits
                                                   FROM booking_financial_details f JOIN bookings b ON b.id=f.booking_id
                                                   WHERE f.store_id=?`,[store_id]);
            const [claims]=await connection.execute(`SELECT COALESCE(SUM(approved_amount),0) AS approved,
                                                            COALESCE(SUM(amount_paid),0) AS recoveredCash,COALESCE(SUM(deposit_applied),0) AS appliedDeposits,
                                                            COALESCE(SUM(GREATEST(approved_amount-amount_paid-deposit_applied,0)),0) AS outstanding
                                                     FROM booking_customer_claims WHERE store_id=? AND status <> 'waived'`,[store_id]);
            return response(200,{overview:{deliveryFees:Number(fees[0].delivery),setupFees:Number(fees[0].setup),
                    refundableDepositsHeld:Number(fees[0].heldDeposits),approvedClaims:Number(claims[0].approved),
                    cashRecovered:Number(claims[0].recoveredCash),depositsApplied:Number(claims[0].appliedDeposits),
                    outstandingClaims:Number(claims[0].outstanding)}});
        }
        // ── OWNER: realized booking goods revenue / rankings ──────────────────
        // Read only. Uses completed bookings and their persisted financial snapshots.
        // Physical rental lines are part of bookings, not a second independent sale.
        // Do not include refundable deposits, uncompleted bookings, or payment receipts
        // again; the Owner dashboard already counts each completed booking once.
        if (action === "get_owner_dashboard_financial_summary") {
            if (tokenRole !== "owner") return response(403, { error: "Owner access required." });
            const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
            }).formatToParts(new Date());
            const part = name => parts.find(p => p.type === name)?.value || "";
            const today = `${part("year")}-${part("month")}-${part("day")}`;
            const currentMonth = today.slice(0, 7);
            const yearStart = `${part("year")}-01-01`;
            const monthIndex = Number(part("month")) - 1;
            const quarterStart = `${part("year")}-${String(Math.floor(monthIndex / 3) * 3 + 1).padStart(2,"0")}-01`;
            const periodStarts = { month: `${currentMonth}-01`, quarter: quarterStart, year: yearStart };
            const periods = ["month", "quarter", "year"];
            // One query per underlying relation, not one query per booking/branch.
            const [bookingsForSummary] = await connection.execute(`
                SELECT b.id, b.package_name AS packageName, b.booking_type AS bookingType,
                       b.agreed_price AS agreedPrice,
                       DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate,
                       f.booking_id AS financialRecordId,
                       f.package_base AS packageBase,
                       f.rental_subtotal AS rentalSubtotal,
                       f.delivery_fee AS deliveryFee, f.setup_fee AS setupFee
                FROM bookings b
                         LEFT JOIN booking_financial_details f
                                   ON f.booking_id=b.id AND f.store_id=b.store_id AND f.branch_id=b.branch_id
                WHERE b.store_id=? AND LOWER(TRIM(b.status))='completed'
                  AND b.event_date >= ? AND b.event_date <= ?
                ORDER BY b.event_date DESC,b.id DESC`, [store_id, yearStart, today]);
            const [salesLines] = await connection.execute(`
                SELECT bi.booking_id AS bookingId,
                       COALESCE(SUM(CASE WHEN LOWER(TRIM(bi.source_type))='custom'
                                             THEN bi.estimated_subtotal ELSE 0 END),0) AS customSales,
                       COALESCE(SUM(CASE WHEN LOWER(TRIM(bi.source_type))='package'
                                             THEN bi.booked_quantity ELSE 0 END),0) AS packageUnits
                FROM booking_items bi JOIN bookings b
                                           ON b.id=bi.booking_id AND b.store_id=bi.store_id AND b.branch_id=bi.branch_id
                WHERE b.store_id=? AND LOWER(TRIM(b.status))='completed'
                  AND b.event_date >= ? AND b.event_date <= ?
                GROUP BY bi.booking_id`, [store_id, yearStart, today]);
            const [rentalLines] = await connection.execute(`
                SELECT ri.booking_id AS bookingId,ri.equipment_id AS equipmentId,
                       ri.equipment_name AS equipmentName,ri.quantity,
                       ri.agreed_line_total AS lineRevenue
                FROM booking_rental_items ri JOIN bookings b
                                                  ON b.id=ri.booking_id AND b.store_id=ri.store_id AND b.branch_id=ri.branch_id
                WHERE b.store_id=? AND LOWER(TRIM(b.status))='completed'
                  AND b.event_date >= ? AND b.event_date <= ?`, [store_id, yearStart, today]);

            const salesByBooking = new Map(salesLines.map(r => [String(r.bookingId), r]));
            const rentalsByBooking = new Map();
            for (const line of rentalLines) {
                const key = String(line.bookingId);
                if (!rentalsByBooking.has(key)) rentalsByBooking.set(key, []);
                rentalsByBooking.get(key).push(line);
            }
            const money = v => Math.round(Number(v || 0) * 100) / 100;
            const topBookingPackages = {month:[],quarter:[],year:[]};
            const topRentedProducts = {month:[],quarter:[],year:[]};
            const packageMaps = Object.fromEntries(periods.map(p => [p,new Map()]));
            const rentalMaps = Object.fromEntries(periods.map(p => [p,new Map()]));
            let bookingConsumable = 0, bookingRental = 0, bookingTotal = 0;
            let unverifiedBookings = 0, completedThisMonth = 0;
            const reasons = new Set();

            for (const b of bookingsForSummary) {
                const bookedDate = String(b.eventDate || "").slice(0,10);
                const bookingId = String(b.id);
                const agreed = money(b.agreedPrice);
                const savedLines = rentalsByBooking.get(bookingId) || [];
                const rentalQuote = money(savedLines.reduce((sum,line) => sum + Number(line.lineRevenue || 0),0));
                const itemSnapshot = salesByBooking.get(bookingId) || {};
                const packageBase = money(b.packageBase);
                const customSales = money(itemSnapshot.customSales);
                const declaredRental = money(b.rentalSubtotal);
                const fees = money(Number(b.deliveryFee || 0) + Number(b.setupFee || 0));
                const expected = money(packageBase + customSales + declaredRental + fees);
                const isVerified = b.financialRecordId != null && agreed >= 0 &&
                    Math.abs(agreed-expected) <= 0.01 &&
                    Math.abs(rentalQuote-declaredRental) <= 0.01 &&
                    fees <= 0.005 &&
                    (packageBase <= 0.005 || Number(itemSnapshot.packageUnits || 0) > 0);
                const inMonth = bookedDate >= periodStarts.month;
                if (inMonth) {
                    completedThisMonth++;
                    bookingTotal = money(bookingTotal + agreed);
                    if (isVerified) {
                        bookingConsumable = money(bookingConsumable + packageBase + customSales);
                        bookingRental = money(bookingRental + declaredRental);
                    } else {
                        unverifiedBookings++;
                        if (b.financialRecordId == null) reasons.add("Some completed bookings have no financial snapshot.");
                        else if (fees > 0) reasons.add("Service fees need their own revenue category.");
                        else if (Math.abs(agreed-expected)>0.01) reasons.add("Some booking totals do not reconcile to item charges.");
                        else if (Math.abs(rentalQuote-declaredRental)>0.01) reasons.add("Rental charges do not reconcile to saved rental items.");
                        else reasons.add("Some package inclusions cannot be classified reliably.");
                    }
                }
                for (const period of periods) {
                    if (bookedDate < periodStarts[period]) continue;
                    // Only count the portion of the booking attributed to its package,
                    // not separately billed rental or custom items a second time.
                    const type = String(b.bookingType || "").toLowerCase();
                    const packageName = String(b.packageName || "").trim();
                    if (packageName && !type.includes("custom") && !packageName.toLowerCase().includes("custom")) {
                        const earnedPackage = b.financialRecordId != null ? packageBase :
                            (rentalQuote <= 0.005 ? agreed : 0);
                        if (earnedPackage > 0) {
                            const key = packageName.toLowerCase();
                            const old = packageMaps[period].get(key) || {key,name:packageName,bookings:0,revenue:0};
                            old.bookings += 1;
                            old.revenue = money(old.revenue + earnedPackage);
                            packageMaps[period].set(key,old);
                        }
                    }
                    // The stored equipment-level charge is the source for top rentals.
                    // Do not attribute the same rental booking's revenue to packages again.
                    for (const line of savedLines) {
                        const key = String(line.equipmentId);
                        const old = rentalMaps[period].get(key) || {
                            key,name:String(line.equipmentName || `Equipment #${key}`),
                            rentals:0,revenue:0
                        };
                        old.rentals += Number(line.quantity || 0);
                        old.revenue = money(old.revenue + Number(line.lineRevenue || 0));
                        rentalMaps[period].set(key,old);
                    }
                }
            }
            for (const period of periods) {
                topBookingPackages[period] = Array.from(packageMaps[period].values())
                    .sort((a,b) => b.revenue-a.revenue).slice(0,5);
                topRentedProducts[period] = Array.from(rentalMaps[period].values())
                    .sort((a,b) => b.revenue-a.revenue).slice(0,5);
            }
            const verified = unverifiedBookings === 0 &&
                Math.abs(money(bookingConsumable + bookingRental) - bookingTotal) <= 0.01;
            return response(200, {
                success:true, topBookingPackages, topRentedProducts,
                bookingRevenueAllocation: {
                    month:currentMonth, verified,
                    bookingConsumable:verified?bookingConsumable:null,
                    bookingRental:verified?bookingRental:null,
                    bookingRevenue:bookingTotal,
                    // Separately expose only amounts proved by saved, reconciled
                    // booking financial rows. Missing legacy snapshots stay unallocated.
                    verifiedBookingConsumable:bookingConsumable,
                    verifiedBookingRental:bookingRental,
                    unallocatedBookingRevenue:money(Math.max(0,bookingTotal-bookingConsumable-bookingRental)),
                    reason:verified?"":([...reasons][0] || "Booking goods revenue needs reconciliation.")
                },
                summaryInfo:{ completedBookingsThisMonth:completedThisMonth,
                    unverifiedBookingsThisMonth:unverifiedBookings,
                    completedBookingsThisYear:bookingsForSummary.length }
            });
        }

        // ── PROTECTED: get_booking_page_bookings ────────────────────────────────
        // Use this action on the OwnerBookings, ManagerBookings, and
        // StaffBookings screens. It returns the fields needed by those pages
        // without returning the package_json snapshot for hundreds of records.
        if (action === "get_booking_page_bookings") {
            const { branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;
            const rawDateFrom = body.date_from ?? body.dateFrom;
            const rawDateTo = body.date_to ?? body.dateTo;
            const dateFrom = normalizeDateFilter(rawDateFrom);
            const dateTo = normalizeDateFilter(rawDateTo);

            if ((rawDateFrom && !dateFrom) || (rawDateTo && !dateTo)) {
                return response(400, { error: "Invalid booking date filter. Use YYYY-MM-DD." });
            }

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return response(400, { error: "date_from cannot be later than date_to." });
            }

            let query = `
                SELECT
                    ${bookingPageSelectFields()}
                FROM bookings
                         LEFT JOIN branches
                                   ON bookings.branch_id = branches.id
                                       AND bookings.store_id = branches.store_id
                         LEFT JOIN booking_approval_requests appr
                                   ON appr.booking_id=bookings.id AND appr.store_id=bookings.store_id
                                       AND appr.branch_id=bookings.branch_id
                WHERE bookings.store_id = ?
            `;

            const params = [store_id];

            if (requestedBranchId) {
                query += ` AND bookings.branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            if (dateFrom) {
                query += ` AND bookings.event_date >= ?`;
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ` AND bookings.event_date <= ?`;
                params.push(dateTo);
            }

            query += ` ORDER BY bookings.created_at DESC`;

            const [rows] = await connection.execute(query, params);

            // Preserve the established booking-list query. Deposit information is
            // optional for rendering this list, but NEVER for the server-side
            // release check. A financial lookup failure must not hide all bookings.
            const depositByBooking = new Map();
            if (rows.length) {
                const bookingIds = rows.map(row => Number(row.id))
                    .filter(value => Number.isSafeInteger(value) && value > 0);
                try {
                    // Bound each lookup to the authenticated store and relevant
                    // booking IDs. Chunks also avoid excessive SQL placeholders.
                    for (let i = 0; i < bookingIds.length; i += 250) {
                        const slice = bookingIds.slice(i, i + 250);
                        const placeholders = slice.map(() => '?').join(',');
                        const [details] = await connection.execute(
                            `SELECT booking_id AS bookingId,
                                    refundable_deposit_required AS requiredDeposit,
                                    deposit_collected AS collectedDeposit
                             FROM booking_financial_details
                             WHERE store_id=? AND booking_id IN (${placeholders})`,
                            [store_id, ...slice]
                        );
                        for (const detail of details) {
                            depositByBooking.set(Number(detail.bookingId), detail);
                        }
                    }
                } catch (depositError) {
                    // Do NOT treat missing/unavailable deposit data as paid.
                    // The UI will show Deposit Unverified for affected bookings.
                    // Existing rental/consumable release endpoints still enforce
                    // both payments from the authoritative financial ledger.
                    console.error('Booking list deposit lookup failed:', depositError);
                }
            }
            const bookingsWithDeposits = rows.map(row => {
                const financial = depositByBooking.get(Number(row.id));
                return {
                    ...row,
                    securityDepositRequired: financial?.requiredDeposit ?? null,
                    securityDepositCollected: financial?.collectedDeposit ?? null,
                };
            });

            return response(200, {
                bookings: bookingsWithDeposits,
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

        // ── PROTECTED: get_booking_costs ──────────────────────────────────────
        // Returns item-level inventory cost for owner financial KPIs. The
        // project has had two booking_items schemas over its development
        // history, so the quantity/cost columns are detected at runtime.
        // This keeps the dashboard compatible with both the seeded local
        // database and the current booking workflow.
        if (action === "get_booking_costs") {
            const { branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;
            const rawDateFrom = body.date_from ?? body.dateFrom;
            const rawDateTo = body.date_to ?? body.dateTo;
            const dateFrom = normalizeDateFilter(rawDateFrom);
            const dateTo = normalizeDateFilter(rawDateTo);

            if ((rawDateFrom && !dateFrom) || (rawDateTo && !dateTo)) {
                return response(400, { error: "Invalid booking cost date filter. Use YYYY-MM-DD." });
            }

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return response(400, { error: "date_from cannot be later than date_to." });
            }

            const { quantityColumn, hasUnitCost } =
                await getBookingItemsCostSchema(connection);

            if (!quantityColumn) {
                return response(200, { success: true, costs: {} });
            }
            const quantityExpression = `COALESCE(NULLIF(bi.${quantityColumn}, 0), 0)`;
            const unitCostExpression = hasUnitCost
                ? `COALESCE(NULLIF(bi.unit_cost, 0), CASE WHEN bi.variant_id IS NOT NULL THEN pv.original_price ELSE p.original_price END, 0)`
                : `COALESCE(CASE WHEN bi.variant_id IS NOT NULL THEN pv.original_price ELSE p.original_price END, 0)`;

            let query = `
                SELECT
                    bi.booking_id AS bookingId,
                    bi.product_id AS productId,
                    bi.variant_id AS variantId,
                    ${quantityExpression} AS quantityUsed,
                    ${unitCostExpression} AS unitCost
                FROM booking_items bi
                         INNER JOIN bookings b
                                    ON b.id = bi.booking_id
                         LEFT JOIN products p
                                   ON p.id = bi.product_id
                                       AND p.store_id = b.store_id
                         LEFT JOIN product_variants pv
                                   ON pv.id = bi.variant_id
                                       AND pv.product_id = bi.product_id
                WHERE b.store_id = ?
            `;

            const params = [store_id];

            if (requestedBranchId) {
                query += ` AND b.branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            if (dateFrom) {
                query += ` AND b.event_date >= ?`;
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ` AND b.event_date <= ?`;
                params.push(dateTo);
            }

            query += ` ORDER BY bi.booking_id, bi.id`;

            const [rows] = await connection.execute(query, params);
            const totals = new Map();
            const invalidBookings = new Set();
            const rowCounts = new Map();

            for (const row of rows) {
                const bookingId = String(row.bookingId);
                const quantity = Number(row.quantityUsed || 0);
                const unitCost = Number(row.unitCost || 0);

                rowCounts.set(bookingId, (rowCounts.get(bookingId) || 0) + 1);

                if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
                    invalidBookings.add(bookingId);
                    continue;
                }

                totals.set(
                    bookingId,
                    (totals.get(bookingId) || 0) + quantity * unitCost
                );
            }

            const costs = {};
            for (const [bookingId, total] of totals.entries()) {
                if (!invalidBookings.has(bookingId) && rowCounts.get(bookingId) > 0) {
                    costs[bookingId] = Number(total.toFixed(2));
                }
            }

            return response(200, {
                success: true,
                costs,
                cost_basis: hasUnitCost
                    ? "booking_item_unit_cost_with_inventory_fallback"
                    : "live_inventory_original_price",
            });
        }

        // ── PROTECTED: get_booking_items ───────────────────────────────────────
        if (action === "get_booking_items") {
            const { booking_id, branch_id, branchId } = body;
            const requestedBranchId = branch_id || branchId;

            if (!booking_id) {
                return response(400, { error: "Missing booking_id" });
            }

            let bookingQuery = `
                SELECT id, status, store_id, branch_id, booking_reference,
                       DATE_FORMAT(event_date,'%Y-%m-%d') AS event_date
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
            // Rental equipment is intentionally NOT a Sales booking_item. Display
            // it alongside package inclusions without ever deducting it as a sale.
            const recordedBranchId=Number(bookingRows[0].branch_id);
            const [rentalItems]=await connection.execute(
                `SELECT id,equipment_id,equipment_name,quantity,
                        DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,
                        DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date,
                        billable_days,agreed_line_total
                 FROM booking_rental_items WHERE booking_id=? AND store_id=? AND branch_id=? ORDER BY id`,
                [Number(booking_id),store_id,recordedBranchId]);
            const [allocations]=rentalItems.length ? await connection.execute(
                `SELECT equipment_id,status FROM rental_booking_allocations
                 WHERE booking_reference=? AND store_id=? AND branch_id=?`,
                [bookingRows[0].booking_reference,store_id,recordedBranchId]) : [[]];
            const allocationStates=new Map(allocations.map(a=>[Number(a.equipment_id),String(a.status)]));

            // Read-only availability display. Physical stock is checked NOW;
            // rental reservations are checked over the saved event date range.
            // Do not subtract this booking's own reserved units as competing demand.
            const eventDate=String(bookingRows[0].event_date||'').slice(0,10);
            const bookingReference=String(bookingRows[0].booking_reference||'');
            const enrichedSales=[];
            for(const item of items){
                let available=null,reason=null;
                try {
                    const productId=Number(item.product_id);
                    const variantId=Number(item.variant_id)>0 ? Number(item.variant_id) : null;
                    if(!Number.isSafeInteger(productId)||productId<=0||!eventDate){
                        reason='Product or event date is unavailable.';
                    }else{
                        const [matches]=await connection.execute(
                            `SELECT p.deleted_at AS productDeleted,
                                    DATE_FORMAT(p.expiration_date,'%Y-%m-%d') AS productExpiry,
                                    v.id AS matchingVariant,v.deleted_at AS variantDeleted,
                                    DATE_FORMAT(v.expiration_date,'%Y-%m-%d') AS variantExpiry,
                                    bi.id AS inventoryId,bi.quantity_on_hand AS onHand
                             FROM products p
                                      LEFT JOIN product_variants v ON v.product_id=p.id AND v.id <=> ?
                             LEFT JOIN branch_inventory bi ON bi.product_id=p.id AND bi.variant_id <=> ?
                                 AND bi.store_id=p.store_id AND bi.branch_id=p.branch_id AND bi.status='active'
                             WHERE p.id=? AND p.store_id=? AND p.branch_id=? LIMIT 1`,
                            [variantId,variantId,productId,store_id,recordedBranchId]);
                        const record=matches[0];
                        if(!record || !record.inventoryId || (variantId!=null && !record.matchingVariant)){
                            reason='Active inventory record not found.';
                        }else if(record.productDeleted || record.variantDeleted){
                            available=0;
                            reason='Product or variant is inactive.';
                        }else{
                            const [batches]=await connection.execute(
                                `SELECT COALESCE(SUM(remaining_quantity),0) AS eligible
                                 FROM inventory_batches WHERE branch_inventory_id=?
                                                          AND remaining_quantity>0 AND status='active'
                                                          AND (expiration_date IS NULL OR expiration_date>=?)`,
                                [record.inventoryId,eventDate]);
                            const sellable=Math.min(Math.max(0,Number(record.onHand||0)),
                                Math.max(0,Number(batches[0]?.eligible||0)));
                            // Reserving consumables already reduces branch inventory.
                            // Include this booking's unissued reservation so its own
                            // quantity does not falsely appear as a shortage.
                            const ownUnissued=String(item.inventory_status)==='reserved'
                                ? Math.max(0,Number(item.reserved_quantity||0)-Number(item.used_quantity||0)-Number(item.restored_quantity||0)) : 0;
                            available=Math.max(0,Math.floor(sellable+ownUnissued));
                        }
                    }
                }catch(error){
                    // Fail as 'not verified', never falsely display zero stock.
                    console.warn('Booking consumable availability not verified',item.id,error?.message||error);
                    available=null;reason='Current consumable stock could not be verified.';
                }
                enrichedSales.push({...item,available_for_booking:available,availability_note:reason});
            }
            const enrichedRentals=[];
            for(const item of rentalItems){
                let available=null,reason=null;
                try{
                    const from=String(item.start_date||''),to=String(item.end_date||'');
                    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to){
                        reason='Rental dates are unavailable.';
                    }else{
                        const [equipment]=await connection.execute(
                            `SELECT total_units,maintenance_units,missing_units FROM rental_equipment
                             WHERE id=? AND store_id=? AND branch_id=? AND archived_at IS NULL LIMIT 1`,
                            [item.equipment_id,store_id,recordedBranchId]);
                        if(!equipment.length){reason='Rental equipment is unavailable in this branch.';}
                        else{
                            const [otherAllocations]=await connection.execute(
                                `SELECT quantity,status,DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
                                        DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate
                                 FROM rental_booking_allocations
                                 WHERE store_id=? AND branch_id=? AND equipment_id=?
                                   AND booking_reference <> ?
                                   AND status IN ('reserved','checked_out')
                                   AND start_date<=? AND (end_date>=? OR status='checked_out')`,
                                [store_id,recordedBranchId,item.equipment_id,bookingReference,to,from]);
                            const peak=rentalPeakReserved(otherAllocations,from,to,rentalTodayManila());
                            const capacity=Math.max(0,Number(equipment[0].total_units||0)-
                                Number(equipment[0].maintenance_units||0)-Number(equipment[0].missing_units||0));
                            available=Math.max(0,Math.floor(capacity-peak));
                        }
                    }
                }catch(error){
                    console.warn('Booking rental date availability not verified',item.id,error?.message||error);
                    available=null;reason='Availability for the event dates could not be verified.';
                }
                enrichedRentals.push({...item,available_for_event:available,availability_note:reason,
                    allocation_status:allocationStates.get(Number(item.equipment_id))||'pending_review'});
            }
            return response(200, {
                success: true,
                booking: bookingRows[0],
                items:enrichedSales,
                rentalItems:enrichedRentals,
            });
        }

        // Staff: simple catalog-priced Package OR Custom bookings can be confirmed.
        // All decisions are rechecked in the transaction; never trust the browser's classification.
        if(action==='assess_booking_confirmation' || action==='request_booking_approval' || action==='confirm_standard_booking') {
            if(tokenRole!=='staff'||!['standard','full'].includes(bookingAccess))
                return response(403,{error:'Staff standard-confirm permission is required.'});
            const bookingId=Number(body.booking_id);
            if(!Number.isSafeInteger(bookingId)||bookingId<=0)return response(400,{error:'Valid booking ID required.'});
            const branchId=Number(tokenBranchId);
            if(action==='confirm_standard_booking' && body.reviewAcknowledged!==true)
                return response(400,{error:'Review customer notes and acknowledge that no unpriced special service is included.'});
            if(action==='assess_booking_confirmation'){
                const result=await inspectBookingForConfirmation(connection,{bookingId,storeId:store_id,branchId});
                return response(200,{standardEligible:result.standardEligible,reasons:result.reasons,quotedAmount:result.baseline,
                    approvalStatus:result.approval?.status||null});
            }
            await connection.beginTransaction();
            try{
                const result=await inspectBookingForConfirmation(connection,{bookingId,storeId:store_id,branchId,lock:true});
                const employee=await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                if(action==='request_booking_approval'){
                    const why=String(body.reason||'').trim().slice(0,500);
                    if(why.length<10)throw rentalError('Describe the exception for Manager review (at least 10 characters).');
                    await connection.execute(`INSERT INTO booking_approval_requests
                                              (booking_id,store_id,branch_id,status,reason,requested_by,requested_at,reviewed_by,reviewed_at)
                                              VALUES (?,?,?,'pending',?,?,NOW(),NULL,NULL)
                                                  ON DUPLICATE KEY UPDATE status='pending',reason=VALUES(reason),requested_by=VALUES(requested_by),
                                requested_at=NOW(),reviewed_by=NULL,reviewed_at=NULL`,
                        [bookingId,store_id,branchId,why,employee.name]);
                    await logEmployeeAction(connection,{storeId:store_id,branchId,employee,module:'Bookings',
                        referenceNumber:result.booking.booking_reference||String(bookingId),action:'Requested Manager approval',
                        referenceId:String(bookingId),details:why});
                    await connection.commit();
                    return response(200,{success:true,approvalStatus:'pending'});
                }
                if(!result.standardEligible)throw rentalError('Manager approval required: '+result.reasons.join(' '));
                const stage=normalizeBookingStatus(result.booking.status);
                if(stage==='Pending Review'){
                    if(Number(result.booking.required_down_payment||0)<=0)
                        throw rentalError('A zero-down-payment reservation requires Manager approval.');
                    await checkAvailableBeforePayment(connection,{bookingId,storeId:store_id,branchId});
                    const [updated]=await connection.execute(`UPDATE bookings
                                                              SET status='Awaiting Down Payment'
                                                              WHERE id=? AND store_id=? AND branch_id=? AND status='Pending Review'`,
                        [bookingId,store_id,branchId]);
                    if(updated.affectedRows!==1)throw rentalError('Booking status changed. Refresh and retry.');
                    await logEmployeeAction(connection,{storeId:store_id,branchId,employee,module:'Bookings',
                        referenceNumber:result.booking.booking_reference||String(bookingId),action:'Approved booking awaiting DP',
                        referenceId:String(bookingId),details:`Reviewed standard catalog quotation: ₱${result.baseline.toFixed(2)}. No stock allocated.`});
                    await connection.commit();
                    return response(200,{success:true,status:'Awaiting Down Payment',reserved_items:0});
                }
                requireBookingDeposit(result.booking);
                await requireCustomerReviewClear(connection,{bookingId,storeId:store_id,branchId,phone:result.booking.phone});
                const [updated]=await connection.execute(`UPDATE bookings SET status='Confirmed'
                                                          WHERE id=? AND store_id=? AND branch_id=? AND status='Awaiting Down Payment'`,
                    [bookingId,store_id,branchId]);
                if(updated.affectedRows!==1)throw rentalError('Booking status changed. Refresh and retry.');
                const inventory=await reserveBookingInventory(connection,{bookingId,storeId:store_id,branchId,actor:employee});
                if(!inventory.ok)throw rentalError(inventory.error||'Insufficient inventory for this booking.');
                await confirmRentalAllocations(connection,{bookingId,storeId:store_id,branchId,price:result.booking.agreed_price});
                await logEmployeeAction(connection,{storeId:store_id,branchId,employee,module:'Bookings',
                    referenceNumber:result.booking.booking_reference||String(bookingId),action:'Confirmed paid standard booking',
                    referenceId:String(bookingId),details:`DP verified by Manager; items allocated.`});
                await connection.commit();
                return response(200,{success:true,status:'Confirmed',reserved_items:inventory.reservedCount||0});
            }catch(err){
                await connection.rollback();
                if(err.rentalValidation)return response(409,{error:err.message,requiresManagerApproval:true});
                throw err;
            }
        }


        // Staff-only operational transitions. Never expose the general Manager
        // update_status / price / cancellation API through a Staff permission.
        if (action === "advance_staff_booking") {
            if (tokenRole !== "staff" || !["standard", "full"].includes(bookingAccess))
                return response(403, {error: "Staff booking operations permission is required."});
            const bookingId = Number(body.booking_id);
            const target = normalizeBookingStatus(body.status);
            if (!Number.isSafeInteger(bookingId) || bookingId <= 0 ||
                !["Preparing", "Completed"].includes(target))
                return response(400, {error: "Choose a valid booking and permitted operational step."});
            // These fields are intentionally outside Staff operational authority.
            if (body.agreed_price !== undefined || body.required_down_payment !== undefined ||
                body.amount_paid !== undefined || body.used_items !== undefined)
                return response(403, {error: "Staff cannot modify booking prices, payment terms or cancellation quantities."});
            const branchId = Number(tokenBranchId);
            await connection.beginTransaction();
            try {
                const [rows] = await connection.execute(`SELECT id,booking_reference,name,status,
                                                                DATE_FORMAT(event_date,'%Y-%m-%d') AS eventDate,
                                                                DATE_FORMAT(COALESCE(event_end_date,event_date),'%Y-%m-%d') AS eventEndDate,
                                                                agreed_price,package_price,required_down_payment,amount_paid
                                                         FROM bookings WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                    [bookingId,store_id,branchId]);
                if (!rows.length) throw rentalError("Booking not found in your assigned branch.");
                const booking = rows[0];
                const current = normalizeBookingStatus(booking.status);
                const expected = target === "Preparing" ? "Confirmed" : "Preparing";
                if (current !== expected)
                    throw rentalError(`Booking must be ${expected} before Staff can mark it ${target}.`);

                const [approvalRows] = await connection.execute(`SELECT status FROM booking_approval_requests
                                                                 WHERE booking_id=? AND store_id=? AND branch_id=? LIMIT 1`, [bookingId,store_id,branchId]);
                if (["pending", "rejected"].includes(String(approvalRows[0]?.status || "").toLowerCase()))
                    throw rentalError("Manager approval is unresolved for this booking.");
                const agreed = Number(booking.agreed_price ?? booking.package_price ?? 0);
                const paid = Number(booking.amount_paid ?? 0);
                const down = Number(booking.required_down_payment ?? 0);
                if (!Number.isFinite(agreed) || agreed <= 0 || !Number.isFinite(paid) || paid < 0 ||
                    !Number.isFinite(down) || down < 0 || down > agreed || paid + 0.005 < down)
                    throw rentalError("Verify the agreed booking charge and record its required down payment first.");

                // Reservation is made on confirmation. Ensure the actual Sales lines
                // still reflect that reservation before Staff begins fulfillment.
                const [sales] = await connection.execute(`SELECT booked_quantity,reserved_quantity,inventory_status
                                                          FROM booking_items WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                    [bookingId,store_id,branchId]);
                if (sales.some(line => Number(line.booked_quantity) <= 0 ||
                    Number(line.reserved_quantity) !== Number(line.booked_quantity) ||
                    String(line.inventory_status || "").toLowerCase() !== "reserved"))
                    throw rentalError("Booking sales inventory is not fully reserved. Ask Manager to reconcile the booking.");

                const [rentals] = await connection.execute(`SELECT r.equipment_id,r.quantity,
                                                                   a.quantity AS allocatedQuantity,a.status AS allocationStatus
                                                            FROM booking_rental_items r LEFT JOIN rental_booking_allocations a
                                                                                                  ON a.store_id=r.store_id AND a.branch_id=r.branch_id AND a.equipment_id=r.equipment_id
                                                                                                      AND a.booking_reference COLLATE utf8mb4_unicode_ci=r.booking_reference COLLATE utf8mb4_unicode_ci
                                                            WHERE r.booking_id=? AND r.store_id=? AND r.branch_id=? FOR UPDATE`,
                    [bookingId,store_id,branchId]);
                if (!sales.length && !rentals.length)
                    throw rentalError("Booking has no verified inventory or rental equipment to fulfill.");
                if (rentals.some(r => Number(r.allocatedQuantity) !== Number(r.quantity) ||
                    (target === "Preparing" && r.allocationStatus !== "reserved")))
                    throw rentalError("Rental equipment reservation is missing or has already progressed. Review Rental Inventory.");

                if (target === "Completed") {
                    // Staff cannot complete future events, unpaid service or outstanding rentals.
                    const todayParts = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Manila",
                        year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
                    const datePart = type => todayParts.find(p => p.type === type)?.value || "";
                    const today = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
                    if (String(booking.eventEndDate || booking.eventDate) > today)
                        throw rentalError("Complete the booking on or after the last scheduled event day.");
                    if (paid + 0.005 < agreed)
                        throw rentalError("Record the remaining customer payment before completing the booking.");
                    // Booking completion must not bypass the Staff Sales handover.
                    const [pendingSales]=await connection.execute(`SELECT COUNT(*) AS pendingCount
                                                                   FROM booking_items bi LEFT JOIN booking_sales_fulfillment f
                                                                                                   ON f.booking_item_id=bi.id AND f.store_id=bi.store_id AND f.branch_id=bi.branch_id
                                                                   WHERE bi.booking_id=? AND bi.store_id=? AND bi.branch_id=?
                                                                     AND bi.product_id IS NOT NULL AND bi.booked_quantity>0
                                                                     AND bi.inventory_status='reserved'
                                                                     AND (f.issued_at IS NULL OR COALESCE(bi.used_quantity,0)<bi.booked_quantity)`,
                        [bookingId,store_id,branchId]);
                    if(Number(pendingSales[0]?.pendingCount||0)>0)
                        throw rentalError('Staff must hand over the complete Sales product inclusions before finishing this booking.');
                    await requireRentalReturnBeforeCompletion(connection,{bookingId,storeId:store_id,branchId});
                    await requireRentalIncidentSettlement(connection,{bookingId,storeId:store_id,branchId});
                    if (rentals.length) {
                        const [finance] = await connection.execute(`SELECT refundable_deposit_required,deposit_collected
                                                                    FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=?`,
                            [bookingId,store_id,branchId]);
                        if (!finance.length || Number(finance[0].deposit_collected) + 0.005 <
                            Number(finance[0].refundable_deposit_required))
                            throw rentalError("Record the required refundable security deposit before closing rental fulfillment.");
                    }
                }

                const [updated] = await connection.execute(`UPDATE bookings SET status=?
                                                            WHERE id=? AND store_id=? AND branch_id=? AND status=?`,
                    [target,bookingId,store_id,branchId,current]);
                if (updated.affectedRows !== 1) throw rentalError("Booking status changed. Refresh and retry.");
                const employee = await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                await logEmployeeAction(connection,{storeId:store_id,branchId,employee,module:"Bookings",
                    referenceNumber:buildBookingReference(booking,bookingId),
                    action:target === "Preparing" ? "Started preparing booking" : "Completed booking operations",
                    referenceId:String(bookingId),details:`${current} → ${target} (Staff operational workflow)`});
                await connection.commit();
                return response(200,{success:true,status:target});
            } catch(err) {
                await connection.rollback();
                if (err.rentalValidation) return response(409,{error:err.message});
                throw err;
            }
        }

        // ── PROTECTED: update_status (enhanced) ────────────────────────────────
        if (tokenRole === 'owner' && new Set(['update_status','update_price','update_payment']).has(action)) {
            return response(403,{error:'Operational booking changes require an authorized Manager or Staff workflow.'});
        }

        if (action === "update_status") {
            const { booking_id, status: rawStatus, agreed_price, branch_id, branchId } = body;
            let status = rawStatus;
            const usedItems = getUsedItemsInput(body);
            const requestedBranchId = branch_id || branchId;

            if (!booking_id || !status) return response(400, { error: "Missing booking_id or status" });

            const allowedStatuses = ["Pending Review","Awaiting Down Payment","Confirmed","Cancelled"];
            const normalizedTargetStatus = normalizeBookingStatus(status);
            if (!normalizedTargetStatus || !allowedStatuses.includes(normalizedTargetStatus)) {
                return response(400, { error: "Invalid booking status" });
            }
            status = normalizedTargetStatus;

            let selectQuery = `
                SELECT id, status, store_id, branch_id, package_json, booking_reference, name
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

            const currentStatus = normalizeBookingStatus(rows[0].status) || "Pending Review";
            const allowedTransitions = {
                "Pending Review": ["Awaiting Down Payment","Confirmed","Cancelled"],
                "Awaiting Down Payment": ["Confirmed","Cancelled"],
                "Confirmed": ["Cancelled"],
                "Preparing": ["Cancelled"],
                "Released": [],
                "Return Inspection": [],
                "Pending Settlement": [],
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

            const actingEmployee = await getActingEmployee(
                connection,
                decodedToken,
                tokenRole,
                store_id
            );

            await connection.beginTransaction();
            try {
                if(status==='Awaiting Down Payment' || status==='Confirmed') {
                    // Check the saved, booking-specific deposit without an Owner policy.
                    // The Manager may agree to ₱0 or any valid nonnegative amount.
                    if(currentStatus==='Pending Review'){
                        const branchId=Number(requestedBranchId||rows[0].branch_id);
                        const [rentalLines]=await connection.execute(`SELECT COUNT(*) AS units
                                                                      FROM booking_rental_items WHERE booking_id=? AND store_id=? AND branch_id=?`,
                            [Number(booking_id),store_id,branchId]);
                        if(Number(rentalLines[0]?.units||0)>0){
                            const [terms]=await connection.execute(`SELECT refundable_deposit_required
                                                                    FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                                [Number(booking_id),store_id,branchId]);
                            if(!terms.length)throw rentalError('Booking deposit terms are missing. Review and save payment terms first.');
                            const deposit=Number(terms[0].refundable_deposit_required);
                            if(terms[0].refundable_deposit_required == null || !Number.isFinite(deposit) || deposit<0)
                                throw rentalError('Save a valid optional refundable security deposit in Payment Terms first.');
                        }
                    }
                    const review=await inspectBookingForConfirmation(connection,{
                        bookingId:Number(booking_id),storeId:store_id,
                        branchId:Number(requestedBranchId||rows[0].branch_id),lock:true
                    });
                    // Manager can approve non-standard scope, but never missing price, unpaid required
                    // down payment, invalid amounts, or missing price records.
                    const blocking=review.reasons.filter(r=>
                        /has not been set|has not been recorded|invalid|inconsistent|quotation is missing|do not match|missing/i.test(r));
                    if(blocking.length)throw rentalError(blocking.join(' '));
                    if(agreed_price!==undefined && Math.abs(Number(agreed_price)-Number(review.booking.agreed_price))>0.01)
                        throw rentalError('Save and review the agreed price first; do not override it during confirmation.');
                    if(review.approval?.status==='rejected')throw rentalError('Rejected approval request must be reviewed again before confirming.');
                    if(status==='Awaiting Down Payment'){
                        if(Number(review.booking.required_down_payment||0)<=0)
                            throw rentalError('Use the Manager no-DP approval option for a booking with no down payment.');
                        await checkAvailableBeforePayment(connection,{bookingId:Number(booking_id),storeId:store_id,
                            branchId:Number(requestedBranchId||rows[0].branch_id)});
                    } else if(currentStatus==='Pending Review'){
                        const reason=String(body.noDpReason||'').trim();
                        if(Number(review.booking.required_down_payment||0)!==0 || reason.length<10)
                            throw rentalError('Direct confirmation requires a zero DP and a Manager waiver reason (10+ characters).');
                        await connection.execute(`UPDATE bookings SET booking_no_dp_approved_by=?,booking_no_dp_reason=?
                                                  WHERE id=? AND store_id=? AND branch_id=?`,
                            [String(actingEmployee.name||'Manager'),reason,Number(booking_id),store_id,Number(requestedBranchId||rows[0].branch_id)]);
                        review.booking.booking_no_dp_approved_by=String(actingEmployee.name||'Manager');
                    }
                    if(status==='Confirmed'){
                        requireBookingDeposit(review.booking);
                        await requireCustomerReviewClear(connection,{bookingId:Number(booking_id),storeId:store_id,
                            branchId:Number(requestedBranchId||rows[0].branch_id),phone:review.booking.phone});
                    }
                    await connection.execute(`UPDATE booking_approval_requests SET status='approved',reviewed_by=?,reviewed_at=NOW()
                                              WHERE booking_id=? AND store_id=? AND branch_id=? AND status='pending'`,
                        [String(actingEmployee.name||'Manager'),Number(booking_id),store_id,Number(requestedBranchId||rows[0].branch_id)]);
                }
                // 1️⃣ Update booking status. Approval does not allocate inventory.
                let query = `UPDATE bookings SET status = ?`;
                const params = [status];
                if (agreed_price !== undefined && agreed_price !== null) {
                    const newPrice=financeCurrency(agreed_price,'Agreed booking price');
                    const [f]=await connection.execute('SELECT package_base,rental_subtotal,delivery_fee,setup_fee FROM booking_financial_details WHERE booking_id=?',[Number(booking_id)]);
                    if(f.length && newPrice + 0.005 < Number(f[0].package_base)+Number(f[0].rental_subtotal)+Number(f[0].delivery_fee)+Number(f[0].setup_fee))
                        throw rentalError('Booking price cannot be below package, rental and service charges.');
                    query += `, agreed_price = ?`; params.push(newPrice);
                }
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
                        actor: actingEmployee,
                    });

                    if (!inventoryResult.ok) {
                        await connection.rollback();

                        return response(400, {
                            error: inventoryResult.error,
                        });
                    }
                }

                if(status === "Confirmed") {
                    await confirmRentalAllocations(connection,{
                        bookingId:Number(booking_id),storeId:store_id,
                        branchId:requestedBranchId||rows[0].branch_id,
                        price:agreed_price??(await connection.execute(
                            "SELECT agreed_price FROM bookings WHERE id=? AND store_id=?",[Number(booking_id),store_id]))[0][0]?.agreed_price
                    });
                }
                if(status === "Completed") {
                    const [bill]=await connection.execute(`SELECT agreed_price,amount_paid FROM bookings
                                                           WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [Number(booking_id),store_id,Number(requestedBranchId||rows[0].branch_id)]);
                    if(!bill.length || Number(bill[0].agreed_price||0)<=0 ||
                        Number(bill[0].amount_paid||0)+0.005<Number(bill[0].agreed_price))
                        throw rentalError('Booking balance must be fully paid before completion.');
                    const [pendingSales]=await connection.execute(`SELECT COUNT(*) AS pendingCount
                                                                   FROM booking_items bi LEFT JOIN booking_sales_fulfillment f
                                                                                                   ON f.booking_item_id=bi.id AND f.store_id=bi.store_id AND f.branch_id=bi.branch_id
                                                                   WHERE bi.booking_id=? AND bi.store_id=? AND bi.branch_id=?
                                                                     AND bi.product_id IS NOT NULL AND bi.booked_quantity>0
                                                                     AND bi.inventory_status='reserved'
                                                                     AND (f.issued_at IS NULL OR COALESCE(bi.used_quantity,0)<bi.booked_quantity)`,
                        [Number(booking_id),store_id,Number(requestedBranchId||rows[0].branch_id)]);
                    if(Number(pendingSales[0]?.pendingCount||0)>0)
                        throw rentalError('The Sales products must be physically handed over before completing this booking.');
                    await requireRentalReturnBeforeCompletion(connection,{
                        bookingId:Number(booking_id),storeId:store_id,branchId:requestedBranchId||rows[0].branch_id
                    });
                    await requireRentalIncidentSettlement(connection,{
                        bookingId:Number(booking_id),storeId:store_id,branchId:requestedBranchId||rows[0].branch_id
                    });
                }
                if (status === "Cancelled") {
                    await cancelRentalAllocations(connection,{
                        bookingId:Number(booking_id),storeId:store_id,branchId:requestedBranchId||rows[0].branch_id
                    });
                    inventoryResult = await restoreBookingInventoryOnCancel(connection, {
                        bookingId: Number(booking_id),
                        storeId: rows[0].store_id,
                        branchId: requestedBranchId || rows[0].branch_id || null,
                        usedItems,
                        actor: actingEmployee,
                    });

                    if (!inventoryResult.ok) {
                        await connection.rollback();

                        return response(400, {
                            error: inventoryResult.error,
                        });
                    }
                }

                // The booking transition, Manager approval, and audit log commit together.
                const statusActionLabels = {
                    "Awaiting Down Payment": "Approved booking awaiting DP",
                    Confirmed: "Confirmed booking",
                    Preparing: "Started preparing booking",
                    Completed: "Marked booking as completed",
                    Cancelled: "Cancelled booking",
                };
                const bookingRef = buildBookingReference(rows[0], booking_id);
                const customerName = rows[0].name || "customer";
                await logEmployeeAction(connection, {
                    storeId:store_id,branchId:requestedBranchId||rows[0].branch_id||null,
                    employee:actingEmployee,module:"Bookings",referenceNumber:bookingRef,
                    action:statusActionLabels[status]||`Updated booking status to ${status}`,
                    referenceId:String(booking_id),
                    details:`${bookingRef} (${customerName}): ${currentStatus} → ${status}`,
                });
                await connection.commit();
            } catch (err) {
                await connection.rollback();
                if(err.rentalValidation)return response(409,{error:err.message});
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

        // ── PROTECTED: update_price for pre-approval booking payment terms ───────
        if (action === "update_price") {
            const {
                booking_id,
                agreed_price,
                required_down_payment,
                requiredDownPayment,
                refundable_deposit,
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

            let priceSelectQuery = `
                SELECT id, branch_id, booking_reference, name, status, agreed_price, required_down_payment
                FROM bookings
                WHERE id = ?
                  AND store_id = ?
            `;
            const priceSelectParams = [Number(booking_id), store_id];
            if (requestedBranchId) {
                priceSelectQuery += ` AND branch_id = ?`;
                priceSelectParams.push(Number(requestedBranchId));
            }

            const [priceRows] = await connection.execute(priceSelectQuery, priceSelectParams);

            if (!priceRows.length) {
                return response(404, { error: "Booking not found" });
            }

            const previousBooking = priceRows[0];
            // Payment terms, including deposit waivers, are locked after approval.
            if(normalizeBookingStatus(previousBooking.status)!=='Pending Review')
                return response(409,{error:'Booking payment terms are locked after Manager approval.'});
            const bookingBranchId=Number(previousBooking.branch_id);
            const depositSpecified=refundable_deposit!==undefined && refundable_deposit!==null;
            const depositAmount=depositSpecified?financeCurrency(refundable_deposit,'Refundable security deposit'):null;
            const rentalQuote=await rentalQuoteTotal(connection,Number(booking_id),store_id,
                requestedBranchId||previousBooking.branch_id);
            const [financeLines]=await connection.execute(`SELECT package_base,rental_subtotal,delivery_fee,setup_fee
                                                           FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=?`,
                [Number(booking_id),store_id,requestedBranchId||previousBooking.branch_id]);
            const requiredMinimum=financeLines.length ?
                Number(financeLines[0].package_base)+Number(financeLines[0].rental_subtotal)+
                Number(financeLines[0].delivery_fee)+Number(financeLines[0].setup_fee) : rentalQuote.total;
            if(depositSpecified && rentalQuote.count===0 && depositAmount>0)
                return response(400,{error:'Rental security deposits apply only to bookings containing rental equipment.'});
            if(rentalQuote.count || requiredMinimum>0){
                const [state]=await connection.execute("SELECT status FROM bookings WHERE id=? AND store_id=?",
                    [Number(booking_id),store_id]);
                if(normalizeBookingStatus(state[0]?.status)!=='Pending Review')
                    return response(409,{error:"Rental booking prices cannot be changed after confirmation."});
                if(total<requiredMinimum-0.005)
                    return response(400,{error:`Booking price cannot be below the saved package, rental, and service charges of ₱${requiredMinimum.toFixed(2)}.`});
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
                                         WHEN ? = 0 THEN 'Unpaid'
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
                requiredDp,
                Number(booking_id),
                store_id,
            ];

            if (requestedBranchId) {
                query += ` AND branch_id = ?`;
                params.push(Number(requestedBranchId));
            }

            await connection.beginTransaction();

            try {
                await connection.execute(query, params);
                if(depositSpecified){
                    const [existingDeposit]=await connection.execute(`SELECT deposit_collected,deposit_applied,deposit_refunded
                                                                      FROM booking_financial_details WHERE booking_id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                        [Number(booking_id),store_id,bookingBranchId]);
                    if(existingDeposit.length && depositAmount+0.005<Number(existingDeposit[0].deposit_collected||0))
                        throw rentalError('The agreed deposit cannot be lower than funds already collected; settle them first.');
                    await connection.execute(`INSERT INTO booking_financial_details
                                              (booking_id,store_id,branch_id,refundable_deposit_required,deposit_waiver_reason)
                                              VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE
                                                  refundable_deposit_required=VALUES(refundable_deposit_required),
                                                  deposit_waiver_reason=VALUES(deposit_waiver_reason)`,
                        [Number(booking_id),store_id,bookingBranchId,depositAmount,null]);
                }

                const priceBookingRef = buildBookingReference(previousBooking, booking_id);
                const customerNameForPrice = previousBooking.name || "customer";
                const prevAgreed = Number(previousBooking.agreed_price || 0);
                const prevDp = Number(previousBooking.required_down_payment || 0);

                const actingEmployeeForPrice = await getActingEmployee(
                    connection,
                    decodedToken,
                    tokenRole,
                    store_id
                );

                await logEmployeeAction(connection, {
                    storeId: store_id,
                    branchId: requestedBranchId || previousBooking.branch_id || null,
                    employee: actingEmployeeForPrice,
                    module: "Bookings",
                    referenceNumber: priceBookingRef,
                    action: "Updated booking payment terms",
                    referenceId: String(booking_id),
                    details:
                        `${priceBookingRef} (${customerNameForPrice}): ` +
                        `price ₱${prevAgreed.toLocaleString()} → ₱${total.toLocaleString()}, ` +
                        `down payment ₱${prevDp.toLocaleString()} → ₱${requiredDp.toLocaleString()}` +
                        (depositSpecified ? `, refundable deposit ₱${depositAmount.toLocaleString()}` : ''),
                });

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            }

            return response(200, {
                success: true,
                agreed_price: total,
                required_down_payment: requiredDp,
                ...(depositSpecified?{refundable_deposit:depositAmount}:{}),
            });
        }

        // ── MANAGER: record verified booking payment and optional deposit together ──
        // Atomic settlement: refundable deposit is a separate liability, never
        // counted toward the agreed booking price or ordinary booking payments.
        if (action === "record_booking_customer_payment_with_deposit") {
            if (tokenRole !== "manager" || bookingAccess !== "full")
                return response(403, {error: "Assigned-branch Manager with full Bookings access is required."});
            const bookingId = Number(body.booking_id);
            const branchId = Number(tokenBranchId);
            if (!Number.isSafeInteger(bookingId) || bookingId <= 0)
                return response(400, {error: "Valid booking ID is required."});
            const bookingPayment = financeCurrency(body.bookingPayment ?? 0, "Booking payment received");
            const depositPayment = financeCurrency(body.depositPayment ?? 0, "Refundable security deposit received");
            const expectedBookingPaid = financeCurrency(body.expectedBookingPaid, "Previously recorded booking payment");
            const expectedDepositCollected = financeCurrency(body.expectedDepositCollected, "Previously recorded security deposit");
            if (bookingPayment + depositPayment <= 0)
                return response(400, {error: "Record a positive booking payment, security deposit, or both."});
            const requestKey = String(body.requestKey || "").trim();
            if (!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey))
                return response(400, {error: "A unique payment transaction key is required."});

            await connection.beginTransaction();
            try {
                const [bookings] = await connection.execute(`SELECT id,booking_reference,name,status,
                                                                    agreed_price,package_price,required_down_payment,amount_paid
                                                             FROM bookings WHERE id=? AND store_id=? AND branch_id=? FOR UPDATE`,
                    [bookingId,store_id,branchId]);
                if (!bookings.length) throw rentalError("Booking not found in the Manager's assigned branch.");
                const booking = bookings[0];
                const [prior] = await connection.execute(`SELECT booking_id,event_type,amount FROM booking_financial_events
                                                          WHERE store_id=? AND request_key=? LIMIT 1 FOR UPDATE`,
                    [store_id,requestKey]);
                if (prior.length) {
                    if (Number(prior[0].booking_id) !== bookingId ||
                        String(prior[0].event_type) !== "deposit_received" ||
                        Math.abs(Number(prior[0].amount) - depositPayment) > 0.005)
                        throw rentalError("This payment transaction key was already used for another entry.");
                    await connection.rollback();
                    return response(200, {success:true,alreadyRecorded:true,refreshRequired:true});
                }
                const agreed = Number(booking.agreed_price || booking.package_price || 0);
                const currentPaid = Number(booking.amount_paid);
                const down = Number(booking.required_down_payment || 0);
                if (![agreed,currentPaid,down].every(Number.isFinite) || agreed <= 0 ||
                    currentPaid < 0 || currentPaid > agreed + 0.005)
                    throw rentalError("The agreed booking price or previous payment needs reconciliation.");
                if (Math.abs(currentPaid - expectedBookingPaid) > 0.005)
                    throw rentalError("Booking payments changed. Close and reopen the payment dialog before recording more money.");
                const [terms] = await connection.execute(`SELECT refundable_deposit_required,deposit_collected
                                                          FROM booking_financial_details
                                                          WHERE booking_id=? AND store_id=? AND branch_id=? LIMIT 1 FOR UPDATE`,
                    [bookingId,store_id,branchId]);
                if (!terms.length)
                    throw rentalError("Booking financial details are unavailable. Ask the Manager to review Billing.");
                const requiredDeposit = Number(terms[0].refundable_deposit_required);
                const collectedDeposit = Number(terms[0].deposit_collected);
                if (![requiredDeposit,collectedDeposit].every(Number.isFinite) || requiredDeposit < 0 || collectedDeposit < 0)
                    throw rentalError("Security-deposit records need reconciliation before collecting payment.");
                if (Math.abs(collectedDeposit - expectedDepositCollected) > 0.005)
                    throw rentalError("Security deposit collections changed. Close and reopen the payment dialog.");
                const bookingRemainingCents = Math.max(0,Math.round(agreed*100) - Math.round(currentPaid*100));
                const depositRemainingCents = Math.max(0,Math.round(requiredDeposit*100) - Math.round(collectedDeposit*100));
                if (Math.round(bookingPayment*100) > bookingRemainingCents)
                    throw rentalError("Booking payment exceeds the outstanding booking balance.");
                if (Math.round(depositPayment*100) > depositRemainingCents)
                    throw rentalError("Security deposit payment exceeds the agreed unpaid refundable deposit.");
                const newPaid = (Math.round(currentPaid*100) + Math.round(bookingPayment*100)) / 100;
                const newDepositCollected = (Math.round(collectedDeposit*100) + Math.round(depositPayment*100)) / 100;
                const newBalance = Math.max(0,(Math.round(agreed*100) - Math.round(newPaid*100)) / 100);
                const paymentStatus = newBalance <= 0 ? "Fully Paid" :
                    down > 0 && newPaid + 0.005 >= down ? "Down Payment Paid" :
                        newPaid > 0 ? "Partial" : "Unpaid";

                await connection.execute(`UPDATE bookings SET amount_paid=?,balance=?,payment_status=?
                                          WHERE id=? AND store_id=? AND branch_id=?`,
                    [newPaid,newBalance,paymentStatus,bookingId,store_id,branchId]);
                if (depositPayment > 0) {
                    const employee = await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                    await connection.execute(`INSERT INTO booking_financial_events
                                              (booking_id,store_id,branch_id,claim_id,event_type,amount,request_key,actor_role,actor_name)
                                              VALUES (?,?,?,NULL,'deposit_received',?,?,?,?)`,
                        [bookingId,store_id,branchId,depositPayment,requestKey,tokenRole,employee.name]);
                    await connection.execute(`UPDATE booking_financial_details SET deposit_collected=deposit_collected+?
                                              WHERE booking_id=? AND store_id=? AND branch_id=?`,
                        [depositPayment,bookingId,store_id,branchId]);
                }
                const employee = await getActingEmployee(connection,decodedToken,tokenRole,store_id);
                await logEmployeeAction(connection,{
                    storeId:store_id,branchId,employee,module:"Bookings",
                    referenceNumber:buildBookingReference(booking,bookingId),
                    referenceId:String(bookingId),action:"Recorded verified customer payment",
                    details:`Booking payment ₱${bookingPayment.toFixed(2)}; refundable security deposit ₱${depositPayment.toFixed(2)}. Deposit recorded separately from revenue.`,
                });
                await connection.commit();
                return response(200,{success:true,amountPaid:newPaid,balance:newBalance,paymentStatus,
                    depositCollected:newDepositCollected,
                    depositRemaining:Math.max(0,(Math.round(requiredDeposit*100)-Math.round(newDepositCollected*100))/100),
                    totalDueBeforeRelease:Math.max(0,newBalance)+
                        Math.max(0,(Math.round(requiredDeposit*100)-Math.round(newDepositCollected*100))/100)});
            } catch (err) {
                await connection.rollback();
                if (err.rentalValidation) return response(409,{error:err.message});
                throw err;
            }
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
            if (!Number.isFinite(Number(amount_paid)) || paid < 0 ||
                (safeBalance !== null && (!Number.isFinite(Number(balance)) || safeBalance < 0))) {
                return response(400, { error: "Payment amounts must be valid non-negative numbers." });
            }

            // Do not accept a self-declared Fully Paid status at less than the agreed charge.
            const [monetaryState]=await connection.execute(`SELECT agreed_price,package_price,required_down_payment
                                                            FROM bookings WHERE id=? AND store_id=?`,[Number(booking_id),store_id]);
            if(!monetaryState.length)return response(404,{error:'Booking not found.'});
            const monetaryTotal=Number(monetaryState[0].agreed_price||monetaryState[0].package_price||0);
            if((payment_status==='Fully Paid'||payment_status==='Down Payment Paid')&&monetaryTotal<=0)
                return response(409,{error:'Confirm the agreed booking price before recording its down payment.'});
            if(paid>monetaryTotal+0.005&&monetaryTotal>0)
                return response(400,{error:'Collected booking payments cannot exceed the agreed charge. Track refundable deposits separately.'});
            if((payment_status==='Fully Paid'&&paid+0.005<monetaryTotal)||
                (payment_status==='Down Payment Paid'&&paid+0.005<Number(monetaryState[0].required_down_payment||0)))
                return response(400,{error:'Payment status does not match the recorded amount collected.'});
            // Recompute the balance instead of trusting the client-provided balance.
            if(safeBalance!==null&&Math.abs(safeBalance-Math.max(0,monetaryTotal-paid))>0.01)
                return response(400,{error:'Booking balance must equal the agreed price minus recorded payments.'});

            let selectQuery = `
                SELECT id, status, store_id, branch_id, booking_reference, name
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

            const currentStatus = normalizeBookingStatus(bookingRows[0].status) || "Pending Review";
            // Payment collection never approves a booking; confirmation is an independent
            // operation with branch, quotation and inventory validation.
            const willAutoConfirm = false;

            let query = `
                UPDATE bookings
                SET
                    amount_paid = ?,
                    payment_status = ?,
                    balance = CASE
                                  WHEN ? IS NULL THEN GREATEST(
                                          COALESCE(NULLIF(agreed_price, 0), NULLIF(package_price, 0), 0) - ?,
                                          0
                                                      )
                                  ELSE ?
                        END,
                    status = status
                WHERE id = ?
                  AND store_id = ?
            `;

            const params = [
                paid,
                payment_status,
                safeBalance,
                paid,
                safeBalance,
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

                if(willAutoConfirm){
                    const [priceRows]=await connection.execute("SELECT agreed_price,package_price FROM bookings WHERE id=? AND store_id=?",
                        [Number(booking_id),store_id]);
                    await confirmRentalAllocations(connection,{
                        bookingId:Number(booking_id),storeId:store_id,branchId:requestedBranchId||bookingRows[0].branch_id,
                        price:priceRows[0]?.agreed_price??priceRows[0]?.package_price
                    });
                }
                await connection.commit();
            } catch (err) {
                await connection.rollback();
                if(err.rentalValidation)return response(409,{error:err.message});
                throw err;
            }

            const paymentBookingRef = buildBookingReference(bookingRows[0], booking_id);
            const customerNameForPayment = bookingRows[0].name || "customer";

            const paymentActionLabels = {
                "Fully Paid": "Marked as fully paid",
                "Down Payment Paid": "Marked down payment as paid",
                "Partial": "Recorded partial payment",
            };

            const actingEmployeeForPayment = await getActingEmployee(
                connection,
                decodedToken,
                tokenRole,
                store_id
            );

            await logEmployeeAction(connection, {
                storeId: store_id,
                branchId: requestedBranchId || bookingRows[0].branch_id || null,
                employee: actingEmployeeForPayment,
                module: "Bookings",
                referenceNumber: paymentBookingRef,
                action: paymentActionLabels[payment_status] || `Updated payment status to ${payment_status}`,
                referenceId: String(booking_id),
                details: `${paymentBookingRef} (${customerNameForPayment}): paid ₱${paid.toLocaleString()}, status → ${payment_status}`,
            });

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
            connection.release();
        }
    }
};