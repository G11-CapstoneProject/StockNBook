/* eslint-disable @typescript-eslint/no-require-imports */
/** customers (booking clients and some named POS buyers). */
const { CONFIG } = require("../lib/config");
const { addDays, diffDays, dt } = require("../lib/dates");
const { personName, phMobile } = require("../lib/random");

const AREAS = ["Quezon City", "Makati City", "Pasig City", "Taguig City", "Mandaluyong City", "Marikina City", "Manila",
    "Parañaque City", "Las Piñas City", "Muntinlupa City", "San Juan City", "Caloocan City", "Antipolo City"];

async function buildCustomers({ ctx, ids, rng }) {
    const { store, storeStart } = ctx;
    const customers = [];
    const span = Math.max(1, diffDays(storeStart, CONFIG.today));
    const usedPhones = new Set();
    for (let i = 0; i < ctx.customerCount; i += 1) {
        const name = personName(rng);
        let phone = phMobile(rng);
        while (usedPhones.has(phone)) phone = phMobile(rng);
        usedPhones.add(phone);
        const created = dt(addDays(storeStart, rng.int(0, span)), rng.int(8, 20), rng.int(0, 59));
        // A few customers are flagged for review (late cancellations). They stay unverified,
        // which the Bookings Lambda allows to be confirmed normally.
        const review = rng.chance(0.03);
        const slugName = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
        customers.push({ id: await ids.take("customers"), store_id: store.id, full_name: name, phone,
            email: rng.chance(0.6) ? `${slugName}${rng.int(1, 99)}@example.com` : null,
            facebook_name: rng.chance(0.5) ? name : null,
            address: rng.chance(0.45) ? `${rng.int(1, 999)} ${rng.pick(["Mabini", "Rizal", "Bonifacio", "Luna", "Del Pilar", "Quezon"])} St, ${rng.pick(AREAS)}` : null,
            review_required: review ? 1 : 0, identity_verified: !review && rng.chance(0.2) ? 1 : 0,
            review_reason: review ? "Two late cancellations in the past year. Confirm the event details by phone." : null,
            status: "active", created_at: created, updated_at: created });
    }
    return customers;
}

module.exports = { buildCustomers };
