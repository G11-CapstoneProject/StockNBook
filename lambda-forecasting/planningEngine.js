/*
 * StockNBook Forecasting — planning engine.
 *
 * 1. Stock Plan: how much of each product (and how many units of each rental item) the
 *    coming months need, from up to three years of history.
 *      expected units in a month = normal month (average of the last 12 months)
 *                                  × seasonal index of that calendar month
 *      seasonal index = average units in that calendar month ÷ average month (over up to 3 years)
 *    Rentals: busiest day of that month in past years × the item's 12-month growth,
 *    compared with the units owned and with bookings already made.
 *
 * 2. Forecast Accuracy (backtest): for each of the last six complete months, forecast the
 *    month using only the data before it, then compare with what really sold.
 *      MAE  = average of |actual − forecast|
 *      RMSE = square root of the average of (actual − forecast)²
 *      WAPE = Σ|actual − forecast| ÷ Σ actual   (accuracy = 100% − WAPE)
 *
 * 3. Events: compare an upcoming event (for example the next election) with the same event
 *    in the past and with the same dates a year before it, to see what sells more.
 */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const toNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, d = 1) => { const f = 10 ** d; return Math.round((toNumber(v) + Number.EPSILON) * f) / f; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function diffDays(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
function addMonthKey(key, months) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    return d.toISOString().slice(0, 7);
}
function daysInMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
}
function shortDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
}
function monthRange(firstKey, lastKey) {
    const keys = [];
    for (let k = firstKey; k <= lastKey; k = addMonthKey(k, 1)) keys.push(k);
    return keys;
}

/**
 * Seasonal model for one item from its monthly history (keys = complete months, oldest first).
 * Returns the normal month (average of the last 12), the index per calendar month and
 * the expected units for any target month.
 */
function seasonalModel(history, unitsOf) {
    const values = history.map((k) => toNumber(unitsOf(k)));
    const last12 = values.slice(-12);
    const normal = last12.length ? last12.reduce((a, b) => a + b, 0) / last12.length : 0;
    const byMonth = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
    history.forEach((k, i) => {
        const m = Number(k.slice(5, 7)) - 1;
        byMonth[m].total += values[i];
        byMonth[m].count += 1;
    });
    const averages = byMonth.map((b) => (b.count ? b.total / b.count : null));
    const known = averages.filter((a) => a !== null);
    const overall = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    const index = averages.map((a) => (a === null || overall <= 0 ? 1 : a / overall));
    const enoughHistory = history.length >= 12;
    return {
        normal,
        index,
        expected: (targetKey) => (enoughHistory ? normal * index[Number(targetKey.slice(5, 7)) - 1] : normal),
        enoughHistory,
    };
}

/** Units out per day for each (branch, item) from rental periods. */
function dailyUsage(periods, fromDate, toDate) {
    const usage = new Map(); // key -> Map(date -> units)
    for (const p of periods) {
        const key = `${p.branchId}:${p.equipmentId}`;
        if (!usage.has(key)) usage.set(key, new Map());
        const days = usage.get(key);
        const start = p.startDate > fromDate ? p.startDate : fromDate;
        const end = p.endDate < toDate ? p.endDate : toDate;
        for (let d = start; d <= end; d = addDays(d, 1)) days.set(d, (days.get(d) || 0) + toNumber(p.quantity));
    }
    return usage;
}
function peakInMonth(days, monthKey) {
    let peak = 0;
    if (!days) return 0;
    for (const [d, units] of days) if (d.startsWith(monthKey) && units > peak) peak = units;
    return peak;
}

/* -------------------------------------------------------
 * 1. STOCK PLAN FOR THE NEXT MONTHS
 * ------------------------------------------------------- */

