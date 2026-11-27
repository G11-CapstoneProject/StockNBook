/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Accuracy check for Analytics and Forecasting.
 *
 * It asks the app for the same numbers the pages show, then works each number out again
 * straight from the database (with separate SQL), and compares them.
 *
 *   1. Start the app:            npm run dev
 *   2. Run the check:            node scripts/seed/verify-analytics.js
 *
 * Options (environment variables):
 *   APP_URL                 the running app (default http://localhost:3000)
 *   ANALYTICS_LAMBDA        instead of the app: path to the Analytics Lambda index.js
 *   FORECASTING_LAMBDA      instead of the app: path to the Forecasting Lambda index.js
 *   SEED_STORE              which seeded store to check, 1 = Demo Party Store (default)
 *
 * It only reads data. Nothing is changed.
 */
const path = require("path");
const jwt = require("jsonwebtoken");
const { CONFIG } = require("./lib/config");
const { connect } = require("./lib/db");

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const STORE_NO = Number(process.env.SEED_STORE || 1);
const ACCEPTED = "('confirmed','preparing','released','return inspection','pending settlement','completed')";

let passed = 0, failed = 0;
const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const num = (n) => Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
const close = (a, b, tolerance = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
function check(label, ok, detail = "") {
    if (ok) passed += 1; else failed += 1;
    console.log(`  ${ok ? "✔" : "✘"} ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

// ── Dates (same rules as the pages) ──
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (date, n) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000));
function lastCompleteMonths(count, today) {
    const [y, m] = today.split("-").map(Number);
    return { start: iso(utc(y, m - 1 - count, 1)), end: iso(utc(y, m - 1, 0)) };
}
function thisMonth(today) {
    const [y, m] = today.split("-").map(Number);
    return { start: iso(utc(y, m - 1, 1)), end: iso(utc(y, m, 0)) };
}
function previousPeriod({ start, end }) {
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    const prevEnd = addDays(start, -1);
    return { start: addDays(prevEnd, -(days - 1)), end: prevEnd };
}
function sameDatesLastYear({ start, end }) {
    const back = (date) => {
        const [y, m, d] = date.split("-").map(Number);
        const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
        return iso(utc(y - 1, m - 1, Math.min(d, last)));
    };
    return { start: back(start), end: back(end) };
}
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

// ── Calling the app (or the Lambdas directly) ──
function loadLambda(file) {
    return file ? require(path.resolve(process.cwd(), file)) : null;
}
const directAnalytics = loadLambda(process.env.ANALYTICS_LAMBDA);
const directForecasting = loadLambda(process.env.FORECASTING_LAMBDA);

async function call(route, token, body) {
    const direct = route === "analytics" ? directAnalytics : directForecasting;
    if (direct) {
        const out = await direct.handler({ httpMethod: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
        return { status: out.statusCode, body: JSON.parse(out.body || "{}") };
    }
    let res;
    try {
        res = await fetch(`${APP_URL}/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body) });
    } catch {
        throw new Error(`Cannot reach ${APP_URL}. Start the app first (npm run dev), or set ANALYTICS_LAMBDA and FORECASTING_LAMBDA.`);
    }
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ── Forecast formulas (written again here, from the method description) ──
function weightedMovingAverage(weeks) {
    const avg = (values) => {
        if (!values.length) return 0;
        const weights = [0.2, 0.3, 0.5].slice(3 - values.length);
        return values.reduce((s, v, i) => s + v * weights[i], 0) / weights.reduce((s, w) => s + w, 0);
    };
    const lastThree = weeks.slice(-3);
    if (lastThree.some((v) => v > 0)) return avg(lastThree);
    return avg(weeks.filter((v) => v > 0).slice(-3)); // quiet lately: use the last three weeks that had sales
}
function expectedForecast(weeks, onHand, reserved, reorder) {
    const recent = weeks.slice(-4).reduce((s, v) => s + v, 0);
    const previous = weeks.slice(-8, -4).reduce((s, v) => s + v, 0);
    let factor = 1;
    if (previous > 0) factor = Math.min(1.3, Math.max(0.7, Math.round((1 + (recent - previous) / previous) * 100) / 100));
    const forecast = Math.ceil(weightedMovingAverage(weeks) * factor * (30 / 7));
    const available = Math.max(0, onHand - reserved);
    return { forecast, available, restock: Math.max(0, forecast + reorder - available), recent, previous };
}

