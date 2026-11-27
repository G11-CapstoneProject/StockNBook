/* eslint-disable @typescript-eslint/no-require-imports */
/** packages and package_items (per branch, built only from that store's catalog). */
const V = require("../lib/vocab");
const { dt, addDays } = require("../lib/dates");

const PACKAGE_TEMPLATES = [
    ["Basic Birthday Package", "Birthday", "4 hours"], ["Kiddie Party Package", "Birthday", "5 hours"],
    ["Debut Elegance Package", "Debut", "6 hours"], ["Wedding Reception Package", "Wedding", "1 day"],
    ["Christening Celebration Package", "Christening", "4 hours"], ["Corporate Event Package", "Corporate", "1 day"],
    ["Baby Shower Package", "Baby Shower", "4 hours"], ["Graduation Party Package", "Graduation", "5 hours"],
];

const round100 = (n) => Math.round(n / 100) * 100;

async function buildPackages({ ctx, catalog, ids, rng }) {
    const { store, branches, storeStart } = ctx;
    const bookable = catalog.variants.filter((v) => v._product._bookable);
    const rentable = catalog.equipment;
    const packages = [], packageItems = [];
    let seq = 0;
    for (const branch of branches) {
        const count = ctx.packagesPerBranch;
        const templates = rng.sample(PACKAGE_TEMPLATES, count);
        for (let p = 0; p < templates.length; p += 1) {
            const [name, category, duration] = templates[p];
            seq += 1;
            const id = await ids.take("packages");
            const created = dt(addDays(storeStart, 2 + p), 14, rng.int(0, 59));
            // Consumables: distinct products, one variant each.
            const lines = [];
            const usedProducts = new Set();
            for (const v of rng.sample(bookable, 30)) {
                if (lines.filter((l) => l.kind === "consumable").length >= rng.int(4, 7)) break;
                if (usedProducts.has(v._product.id)) continue;
                usedProducts.add(v._product.id);
                lines.push({ kind: "consumable", v, quantity: rng.int(1, 6) });
            }
            if (rentable.length && rng.chance(0.6)) {
                for (const e of rng.sample(rentable, rng.int(1, 3))) {
                    const big = e._units[1] >= 60;
                    lines.push({ kind: "rental", e, quantity: big ? rng.int(10, 30) : rng.int(1, 3) });
                }
            }
            const value = lines.reduce((s, l) => s + l.quantity * Number(l.kind === "consumable" ? l.v.selling_price : l.e.rental_rate_per_day), 0);
            const discountType = rng.weighted([[V.DISCOUNT_TYPE.PERCENT, 5], [V.DISCOUNT_TYPE.FIXED, 2], [null, 3]]);
            const discountValue = discountType === V.DISCOUNT_TYPE.PERCENT ? rng.pick([5, 10, 15])
                : discountType === V.DISCOUNT_TYPE.FIXED ? rng.pick([200, 300, 500]) : 0;
            const discounted = discountType === V.DISCOUNT_TYPE.PERCENT ? value * (1 - discountValue / 100)
                : value - discountValue;
            const price = Math.max(500, round100(discounted));
            const pkg = { id, store_id: store.id, branch_id: branch.id,
                package_code: `${store.store_code}-${branch.branch_code}-PKG-${String(seq).padStart(3, "0")}`,
                package_name: name, description: `${name} with decorations, party supplies${lines.some((l) => l.kind === "rental") ? " and rental equipment" : ""}.`,
                category, discount_type: discountType, discount_value: discountValue, package_price: price,
                down_payment_amount: round100(price * 0.3), duration, cover_image_url: null,
                // The last package of the last branch is inactive, to test filters. Bookings never use it.
                status: branch === branches[branches.length - 1] && p === templates.length - 1 && templates.length > 1 ? "inactive" : "active",
                updated_by: branch.managerId, created_at: created, updated_at: created,
                _lines: lines, _branch: branch };
            packages.push(pkg);
            let sort = 0;
            for (const line of lines) {
                sort += 1;
                packageItems.push({ id: await ids.take("package_items"), store_id: store.id, package_id: id,
                    variant_id: line.kind === "consumable" ? line.v.id : null, equipment_id: line.kind === "rental" ? line.e.id : null,
                    item_type: line.kind === "consumable" ? V.PACKAGE_ITEM.CONSUMABLE : V.PACKAGE_ITEM.RENTAL,
                    quantity: line.quantity,
                    unit_price_snapshot: line.kind === "consumable" ? line.v.selling_price : line.e.rental_rate_per_day,
                    sort_order: sort, created_at: created });
            }
        }
    }
    return { packages, packageItems };
}

module.exports = { buildPackages };