function buildStockPlan({ today, monthsAhead = 3, historyKeys, productMonthly, productStock, equipmentOwned, rentalPeriods,
                            canViewStock = true, scope }) {
    const currentKey = today.slice(0, 7);
    const targets = Array.from({ length: monthsAhead }, (_, i) => addMonthKey(currentKey, i + 1));
    const daysLeft = daysInMonth(currentKey) - Number(today.slice(8, 10)) + 1;

    // ── Products ──
    const unitsBy = new Map();
    for (const r of productMonthly) unitsBy.set(`${r.branchId}:${r.productId}:${r.monthKey}`, toNumber(r.units));
    const products = [];
    const monthTotals = targets.map(() => ({ expected: 0, normal: 0 }));
    for (const s of productStock) {
        const key = `${s.branchId}:${s.productId}`;
        const model = seasonalModel(historyKeys, (k) => unitsBy.get(`${key}:${k}`));
        if (model.normal <= 0 && !historyKeys.some((k) => unitsBy.get(`${key}:${k}`))) continue;
        const restOfThisMonth = model.expected(currentKey) * (daysLeft / daysInMonth(currentKey));
        let cumulative = restOfThisMonth;
        const available = toNumber(s.available);
        const months = targets.map((k, i) => {
            const expected = model.expected(k);
            cumulative += expected;
            monthTotals[i].expected += expected;
            monthTotals[i].normal += model.normal;
            const lastYear = unitsBy.get(`${key}:${addMonthKey(k, -12)}`) || 0;
            return {
                month: k, label: monthLabel(k), expected: round(expected), lastYear: round(lastYear),
                index: round(model.index[Number(k.slice(5, 7)) - 1], 2),
                prepare: Math.max(0, Math.ceil(cumulative - available)),
            };
        });
        // How much to add before each month starts (on top of what earlier months already need).
        months.forEach((m, i) => { m.addBefore = i === 0 ? m.prepare : Math.max(0, m.prepare - months[i - 1].prepare); });
        const peak = months.reduce((best, m) => (m.index > best.index ? m : best), months[0]);
        products.push({
            branchId: Number(s.branchId), branchName: String(s.branchName || ""), productId: Number(s.productId),
            name: String(s.productName), category: String(s.category), normalMonth: round(model.normal),
            available: canViewStock ? available : null,
            months: canViewStock ? months : months.map(({ prepare, addBefore, ...m }) => m),
            peakMonth: peak.label, peakIndex: peak.index, extraUnits: round(peak.expected - model.normal),
            limitedHistory: !model.enoughHistory,
        });
    }
    // Products that clearly sell more in the coming months come first.
    const rising = products.filter((p) => p.peakIndex >= 1.3 && p.extraUnits >= 2)
        .sort((a, b) => b.extraUnits - a.extraUnits || b.peakIndex - a.peakIndex);

    // ── Rental equipment ──
    const historyStart = `${historyKeys[0]}-01`;
    const horizonEnd = `${targets[targets.length - 1]}-${String(daysInMonth(targets[targets.length - 1])).padStart(2, "0")}`;
    const usage = dailyUsage(rentalPeriods, historyStart, horizonEnd);
    const bookedBy = new Map(); // `${branch}:${equipment}:${monthKey}` -> units booked (event month)
    for (const p of rentalPeriods) {
        const k = `${p.branchId}:${p.equipmentId}:${String(p.eventDate).slice(0, 7)}`;
        bookedBy.set(k, (bookedBy.get(k) || 0) + toNumber(p.quantity));
    }
    const rentals = [];
    for (const e of equipmentOwned) {
        const key = `${e.branchId}:${e.equipmentId}`;
        const days = usage.get(key);
        const last12 = historyKeys.slice(-12).reduce((s, k) => s + (bookedBy.get(`${key}:${k}`) || 0), 0);
        const prev12 = historyKeys.slice(-24, -12).reduce((s, k) => s + (bookedBy.get(`${key}:${k}`) || 0), 0);
        const growth = prev12 > 0 ? clamp(last12 / prev12, 0.7, 1.5) : 1;
        const peakAvg = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
        for (const k of historyKeys) {
            const m = Number(k.slice(5, 7)) - 1;
            peakAvg[m].total += peakInMonth(days, k);
            peakAvg[m].count += 1;
        }
        const owned = toNumber(e.owned);
        const months = targets.map((k) => {
            const p = peakAvg[Number(k.slice(5, 7)) - 1];
            const expectedPeak = Math.round((p.count ? p.total / p.count : 0) * growth);
            const alreadyBooked = peakInMonth(days, k);
            const need = Math.max(expectedPeak, alreadyBooked);
            return { month: k, label: monthLabel(k), expectedPeakDay: expectedPeak, alreadyBookedPeakDay: alreadyBooked,
                need, shortage: Math.max(0, need - owned) };
        });
        const maxNeed = Math.max(...months.map((m) => m.need));
        if (maxNeed <= 0) continue;
        const worst = months.reduce((best, m) => (m.need > best.need ? m : best), months[0]);
        const status = worst.shortage > 0 ? "SHORT" : worst.need >= owned * 0.8 ? "TIGHT" : "OK";
        rentals.push({
            branchId: Number(e.branchId), branchName: String(e.branchName || ""), equipmentId: Number(e.equipmentId),
            name: String(e.name), category: String(e.category), growth: round(growth, 2),
            owned: canViewStock ? owned : null,
            months: canViewStock ? months : months.map(({ shortage, ...m }) => m),
            busiestMonth: worst.label, status: canViewStock ? status : null,
        });
    }
    const statusRank = { SHORT: 0, TIGHT: 1, OK: 2 };
    rentals.sort((a, b) => (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3)
        || Math.max(...b.months.map((m) => m.need)) - Math.max(...a.months.map((m) => m.need)));

    const monthSummary = targets.map((k, i) => {
        const ratio = monthTotals[i].normal > 0 ? monthTotals[i].expected / monthTotals[i].normal : 1;
        const top = products.map((p) => ({ name: p.name, branchName: p.branchName, extra: p.months[i].expected - p.normalMonth }))
            .filter((p) => p.extra >= 1).sort((a, b) => b.extra - a.extra).slice(0, 5).map((p) => p.name);
        return { month: k, label: monthLabel(k), expectedUnits: Math.round(monthTotals[i].expected),
            normalUnits: Math.round(monthTotals[i].normal), ratio: round(ratio, 2), topRising: [...new Set(top)] };
    });

    return {
        success: true,
        action: "get_seasonal_stock_plan",
        generatedAt: new Date().toISOString(),
        scope,
        today,
        months: targets.map((k) => ({ month: k, label: monthLabel(k) })),
        historyFrom: historyKeys[0],
        historyTo: historyKeys[historyKeys.length - 1],
        historyMonths: historyKeys.length,
        canViewStock,
        monthSummary,
        products: rising.slice(0, 60),
        risingProducts: rising.length,
        trackedProducts: products.length,
        rentals: rentals.slice(0, 40),
        rentalShortages: rentals.filter((r) => r.status === "SHORT").length,
        method: "Expected units = normal month (average of the last 12 months) × seasonal index of that calendar month "
            + "(its average over up to 3 years ÷ the average month). Prepare = expected units until the end of that month − available stock. "
            + "Rentals: the busiest day of that month in past years × the item's 12-month growth, or the bookings already made, whichever is higher.",
    };
}

