/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Demand model: makes the sales and booking history look like a real party-supply store,
 * with clear patterns to find but enough randomness that it is not predictable.
 *
 *   - The store grows at a different rate each year, plus a random month-to-month drift.
 *   - Each category has its own busy and slow months (for example decorations in December).
 *   - Seasonal products peak in their season: Valentine's, graduation, summer fiestas,
 *     Halloween, Christmas, New Year, and election campaigns (SEED_ELECTIONS).
 *   - Each category is bought at its own time of day (balloons in the morning, candles and
 *     cakes in the afternoon, costumes in the evening).
 *   - Weekends, paydays, holidays (Holy Week, All Saints', Christmas, New Year) and random
 *     typhoon days change how busy a day is.
 *   - Each product has its own trend (rising, steady or falling) and some have a short fad.
 *   - Rental equipment has its own busy months (tents in the rainy season, fans in summer,
 *     sound systems for Christmas parties and campaign rallies).
 */
const { addDays, diffDays, dayOfWeek, daysInMonth } = require("./dates");

const OPEN_HOUR = 8;   // first order hour
const CLOSE_HOUR = 20; // store closes at 8 PM (last order hour is 19)

// Overall busy-ness per calendar month (Jan..Dec). Christmas is added by the season lift below.
const MONTH_FACTOR = [0.86, 1.02, 0.96, 1.0, 1.06, 0.98, 0.88, 0.9, 0.94, 1.02, 1.06, 1.18];
const WEEKDAY_FACTOR = [1.25, 0.8, 0.85, 0.9, 0.95, 1.1, 1.4]; // Sun..Sat

// Category busy months (Jan..Dec).
const CATEGORY_MONTHS = {
    "Balloons": [0.9, 1.15, 1.0, 1.05, 1.05, 0.95, 0.9, 0.95, 0.95, 1.0, 1.05, 1.25],
    "Backdrops": [0.85, 1.0, 1.1, 1.15, 1.05, 0.95, 0.9, 0.9, 0.95, 1.0, 1.05, 1.2],
    "Tables & Chairs": [1.15, 1.2, 0.95, 1.1, 1.15, 1.1, 0.8, 0.8, 0.9, 0.95, 1.05, 1.3],
    "Linens & Covers": [1.15, 1.2, 0.95, 1.1, 1.15, 1.1, 0.8, 0.8, 0.9, 0.95, 1.05, 1.3],
    "Decorations": [0.85, 1.0, 0.95, 1.0, 1.05, 0.95, 0.9, 0.9, 0.95, 1.05, 1.15, 1.35],
    "Party Favors": [0.9, 0.95, 0.95, 1.05, 1.1, 1.0, 0.9, 0.95, 0.95, 1.0, 1.1, 1.35],
    "Catering / Food": [0.9, 0.95, 1.0, 1.1, 1.15, 1.0, 0.95, 0.95, 0.95, 1.0, 1.1, 1.3],
    "Cake & Desserts": [0.95, 1.1, 1.0, 1.05, 1.1, 1.0, 0.95, 0.95, 0.95, 1.0, 1.05, 1.3],
    "Lights & Sounds": [0.9, 1.0, 0.95, 0.95, 1.0, 0.9, 0.9, 0.9, 0.95, 1.1, 1.2, 1.4],
    "Costumes & Props": [0.85, 0.95, 0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1.0, 1.5, 1.0, 1.15],
    "Candles & Accessories": [1.0, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1],
    "Miscellaneous": [0.95, 0.95, 1.0, 1.05, 1.05, 1.0, 0.95, 0.95, 0.95, 1.0, 1.1, 1.3],
};

// When people visit (hours 8..19), weekday and weekend.
const DAY_CURVE = {
    weekday: [0.35, 0.7, 0.95, 1.1, 1.0, 0.8, 0.85, 0.95, 1.1, 1.25, 1.1, 0.6],
    weekend: [0.5, 0.95, 1.2, 1.3, 1.25, 1.1, 1.05, 1.0, 0.95, 0.9, 0.75, 0.45],
};
// Which categories are bought at which hour (8..19).
const PLANNER = [0.8, 1.2, 1.4, 1.3, 1.1, 1.2, 1.2, 1.0, 0.9, 0.8, 0.7, 0.6];
const CATEGORY_HOURS = {
    "Balloons": [1.6, 1.6, 1.4, 1.2, 1.0, 0.9, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6],
    "Catering / Food": [0.8, 1.0, 1.3, 1.4, 1.1, 0.9, 1.0, 1.2, 1.3, 1.1, 0.9, 0.7],
    "Cake & Desserts": [0.5, 0.7, 0.9, 1.0, 1.0, 1.1, 1.3, 1.4, 1.4, 1.2, 1.0, 0.8],
    "Candles & Accessories": [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.4, 1.3, 1.1],
    "Costumes & Props": [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 1.7, 1.5],
    "Decorations": PLANNER, "Backdrops": PLANNER, "Linens & Covers": PLANNER, "Tables & Chairs": PLANNER,
    "Party Favors": [0.7, 0.8, 0.9, 1.0, 1.0, 1.1, 1.2, 1.3, 1.3, 1.2, 1.1, 1.0],
    "Lights & Sounds": [0.6, 0.7, 0.8, 0.9, 1.0, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.4],
};

// Election days (YYYY-MM-DD). Campaign demand builds in the 90 days before each one.
const ELECTIONS = String(process.env.SEED_ELECTIONS ?? "2025-05-12").split(",")
    .map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

/** How strong a season is on a date, from 0 (off season) to 1 (peak). */
function seasonIntensity(key, date) {
    const m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
    switch (key) {
        case "valentine":
            if (m === 2) return d <= 9 ? 0.55 : d <= 14 ? 1 : 0.05;
            return m === 1 && d >= 25 ? 0.2 : 0;
        case "graduation":
            if (m === 3) return d < 15 ? 0.3 : 0.75;
            if (m === 4) return d <= 20 ? 1 : 0.7;
            if (m === 5) return 0.45;
            return m === 6 && d <= 15 ? 0.2 : 0;
        case "fiesta":
            if (m === 5) return 1;
            return m === 4 && d >= 15 ? 0.5 : m === 6 && d <= 10 ? 0.25 : 0;
        case "halloween":
            if (m === 10) return d <= 15 ? 0.3 : d <= 24 ? 0.65 : 1;
            return m === 11 && d <= 2 ? 0.15 : m === 9 && d >= 20 ? 0.1 : 0;
        case "christmas":
            if (m === 11) return d <= 15 ? 0.25 : 0.45;
            if (m === 12) return d <= 10 ? 0.7 : d <= 24 ? 1 : d === 25 ? 0.05 : 0.15;
            return 0;
        case "newyear":
            if (m === 12 && d >= 26) return d === 31 ? 1 : 0.7;
            return 0;
        case "election":
            return electionIntensity(date);
        default:
            return 0;
    }
}

function electionIntensity(date) {
    let best = 0;
    for (const day of ELECTIONS) {
        const before = diffDays(date, day); // days until election day
        if (before < 2 || before > 90) continue; // campaigning stops two days before
        const v = before <= 30 ? 1 - (before - 2) / 60 : 0.3 + 0.2 * (90 - before) / 60;
        best = Math.max(best, v);
    }
    return best;
}

function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Holidays: 0 = closed. */
function holidayFactor(date) {
    const md = date.slice(5);
    if (md === "01-01") return 0;
    if (md === "12-25") return 0.25;
    if (md === "12-24") return 1.3;
    if (md === "12-30") return 1.2;
    if (md === "12-31") return 1.35;
    if (md === "11-01") return 0.6;
    if (md === "11-02") return 0.8;
    const easter = easterSunday(Number(date.slice(0, 4)));
    const fromEaster = diffDays(easter, date);
    if (fromEaster === -3 || fromEaster === -2) return 0.25; // Maundy Thursday, Good Friday
    if (fromEaster === -1) return 0.6;
    if (ELECTIONS.includes(date)) return 0.6;
    return 1;
}

// Gaussian noise from the seeded random generator.
function normal(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng.next();
    while (v === 0) v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function cumulative(weights) {
    const cum = [];
    let total = 0;
    for (const w of weights) { total += Math.max(0, w); cum.push(total); }
    return { cum, total };
}
function pickIndex(rng, { cum, total }) {
    const x = rng.next() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
}

/**
 * One model per store: random growth, random month jitter per year, typhoon days,
 * sale weeks, per-branch size and per-product trends/fads.
 */
function createDemandModel({ rng, start, today, branches }) {
    const years = [];
    for (let y = Number(start.slice(0, 4)); y <= Number(today.slice(0, 4)) + 1; y += 1) years.push(y);
    // Yearly growth differs every year (one year may even be flat or down).
    const yearGrowth = new Map(years.map((y) => [y, Math.max(-0.08, Math.min(0.3, 0.1 + normal(rng) * 0.08))]));
    // Each year's months differ a little from the typical pattern.
    const monthJitter = new Map(years.map((y) => [y, MONTH_FACTOR.map(() => Math.exp(normal(rng) * 0.07))]));
    const categoryJitter = new Map();
    const catJitter = (category, year) => {
        const k = `${category}:${year}`;
        if (!categoryJitter.has(k)) categoryJitter.set(k, Array.from({ length: 12 }, () => Math.exp(normal(rng) * 0.08)));
        return categoryJitter.get(k);
    };

    // Store growth index by month (compounding yearly growth + a random month-to-month drift).
    const growthByMonth = new Map();
    let level = 1, drift = 0;
    for (let d = `${start.slice(0, 7)}-01`; d <= `${today.slice(0, 7)}-01`;) {
        const y = Number(d.slice(0, 4));
        level *= Math.pow(1 + yearGrowth.get(y), 1 / 12);
        drift = 0.6 * drift + normal(rng) * 0.05;
        growthByMonth.set(d.slice(0, 7), level * Math.exp(drift));
        const next = new Date(Date.parse(`${d}T00:00:00Z`));
        next.setUTCMonth(next.getUTCMonth() + 1);
        d = next.toISOString().slice(0, 10);
    }
    const growth = (date) => growthByMonth.get(date.slice(0, 7)) ?? level;

    // Typhoon days (June–November, the whole store) and 1–2 sale weeks a year.
    const typhoon = new Map();
    const saleDays = new Set();
    for (let d = start; d <= today; d = addDays(d, 1)) {
        const m = Number(d.slice(5, 7));
        if (m >= 6 && m <= 11 && rng.chance(0.03)) {
            typhoon.set(d, 0.3);
            const next = addDays(d, 1);
            if (!typhoon.has(next)) typhoon.set(next, 0.7);
        }
    }
    for (const y of years) {
        for (let s = 0; s < rng.int(1, 2); s += 1) {
            const first = `${y}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 24)).padStart(2, "0")}`;
            for (let i = 0; i < rng.int(3, 5); i += 1) saleDays.add(addDays(first, i));
        }
    }

    // Branches: different sizes and their own growth tilt.
    const branchFactor = new Map(branches.map((b, i) => [b.id, {
        size: i === 0 ? 1.15 : 0.7 + rng.next() * 0.55,
        tilt: normal(rng) * 0.06,
    }]));

    /** Expected number of orders for a branch on a date (before Poisson noise). */
    function dayVolume(branchId, date, baseOrders) {
        const m = Number(date.slice(5, 7)) - 1, y = Number(date.slice(0, 4));
        const bf = branchFactor.get(branchId);
        const yearsIn = diffDays(start, date) / 365;
        const dom = Number(date.slice(8, 10));
        const payday = [15, 30, 31].includes(dom) || dom === 1 || (m === 1 && dom >= 28) ? 1.18 : 1;
        const lift = 1 + 0.3 * seasonIntensity("christmas", date) + 0.1 * seasonIntensity("halloween", date)
            + 0.08 * seasonIntensity("valentine", date) + 0.1 * seasonIntensity("graduation", date)
            + 0.06 * seasonIntensity("fiesta", date) + 0.15 * seasonIntensity("newyear", date)
            + 0.12 * seasonIntensity("election", date);
        const noise = Math.exp(normal(rng) * 0.16);
        return baseOrders * bf.size * Math.exp(bf.tilt * yearsIn) * growth(date)
            * MONTH_FACTOR[m] * monthJitter.get(y)[m] * WEEKDAY_FACTOR[dayOfWeek(date)] * payday * lift
            * holidayFactor(date) * (typhoon.get(date) ?? 1) * (saleDays.has(date) ? 1.3 : 1) * noise;
    }

    /** Minute of the day for an order (more orders at the usual busy hours). */
    const curves = {
        weekday: cumulative(DAY_CURVE.weekday),
        weekend: cumulative(DAY_CURVE.weekend),
    };
    function orderMinute(date, closeMin) {
        const weekend = [0, 6].includes(dayOfWeek(date));
        for (let tries = 0; tries < 6; tries += 1) {
            const hour = OPEN_HOUR + pickIndex(rng, curves[weekend ? "weekend" : "weekday"]);
            const minute = hour * 60 + rng.int(0, 59);
            if (minute <= closeMin) return minute;
        }
        return rng.int(OPEN_HOUR * 60, Math.max(OPEN_HOUR * 60, closeMin));
    }

    // Product trends: rising, steady or falling, and an occasional short fad.
    const productTrend = new Map();
    function trendOf(productId) {
        if (!productTrend.has(productId)) {
            const kind = rng.weighted([["rising", 20], ["steady", 55], ["falling", 25]]);
            const rate = kind === "rising" ? 0.2 + rng.next() * 0.4 : kind === "falling" ? -(0.15 + rng.next() * 0.3) : -0.08 + rng.next() * 0.18;
            let fad = null;
            if (rng.chance(0.08)) {
                const span = diffDays(start, today);
                fad = { center: addDays(start, rng.int(30, Math.max(31, span - 10))), half: rng.int(10, 38), peak: 1.8 + rng.next() * 2.2 };
            }
            productTrend.set(productId, { kind, rate, fad });
        }
        return productTrend.get(productId);
    }
    function productFactor(product, date) {
        const t = trendOf(product.id);
        const yearsIn = diffDays(start, date) / 365;
        let f = Math.pow(1 + t.rate, yearsIn);
        if (t.fad) {
            const dist = Math.abs(diffDays(t.fad.center, date));
            if (dist < t.fad.half) f *= 1 + (t.fad.peak - 1) * (1 - dist / t.fad.half);
        }
        if (product._season) f *= 0.25 + product._seasonLift * seasonIntensity(product._season, date);
        return f;
    }
    function categoryFactor(category, date) {
        const m = Number(date.slice(5, 7)) - 1;
        return (CATEGORY_MONTHS[category]?.[m] ?? 1) * catJitter(category, Number(date.slice(0, 4)))[m];
    }
    function hourFactor(category, minute) {
        const h = Math.max(OPEN_HOUR, Math.min(CLOSE_HOUR - 1, Math.floor(minute / 60)));
        return CATEGORY_HOURS[category]?.[h - OPEN_HOUR] ?? 1;
    }

    return { dayVolume, orderMinute, productFactor, categoryFactor, hourFactor, trendOf, growth };
}

// ── Rental equipment: busy months (Jan..Dec) and campaign-rally demand ──
const RAINY = [0.55, 0.55, 0.6, 0.7, 0.9, 1.6, 1.9, 1.9, 1.7, 1.3, 0.9, 1.0];
const WEDDING = [1.4, 1.6, 0.9, 1.3, 1.4, 1.3, 0.7, 0.7, 0.8, 0.9, 1.0, 1.7];
const EVENTS = [0.7, 0.8, 1.1, 1.3, 1.1, 0.8, 0.7, 0.7, 0.8, 1.1, 1.4, 1.9];
const CATERING = [0.8, 0.8, 1.0, 1.1, 1.5, 0.9, 0.8, 0.8, 0.8, 1.0, 1.3, 1.9];
const EQUIPMENT_MONTHS = {
    "Party Tent 3x3m": RAINY, "Canopy 5x10m": RAINY,
    "Monobloc Chair": [1.0, 1.0, 1.0, 1.1, 1.2, 1.0, 0.9, 0.9, 1.0, 1.0, 1.1, 1.4],
    "Tiffany Chair": WEDDING, "Arch Backdrop Stand": WEDDING, "Red Carpet Runner 10m": WEDDING,
    "Round Table (8-seater)": WEDDING, "Cocktail High Table": WEDDING, "Rectangular Banquet Table": WEDDING,
    "Kiddie Table and Chair Set": [0.9, 0.9, 1.0, 1.3, 1.3, 1.0, 0.9, 0.9, 0.9, 1.0, 1.0, 1.2],
    "Sound System Set": EVENTS, "Wireless Microphone": EVENTS, "Generator Set 5kVA": EVENTS, "LED Par Light": EVENTS,
    "Projector and Screen": EVENTS,
    "Fog Machine": [0.7, 1.2, 1.0, 0.8, 0.8, 0.7, 0.7, 0.7, 0.8, 2.4, 1.1, 1.5],
    "Chafing Dish": CATERING, "Beverage Dispenser": CATERING, "Dessert Table Display": CATERING, "Cake Stand Set": CATERING,
    "Electric Stand Fan": [0.4, 0.5, 1.5, 2.2, 2.2, 1.0, 0.6, 0.5, 0.5, 0.5, 0.5, 0.6],
    "Photo Booth Frame": [1.1, 1.3, 1.1, 1.1, 1.1, 1.0, 0.8, 0.8, 0.9, 1.0, 1.1, 1.4],
    "Hexagon Backdrop Frame": [1.1, 1.3, 1.1, 1.1, 1.1, 1.0, 0.8, 0.8, 0.9, 1.0, 1.1, 1.4],
};
const RALLY_EQUIPMENT = { "Sound System Set": 5, "Wireless Microphone": 3, "Generator Set 5kVA": 4, "Party Tent 3x3m": 3,
    "Canopy 5x10m": 3, "Monobloc Chair": 4, "Stanchion Post Set": 2, "LED Par Light": 2 };

// Squared so busy months clearly stand out when customers choose what to rent.
function equipmentWeight(name, date, rally = false) {
    const m = Number(date.slice(5, 7)) - 1;
    const base = (EQUIPMENT_MONTHS[name]?.[m] ?? 1) ** 2;
    return rally ? base * (RALLY_EQUIPMENT[name] ?? 0.15) : base;
}
// More equipment-only rentals in the rainy season (tents), summer (fans) and December.
const RENTAL_SHARE = [0.8, 0.9, 1.0, 1.2, 1.2, 1.3, 1.4, 1.4, 1.3, 1.1, 1.1, 1.4];

// Bookings per calendar month (Jan..Dec).
const BOOKING_MONTHS = [0.9, 1.05, 1.0, 1.1, 1.2, 1.0, 0.8, 0.8, 0.9, 1.0, 1.15, 1.45];

/** Event type that fits the date (Christmas parties in December, Halloween parties in October, ...). */
function seasonalEventType(rng, date, fallbackList) {
    const m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
    if (m === 12 && d >= 26 && rng.chance(0.5)) return "New Year Party";
    if ((m === 12 || (m === 11 && d >= 15)) && rng.chance(0.45)) return "Christmas Party";
    if (m === 10 && rng.chance(0.35)) return "Halloween Party";
    if (m >= 3 && m <= 5 && rng.chance(0.25)) return "Graduation Party";
    if (m === 5 && rng.chance(0.2)) return "Town Fiesta";
    if (m === 2 && d <= 14 && rng.chance(0.2)) return "Valentine Dinner";
    return rng.pick(fallbackList);
}

/** Weighted sample without replacement. */
function weightedSample(rng, list, weightOf, count) {
    const pool = list.map((item) => ({ item, w: Math.max(0, weightOf(item)) }));
    const out = [];
    while (out.length < count && pool.length) {
        const total = pool.reduce((s, p) => s + p.w, 0);
        if (total <= 0) break;
        let x = rng.next() * total, i = 0;
        for (; i < pool.length - 1; i += 1) { x -= pool[i].w; if (x <= 0) break; }
        out.push(pool[i].item);
        pool.splice(i, 1);
    }
    return out;
}

/** Day-of-month for an event in a month: weekends are busiest. */
function eventDayInMonth(rng, month) {
    const days = daysInMonth(month);
    const weights = [];
    for (let d = 1; d <= days; d += 1) {
        const date = `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;
        const dow = dayOfWeek(date);
        weights.push(dow === 6 ? 2.6 : dow === 0 ? 2.1 : dow === 5 ? 1.2 : 0.7);
    }
    return pickIndex(rng, cumulative(weights)) + 1;
}

module.exports = { ELECTIONS, OPEN_HOUR, CLOSE_HOUR, createDemandModel, seasonIntensity, electionIntensity,
    equipmentWeight, BOOKING_MONTHS, RENTAL_SHARE, seasonalEventType, weightedSample, eventDayInMonth, cumulative, pickIndex, normal };
