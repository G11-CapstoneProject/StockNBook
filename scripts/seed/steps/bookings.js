/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * customers' bookings, booking_items, booking payments, deposit refunds, rental incidents (stock_issues)
 * and Bookings activity. Every booking follows the same rules as lambda-bookings-v2.js, so the app can
 * open, pay, release and settle seeded bookings exactly like real ones.
 *
 * Stock changes (reserve / hand-over / cancel) are returned as dated events and applied by the
 * inventory simulation, so branch_inventory and inventory_movements always agree.
 */
const { CONFIG } = require("../lib/config");
const V = require("../lib/vocab");
const { addDays, diffDays, addMonths, dt, minutesToTime } = require("../lib/dates");
const { ELECTIONS, BOOKING_MONTHS, RENTAL_SHARE, electionIntensity, equipmentWeight, seasonalEventType, weightedSample,
    eventDayInMonth, normal, createDemandModel } = require("../lib/demand");

const S = V.BOOKING_STATUS;
const EVENT_TYPES = ["Birthday Party", "Kiddie Party", "Debut", "Wedding Reception", "Christening", "Baby Shower",
    "Corporate Event", "Graduation Party", "Anniversary", "Gender Reveal"];
const THEMES = ["Pastel Unicorn", "Safari Adventure", "Princess Castle", "Superhero Squad", "Rustic Garden", "Minimalist White and Gold",
    "Under the Sea", "Outer Space", "Tropical Luau", "Hollywood Glam", "Rose Gold Elegance", "Baby Blue Clouds", "K-Pop Party",
    "Boho Chic", "Carnival Fun"];
const VENUES = ["Clubhouse, Ayala Heights, Quezon City", "Function Room B, SM Megamall, Mandaluyong", "Barangay Hall, San Roque, Marikina",
    "Private residence, BF Homes, Parañaque", "Garden Pavilion, Tagaytay Highlands", "Events Place, Kapitolyo, Pasig",
    "Covered court, Greenwoods, Pasig", "Hotel ballroom, Ortigas Center", "Restaurant private room, Maginhawa, Quezon City",
    "Beach resort, Nasugbu, Batangas"];
const RALLY_VENUES = ["Town plaza, Marikina", "Covered court, Barangay San Roque, Marikina", "Basketball court, Greenwoods, Pasig",
    "Barangay Hall grounds, Kapitolyo, Pasig", "Open grounds, Commonwealth, Quezon City"];
const CUSTOM_REQUESTS = ["Please add a personalized name banner and a 3-tier cake topper.",
    "Balloon arch in our motif colors at the entrance, plus a dessert table setup.",
    "We need extra chairs for elderly guests and a separate kids' corner.",
    "Matching table runners and centerpieces for 10 tables.",
    "Photo backdrop with our logo for a company anniversary.",
    "Add glow sticks and party hats for 40 kids."];
const CANCEL_REASONS = ["Customer moved the event to another date outside our schedule.",
    "Event cancelled by the customer due to a family emergency.", "Venue was no longer available on the event date.",
    "Customer chose a different supplier after comparing quotations."];
const REJECT_REASONS = ["Fully booked for the requested date.", "Requested venue is outside our delivery area.",
    "Requested items are not available for the event date."];

const money2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round100 = (n) => Math.round(n / 100) * 100;
const round50 = (n) => Math.max(50, Math.round(n / 50) * 50);
const nowMinutes = () => { const [h, m] = CONFIG.nowTime.split(":").map(Number); return h * 60 + m; };

/**
 * Keeps each booking's timestamps in order and never later than "now".
 * Only a new request and today's hand-over may happen today; other steps happen by yesterday.
 */
function timeline(rng) {
    let lastDate = null, lastMin = -1;
    return (date, fromMin = 8 * 60, toMin = 19 * 60, allowToday = false) => {
        if (date > CONFIG.today) date = CONFIG.today;
        if (!allowToday && date === CONFIG.today) date = addDays(CONFIG.today, -1);
        if (lastDate && date < lastDate) date = lastDate;
        let lo = fromMin, hi = toMin;
        if (date === lastDate) lo = Math.max(lo, lastMin + 5);
        if (date === CONFIG.today) {
            // Squeeze today's steps in before the current time (the app writes later rows with NOW()).
            hi = Math.min(hi, nowMinutes() - 1);
            if (lo > hi) lo = Math.max(date === lastDate ? lastMin + 1 : 0, hi - 30);
        }
        if (hi < lo) hi = lo;
        const minute = lo + Math.floor(rng.next() * (hi - lo + 1));
        lastDate = date; lastMin = minute;
        const [h, m] = minutesToTime(minute);
        return { date, at: dt(date, h, m, rng.int(0, 59)), minute };
    };
}