/* -------------------------------------------------------
 * 2. FORECAST ACCURACY (BACKTEST)
 * ------------------------------------------------------- */

function weightedMovingAverage(weeks) {
    const avg = (values) => {
        if (!values.length) return 0;
        const weights = [0.2, 0.3, 0.5].slice(3 - values.length);
        return values.reduce((s, v, i) => s + v * weights[i], 0) / weights.reduce((s, w) => s + w, 0);
    };
    const lastThree = weeks.slice(-3);
    if (lastThree.some((v) => v > 0)) return avg(lastThree);
    return avg(weeks.filter((v) => v > 0).slice(-3));
}
function shortTermForecast(weeks, days) {
    const recent = weeks.slice(-4).reduce((a, b) => a + b, 0);
    const previous = weeks.slice(-8, -4).reduce((a, b) => a + b, 0);
    const factor = previous > 0 ? clamp(1 + (recent - previous) / previous, 0.7, 1.3) : 1;
    return weightedMovingAverage(weeks) * factor * (days / 7);
}

function errorSummary(pairs) {
    let abs = 0, sq = 0, actual = 0, forecast = 0;
    for (const [a, f] of pairs) { abs += Math.abs(a - f); sq += (a - f) ** 2; actual += a; forecast += f; }
    const wape = actual > 0 ? (abs / actual) * 100 : null;
    return {
        mae: pairs.length ? round(abs / pairs.length, 2) : null,
        rmse: pairs.length ? round(Math.sqrt(sq / pairs.length), 2) : null,
        wape: wape === null ? null : round(wape, 1),
        accuracy: wape === null ? null : round(Math.max(0, 100 - wape), 1),
        bias: actual > 0 ? round(((forecast - actual) / actual) * 100, 1) : null,
        comparisons: pairs.length,
    };
}