async function main() {
    const db = await connect();
    const [stores] = await db.query(`SELECT id, store_name FROM stores WHERE slug LIKE ? ORDER BY id`, [`${CONFIG.slugPrefix}%`]);
    const store = stores[STORE_NO - 1];
    if (!store) throw new Error(`Seeded store ${STORE_NO} not found. Run node scripts/seed/run.js first.`);
    const sid = Number(store.id);
    const [[owner]] = await db.query(`SELECT id FROM users WHERE store_id=? AND role='owner'`, [sid]);
    const [branches] = await db.query(`SELECT id, branch_name FROM branches WHERE store_id=? ORDER BY id`, [sid]);
    const main = branches[0], other = branches[1];
    const [[manager]] = await db.query(`SELECT id FROM users WHERE store_id=? AND branch_id=? AND role='manager'`, [sid, main.id]);
    const [[mainStaff]] = await db.query(`SELECT id FROM users WHERE store_id=? AND branch_id=? AND role='staff'`, [sid, main.id]);
    const [[otherStaff]] = other ? await db.query(`SELECT id FROM users WHERE store_id=? AND branch_id=? AND role='staff'`, [sid, other.id]) : [[null]];
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is missing in .env.local.");
    const token = (id, role, branchId = null) => jwt.sign({ user_id: id, store_id: sid, branch_id: branchId, role }, secret, { expiresIn: "1h" });
    const OWNER = token(owner.id, "owner");
    const today = CONFIG.today;
    console.log(`Checking ${store.store_name} (store ${sid}) in ${CONFIG.db.database}, today ${today}`);
    console.log(directAnalytics ? "Calling the Lambdas directly.\n" : `Calling the app at ${APP_URL}.\n`);

    const q = async (sql, params = []) => (await db.query(sql, params))[0];
    const one = async (sql, params = []) => (await q(sql, params))[0] || {};
    const dayRange = (col) => `${col} >= ? AND ${col} < DATE_ADD(?, INTERVAL 1 DAY)`;
    const screen = [];

    // ═══════════ ANALYTICS ═══════════
    for (const [label, range] of [["This month", thisMonth(today)], ["Last 12 complete months", lastCompleteMonths(12, today)]]) {
        console.log(`ANALYTICS (Owner, all branches) · ${label}: ${range.start} to ${range.end}`);
        const res = await call("analytics", OWNER, { action: "get_analytics_v2", start_date: range.start, end_date: range.end });
        check("the page loads (HTTP 200)", res.status === 200, JSON.stringify(res.body).slice(0, 200));
        if (res.status !== 200) continue;
        const a = res.body;
        const sales = async (r, branchId = null) => one(`SELECT COALESCE(SUM(total),0) total, COUNT(*) orders FROM orders
            WHERE store_id=? ${branchId ? "AND branch_id=?" : ""} AND LOWER(status)='completed' AND ${dayRange("order_date")}`,
            branchId ? [sid, branchId, r.start, r.end] : [sid, r.start, r.end]);
        const s = await sales(range);
        check(`Total sales ${peso(a.sales.totalSales)}`, close(a.sales.totalSales, s.total), `database: ${peso(s.total)}`);
        check(`Completed orders ${num(a.sales.orderCount)}`, Number(a.sales.orderCount) === Number(s.orders), `database: ${s.orders}`);
        const prev = await sales(previousPeriod(range)), ly = await sales(sameDatesLastYear(range));
        const pChange = pct(Number(s.total), Number(prev.total)), yChange = pct(Number(s.total), Number(ly.total));
        check(`vs previous period ${a.sales.periodChange.label}`, a.sales.periodChange.percentage === null ? pChange === null : close(a.sales.periodChange.percentage, pChange, 0.11),
            `database: ${pChange}%`);
        check(`Year-over-year ${a.sales.yearOverYearChange.label}`, a.sales.yearOverYearChange.percentage === null ? yChange === null : close(a.sales.yearOverYearChange.percentage, yChange, 0.11),
            `database: ${yChange}%`);
        const months = await q(`SELECT DATE_FORMAT(order_date,'%Y-%m') k, SUM(total) v FROM orders WHERE store_id=? AND LOWER(status)='completed'
            AND ${dayRange("order_date")} GROUP BY k`, [sid, range.start, range.end]);
        const monthMap = new Map(months.map((m) => [m.k, Number(m.v)]));
        check(`Monthly sales chart (${a.sales.monthlySales.length} month(s))`, a.sales.monthlySales.every((p) => close(p.value, monthMap.get(p.key) || 0)));

        // Products and categories
        const units = await one(`SELECT COALESCE(SUM(oi.quantity),0) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
            WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")}`, [sid, range.start, range.end]);
        check(`Units sold ${num(a.products.totalUnits)}`, close(a.products.totalUnits, units.u), `database: ${units.u}`);
        const top = await q(`SELECT CASE WHEN p.has_variants=1 THEN CONCAT(p.product_name,' (',pv.variant_name,')') ELSE p.product_name END name,
                SUM(oi.quantity) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id JOIN product_variants pv ON pv.id=oi.variant_id
                JOIN products p ON p.id=pv.product_id WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")}
                GROUP BY oi.variant_id, name ORDER BY u DESC, name LIMIT 5`, [sid, range.start, range.end]);
        const apiTop = a.products.products.slice(0, 5);
        check(`Best seller: ${apiTop[0]?.name} (${num(apiTop[0]?.units)} units)`, apiTop.length > 0 && apiTop.every((p, i) => close(p.units, top[i]?.u)),
            `database top 5: ${top.map((t) => `${t.name} ${t.u}`).join(", ")}`);
        const cats = await q(`SELECT COALESCE(NULLIF(TRIM(c.category_name),''),'Uncategorized') name, SUM(oi.quantity) u FROM orders o
                JOIN order_items oi ON oi.order_id=o.order_id JOIN product_variants pv ON pv.id=oi.variant_id JOIN products p ON p.id=pv.product_id
                LEFT JOIN categories c ON c.id=p.category_id WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")}
                GROUP BY name`, [sid, range.start, range.end]);
        const catMap = new Map(cats.map((c) => [c.name, Number(c.u)]));
        check(`Category demand (${a.products.categories.length} categories)`, a.products.categories.every((c) => close(c.units, catMap.get(c.name))));
        const hours = await q(`SELECT HOUR(o.order_date) h, SUM(oi.quantity) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")} GROUP BY h`, [sid, range.start, range.end]);
        const hourMap = new Map(hours.map((h) => [Number(h.h), Number(h.u)]));
        const peak = [...a.products.hourlyDemand].sort((x, y) => y.units - x.units)[0];
        check(`Purchasing by hour (peak ${peak?.label})`, a.products.hourlyDemand.every((h) => close(h.units, hourMap.get(h.hour) || 0)));

        // Bookings, packages, rentals (by event date)
        const bk = await one(`SELECT COUNT(*) n, SUM(LOWER(booking_type)='package') pk FROM bookings WHERE store_id=? AND LOWER(status) IN ${ACCEPTED}
                AND event_date BETWEEN ? AND ?`, [sid, range.start, range.end]);
        check(`Accepted bookings ${num(a.bookings.totalBookings)}`, Number(a.bookings.totalBookings) === Number(bk.n), `database: ${bk.n}`);
        check(`Package bookings ${num(a.packages.totalPackageBookings)}`, Number(a.packages.totalPackageBookings) === Number(bk.pk || 0), `database: ${bk.pk}`);
        const items = await one(`SELECT COALESCE(SUM(bi.quantity),0) u FROM bookings b JOIN booking_items bi ON bi.booking_id=b.id
                WHERE b.store_id=? AND LOWER(b.status) IN ${ACCEPTED} AND b.event_date BETWEEN ? AND ? AND bi.item_type IN ('consumable','rental')
                AND LOWER(bi.item_status)<>'cancelled' AND bi.item_status NOT LIKE 'claim%'`, [sid, range.start, range.end]);
        check(`Booked item units ${num(a.bookings.totalBookedItemUnits)}`, close(a.bookings.totalBookedItemUnits, items.u), `database: ${items.u}`);
        if (a.rentals) {
            const rented = await one(`SELECT COALESCE(SUM(bi.quantity),0) u FROM bookings b JOIN booking_items bi ON bi.booking_id=b.id
                    WHERE b.store_id=? AND LOWER(b.status) IN ${ACCEPTED} AND b.event_date BETWEEN ? AND ? AND bi.item_type='rental'
                    AND LOWER(bi.item_status)<>'cancelled'`, [sid, range.start, range.end]);
            const back = await one(`SELECT COALESCE(SUM(bi.returned_quantity),0) r, COALESCE(SUM(bi.damaged_quantity),0) d, COALESCE(SUM(bi.missing_quantity),0) m
                    FROM bookings b JOIN booking_items bi ON bi.booking_id=b.id WHERE b.store_id=? AND LOWER(b.status) IN ${ACCEPTED}
                    AND bi.item_type='rental' AND LOWER(bi.item_status)<>'cancelled' AND ${dayRange("bi.returned_at")}`, [sid, range.start, range.end]);
            check(`Rental units booked ${num(a.rentals.bookedUnits)}`, close(a.rentals.bookedUnits, rented.u), `database: ${rented.u}`);
            check(`Rental units returned ${num(a.rentals.returnedUnits)} (damaged ${a.rentals.damagedUnits}, missing ${a.rentals.missingUnits})`,
                close(a.rentals.returnedUnits, back.r) && close(a.rentals.damagedUnits, back.d) && close(a.rentals.missingUnits, back.m),
                `database: returned ${back.r}, damaged ${back.d}, missing ${back.m}`);
        }
        const perBranch = await q(`SELECT branch_id id, SUM(total) v FROM orders WHERE store_id=? AND LOWER(status)='completed' AND ${dayRange("order_date")}
                GROUP BY branch_id`, [sid, range.start, range.end]);
        const branchMap = new Map(perBranch.map((b) => [Number(b.id), Number(b.v)]));
        check(`Branch performance (${a.branches?.branches.length || 0} branches)`, (a.branches?.branches || []).every((b) => close(b.totalSales, branchMap.get(b.branchId))));
        screen.push([`Analytics · ${label}`, `Total sales ${peso(a.sales.totalSales)} · ${num(a.sales.orderCount)} orders · ${num(a.bookings.totalBookings)} accepted bookings · best seller ${apiTop[0]?.name || "—"}`]);
        console.log("");
    }

    // ═══════════ NEW ANALYTICS SECTIONS ═══════════
    console.log("ANALYTICS · when customers buy, this month vs last year, item insight");
    {
        const r12 = lastCompleteMonths(12, today);
        const res = await call("analytics", OWNER, { action: "get_analytics_v2", start_date: r12.start, end_date: r12.end });
        if (res.status === 200 && res.body.products.categoryHourly) {
            const ch = res.body.products.categoryHourly;
            check("Category × hour heatmap adds up to units sold", close(ch.reduce((t, c) => t + c.units, 0), res.body.products.totalUnits));
            const top = ch[0];
            const [row] = await q(`SELECT COALESCE(SUM(oi.quantity),0) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                    JOIN product_variants pv ON pv.id=oi.variant_id JOIN products p ON p.id=pv.product_id
                    LEFT JOIN categories c ON c.id=p.category_id
                    WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")}
                      AND COALESCE(NULLIF(TRIM(c.category_name),''),'Uncategorized')=? AND HOUR(o.order_date)=?`, [sid, r12.start, r12.end, top.name, top.peakHour]);
            check(`${top.name} at its peak hour (${top.peakHour}:00) = ${num(top.hours[top.peakHour])} units`, close(top.hours[top.peakHour], row.u), `database: ${row.u}`);
        } else check("Heatmap data present (update the Analytics Lambda)", false, `HTTP ${res.status}`);
        const mc = await call("analytics", OWNER, { action: "get_month_comparison" });
        if (mc.status === 200) {
            const cur = await one(`SELECT COALESCE(SUM(oi.quantity),0) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                    WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")}`, [sid, mc.body.startDate, mc.body.endDate]);
            const ly = await one(`SELECT COALESCE(SUM(oi.quantity),0) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                    WHERE o.store_id=? AND LOWER(o.status)='completed' AND ${dayRange("o.order_date")}`, [sid, mc.body.lastYearStartDate, mc.body.lastYearEndDate]);
            check(`${mc.body.label} vs ${mc.body.lastYearLabel}: ${num(mc.body.totals.units)} vs ${num(mc.body.totals.lastYearUnits)} units`,
                close(mc.body.totals.units, cur.u) && close(mc.body.totals.lastYearUnits, ly.u), `database: ${cur.u} vs ${ly.u}`);
            screen.push(["Analytics · This Month vs the Same Month Last Year", `${num(mc.body.totals.units)} vs ${num(mc.body.totals.lastYearUnits)} units · most sold ${mc.body.mostSold[0]?.name || "—"}`]);
        } else check("This month vs last year loads (update the Analytics Lambda)", false, `HTTP ${mc.status} ${mc.body.error || ""}`);
        const opts = await call("analytics", OWNER, { action: "get_item_options" });
        const pick = opts.status === 200 ? (opts.body.products.find((x) => x.name === "Kids Halloween Costume") || opts.body.products[0]) : null;
        if (pick) {
            const ins = await call("analytics", OWNER, { action: "get_item_insight", kind: "product", item_id: pick.id });
            const months = await q(`SELECT DATE_FORMAT(o.order_date,'%Y-%m') k, SUM(oi.quantity) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                    JOIN product_variants pv ON pv.id=oi.variant_id WHERE o.store_id=? AND pv.product_id=? AND LOWER(o.status)='completed' AND o.order_date >= ?
                    GROUP BY k`, [sid, pick.id, ins.body.historyStart]);
            const mm = new Map(months.map((r) => [r.k, Number(r.u)]));
            const bad = (ins.body.years || []).flatMap((y) => y.months.map((v, i) => [`${y.year}-${String(i + 1).padStart(2, "0")}`, v]))
                .filter(([k, v]) => v !== null && !close(v, mm.get(k) || 0)).length;
            check(`Item insight for ${pick.name}: 3 years month by month`, ins.status === 200 && bad === 0, `HTTP ${ins.status}, ${bad} month(s) differ`);
            if (ins.status === 200) screen.push([`Analytics · Item Insight · ${pick.name}`, (ins.body.insights || []).slice(0, 2).join(" ")]);
        } else check("Item options load (update the Analytics Lambda)", false, `HTTP ${opts.status}`);
    }
    console.log("");

    // Access by role
    console.log("ANALYTICS · who can see what");
    const range = thisMonth(today);
    const body = { action: "get_analytics_v2", start_date: range.start, end_date: range.end };
    const m = await call("analytics", token(manager.id, "manager", main.id), { ...body, branch_id: other?.id });
    const mainSales = await one(`SELECT COALESCE(SUM(total),0) t FROM orders WHERE store_id=? AND branch_id=? AND LOWER(status)='completed' AND ${dayRange("order_date")}`,
        [sid, main.id, range.start, range.end]);
    check(`Manager sees only ${main.branch_name} (${peso(m.body.sales?.totalSales)})`, m.status === 200 && m.body.scope?.branchId === Number(main.id) && close(m.body.sales.totalSales, mainSales.t),
        `HTTP ${m.status}, database ${peso(mainSales.t)}`);
    const st1 = await call("analytics", token(mainStaff.id, "staff", main.id), body);
    check("Staff with Analytics access can open it", st1.status === 200, `HTTP ${st1.status} ${st1.body.error || ""}`);
    if (otherStaff) {
        const st2 = await call("analytics", token(otherStaff.id, "staff", other.id), body);
        check("Staff without Analytics access is blocked", st2.status === 403, `HTTP ${st2.status}`);
    }
    console.log("");

    // ═══════════ FORECASTING ═══════════
    console.log("FORECASTING (Owner, all branches)");
    const inv = await call("forecasting", OWNER, { action: "get_inventory_forecast" });
    check("Product Demand loads (HTTP 200)", inv.status === 200, JSON.stringify(inv.body).slice(0, 200));
    if (inv.status === 200) {
        const f = inv.body;
        const stock = await q(`SELECT bi.branch_id, p.id product_id, CASE WHEN p.has_variants=1 THEN pv.id END variant_id,
                CASE WHEN bi.expiration_date IS NOT NULL AND bi.expiration_date < UTC_DATE() THEN 0
                     ELSE GREATEST(0, bi.on_hand_quantity - bi.unavailable_quantity) END usable,
                CASE WHEN bi.expiration_date IS NOT NULL AND bi.expiration_date < UTC_DATE() THEN 0 ELSE bi.reserved_quantity END reserved,
                bi.reorder_level
            FROM branch_inventory bi JOIN product_variants pv ON pv.id=bi.variant_id JOIN products p ON p.id=pv.product_id
            WHERE bi.store_id=? AND LOWER(bi.status)='active' AND LOWER(p.status)='active' AND LOWER(pv.status)='active'
              AND p.deleted_at IS NULL AND pv.deleted_at IS NULL
              AND ((p.has_variants=0 AND pv.is_default=1) OR (p.has_variants=1 AND pv.is_default=0))`, [sid]);
        const key = (b, p, v) => `${b}:${p}:${v || "product"}`;
        const stockMap = new Map(stock.map((r) => [key(r.branch_id, r.product_id, r.variant_id), r]));
        check(`Products tracked ${num(f.items.length)}`, f.items.length === stock.length, `database: ${stock.length}`);
        // Weekly POS units for the 12 weeks the forecast uses (Monday to Sunday).
        const now = new Date();
        const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        const weekStarts = Array.from({ length: 12 }, (_, i) => iso(new Date(monday.getTime() - (11 - i) * 7 * 86400000)));
        const weekly = await q(`SELECT o.branch_id, pv.product_id, CASE WHEN p.has_variants=1 THEN oi.variant_id END variant_id,
                DATE_FORMAT(DATE_SUB(DATE(o.order_date), INTERVAL WEEKDAY(DATE(o.order_date)) DAY),'%Y-%m-%d') wk, SUM(oi.quantity) u
            FROM orders o JOIN order_items oi ON oi.order_id=o.order_id JOIN product_variants pv ON pv.id=oi.variant_id JOIN products p ON p.id=pv.product_id
            WHERE o.store_id=? AND LOWER(o.status)='completed' AND o.order_date >= ? AND o.order_date < DATE_ADD(?, INTERVAL 7 DAY)
            GROUP BY o.branch_id, pv.product_id, variant_id, wk`, [sid, weekStarts[0], weekStarts[11]]);
        const weeks = new Map();
        for (const w of weekly) {
            const k = key(w.branch_id, w.product_id, w.variant_id);
            if (!weeks.has(k)) weeks.set(k, Array(12).fill(0));
            const i = weekStarts.indexOf(w.wk);
            if (i >= 0) weeks.get(k)[i] += Number(w.u);
        }
        let stockBad = 0, soldBad = 0, mathBad = 0;
        const examples = [];
        for (const item of f.items) {
            const k = key(item.branchId, item.productId, item.variantId);
            const s = stockMap.get(k);
            const w = weeks.get(k) || Array(12).fill(0);
            if (!s) { stockBad += 1; continue; }
            const e = expectedForecast(w, Number(s.usable), Number(s.reserved), Number(s.reorder_level));
            if (!close(item.availableQuantity, e.available) || !close(item.allocatedQuantity, s.reserved)) stockBad += 1;
            if (!close(item.totalUnitsSold, w.reduce((x, y) => x + y, 0)) || !close(item.recentFourWeekDemand, e.recent)) soldBad += 1;
            if (!close(item.forecastedDemand, e.forecast) || !close(item.suggestedRestock, e.restock)) {
                mathBad += 1;
                if (examples.length < 3) examples.push(`${item.itemName}: app ${item.forecastedDemand}/${item.suggestedRestock}, recomputed ${e.forecast}/${e.restock}`);
            }
        }
        check("Available stock = usable stock − reserved for bookings (every product)", stockBad === 0, `${stockBad} product(s) differ`);
        check("12-week POS units sold (every product)", soldBad === 0, `${soldBad} product(s) differ`);
        check("30-day demand and suggested restock follow the formula (every product)", mathBad === 0, `${mathBad} differ: ${examples.join("; ")}`);
        const top = [...f.items].sort((x, y) => y.forecastedDemand - x.forecastedDemand)[0];
        const high = f.items.filter((i) => i.demandLevel === "HIGH").length;
        const actions = f.items.filter((i) => ["LOW", "RISK"].includes(String(i.status)) || Number(i.suggestedRestock) > 0 || i.reorderNow).length;
        screen.push(["Forecasting · Product & Inventory", `30-day demand ${num(f.summary.projectedDemand)} units · ${num(high)} high-demand products · ${num(actions)} stock planning actions · top: ${top?.itemName} (${top?.forecastedDemand})`]);
    }

    // Seasonal: the page's default is the last 12 months, including this month.
    const [ty, tm] = today.split("-").map(Number);
    const startMonth = iso(utc(ty, tm - 12, 1)).slice(0, 7), endMonth = today.slice(0, 7);
    const sea = await call("forecasting", OWNER, { action: "get_seasonal_analysis", seasonalStartMonth: startMonth, seasonalEndMonth: endMonth });
    check(`Seasonal Demand loads (${startMonth} to ${endMonth})`, sea.status === 200 && sea.body.seasonal, JSON.stringify(sea.body).slice(0, 200));
    if (sea.status === 200 && sea.body.seasonal) {
        const months = await q(`SELECT DATE_FORMAT(o.order_date,'%Y-%m') k, SUM(oi.quantity) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
            WHERE o.store_id=? AND LOWER(o.status)='completed' AND o.order_date >= ? AND o.order_date < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY k`,
            [sid, `${startMonth}-01`, sea.body.scope.historyEndDate]);
        const mm = new Map(months.map((r) => [r.k, Number(r.u)]));
        const hist = sea.body.seasonal.monthlyHistory;
        check(`Monthly items sold (${hist.length} months)`, hist.length === months.length && hist.every((h) => close(h.totalUnits, mm.get(h.monthKey))));
        const peaks = (sea.body.seasonal.peakMonths || []).map((p) => p.month).join(", ");
        screen.push(["Forecasting · Seasonal Demand", `peak months ${peaks || "—"} · trend ${sea.body.seasonal.recentTrend}`]);
    }

    const bf = await call("forecasting", OWNER, { action: "get_booking_forecast" });
    check("Rental & Booking loads", bf.status === 200 && bf.body.booking, JSON.stringify(bf.body).slice(0, 200));
    if (bf.status === 200 && bf.body.booking) {
        const startB = bf.body.scope.startDate, endB = bf.body.scope.endDate;
        const up = await one(`SELECT COUNT(*) n, SUM(LOWER(status)='preparing') p FROM bookings WHERE store_id=? AND event_date BETWEEN ? AND ?
            AND LOWER(status) IN ('confirmed','preparing','released')`, [sid, startB, endB]);
        check(`Upcoming bookings (next 30 days) ${bf.body.booking.expectedBookings}`, Number(bf.body.booking.expectedBookings) === Number(up.n)
            && Number(bf.body.booking.preparingBookings) === Number(up.p || 0), `database: ${up.n} (preparing ${up.p})`);
        screen.push(["Forecasting · Rental & Booking", `${bf.body.booking.expectedBookings} upcoming bookings · ${bf.body.booking.confirmedBookings} confirmed · ${bf.body.booking.preparingBookings} preparing`]);
    }

    // ═══════════ STOCK PLAN, ACCURACY, EVENTS ═══════════
    console.log("\nFORECASTING · Stock Plan, Accuracy and Events");
    {
        const plan = await call("forecasting", OWNER, { action: "get_seasonal_stock_plan" });
        if (plan.status === 200 && plan.body.products) {
            const p0 = plan.body.products[0];
            if (p0) {
                // Expected units for the first month = normal month × seasonal index, recomputed from the database.
                const firstKey = plan.body.historyFrom, lastKey = plan.body.historyTo;
                const rows = await q(`SELECT DATE_FORMAT(o.order_date,'%Y-%m') k, SUM(oi.quantity) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                        JOIN product_variants pv ON pv.id=oi.variant_id WHERE o.store_id=? AND o.branch_id=? AND pv.product_id=? AND LOWER(o.status)='completed'
                        AND o.order_date >= ? AND o.order_date < DATE_ADD(LAST_DAY(?), INTERVAL 1 DAY) GROUP BY k`,
                    [sid, p0.branchId, p0.productId, `${firstKey}-01`, `${lastKey}-01`]);
                const um = new Map(rows.map((r) => [r.k, Number(r.u)]));
                const keys = [];
                for (let [y, m] = firstKey.split("-").map(Number); ; m += 1) { if (m > 12) { m = 1; y += 1; } const k = `${y}-${String(m).padStart(2, "0")}`; keys.push(k); if (k === lastKey) break; }
                const vals = keys.map((k) => um.get(k) || 0);
                const normal = vals.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, vals.length);
                const avg = Array.from({ length: 12 }, (_, i) => { const v = keys.map((k, j) => [k, vals[j]]).filter(([k]) => Number(k.slice(5, 7)) === i + 1).map(([, v]) => v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
                const known = avg.filter((v) => v !== null), overall = known.reduce((a, b) => a + b, 0) / known.length;
                const m0 = plan.body.months[0].month, target = avg[Number(m0.slice(5, 7)) - 1];
                const expected = keys.length >= 12 && overall > 0 ? normal * (target / overall) : normal;
                check(`Stock Plan: ${p0.name} (${p0.branchName}) expected in ${plan.body.months[0].label} = ${p0.months[0].expected}`,
                    close(p0.months[0].expected, Math.round(expected * 10) / 10, 0.11), `recomputed ${expected.toFixed(1)}`);
            }
            const s = plan.body.monthSummary.map((m) => `${m.label} ${num(m.expectedUnits)} units (${m.ratio}× normal)`).join(" · ");
            screen.push(["Forecasting · Stock Plan", `${s} · ${plan.body.rentalShortages} rental item(s) may run short`]);
        } else check("Stock Plan loads (update the Forecasting Lambda)", false, `HTTP ${plan.status} ${plan.body.error || ""}`);
        const acc = await call("forecasting", OWNER, { action: "get_forecast_accuracy" });
        if (acc.status === 200 && acc.body.perMonth) {
            const last = acc.body.perMonth[acc.body.perMonth.length - 1];
            const sold = await one(`SELECT COALESCE(SUM(oi.quantity),0) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                    WHERE o.store_id=? AND LOWER(o.status)='completed' AND DATE_FORMAT(o.order_date,'%Y-%m')=?`, [sid, last.month]);
            check(`Accuracy: actual units in ${last.label} = ${num(last.actual)}`, close(last.actual, sold.u, 1), `database: ${sold.u}`);
            const total = acc.body.levels.find((l) => l.level === "total");
            screen.push(["Forecasting · Accuracy", `Stock Plan ${total.seasonal.accuracy}% · Product Demand ${total.shortTerm.accuracy}% (whole store, last 6 months)`]);
        } else check("Accuracy loads (update the Forecasting Lambda)", false, `HTTP ${acc.status} ${acc.body.error || ""}`);
        const ev = await call("forecasting", OWNER, { action: "list_store_events" });
        if (ev.status === 200) {
            const count = await one(`SELECT COUNT(*) n FROM store_events WHERE store_id=? AND deleted_at IS NULL`, [sid]);
            check(`Events calendar lists ${ev.body.events.length} events`, ev.body.events.length === Number(count.n), `database: ${count.n}`);
            const ef = await call("forecasting", OWNER, { action: "get_event_forecast" });
            const ready = (ef.body.events || []).filter((e) => e.ready);
            const first = ready[0];
            if (first && first.products[0]) {
                const p = first.products[0];
                const sold = await one(`SELECT COALESCE(SUM(oi.quantity),0) u FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
                        JOIN product_variants pv ON pv.id=oi.variant_id WHERE o.store_id=? AND pv.product_id=? AND LOWER(o.status)='completed'
                        AND ${dayRange("o.order_date")}`, [sid, p.productId, first.learnedFrom.startDate, first.learnedFrom.endDate]);
                check(`Event "${first.event.name}": ${p.name} sold ${p.pastUnits} during ${first.learnedFrom.name}`, close(p.pastUnits, sold.u), `database: ${sold.u}`);
            }
            screen.push(["Forecasting · Events", ready.map((e) => `${e.event.name}: ${e.products[0]?.name || "—"} ${e.products[0]?.lift ? `${e.products[0].lift}×` : ""}`).join(" · ") || "no upcoming events"]);
        } else if (ev.status === 409) console.log("  – Events skipped: this database has no store_events table (optional).");
        else check("Events load (update the Forecasting Lambda)", false, `HTTP ${ev.status} ${ev.body.error || ""}`);
    }

    console.log("\nFORECASTING · who can see what");
    const fm = await call("forecasting", token(manager.id, "manager", main.id), { action: "get_inventory_forecast", branch_id: other?.id });
    check(`Manager sees only ${main.branch_name}`, fm.status === 200 && fm.body.items.every((i) => i.branchId === Number(main.id)), `HTTP ${fm.status}`);
    const fs1 = await call("forecasting", token(mainStaff.id, "staff", main.id), { action: "get_inventory_forecast" });
    check("Staff with Forecasting access can open it", fs1.status === 200, `HTTP ${fs1.status} ${fs1.body.error || ""}`);
    if (otherStaff) {
        const fs2 = await call("forecasting", token(otherStaff.id, "staff", other.id), { action: "get_inventory_forecast" });
        check("Staff without Forecasting access is blocked", fs2.status === 403, `HTTP ${fs2.status}`);
    }

    console.log("\nWHAT THE PAGES SHOULD SHOW (log in as the owner of this store):");
    for (const [where, what] of screen) console.log(`  ${where}\n    ${what}`);
    console.log(`\n${passed} passed, ${failed} failed.`);
    await db.end();
    process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(`\nAccuracy check stopped: ${error.message}`); process.exit(1); });