async function buildBookings({ ctx, catalog, packages, customers, ids, rng, inventoryIndex, equipUnits, demand }) {
    const { store, branches, storeStart } = ctx;
    const today = CONFIG.today;
    const model = demand || createDemandModel({ rng, start: addMonths(today, -CONFIG.historyMonths), today, branches });
    const out = { bookings: [], bookingItems: [], payments: [], refunds: [], stockIssues: [], actions: [],
        events: [], equipmentEvents: [] };
    const bookableVariants = catalog.variants.filter((v) => v._product._bookable);
    const activePackagesByBranch = new Map(branches.map((b) => [b.id, packages.filter((p) => p.branch_id === b.id && p.status === "active")]));
    const usage = new Map();      // `${branch}:${equipment}:${date}` -> units out
    const incidentBudget = new Map(); // `${branch}:${equipment}` -> units that may still be damaged/missing
    const capacity = (branchId, e) => {
        const units = equipUnits.get(`${branchId}:${e.id}`);
        return units - Math.max(1, Math.ceil(units * 0.1)); // keep a 10% buffer for damaged/missing units
    };
    const fits = (branchId, e, qty, from, to) => {
        for (let d = from; d <= to; d = addDays(d, 1))
            if ((usage.get(`${branchId}:${e.id}:${d}`) || 0) + qty > capacity(branchId, e)) return false;
        return true;
    };
    const occupy = (branchId, e, qty, from, to) => {
        for (let d = from; d <= to; d = addDays(d, 1)) {
            const k = `${branchId}:${e.id}:${d}`;
            usage.set(k, (usage.get(k) || 0) + qty);
        }
    };
    const references = new Set();
    const newReference = (date) => {
        let ref;
        do ref = `BKG-${date.slice(0, 4)}-${rng.token(6)}`; while (references.has(ref));
        references.add(ref);
        return ref;
    };
    const method = () => rng.weighted(V.BOOKING_PAYMENT_METHODS);
    const refNo = (m) => (m === "cash" ? null : `${m === "gcash" ? "GC" : "BT"}${rng.int(100000, 999999)}${rng.int(1000000, 9999999)}`);
    // Bookings rows use the lowercase role, exactly as lambda-bookings-v2.js logs them.
    const log = (b, actorId, _role, action, message, at, extra = {}) => out.actions.push({
        store_id: store.id, branch_id: b.branch_id, user_id: actorId, user_name: ctx.userName(actorId), user_role: ctx.userRole(actorId),
        module: "Bookings", action, entity_type: "booking", entity_id: b.id, reference_number: b.booking_reference,
        details: JSON.stringify({ message, ...extra }), ip_address: null, created_at: at });
    const logRental = (b, actorId, action, message, at) => out.actions.push({
        store_id: store.id, branch_id: b.branch_id, user_id: actorId, user_name: ctx.userName(actorId), user_role: ctx.userRoleLabel(actorId),
        module: "Rentals", action, entity_type: "booking", entity_id: b.id, reference_number: b.booking_reference,
        details: JSON.stringify(message), ip_address: null, created_at: at });

    // How many bookings per month: busy and slow months, store growth and random ups and downs
    // over the whole history; fewer in later months (not booked yet). Events fall mostly on weekends.
    const plan = [];
    const perMonth = ctx.bookingsPerMonth;
    const yearJitter = new Map();
    for (let o = -CONFIG.historyMonths; o <= CONFIG.futureMonths; o += 1) {
        const month = addMonths(today, o);
        const year = month.slice(0, 4), m = Number(month.slice(5, 7)) - 1;
        if (!yearJitter.has(year)) yearJitter.set(year, BOOKING_MONTHS.map(() => Math.exp(normal(rng) * 0.1)));
        const ahead = o <= 0 ? 1 : [0.6, 0.35, 0.15][o - 1] ?? 0.1;
        const seasonal = BOOKING_MONTHS[m] * yearJitter.get(year)[m] * model.growth(o <= 0 ? month : today) * Math.exp(normal(rng) * 0.12);
        const count = Math.round(perMonth * ahead * seasonal);
        for (let i = 0; i < count; i += 1) {
            const date = `${month.slice(0, 8)}${String(eventDayInMonth(rng, month)).padStart(2, "0")}`;
            if (diffDays(storeStart, date) < 20) continue;
            plan.push({ date });
        }
    }
    // Election campaigns: extra equipment rentals for rallies in the 90 days before each election day.
    const lastPlanned = addMonths(today, CONFIG.futureMonths + 1);
    for (const electionDay of ELECTIONS) {
        for (let date = addDays(electionDay, -90); date <= addDays(electionDay, -2); date = addDays(date, 1)) {
            if (diffDays(storeStart, date) < 20 || date >= lastPlanned) continue;
            const ahead = date <= today ? 1 : 0.4;
            if (rng.chance((perMonth * 0.3 / 30) * (0.3 + electionIntensity(date)) * ahead)) plan.push({ date, rally: true });
        }
    }
    // Fixed examples in the main branch, so every status can be tested on any day the seeder runs.
    const B = V.BOOKING_TYPE;
    for (const [offset, status, type, days, extra] of [
        [0, S.PREPARING, B.PACKAGE, 1, { fullyPaid: true }],          // ready for Staff hand-over today
        [-1, S.RELEASED, B.RENTAL, 3, {}],                             // equipment out right now
        [-3, S.RETURN_INSPECTION, B.RENTAL, 1, {}],                    // returned, waiting for Staff inspection
        [-5, S.PENDING_SETTLEMENT, B.RENTAL, 1, { incident: true }],   // Manager must approve a damage charge
        [-6, S.PENDING_SETTLEMENT, B.CUSTOM, 1, { incident: false, rentals: true }], // only the deposit refund is left
        [-20, S.COMPLETED, B.RENTAL, 2, { incident: true }],
        [7, S.CONFIRMED, B.PACKAGE, 1, {}],
        [10, S.AWAITING_DP, B.CUSTOM, 1, {}],
        [14, S.PENDING_REVIEW, B.CUSTOM, 1, {}],
        [20, S.CANCELLED, B.PACKAGE, 1, {}],
        [25, S.REJECTED, B.CUSTOM, 1, {}],
    ]) plan.push({ date: addDays(today, offset), force: { status, type, days, ...extra } });
    plan.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // The plan's monthly limit counts bookings by created_at. Keep this month under it.
    const createdThisMonthCap = ctx.plan.max_bookings > 0 ? Math.max(0, ctx.plan.max_bookings - CONFIG.bookingHeadroom) : Infinity;
    let createdThisMonth = 0;

    for (const { date: eventDate, force, rally = false } of plan) {
        const branch = force ? branches[0] : rng.weighted(branches.map((b, i) => [b, i === 0 ? 2 : 1]));
        const workerId = rng.pick(branch.workerIds);
        const managerId = branch.managerId;
        let type = rng.weighted([[V.BOOKING_TYPE.PACKAGE, 50], [V.BOOKING_TYPE.CUSTOM, 30],
            [V.BOOKING_TYPE.RENTAL, 20 * RENTAL_SHARE[Number(eventDate.slice(5, 7)) - 1]]]);
        if (rally) type = V.BOOKING_TYPE.RENTAL;
        if (force) type = force.type;
        // Rental equipment that is in demand on this date (tents in the rainy season, sound systems for rallies, ...).
        const equipmentByDemand = (count) => weightedSample(rng, catalog.equipment, (e) => equipmentWeight(e._base, eventDate, rally), count);
        if (type === V.BOOKING_TYPE.PACKAGE && !activePackagesByBranch.get(branch.id).length) type = V.BOOKING_TYPE.CUSTOM;
        const d = diffDays(today, eventDate);

        // ── Status from the event date (past events are finished, future ones are in progress) ──
        let status;
        if (d > 2) status = rng.weighted([[S.PENDING_REVIEW, 25], [S.AWAITING_DP, 20], [S.CONFIRMED, 50], [S.CANCELLED, 5]]);
        else if (d >= 1) status = rng.weighted([[S.CONFIRMED, 40], [S.PREPARING, 60]]);
        else if (d === 0) status = nowMinutes() >= 10 * 60 + 30 ? rng.weighted([[S.RELEASED, 75], [S.PREPARING, 25]]) : S.PREPARING;
        else status = rng.weighted([[S.COMPLETED, 87], [S.CANCELLED, 7], [S.REJECTED, 6]]);
        if (force) status = force.status;
        const holdsEquipment = ![S.CANCELLED, S.REJECTED].includes(status);

        // ── Rental period ──
        let days = 1;
        const wantsRentals = type === V.BOOKING_TYPE.RENTAL || (type === V.BOOKING_TYPE.CUSTOM && (force ? Boolean(force.rentals) : rng.chance(0.4)));
        if (wantsRentals || type === V.BOOKING_TYPE.PACKAGE) days = force ? force.days : rng.weighted([[1, 65], [2, 25], [3, 10]]);
        let endDate = addDays(eventDate, days - 1);

        // ── Items ──
        let pkg = null;
        const consumables = [];  // { v, qty, parent: bool }
        const rentals = [];      // { e, qty, included: bool }
        if (type === V.BOOKING_TYPE.PACKAGE) {
            for (const candidate of rng.sample(activePackagesByBranch.get(branch.id), 3)) {
                const rentLines = candidate._lines.filter((l) => l.kind === "rental");
                if (!holdsEquipment || rentLines.every((l) => fits(branch.id, l.e, l.quantity, eventDate, endDate))) { pkg = candidate; break; }
            }
            if (!pkg) type = V.BOOKING_TYPE.CUSTOM;
            else {
                for (const l of pkg._lines) {
                    if (l.kind === "consumable") consumables.push({ v: l.v, qty: l.quantity, parent: true });
                    else rentals.push({ e: l.e, qty: l.quantity, included: true });
                }
                if (catalog.equipment.length && rng.chance(0.2)) {
                    const [extra] = equipmentByDemand(1);
                    if (!rentals.some((r) => r.e.id === extra.id)) rentals.push({ e: extra, qty: extra._units[1] >= 60 ? rng.int(10, 30) : rng.int(1, 2), included: false });
                }
            }
        }
        if (type === V.BOOKING_TYPE.CUSTOM) {
            const seen = new Set();
            // Products that sell well on this date are also the ones customers add to custom bookings.
            const demandRank = { high: 3, medium: 2, slow: 1 };
            for (const v of weightedSample(rng, bookableVariants, (x) => demandRank[x._product._demand] * model.productFactor(x._product, eventDate), 20)) {
                if (consumables.length >= rng.int(3, 7)) break;
                if (seen.has(v._product.id)) continue;
                seen.add(v._product.id);
                consumables.push({ v, qty: rng.int(1, 8), parent: false });
            }
            if (wantsRentals) for (const e of equipmentByDemand(rng.int(1, 2)))
                rentals.push({ e, qty: e._units[1] >= 60 ? rng.int(10, 40) : rng.int(1, 3), included: false });
        }
        if (type === V.BOOKING_TYPE.RENTAL) {
            for (const e of equipmentByDemand(rally ? rng.int(2, 4) : rng.int(1, 4)))
                rentals.push({ e, qty: e._units[1] >= 60 ? rng.int(20, 60) : rng.int(1, 4), included: false });
        }
        // Make customer-added rentals fit the equipment free on those dates.
        for (let i = rentals.length - 1; i >= 0; i -= 1) {
            const r = rentals[i];
            if (r.included || !holdsEquipment) continue;
            while (r.qty > 0 && !fits(branch.id, r.e, r.qty, eventDate, endDate)) r.qty -= 1;
            if (r.qty <= 0) rentals.splice(i, 1);
        }
        if (type === V.BOOKING_TYPE.RENTAL && !rentals.length) continue; // nothing free that week
        const hasRentals = rentals.length > 0;
        if (!hasRentals) { days = 1; endDate = eventDate; }
        if (holdsEquipment) for (const r of rentals) occupy(branch.id, r.e, r.qty, eventDate, endDate);

        // Rentals still out / just returned change the finished-booking status.
        if (!force && d < 0 && status === S.COMPLETED && hasRentals) {
            if (endDate >= today) status = S.RELEASED;
            else if (endDate === addDays(today, -1)) status = rng.weighted([[S.RETURN_INSPECTION, 40], [S.PENDING_SETTLEMENT, 60]]);
            else if (endDate >= addDays(today, -14)) status = rng.weighted([[S.COMPLETED, 70], [S.PENDING_SETTLEMENT, 30]]);
        }
        if (status === S.RELEASED && !hasRentals) status = S.COMPLETED; // the Lambda completes consumable-only bookings on hand-over
        if (status === S.PREPARING && !consumables.length) status = S.CONFIRMED; // only consumables can be "prepared"

        // ── Money ──
        const pkgPrice = pkg ? Number(pkg.package_price) : 0;
        const customSales = consumables.filter((c) => !c.parent).reduce((s, c) => s + Number(c.v.selling_price) * c.qty, 0);
        const rentalExtras = rentals.filter((r) => !r.included).reduce((s, r) => s + Number(r.e.rental_rate_per_day) * r.qty * days, 0);
        const rentalValue = rentals.reduce((s, r) => s + Number(r.e.rental_rate_per_day) * r.qty * days, 0);
        const catalogTotal = money2(pkgPrice + customSales + rentalExtras);
        const approved = ![S.PENDING_REVIEW, S.REJECTED].includes(status) && !(status === S.CANCELLED && rng.chance(0.4));
        const customFee = type === V.BOOKING_TYPE.CUSTOM ? round100(rng.int(5, 30) * 100) : 0;
        let agreed = type === V.BOOKING_TYPE.CUSTOM ? (approved ? money2(catalogTotal + customFee) : null) : catalogTotal;
        let dp = pkg ? Number(pkg.down_payment_amount) : 0;
        if (approved && type === V.BOOKING_TYPE.CUSTOM) dp = Math.max(100, round100(agreed * (0.3 + rng.next() * 0.2)));
        if (approved && type === V.BOOKING_TYPE.RENTAL)
            dp = status === S.AWAITING_DP || rng.chance(0.85) ? Math.max(100, round100(agreed * 0.5)) : 0;
        if (dp > (agreed || Infinity)) dp = round100(agreed * 0.5);
        let deposit = 0;
        if (approved && hasRentals) {
            deposit = rng.chance(0.2) ? 0 : Math.max(500, round100(rentalValue * (0.2 + rng.next() * 0.1)));
            if (status === S.PENDING_SETTLEMENT && deposit === 0) deposit = Math.max(500, round100(rentalValue * 0.2));
        }

        // ── Timeline ──
        const t = timeline(rng);
        let createdDate = addDays(eventDate, -rng.int(5, 45));
        if (createdDate < addDays(storeStart, 1)) createdDate = addDays(storeStart, 1);
        if (createdDate > today) createdDate = today;
        // A request sent today has not been reviewed yet.
        if (createdDate === today && !force && status !== S.PENDING_REVIEW) createdDate = addDays(today, -rng.int(1, 3));
        if (createdDate.slice(0, 7) === today.slice(0, 7)) {
            if (createdThisMonth >= createdThisMonthCap) createdDate = addDays(`${today.slice(0, 8)}01`, -rng.int(1, 5));
            else createdThisMonth += 1;
        }
        if (createdDate === today && nowMinutes() < 9 * 60) createdDate = addDays(today, -1);
        const created = t(createdDate, 8 * 60, 21 * 60, true);
        const customer = rng.pick(customers);
        if (customer.created_at > created.at) { customer.created_at = created.at; customer.updated_at = created.at; }

        // Pickup or delivery, and when: the customer gets the items before the event; rentals come back after it.
        const eventMin = rng.int(9, 18) * 60 + rng.pick([0, 30]);
        const delivery = rng.chance(rally ? 0.7 : 0.4);
        const handoverMin = Math.max(delivery ? 7 * 60 : 8 * 60, eventMin - rng.int(2, 4) * 60);
        const returnMin = endDate === eventDate ? Math.min(21 * 60, eventMin + rng.int(4, 6) * 60) : rng.int(9, 17) * 60;
        const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
        const nearElection = ELECTIONS.some((e) => { const d = diffDays(eventDate, e); return d >= 2 && d <= 7; });
        const eventType = rally ? (nearElection ? "Miting de Avance" : "Campaign Rally")
            : type === V.BOOKING_TYPE.RENTAL ? "Equipment Rental" : seasonalEventType(rng, eventDate, EVENT_TYPES);

        const id = await ids.take("bookings");
        const b = { id, store_id: store.id, branch_id: branch.id, booking_reference: newReference(created.date), customer_id: customer.id,
            package_id: pkg ? pkg.id : null, booking_type: type,
            event_type: eventType,
            theme: type === V.BOOKING_TYPE.RENTAL ? null : rng.pick(THEMES), event_date: eventDate, event_end_date: endDate,
            event_time: clock(eventMin), venue: rally ? rng.pick(RALLY_VENUES) : rng.pick(VENUES),
            handover_method: delivery ? "delivery" : "pickup", handover_date: eventDate, handover_time: clock(handoverMin),
            rental_start_date: hasRentals ? eventDate : null, rental_end_date: hasRentals ? endDate : null,
            return_time: hasRentals ? clock(returnMin) : null,
            custom_order: type === V.BOOKING_TYPE.CUSTOM ? rng.pick(CUSTOM_REQUESTS) : null,
            notes: rng.chance(0.3) ? rng.pick(["Please call before delivery.", "Setup must finish 2 hours before the event.",
                "Gate pass needed at the subdivision entrance.", "Contact person: the event coordinator."]) : null,
            status, package_price_snapshot: pkg ? pkgPrice : null, agreed_price: agreed, required_down_payment: dp,
            down_payment_deadline: null, refundable_deposit_required: deposit, vat_amount: 0,
            approved_by: null, approved_at: null, final_additional_charges: 0, deposit_applied_amount: 0, approved_refund_amount: 0,
            settlement_status: V.SETTLEMENT.PENDING, settlement_notes: null, settlement_reviewed_by: null, settlement_reviewed_at: null,
            cancellation_reason: null, created_by: rng.chance(0.2) ? managerId : null, created_at: created.at, updated_at: created.at };
        out.bookings.push(b);

        // booking_items exactly like create_booking writes them.
        const items = [];
        const addItem = async (fields) => {
            const row = { id: await ids.take("booking_items"), store_id: store.id, booking_id: id, parent_item_id: null, package_id: null,
                variant_id: null, equipment_id: null, item_name_snapshot: "", variant_name_snapshot: null, quantity: 1, rental_days: null,
                unit_price_snapshot: 0, line_total: 0, used_quantity: 0, item_status: V.ITEM_STATUS.PENDING, prepared_at: null,
                prepared_by: null, released_at: null, released_by: null, returned_quantity: 0, damaged_quantity: 0, missing_quantity: 0,
                returned_at: null, received_by: null, inspected_at: null, inspected_by: null, return_notes: null, notes: null,
                created_at: created.at, updated_at: created.at, ...fields };
            items.push(row);
            out.bookingItems.push(row);
            return row;
        };
        let packageRow = null;
        if (pkg) packageRow = await addItem({ item_type: V.ITEM.PACKAGE, package_id: pkg.id, item_name_snapshot: pkg.package_name,
            quantity: 1, unit_price_snapshot: pkgPrice, line_total: pkgPrice });
        for (const c of consumables) await addItem({ item_type: V.ITEM.CONSUMABLE, parent_item_id: c.parent ? packageRow.id : null,
            variant_id: c.v.id, item_name_snapshot: c.v._product.product_name,
            variant_name_snapshot: c.v._product.has_variants ? c.v.variant_name : null, quantity: c.qty,
            unit_price_snapshot: c.v.selling_price, line_total: c.parent ? 0 : money2(Number(c.v.selling_price) * c.qty), _variant: c.v });
        for (const r of rentals) await addItem({ item_type: V.ITEM.RENTAL, parent_item_id: r.included ? packageRow.id : null,
            equipment_id: r.e.id, item_name_snapshot: r.e.equipment_name, quantity: r.qty, rental_days: days,
            unit_price_snapshot: r.e.rental_rate_per_day,
            line_total: r.included ? 0 : money2(Number(r.e.rental_rate_per_day) * r.qty * days), _equipment: r.e });
        const consumableRows = items.filter((i) => i.item_type === V.ITEM.CONSUMABLE);
        const rentalRows = items.filter((i) => i.item_type === V.ITEM.RENTAL);
        const setAll = (rows, fields) => rows.forEach((r) => Object.assign(r, fields));

        // ── Walk through the lifecycle up to the chosen status ──
        const pay = async (type_, amount, when, key) => {
            if (amount <= 0.004) return null;
            const m = method();
            const row = { id: await ids.take("payments"), store_id: store.id, branch_id: branch.id, booking_id: id, order_id: null,
                payment_type: type_, amount: money2(amount), payment_method: m, reference_number: refNo(m), status: V.PAYMENT_STATUS,
                request_key: key, recorded_by: managerId, paid_at: when.at, notes: null, created_at: when.at };
            out.payments.push(row);
            return row;
        };
        const reserveEvents = (when, kind) => {
            const byVariant = new Map();
            for (const c of consumableRows) byVariant.set(c.variant_id, (byVariant.get(c.variant_id) || 0) + c.quantity);
            for (const [variantId, qty] of byVariant) out.events.push({ date: when.date, minute: when.minute, at: when.at,
                branchId: branch.id, kind, variantId, qty, bookingId: id, ref: b.booking_reference, actorId: kind === "issue" ? workerId : managerId });
        };
        const last = (when) => { b.updated_at = when.at; };
        const cancelledItems = () => setAll(items, { item_status: V.ITEM_STATUS.CANCELLED });

        if (status === S.REJECTED || (status === S.CANCELLED && !approved)) {
            const when = t(addDays(createdDate, rng.int(0, 2)));
            cancelledItems();
            if (status === S.REJECTED) {
                const reason = rng.pick(REJECT_REASONS);
                b.cancellation_reason = `Rejected: ${reason}`;
                log(b, managerId, "manager", "Rejected booking request", `${b.booking_reference} (${customer.full_name}): Pending Review → Rejected`, when.at, { reason });
            } else b.cancellation_reason = "Cancelled by customer through the booking portal.";
            last(when);
            continue;
        }
        if (status === S.PENDING_REVIEW) continue;

        // Approval (Manager).
        const lastBeforeEvent = d > 0 ? addDays(eventDate, -1) : eventDate;
        const approvedAt = t(addDays(createdDate, rng.int(0, 2)) > lastBeforeEvent ? createdDate : addDays(createdDate, rng.int(0, 2)));
        b.approved_by = managerId;
        b.approved_at = approvedAt.at;
        if (type !== V.BOOKING_TYPE.PACKAGE || deposit > 0)
            log(b, managerId, "manager", "Updated booking payment terms", `${b.booking_reference}: agreed ₱${agreed}, DP ₱${dp}, deposit ₱${deposit}`, approvedAt.at);
        log(b, managerId, "manager", dp > 0 ? "Approved booking awaiting DP" : "Confirmed booking",
            `${b.booking_reference} (${customer.full_name}): Pending Review → ${dp > 0 ? S.AWAITING_DP : S.CONFIRMED}`, approvedAt.at,
            dp > 0 ? {} : { noDpReason: "Long-time customer; full payment on event day agreed by the Manager." });
        last(approvedAt);

        const dpDay = (() => {
            const target = addDays(approvedAt.date, rng.int(0, 5));
            return target > lastBeforeEvent ? approvedAt.date : target;
        })();
        let keySeq = 0;
        const key = (suffix) => `BOOKPAY-${id}-S${++keySeq}-${suffix}`;

        // Half of the approved-then-cancelled bookings were cancelled before any down payment.
        if (status === S.CANCELLED && (dp <= 0 || rng.chance(0.5))) {
            const when = t(addDays(approvedAt.date, rng.int(1, 7)) > lastBeforeEvent ? approvedAt.date : addDays(approvedAt.date, rng.int(1, 7)));
            cancelledItems();
            const reason = rng.pick(CANCEL_REASONS);
            b.cancellation_reason = reason;
            log(b, managerId, "manager", "Cancelled booking", `${b.booking_reference} (${customer.full_name}): Awaiting Down Payment → Cancelled`, when.at,
                { reason, bookingPaid: 0, note: "Financial review required; no automatic refund/forfeiture." });
            last(when);
            continue;
        }

        if (status === S.AWAITING_DP) {
            if (rng.chance(0.3)) {
                const when = t(dpDay);
                await pay(V.PAYMENT_TYPE.BOOKING, Math.max(100, round100(dp * (0.3 + rng.next() * 0.4))), when, key("BOOK"));
                log(b, managerId, "manager", "Recorded verified customer payment", `${b.booking_reference}: partial down payment recorded`, when.at);
                last(when);
            }
            continue;
        }

        // Down payment → automatic confirmation → consumables reserved.
        const cancelledAfterDp = status === S.CANCELLED;
        const confirmAt = t(dpDay);
        const payFullNow = !cancelledAfterDp && rng.chance(0.25);
        const firstPayment = dp > 0 ? (payFullNow ? agreed : dp) : 0;
        let depositPaid = 0, paidSoFar = 0;
        if (firstPayment > 0) {
            await pay(V.PAYMENT_TYPE.BOOKING, firstPayment, confirmAt, key("BOOK"));
            paidSoFar = firstPayment;
            if (deposit > 0 && !cancelledAfterDp && rng.chance(0.5)) {
                await pay(V.PAYMENT_TYPE.DEPOSIT, deposit, confirmAt, `BOOKPAY-${id}-S${keySeq}-DEP`);
                depositPaid = deposit;
            }
            log(b, managerId, "manager", "Recorded verified customer payment", `${b.booking_reference}: down payment recorded`, confirmAt.at);
            log(b, managerId, "manager", "Automatically confirmed after verified down payment", `${b.booking_reference}: Awaiting Down Payment → Confirmed`, confirmAt.at);
        }
        reserveEvents(confirmAt, "reserve");
        setAll(consumableRows, { item_status: V.ITEM_STATUS.RESERVED });
        setAll(rentalRows, { item_status: V.ITEM_STATUS.RESERVED });
        last(confirmAt);

        if (cancelledAfterDp) {
            const cancelDay = addDays(confirmAt.date, rng.int(1, 10));
            const when = t(cancelDay > lastBeforeEvent ? confirmAt.date : cancelDay);
            reserveEvents(when, "unreserve");
            cancelledItems();
            const reason = rng.pick(CANCEL_REASONS);
            b.cancellation_reason = reason;
            log(b, managerId, "manager", "Cancelled booking", `${b.booking_reference} (${customer.full_name}): Confirmed → Cancelled`, when.at,
                { reason, bookingPaid: paidSoFar, note: "Financial review required; no automatic refund/forfeiture." });
            last(when);
            continue;
        }
        if (status === S.CONFIRMED) continue;

        // Preparing: Staff prepares the consumables the day before the event.
        const prepAt = t(addDays(eventDate, -1), 9 * 60, 17 * 60);
        const prepareAll = status !== S.PREPARING || (!force && rng.chance(0.6));
        for (const [i, row] of consumableRows.entries()) {
            if (!prepareAll && i > 0) break;
            Object.assign(row, { prepared_at: prepAt.at, prepared_by: workerId, updated_at: prepAt.at });
        }
        if (consumableRows.length)
            log(b, workerId, "staff", "Prepared Sales booking inclusion", `Prepared ${consumableRows[0].quantity} × ${consumableRows[0].item_name_snapshot}`, prepAt.at);
        last(prepAt);
        if (status === S.PREPARING && !force?.fullyPaid) continue;

        // Full payment and deposit before release (the Lambda requires both).
        const balanceAt = status === S.PREPARING ? t(prepAt.date, 9 * 60, 18 * 60)
            : t(eventDate < prepAt.date ? prepAt.date : eventDate, 7 * 60, 8 * 60, true);
        const balance = money2((agreed || 0) - paidSoFar);
        if (balance > 0) {
            await pay(V.PAYMENT_TYPE.BOOKING, balance, balanceAt, key("BOOK"));
            paidSoFar = agreed;
        }
        if (deposit > 0 && depositPaid === 0) {
            await pay(V.PAYMENT_TYPE.DEPOSIT, deposit, balanceAt, `BOOKPAY-${id}-S${keySeq}-DEP`);
            depositPaid = deposit;
        }
        if (balance > 0 || depositPaid > 0)
            log(b, managerId, "manager", "Recorded verified customer payment", `${b.booking_reference}: balance${depositPaid ? " and refundable deposit" : ""} received`, balanceAt.at);
        if (status === S.PREPARING) continue; // fully paid, waiting for the Staff hand-over

        // Release on the event day: consumables handed over (stock deducted), rentals checked out.
        const releaseAt = t(eventDate < balanceAt.date ? balanceAt.date : eventDate, 8 * 60 + 10, 10 * 60 + 20, true);
        if (consumableRows.length) {
            reserveEvents(releaseAt, "issue");
            for (const row of consumableRows) Object.assign(row, { item_status: V.ITEM_STATUS.RELEASED, used_quantity: row.quantity,
                prepared_at: row.prepared_at || prepAt.at, prepared_by: row.prepared_by || workerId,
                released_at: releaseAt.at, released_by: workerId, updated_at: releaseAt.at });
            log(b, workerId, "staff", "Released complete Sales booking inclusions",
                `Physically handed over ${consumableRows.length} Sales product lines; stock deducted from branch inventory.`, releaseAt.at);
        }
        for (const row of rentalRows) Object.assign(row, { item_status: V.ITEM_STATUS.RELEASED, released_at: releaseAt.at,
            released_by: workerId, updated_at: releaseAt.at });
        if (rentalRows.length) logRental(b, workerId, "Checked out rental equipment", `Released ${rentalRows.length} rental item(s) for ${b.booking_reference}`, releaseAt.at);
        last(releaseAt);

        if (!hasRentals) {
            // Consumable-only: the Lambda moves Released → Pending Settlement → Completed on hand-over.
            b.status = S.COMPLETED;
            b.settlement_status = V.SETTLEMENT.SETTLED;
            continue;
        }
        if (status === S.RELEASED) continue;

        // Rental return (Rentals module): next day after the rental period.
        const returnAt = t(addDays(endDate, 1), 9 * 60, 16 * 60);
        // Damage / missing units, limited so the branch never runs out of rentable stock.
        const incidents = [];
        const wantIncident = force && force.incident !== undefined ? force.incident : rng.chance(status === S.PENDING_SETTLEMENT ? 0.45 : 0.18);
        if (status !== S.RETURN_INSPECTION && wantIncident) {
            const row = rng.pick(rentalRows);
            const budgetKey = `${branch.id}:${row.equipment_id}`;
            const units = equipUnits.get(budgetKey);
            const left = incidentBudget.has(budgetKey) ? incidentBudget.get(budgetKey) : Math.max(1, Math.ceil(units * 0.1));
            const damaged = Math.min(left, row.quantity, rng.int(1, 2));
            const missing = damaged < left && rng.chance(0.3) && row.quantity > damaged ? 1 : 0;
            if (damaged + missing > 0) {
                incidentBudget.set(budgetKey, left - damaged - missing);
                incidents.push({ row, damaged, missing });
            }
        }
        for (const row of rentalRows) {
            const inc = incidents.find((i) => i.row === row);
            const missing = inc ? inc.missing : 0, damaged = inc ? inc.damaged : 0;
            Object.assign(row, { item_status: V.ITEM_STATUS.RETURNED, returned_quantity: row.quantity - missing,
                damaged_quantity: damaged, missing_quantity: missing, returned_at: returnAt.at, received_by: workerId,
                return_notes: inc ? `${damaged ? `${damaged} damaged` : ""}${damaged && missing ? ", " : ""}${missing ? `${missing} missing` : ""} on return.` : null,
                updated_at: returnAt.at });
        }
        logRental(b, workerId, "Received rental return", `Received rental equipment back for ${b.booking_reference}`, returnAt.at);
        last(returnAt);
        if (status === S.RETURN_INSPECTION) continue;

        const inspectAt = t(returnAt.date, returnAt.minute + 30, 18 * 60);
        setAll(rentalRows, { inspected_at: inspectAt.at, inspected_by: workerId, updated_at: inspectAt.at });
        // Inspection done: the line leaves the Staff "finalize return" list, like the Rental Lambda's inspection.
        for (const row of rentalRows) row.item_status = row.damaged_quantity > 0 ? V.ITEM_STATUS.DAMAGED : V.ITEM_STATUS.CLEARED;
        logRental(b, workerId, "Inspected rental return", `Inspection finished for ${b.booking_reference}${incidents.length ? " with incidents" : ""}`, inspectAt.at);
        last(inspectAt);

        const settled = status === S.COMPLETED;
        const settleAt = settled ? t(addDays(inspectAt.date, rng.int(0, 2)), 9 * 60, 18 * 60) : null;
        // Incidents become stock issues on the equipment row (damaged → repaired, missing → written off).
        for (const inc of incidents) {
            const invId = inventoryIndex.get(`${branch.id}:e:${inc.row.equipment_id}`);
            for (const [kind, qty] of [["damaged", inc.damaged], ["missing", inc.missing]]) {
                if (!qty) continue;
                const issueId = await ids.take("stock_issues");
                const resolveDay = kind === "damaged" ? addDays(inspectAt.date, rng.int(3, 10)) : settleAt?.date;
                const resolved = settled && resolveDay && (kind === "missing" ? resolveDay <= today : resolveDay < today);
                // Missing units are written off at the settlement itself; damaged units are repaired days later.
                const resolvedAt = !resolved ? null : kind === "missing" ? settleAt.at : dt(resolveDay, 15, rng.int(0, 59));
                const resolvedMinute = kind === "missing" ? settleAt?.minute : 15 * 60; // only used when resolved
                out.stockIssues.push({ id: issueId, store_id: store.id, branch_id: branch.id, branch_inventory_id: invId, booking_id: id,
                    issue_type: kind === "damaged" ? V.ISSUE_TYPE.DAMAGED : V.ISSUE_TYPE.MISSING, quantity: qty, quantity_resolved: resolved ? qty : 0,
                    reason: `${qty} unit(s) of ${inc.row.item_name_snapshot} ${kind} after ${b.booking_reference}.`,
                    status: resolved ? V.ISSUE_STATUS.RESOLVED : V.ISSUE_STATUS.OPEN,
                    estimated_completion_date: !resolved && kind === "damaged" ? addDays(today, rng.int(3, 10)) : null,
                    reported_by: workerId, approved_by: settled ? managerId : null, approved_at: settled ? settleAt.at : null,
                    resolved_by: resolved ? managerId : null, resolved_at: resolvedAt,
                    resolution_notes: resolved ? (kind === "damaged" ? "Repaired and returned to rental stock." : "Written off; customer charged in the booking settlement.") : null,
                    created_at: inspectAt.at, updated_at: resolvedAt || inspectAt.at });
                out.equipmentEvents.push({ date: inspectAt.date, at: inspectAt.at, minute: inspectAt.minute, branchId: branch.id,
                    equipmentId: inc.row.equipment_id, kind: "report", qty, issueId, actorId: workerId });
                if (resolved) out.equipmentEvents.push({ date: resolveDay, at: resolvedAt, minute: resolvedMinute, branchId: branch.id,
                    equipmentId: inc.row.equipment_id, kind: kind === "damaged" ? "repair" : "write_off", qty, issueId, actorId: managerId });
            }
        }
        if (!settled) continue; // Pending Settlement: the Manager settles it in the app.

        // Settlement by the Manager: one booking-wide charge, deposit applied first, the rest refunded.
        let charge = 0;
        for (const inc of incidents) {
            const cost = Number(inc.row._equipment.cost_price);
            charge += inc.damaged * cost * 0.25 + inc.missing * cost;
        }
        charge = incidents.length ? round50(charge) : 0;
        const applied = Math.min(deposit, charge);
        const extraCash = money2(charge - applied);
        const refund = money2(deposit - applied);
        if (incidents.length) {
            b.final_additional_charges = charge;
            b.deposit_applied_amount = applied;
            b.settlement_reviewed_by = managerId;
            b.settlement_reviewed_at = settleAt.at;
            b.settlement_notes = `Combined booking-wide charge for damaged/missing equipment: ₱${charge}.`;
            if (extraCash > 0) await pay(V.PAYMENT_TYPE.CHARGE, extraCash, settleAt, `RETURN-${id}-S1-CHG`);
        }
        if (refund > 0) {
            let remaining = refund;
            for (const p of out.payments.filter((x) => x.booking_id === id && x.payment_type === V.PAYMENT_TYPE.DEPOSIT)) {
                const take = Math.min(remaining, Number(p.amount));
                if (take <= 0) continue;
                out.refunds.push({ id: await ids.take("refunds"), store_id: store.id, payment_id: p.id, refund_type: V.REFUND.DEPOSIT,
                    amount: money2(take), refund_reason: `[RETURN-${id}] Security deposit refund after return inspection`,
                    refund_method: p.payment_method, status: V.REFUND.DONE, approved_by: managerId, processed_by: managerId,
                    processed_at: settleAt.at, created_at: settleAt.at });
                remaining = money2(remaining - take);
            }
            b.approved_refund_amount = refund;
        }
        if (deposit > 0 || incidents.length)
            log(b, managerId, "manager", "Settled security deposit / charges",
                `${b.booking_reference}: charge ₱${charge}, deposit applied ₱${applied}, refunded ₱${refund}`, settleAt.at, { requestKey: `RETURN-${id}` });
        b.settlement_status = V.SETTLEMENT.SETTLED;
        last(settleAt);
    }

    // Seeding-only fields must not reach the database.
    for (const row of out.bookingItems) { delete row._variant; delete row._equipment; }
    return out;
}

module.exports = { buildBookings };