function buildAccuracy({ today, testMonths = 6, productMonthly, weeklyUnits, categories = new Map(), scope }) {
    const currentKey = today.slice(0, 7);
    const tests = Array.from({ length: testMonths }, (_, i) => addMonthKey(currentKey, i - testMonths));
    const monthly = new Map();
    const items = new Set();
    for (const r of productMonthly) {
        const key = `${r.branchId}:${r.productId}`;
        items.add(key);
        monthly.set(`${key}:${r.monthKey}`, toNumber(r.units));
    }
    const weekly = new Map();
    for (const r of weeklyUnits) weekly.set(`${r.branchId}:${r.productId}:${r.weekStart}`, toNumber(r.units));
    const firstDataMonth = productMonthly.reduce((min, r) => (r.monthKey < min ? r.monthKey : min), currentKey);

    // Forecasts are made per product in each branch, then also added up per product, per category and for the whole scope.
    const levels = { total: new Map(), category: new Map(), product: new Map(), productBranch: new Map() };
    const addTo = (level, key, a, st, se) => {
        const cur = levels[level].get(key) || { a: 0, st: 0, se: 0 };
        cur.a += a; cur.st += st; cur.se += se;
        levels[level].set(key, cur);
    };
    const perMonth = tests.map((k) => ({ month: k, label: monthLabel(k), actual: 0, shortTerm: 0, seasonal: 0 }));
    const examples = new Map();
    tests.forEach((k, ti) => {
        const monthStart = `${k}-01`;
        // The 12 weeks (Monday to Sunday) that end before the month starts.
        const firstMonday = addDays(monthStart, -((new Date(`${monthStart}T00:00:00Z`).getUTCDay() + 6) % 7));
        const weekStarts = Array.from({ length: 12 }, (_, i) => addDays(firstMonday, -7 * (12 - i)));
        const history = monthRange(firstDataMonth > addMonthKey(k, -36) ? firstDataMonth : addMonthKey(k, -36), addMonthKey(k, -1));
        for (const key of items) {
            const actual = monthly.get(`${key}:${k}`) || 0;
            const weeks = weekStarts.map((w) => weekly.get(`${key}:${w}`) || 0);
            const st = shortTermForecast(weeks, daysInMonth(k));
            const model = seasonalModel(history, (h) => monthly.get(`${key}:${h}`));
            const se = model.expected(k);
            if (actual === 0 && st === 0 && se === 0) continue;
            const productId = key.split(":")[1];
            addTo("productBranch", `${key}:${k}`, actual, st, se);
            addTo("product", `${productId}:${k}`, actual, st, se);
            addTo("category", `${categories.get(Number(productId)) || "Uncategorized"}:${k}`, actual, st, se);
            addTo("total", k, actual, st, se);
            perMonth[ti].actual += actual;
            perMonth[ti].shortTerm += st;
            perMonth[ti].seasonal += se;
            if (ti === tests.length - 1) examples.set(key, { key, actual, shortTerm: st, seasonal: se });
        }
    });
    const LEVELS = [
        ["total", "Whole store (all products)"],
        ["category", "Per category"],
        ["product", "Per product"],
        ["productBranch", "Per product in each branch"],
    ];
    const byLevel = LEVELS.map(([level, label]) => {
        const values = [...levels[level].values()];
        return { level, label,
            shortTerm: errorSummary(values.map((v) => [v.a, v.st])),
            seasonal: errorSummary(values.map((v) => [v.a, v.se])) };
    });
    const productLevel = byLevel.find((l) => l.level === "productBranch");
    const shortTerm = productLevel.shortTerm, seasonal = productLevel.seasonal;
    const totalLevel = byLevel.find((l) => l.level === "total");
    const better = totalLevel.shortTerm.wape !== null && totalLevel.seasonal.wape !== null
        ? (totalLevel.seasonal.wape < totalLevel.shortTerm.wape ? "seasonal" : "shortTerm") : null;
    return {
        success: true,
        action: "get_forecast_accuracy",
        generatedAt: new Date().toISOString(),
        scope,
        testMonths: tests.map((k) => ({ month: k, label: monthLabel(k) })),
        methods: {
            shortTerm: { name: "Product Demand (last 12 weeks)", ...shortTerm },
            seasonal: { name: "Stock Plan (seasonal, up to 3 years)", ...seasonal },
        },
        better,
        levels: byLevel,
        perMonth: perMonth.map((m) => ({ ...m, actual: Math.round(m.actual), shortTerm: Math.round(m.shortTerm), seasonal: Math.round(m.seasonal) })),
        examples: [...examples.values()].sort((a, b) => b.actual - a.actual).slice(0, 10)
            .map((e) => ({ ...e, shortTerm: round(e.shortTerm), seasonal: round(e.seasonal) })),
        method: "Each of the last six complete months was forecast using only the sales before it, the same way the app forecasts today, "
            + "then compared with the units really sold (each product in each branch). MAE = average of |actual − forecast| units. "
            + "RMSE = square root of the average squared error (big misses count more). WAPE = total |error| ÷ total actual units; accuracy = 100% − WAPE. "
            + "Single products sell only a few units a month, so chance alone makes their monthly errors large; totals and categories show how well the method follows demand.",
    };
}

