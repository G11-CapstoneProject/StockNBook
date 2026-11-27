/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Replays the store's history day by day, in time order:
 *   opening stock → supplier restocks → POS sales → booking reserve / hand-over / cancel →
 *   damage and expiry reports → final stock counts.
 *
 * Produces: branch_inventory (final quantities), inventory_movements, orders, order_items,
 * POS payments, stock_issues and Inventory/POS activity. Every movement's before/after
 * matches the running balance, so on_hand / reserved / unavailable always equal the sum of
 * their movements.
 */
const { CONFIG } = require("../lib/config");
const V = require("../lib/vocab");
const { addDays, dayOfWeek, addMonths, dt, minutesToTime, daysInMonth } = require("../lib/dates");
const { createDemandModel, cumulative, pickIndex } = require("../lib/demand");
const DEMAND_WEIGHT = { high: 10, medium: 4, slow: 1 };
const money2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nowMinutes = () => { const [h, m] = CONFIG.nowTime.split(":").map(Number); return h * 60 + m; };

async function simulate({ ctx, catalog, bookingOut, customers, ids, rng, equipUnits, inventoryIndex, demand }) {
    const { store, branches, storeStart } = ctx;
    const today = CONFIG.today;
    const salesStart = addMonths(today, -CONFIG.historyMonths);
    const model = demand || createDemandModel({ rng, start: salesStart, today, branches });
    const out = { inventory: [], movements: [], orders: [], orderItems: [], payments: [], stockIssues: [], actions: [] };
    const branchById = new Map(branches.map((b) => [b.id, b]));
    const userName = ctx.userName, roleLabel = ctx.userRoleLabel;

    // ── Inventory rows with opening stock ──
    const rows = [];
    const rowByKey = new Map();
    for (const inv of catalog.inventory) {
        const v = inv.variant, e = inv.equipment;
        const demand = v ? v._product._demand : null;
        const reorder = v ? (demand === "high" ? rng.int(20, 40) : demand === "medium" ? rng.int(10, 20) : rng.int(4, 10)) : 0;
        const row = { id: inv.id, branchId: inv.branchId, v, e, on_hand: 0, reserved: 0, unavailable: 0, reorder,
            expiration: null, fixture: null, frozenFrom: null, expireDate: null, lastCounted: null,
            weight: v ? DEMAND_WEIGHT[demand] * (v._product.has_variants ? 0.6 : 1) : 0 };
        rows.push(row);
        rowByKey.set(v ? `${inv.branchId}:v:${v.id}` : `${inv.branchId}:e:${e.id}`, row);
    }
    if (rowByKey.size !== inventoryIndex.size) throw new Error("Inventory index mismatch.");

    const move = async (row, bucket, change, type, refType, refId, reason, actorId, at, unitCost = null) => {
        if (!change) return;
        const before = row[bucket], after = before + change;
        if (after < 0) throw new Error(`Negative ${bucket} for inventory ${row.id} (${type}).`);
        row[bucket] = after;
        if (row.on_hand < row.reserved + row.unavailable)
            throw new Error(`on_hand < reserved + unavailable for inventory ${row.id} after ${type}.`);
        out.movements.push({ id: await ids.take("inventory_movements"), store_id: store.id, branch_id: row.branchId,
            branch_inventory_id: row.id, movement_type: type, quantity_bucket: bucket === "on_hand" ? V.BUCKET.ON_HAND
                : bucket === "reserved" ? V.BUCKET.RESERVED : V.BUCKET.UNAVAILABLE,
            quantity_change: change, quantity_before: before, quantity_after: after, unit_cost: unitCost,
            reference_type: refType, reference_id: refId, reason, performed_by: actorId, created_at: at });
    };
    const available = (row) => row.on_hand - row.reserved - row.unavailable;
    const action = (branchId, userId, module, act, entityType, entityId, refNo, message, at) => out.actions.push({
        store_id: store.id, branch_id: branchId, user_id: userId, user_name: userName(userId), user_role: roleLabel(userId),
        module, action: act, entity_type: entityType, entity_id: entityId, reference_number: refNo,
        details: JSON.stringify(message), ip_address: null, created_at: at });

    // Opening stock on the day the catalog was created.
    for (const row of rows) {
        const branch = branchById.get(row.branchId);
        const at = dt(storeStart, 10, 30, rng.int(0, 59));
        if (row.v) {
            const qty = row.reorder * rng.int(3, 5);
            const p = row.v._product;
            await move(row, "on_hand", qty, V.MOVE.OPENING, V.REF.OPENING, p.id,
                `Ref OPEN-${p.id}-${p.has_variants ? `V${row.v.id}` : "BASE"}: New product opening stock`, branch.managerId, at, row.v.cost_price);
        } else {
            const qty = equipUnits.get(`${row.branchId}:${row.e.id}`);
            await move(row, "on_hand", qty, V.MOVE.OPENING, "EQUIPMENT_OPENING", row.e.id,
                `Ref OPEN-EQP-${row.e.id}: New rental equipment opening stock`, branch.managerId, at, row.e.cost_price);
        }
    }

    // ── End-of-history attention cases for the Inventory dashboards ──
    const variantRows = rows.filter((r) => r.v);
    for (const row of variantRows) {
        if (row.v._product._perishable) {
            const roll = rng.next();
            if (roll < 0.15) { row.fixture = "expired"; row.expireDate = addDays(today, -rng.int(3, 30)); }
            else if (roll < 0.35) { row.fixture = "expiring"; row.expiration = addDays(today, rng.int(1, 7)); }
            else row.expiration = addDays(today, rng.int(15, 120));
        } else if (!row.v._product._bookable || rng.chance(0.5)) {
            const roll = rng.next();
            if (roll < 0.04) { row.fixture = "out"; row.frozenFrom = addDays(today, -30); }
            else if (roll < 0.10) { row.fixture = "low"; row.frozenFrom = addDays(today, -30); }
        }
        if (row.fixture === "expired") { row.expiration = row.expireDate; row.frozenFrom = row.expireDate; }
    }

    // ── Dated events from bookings ──
    const dayEvents = new Map();
    const addEvent = (date, ev) => {
        if (date < storeStart || date > today) return;
        if (!dayEvents.has(date)) dayEvents.set(date, []);
        dayEvents.get(date).push(ev);
    };
    for (const ev of bookingOut.events) addEvent(ev.date, { ...ev, type: "booking" });
    for (const ev of bookingOut.equipmentEvents) addEvent(ev.date, { ...ev, type: "equipment" });

    // Products of each branch (restocks and counts walk this list).
    const pickers = new Map();
    for (const branch of branches) pickers.set(branch.id, { list: variantRows.filter((r) => r.branchId === branch.id) });

    // POS pickers per branch and half-month: each category's products weighted by the product's
    // own trend, fad and season (averaged over the half-month), plus the category's busy months.
    const periodPickers = new Map();
    const periodOf = (date) => {
        const half = Number(date.slice(8, 10)) <= 15 ? 1 : 2;
        const first = half === 1 ? `${date.slice(0, 8)}01` : `${date.slice(0, 8)}16`;
        const last = half === 1 ? `${date.slice(0, 8)}15` : `${date.slice(0, 8)}${String(daysInMonth(date)).padStart(2, "0")}`;
        return { key: `${date.slice(0, 7)}-${half}`, first, last };
    };
    const pickerFor = (branchId, date) => {
        const period = periodOf(date);
        const key = `${branchId}:${period.key}`;
        if (periodPickers.has(key)) return periodPickers.get(key);
        const days = [];
        for (let d = period.first; d <= period.last; d = addDays(d, 1)) days.push(d);
        const mid = days[Math.floor(days.length / 2)];
        const byCategory = new Map();
        for (const row of pickers.get(branchId).list) {
            const product = row.v._product;
            const factor = days.reduce((sum, d) => sum + model.productFactor(product, d), 0) / days.length;
            const category = product._category;
            if (!byCategory.has(category)) byCategory.set(category, { rows: [], weights: [] });
            const c = byCategory.get(category);
            c.rows.push(row);
            c.weights.push(row.weight * factor);
        }
        const categories = [];
        for (const [category, c] of byCategory) {
            const cum = cumulative(c.weights);
            categories.push({ category, rows: c.rows, cum, weight: cum.total * model.categoryFactor(category, mid) });
        }
        const picker = { categories };
        // Keep only the current and previous periods in memory.
        if (periodPickers.size > branches.length * 3) periodPickers.clear();
        periodPickers.set(key, picker);
        return picker;
    };
    // A product for an order line: the category is chosen with the time of day in mind.
    const pickRow = (branchId, date, minute) => {
        const { categories } = pickerFor(branchId, date);
        const weights = categories.map((c) => c.weight * model.hourFactor(c.category, minute));
        const c = categories[pickIndex(rng, cumulative(weights))];
        return c.rows[pickIndex(rng, c.cum)];
    };

    const orderSeq = new Map();
    const buyers = customers.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

    // Product damage / expiry reports (about one per branch every 3–4 weeks).
    // Every event gets its exact timestamp up front, so processing order = created_at order.
    const stamp = (date, minute) => {
        if (date === today) minute = Math.min(minute, nowMinutes() - 1); // nothing after "now"
        const [h, m] = minutesToTime(minute);
        return dt(date, h, m, rng.int(0, 59));
    };
    const scheduleIssue = (date) => { for (const branch of branches) if (rng.chance(1 / 25)) addEvent(date, { type: "product_issue", branchId: branch.id, at: stamp(date, rng.int(9 * 60, 17 * 60)) }); };

    for (let date = storeStart; date <= today; date = addDays(date, 1)) {
        if (date >= salesStart) scheduleIssue(date);
        const events = (dayEvents.get(date) || []).slice();
        const restockDay = [1, 4].includes(dayOfWeek(date)) && date > storeStart;
        if (restockDay) for (const branch of branches) events.push({ type: "restock", branchId: branch.id, at: stamp(date, rng.int(7 * 60, 8 * 60)) });
        if (date === addDays(today, -2)) for (const branch of branches) events.push({ type: "count", branchId: branch.id, at: stamp(date, 18 * 60) });
        if (date >= salesStart) {
            // How busy the day is and when each order happens come from the demand model.
            const closeMin = date === today ? Math.min(20 * 60, nowMinutes() - 1) : 20 * 60;
            for (const branch of branches) {
                const count = closeMin <= 8 * 60 ? 0 : rng.poisson(model.dayVolume(branch.id, date, ctx.ordersPerBranchDay));
                for (let i = 0; i < count; i += 1) {
                    const minute = model.orderMinute(date, closeMin);
                    events.push({ type: "order", branchId: branch.id, minute, at: stamp(date, minute) });
                }
            }
        }
        events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

        for (const ev of events) {
            const branch = branchById.get(ev.branchId);
            const at = ev.at;

            if (ev.type === "booking") {
                const row = rowByKey.get(`${ev.branchId}:v:${ev.variantId}`);
                const label = row.v._product.has_variants ? `${row.v._product.product_name} — ${row.v.variant_name}` : row.v._product.product_name;
                if (ev.kind === "reserve") {
                    if (available(row) < ev.qty) { // emergency supplier delivery so the confirmation can hold the stock
                        const qty = ev.qty - available(row) + row.reorder * 2;
                        await move(row, "on_hand", qty, V.MOVE.RESTOCK, V.REF.RESTOCK, null,
                            `Ref RST-${branch.branch_code}-${date.replace(/-/g, "")}-B: Supplier delivery for ${ev.ref}`, branch.managerId, at, row.v.cost_price);
                    }
                    await move(row, "reserved", ev.qty, V.MOVE.BOOKING_RESERVE, V.REF.BOOKING, ev.bookingId,
                        `Reserved ${ev.qty} unit(s) of ${label} for ${ev.ref}.`, ev.actorId, at);
                } else if (ev.kind === "unreserve") {
                    await move(row, "reserved", -ev.qty, V.MOVE.BOOKING_UNRESERVE, V.REF.BOOKING, ev.bookingId,
                        `Cancelled ${ev.ref}: released ${ev.qty} unused reserved unit(s) of ${label}.`, ev.actorId, at);
                } else if (ev.kind === "issue") {
                    const reason = `Handed over ${ev.qty} × ${label} for ${ev.ref}.`;
                    await move(row, "reserved", -ev.qty, V.MOVE.BOOKING_ISSUE, V.REF.BOOKING, ev.bookingId, reason, ev.actorId, at);
                    await move(row, "on_hand", -ev.qty, V.MOVE.BOOKING_ISSUE, V.REF.BOOKING, ev.bookingId, reason, ev.actorId, at, row.v.cost_price);
                }
            } else if (ev.type === "equipment") {
                const row = rowByKey.get(`${ev.branchId}:e:${ev.equipmentId}`);
                const ref = `SI-${ev.issueId}`;
                if (ev.kind === "report")
                    await move(row, "unavailable", ev.qty, V.MOVE.ISSUE_REPORTED, V.REF.STOCK_ISSUE, ev.issueId, `${ref}: ${ev.qty} unit(s) set aside after return inspection.`, ev.actorId, at);
                else if (ev.kind === "repair")
                    await move(row, "unavailable", -ev.qty, V.MOVE.ISSUE_RESOLVED, V.REF.STOCK_ISSUE, ev.issueId, `${ref}: repaired and back in rental stock.`, ev.actorId, at);
                else if (ev.kind === "write_off") {
                    await move(row, "unavailable", -ev.qty, V.MOVE.ISSUE_RESOLVED, V.REF.STOCK_ISSUE, ev.issueId, `${ref}: missing units written off.`, ev.actorId, at);
                    await move(row, "on_hand", -ev.qty, V.MOVE.WRITE_OFF, V.REF.STOCK_ISSUE, ev.issueId, `${ref}: missing units written off.`, ev.actorId, at, row.e.cost_price);
                }
            } else if (ev.type === "restock") {
                const ref = `RST-${branch.branch_code}-${date.replace(/-/g, "")}`;
                const actor = rng.chance(0.6) ? branch.managerId : rng.pick(branch.workerIds);
                let products = 0, units = 0;
                for (const row of pickers.get(branch.id).list) {
                    if (row.frozenFrom && date >= row.frozenFrom) continue;
                    if (available(row) > row.reorder) continue;
                    const qty = row.reserved + row.unavailable + row.reorder * rng.int(3, 5) - row.on_hand;
                    if (qty <= 0) continue;
                    await move(row, "on_hand", qty, V.MOVE.RESTOCK, V.REF.RESTOCK, null, `Ref ${ref}: Supplier delivery`, actor, at, row.v.cost_price);
                    products += 1; units += qty;
                }
                if (products) action(branch.id, actor, "Inventory", "Restocked products", "restock", null, ref,
                    `Received supplier delivery: ${products} product(s), ${units} unit(s)`, at);
            } else if (ev.type === "count") {
                // Cycle count: leaves the out-of-stock / low-stock cases the dashboards should show.
                for (const row of pickers.get(branch.id).list) {
                    if (row.fixture !== "out" && row.fixture !== "low") continue;
                    const target = row.fixture === "out" ? 0 : Math.max(1, Math.floor(row.reorder / 2));
                    const diff = target - available(row);
                    if (diff < 0) await move(row, "on_hand", diff, V.MOVE.ADJUST, V.REF.COUNT, null,
                        "Cycle count variance: damaged or unrecorded usage", branch.managerId, at, row.v.cost_price);
                    row.lastCounted = at;
                }
            } else if (ev.type === "product_issue") {
                const candidates = pickers.get(branch.id).list.filter((r) => available(r) >= 3 && !r.fixture);
                if (!candidates.length) continue;
                const row = rng.pick(candidates);
                const qty = rng.int(1, Math.min(3, available(row) - 1));
                const kind = row.v._product._perishable && rng.chance(0.6) ? V.ISSUE_TYPE.EXPIRED : V.ISSUE_TYPE.DAMAGED;
                const issueId = await ids.take("stock_issues");
                const reporter = rng.pick(branch.workerIds);
                const resolveDate = addDays(date, rng.int(2, 7));
                const resolved = resolveDate < today;
                const resolvedAt = resolved ? dt(resolveDate, 16, rng.int(0, 59)) : null;
                const label = row.v._product.has_variants ? `${row.v._product.product_name} — ${row.v.variant_name}` : row.v._product.product_name;
                out.stockIssues.push({ id: issueId, store_id: store.id, branch_id: branch.id, branch_inventory_id: row.id, booking_id: null,
                    issue_type: kind, quantity: qty, quantity_resolved: resolved ? qty : 0,
                    reason: kind === V.ISSUE_TYPE.EXPIRED ? `${qty} unit(s) of ${label} past expiry on the shelf.` : `${qty} unit(s) of ${label} damaged in storage.`,
                    status: resolved ? V.ISSUE_STATUS.RESOLVED : V.ISSUE_STATUS.OPEN, estimated_completion_date: resolved ? null : resolveDate,
                    reported_by: reporter, approved_by: resolved ? branch.managerId : null, approved_at: resolvedAt,
                    resolved_by: resolved ? branch.managerId : null, resolved_at: resolvedAt,
                    resolution_notes: resolved ? "Disposed and written off." : null, created_at: at, updated_at: resolvedAt || at });
                await move(row, "unavailable", qty, V.MOVE.ISSUE_REPORTED, V.REF.STOCK_ISSUE, issueId, `SI-${issueId}: ${kind} stock set aside.`, reporter, at);
                action(branch.id, reporter, "Inventory", "Reported stock issue", "stock_issue", issueId, `SI-${issueId}`, `Reported ${qty} ${kind} unit(s) of ${label}`, at);
                if (resolved) {
                    addEvent(resolveDate, { type: "issue_resolve", branchId: branch.id, at: resolvedAt, rowId: row.id, qty, issueId, label });
                }
            } else if (ev.type === "issue_resolve") {
                const row = rows.find((r) => r.id === ev.rowId);
                await move(row, "unavailable", -ev.qty, V.MOVE.ISSUE_RESOLVED, V.REF.STOCK_ISSUE, ev.issueId, `SI-${ev.issueId}: disposed.`, branch.managerId, at);
                await move(row, "on_hand", -ev.qty, V.MOVE.WRITE_OFF, V.REF.STOCK_ISSUE, ev.issueId, `SI-${ev.issueId}: written off.`, branch.managerId, at, row.v.cost_price);
                action(branch.id, branch.managerId, "Inventory", "Resolved stock issue", "stock_issue", ev.issueId, `SI-${ev.issueId}`, `Wrote off ${ev.qty} unit(s) of ${ev.label}`, at);
            } else if (ev.type === "order") {
                const lineCount = rng.weighted([[1, 35], [2, 35], [3, 20], [4, 10]]);
                const chosen = new Map();
                for (let tries = 0; tries < lineCount * 4 && chosen.size < lineCount; tries += 1) {
                    const row = pickRow(branch.id, date, ev.minute);
                    if (chosen.has(row.id) || available(row) <= 0) continue;
                    if (row.expireDate && date >= row.expireDate) continue; // expired stock is not sold
                    const maxQty = row.v._product._demand === "high" ? 6 : 3;
                    chosen.set(row.id, { row, qty: Math.min(available(row), rng.int(1, maxQty)) });
                }
                if (!chosen.size) continue;
                const seqKey = `${branch.id}:${date}`;
                const seq = (orderSeq.get(seqKey) || 0) + 1;
                orderSeq.set(seqKey, seq);
                const orderId = await ids.take("orders", "order_id");
                const orderNumber = `${store.store_code}-${branch.branch_code}-${date.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
                const processor = rng.chance(0.7) ? rng.pick(branch.workerIds) : branch.managerId;
                let subtotal = 0;
                for (const { row, qty } of chosen.values()) {
                    const lineTotal = money2(Number(row.v.selling_price) * qty);
                    subtotal = money2(subtotal + lineTotal);
                    out.orderItems.push({ id: await ids.take("order_items"), store_id: store.id, order_id: orderId, variant_id: row.v.id,
                        product_name_snapshot: row.v._product.has_variants ? `${row.v._product.product_name} - ${row.v.variant_name}` : row.v._product.product_name,
                        quantity: qty, unit_price: row.v.selling_price, cost_price_at_sale: row.v.cost_price, discount_amount: 0, line_total: lineTotal });
                    await move(row, "on_hand", -qty, V.MOVE.SALE, V.REF.ORDER, orderId, `POS sale ${orderNumber}`, processor, at, row.v.cost_price);
                }
                let discount = 0;
                if (subtotal > 200 && rng.chance(0.08)) discount = rng.chance(0.5) ? money2(Math.round(subtotal * rng.pick([0.05, 0.1]))) : rng.pick([20, 50]);
                const total = money2(subtotal - discount);
                const mode = rng.weighted(V.POS_PAYMENT_MODES);
                const step = total < 100 ? 20 : total < 500 ? 100 : total < 2000 ? 500 : 1000;
                const tendered = mode === "Cash" ? Math.ceil(total / step) * step : total;
                const vatable = ctx.isVat ? money2(total / 1.12) : 0;
                const buyer = rng.chance(0.12) ? buyers[rng.int(0, buyers.length - 1)] : null;
                out.orders.push({ order_id: orderId, order_number: orderNumber, store_id: store.id, branch_id: branch.id,
                    customer_id: buyer && buyer.created_at <= at ? buyer.id : null, order_date: at, subtotal, discount_amount: discount,
                    vatable_sales: vatable, vat_amount: ctx.isVat ? money2(total - vatable) : 0, total,
                    tax_type: ctx.isVat ? V.TAX.VAT : V.TAX.NON_VAT, payment_mode: mode, amount_tendered: tendered,
                    change_due: money2(tendered - total), status: V.ORDER_STATUS, processed_by: processor, created_at: at });
                out.payments.push({ id: await ids.take("payments"), store_id: store.id, branch_id: branch.id, booking_id: null, order_id: orderId,
                    payment_type: V.PAYMENT_TYPE.ORDER, amount: total, payment_method: mode,
                    reference_number: mode === "Cash" ? null : `${mode === "GCash" ? "GC" : "MY"}${rng.int(100000, 999999)}${rng.int(1000000, 9999999)}`,
                    status: V.PAYMENT_STATUS, request_key: null, recorded_by: processor, paid_at: at, notes: null, created_at: at });
                action(branch.id, processor, "POS", "Completed sale", "order", orderId, orderNumber,
                    `Sold ${[...chosen.values()].reduce((s, l) => s + l.qty, 0)} item(s) for ${peso(total)}`, at);
            }
        }
    }

    // ── Final branch_inventory rows ──
    for (const row of rows) {
        const counted = row.lastCounted || (rng.chance(0.3) ? dt(addDays(today, -rng.int(3, 60)), 18, rng.int(0, 59)) : null);
        out.inventory.push({ id: row.id, store_id: store.id, branch_id: row.branchId, variant_id: row.v ? row.v.id : null,
            equipment_id: row.e ? row.e.id : null, on_hand_quantity: row.on_hand, reserved_quantity: row.reserved,
            unavailable_quantity: row.unavailable, reorder_level: row.reorder, expiration_date: row.expiration, status: "active",
            last_counted_at: counted, created_at: dt(storeStart, 10, 30), updated_at: dt(today, 7, 0) });
    }
    return out;
}

module.exports = { simulate };