/* -------------------------------------------------------
 * 3. EVENTS
 * ------------------------------------------------------- */

const seriesName = (name) => String(name || "").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The past event to learn from: the latest one with the same name (years ignored), else the same type. */
function matchPastEvent(event, events, today) {
    const past = events.filter((e) => e.endDate < today && e.id !== event.id);
    const sameSeries = past.filter((e) => seriesName(e.name) === seriesName(event.name));
    const pool = sameSeries.length ? sameSeries : past.filter((e) => e.type === event.type);
    return pool.sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] || null;
}

function sameDatesYearBefore(date) {
    const [y, m, d] = date.split("-").map(Number);
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * What sold (and what was rented) more during the past event than on the same dates a year
 * before it, and what that means for the upcoming event.
 */
function buildEventForecast({ event, past, today, data, canViewStock = true }) {
    const eventDays = diffDays(event.startDate, event.endDate) + 1;
    const base = {
        event: { ...event, days: eventDays, startsIn: diffDays(today, event.startDate), label: `${shortDate(event.startDate)} – ${shortDate(event.endDate)}` },
    };
    if (!past) {
        return { ...base, ready: false,
            message: `No past "${event.type.replace("_", " ")}" event is recorded yet. Add the last one (with its dates) so the forecast can learn from it.` };
    }
    const pastDays = diffDays(past.startDate, past.endDate) + 1;
    const lengthFactor = eventDays / pastDays;
    // "Normal" = the average day of the 12 months before the past event, times the event's length.
    const normalScale = pastDays / 365;
    // Store growth since the past event: sales of the last 12 months ÷ the 12 months before the past event ended.
    const growth = toNumber(data.salesBefore.sales) > 0 ? clamp(toNumber(data.salesRecent.sales) / toNumber(data.salesBefore.sales), 0.5, 2) : 1;
    const normalSales = toNumber(data.baselineSales.sales) * normalScale;
    const salesLift = normalSales > 0 ? round(((toNumber(data.pastSales.sales) - normalSales) / normalSales) * 100, 1) : null;

    const baseline = new Map(data.baselineProducts.map((r) => [Number(r.productId), toNumber(r.units) * normalScale]));
    const stock = new Map();
    for (const s of data.stock) stock.set(Number(s.productId), (stock.get(Number(s.productId)) || 0) + toNumber(s.available));
    const products = data.pastProducts.map((r) => {
        const units = toNumber(r.units), before = round(baseline.get(Number(r.productId)) || 0);
        const expected = Math.round(units * growth * lengthFactor);
        const available = stock.get(Number(r.productId)) ?? 0;
        return {
            productId: Number(r.productId), name: String(r.name), category: String(r.category),
            pastUnits: units, normalUnits: before, extraUnits: round(units - before),
            lift: before >= 0.5 ? round(units / before, 1) : null,
            expected, available: canViewStock ? available : null,
            prepare: canViewStock ? Math.max(0, expected - available) : null,
        };
    }).filter((p) => p.extraUnits >= 3 && (p.lift === null || p.lift >= 1.5))
        // Biggest jump first (the products the event itself drives), then the most extra units.
        .sort((a, b) => (b.lift ?? 99) - (a.lift ?? 99) || b.extraUnits - a.extraUnits).slice(0, 15);

    const rentalBefore = new Map(data.baselineEquipment.map((r) => [Number(r.equipmentId), toNumber(r.units) * normalScale]));
    const owned = new Map();
    for (const e of data.owned) owned.set(Number(e.equipmentId), (owned.get(Number(e.equipmentId)) || 0) + toNumber(e.owned));
    const rentals = data.pastEquipment.map((r) => {
        const units = toNumber(r.units), before = round(rentalBefore.get(Number(r.equipmentId)) || 0);
        return {
            equipmentId: Number(r.equipmentId), name: String(r.name), pastUnits: units, normalUnits: before,
            extraUnits: round(units - before), lift: before >= 0.5 ? round(units / before, 1) : null,
            expected: Math.round(units * growth * lengthFactor), owned: canViewStock ? owned.get(Number(r.equipmentId)) ?? 0 : null,
        };
    }).filter((r) => r.extraUnits >= 2 && (r.lift === null || r.lift >= 1.3))
        .sort((a, b) => (b.lift ?? 99) - (a.lift ?? 99) || b.extraUnits - a.extraUnits).slice(0, 10);

    const beforeTypes = new Map(data.baselineTypes.map((t) => [t.eventType, toNumber(t.bookings) * normalScale]));
    const bookingTypes = data.pastTypes.map((t) => ({ eventType: t.eventType, bookings: toNumber(t.bookings),
        normal: round(beforeTypes.get(t.eventType) || 0) })).filter((t) => t.bookings > t.normal + 0.5)
        .sort((a, b) => (b.bookings - b.normal) - (a.bookings - a.normal)).slice(0, 6);

    const findings = [];
    const times = (lift) => (lift === null ? "far more than usual" : `${lift}× a normal period`);
    if (salesLift !== null) findings.push(`During ${past.name} (${shortDate(past.startDate)} – ${shortDate(past.endDate)}), sales were ${salesLift >= 0 ? "+" : ""}${salesLift}% vs normal days.`);
    if (products[0]) findings.push(`${products[0].name} sold ${products[0].pastUnits} units (${times(products[0].lift)}).`);
    if (rentals[0]) findings.push(`${rentals[0].name} was booked ${rentals[0].pastUnits} units (${times(rentals[0].lift)}).`);
    if (bookingTypes[0]) findings.push(`More bookings than usual: ${bookingTypes.map((t) => `${t.eventType} ${t.bookings} (normally about ${Math.round(t.normal)})`).join(", ")}.`);
    findings.push(`Expected amounts below = what sold during ${past.name} × store growth since then (${round(growth, 2)}×)${lengthFactor !== 1 ? ` × length (${eventDays} vs ${pastDays} days)` : ""}.`);

    return {
        ...base,
        ready: true,
        learnedFrom: { ...past, label: `${shortDate(past.startDate)} – ${shortDate(past.endDate)}`,
            comparedWith: `an average ${pastDays}-day period in the 12 months before it` },
        growth: round(growth, 2),
        salesLift,
        products,
        rentals,
        bookingTypes,
        findings,
    };
}

module.exports = {
    MONTH_NAMES,
    addDays,
    addMonthKey,
    daysInMonth,
    monthRange,
    sameDatesYearBefore,
    seasonalModel,
    buildStockPlan,
    buildAccuracy,
    matchPastEvent,
    buildEventForecast,
};
