/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * StockNBook v2 seeder: one command that fills all features with consistent test data.
 *
 *   node scripts/seed/run.js
 *
 * Fresh start (wipes the v2 database first):  node scripts/seed/reset-db.js --yes && node scripts/seed/run.js
 * See scripts/seed/README.md for options.
 */
const bcrypt = require("bcryptjs");
const { CONFIG } = require("./lib/config");
const { connect, insertMany, columnsOf, IdAllocator } = require("./lib/db");
const { createRng } = require("./lib/random");
const { addDays, addMonths } = require("./lib/dates");
const V = require("./lib/vocab");
const { seedPlans, seedPlatformAdmin } = require("./steps/platform");
const { buildStore } = require("./steps/stores");
const { buildCatalog, dbRow } = require("./steps/catalog");
const { buildPackages } = require("./steps/packages");
const { buildCustomers } = require("./steps/customers");
const { buildBookings } = require("./steps/bookings");
const { simulate } = require("./steps/simulation");
const { setupActions } = require("./steps/activity");
const { createDemandModel } = require("./lib/demand");
const { buildEvents } = require("./steps/events");
const { removeSeededStores } = require("./lib/seeded-stores");

const REQUIRED_TABLES = ["plans", "platform_admins", "stores", "branches", "users", "subscriptions", "subscription_payments",
    "categories", "products", "product_variants", "equipment", "branch_inventory", "customers", "packages", "package_items",
    "bookings", "booking_items", "orders", "order_items", "payments", "refunds", "inventory_movements", "stock_issues", "employee_actions", "store_events"];

function scenarioFor(tier, k) {
    if (CONFIG.sizeName === "full") return ["active", "expiring", "expired"][k % 3];
    return tier === "growth" ? "expiring" : "active";
}

async function main() {
    const started = Date.now();
    const db = await connect();
    // Use MySQL's own clock, the same one the Lambdas' NOW() uses, so seeded rows and rows the
    // app writes later stay in time order.
    const [[clock]] = await db.query(`SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS d, DATE_FORMAT(NOW(), '%H:%i') AS t`);
    if (!process.env.SEED_TODAY) {
        if (clock.d !== CONFIG.today)
            console.warn(`Note: MySQL's clock (${clock.d} ${clock.t}) is not on Philippine time (${CONFIG.today} ${CONFIG.nowTime}). Seeded dates follow MySQL, like the app's NOW().`);
        CONFIG.today = clock.d;
        CONFIG.nowTime = clock.t;
    }
    console.log(`Seeding ${CONFIG.db.database} on ${CONFIG.db.host}:${CONFIG.db.port}  (size: ${CONFIG.sizeName}, tag: ${CONFIG.runTag}, today: ${CONFIG.today})`);

    const [tables] = await db.query(`SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
    const have = new Set(tables.map((r) => r.t));
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t) && t !== "store_events");
    if (missing.length) throw new Error(`This database is missing v2 tables: ${missing.join(", ")}. Run reset-db.js first or check DB_NAME.`);

    // The seeder only adds rows; it never changes the database's tables.
    const hasEvents = have.has("store_events");
    if (!hasEvents) console.log("Note: no store_events table in this database, so the demo events are skipped (Forecasting → Events stays empty).");
    // Some copies of the schema also keep the plan on each user / store row (for example users.plan).
    const planCols = [];
    for (const table of ["users", "stores"]) if ((await columnsOf(db, table)).has("plan")) planCols.push(table);

    // Replace an older demo set (your own stores are never touched).
    const [existing] = await db.query(`SELECT COUNT(*) AS n FROM stores WHERE slug LIKE ?`, [`${CONFIG.slugPrefix}%`]);
    if (Number(existing[0].n) > 0) {
        console.log(`Replacing the existing demo stores (tag "${CONFIG.runTag}"):`);
        await removeSeededStores(db);
    }

    const passwordHash = await bcrypt.hash(CONFIG.password, 10);
    const plans = await seedPlans(db);
    const admin = await seedPlatformAdmin(db, passwordHash);
    const storeStart = addDays(addMonths(CONFIG.today, -CONFIG.historyMonths), -30);
    const tierCount = {};
    const logins = [];
    const totals = {};
    const add = (table, n) => { totals[table] = (totals[table] || 0) + n; };

    for (const [index, tier] of CONFIG.size.stores.entries()) {
        const k = tierCount[tier] = (tierCount[tier] ?? -1) + 1;
        const plan = plans[tier];
        const rng = createRng(`${CONFIG.runTag}:store:${index}`);
        const ids = new IdAllocator(db);
        const t0 = Date.now();
        await db.beginTransaction();
        try {
            const ctx = await buildStore({ ids, rng, index, tier, plan, scenario: scenarioFor(tier, k), passwordHash, admin, storeStart });
            const limit = (value, max) => (Number(max) > 0 ? Math.min(value, Number(max)) : value);
            Object.assign(ctx, {
                productCount: limit(CONFIG.size.products[tier], plan.max_inventory),
                equipmentCount: CONFIG.size.equipment[tier],
                customerCount: CONFIG.size.customers[tier],
                packagesPerBranch: CONFIG.size.packagesPerBranch[tier],
                ordersPerBranchDay: CONFIG.size.ordersPerBranchDay[tier],
                bookingsPerMonth: limit(CONFIG.size.bookingsPerMonth[tier], plan.max_bookings),
            });
            const userById = new Map(ctx.users.map((u) => [u.id, u]));
            ctx.userName = (id) => userById.get(id)?.full_name || "User";
            ctx.userRole = (id) => userById.get(id)?.role || "staff";
            ctx.userRoleLabel = (id) => V.ROLE_LABEL[ctx.userRole(id)] || "Staff";

            add("stores", await insertMany(db, "stores", [ctx.store]));
            add("branches", await insertMany(db, "branches", ctx.branches.map(dbRow).map(({ managerId, staffIds, workerIds, ...r }) => r)));
            add("users", await insertMany(db, "users", ctx.users));
            // Some copies of the schema also keep the plan on each user / store row (for example users.plan).
            for (const table of planCols)
                await db.query(table === "users" ? `UPDATE users SET plan = ? WHERE store_id = ?` : `UPDATE stores SET plan = ? WHERE id = ?`,
                    [tier, ctx.store.id]);
            add("subscriptions", await insertMany(db, "subscriptions", [ctx.subscription]));
            add("subscription_payments", await insertMany(db, "subscription_payments", ctx.subscriptionPayments));

            const catalog = await buildCatalog({ ctx, ids, rng });
            add("categories", await insertMany(db, "categories", catalog.categories));
            add("products", await insertMany(db, "products", catalog.products.map(dbRow)));
            add("product_variants", await insertMany(db, "product_variants", catalog.variants.map(dbRow)));
            add("equipment", await insertMany(db, "equipment", catalog.equipment.map(dbRow)));

            // Rentable units of each equipment item in each branch.
            const equipUnits = new Map();
            const inventoryIndex = new Map();
            for (const inv of catalog.inventory) {
                if (inv.equipment) {
                    const [lo, hi] = inv.equipment._units;
                    equipUnits.set(`${inv.branchId}:${inv.equipment.id}`, rng.int(lo, hi));
                    inventoryIndex.set(`${inv.branchId}:e:${inv.equipment.id}`, inv.id);
                } else inventoryIndex.set(`${inv.branchId}:v:${inv.variant.id}`, inv.id);
            }

            const { packages, packageItems } = await buildPackages({ ctx, catalog, ids, rng });
            const customers = await buildCustomers({ ctx, ids, rng });
            // One demand model per store: the same growth, seasons and branch sizes for POS sales and bookings.
            const demand = createDemandModel({ rng, start: addMonths(CONFIG.today, -CONFIG.historyMonths), today: CONFIG.today, branches: ctx.branches });
            const bookingOut = await buildBookings({ ctx, catalog, packages, customers, ids, rng, inventoryIndex, equipUnits, demand });
            const sim = await simulate({ ctx, catalog, bookingOut, customers, ids, rng, equipUnits, inventoryIndex, demand });
            const actions = [...setupActions({ ctx, catalog, packages }), ...bookingOut.actions, ...sim.actions]
                .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

            // Insert in foreign-key order.
            add("branch_inventory", await insertMany(db, "branch_inventory", sim.inventory));
            add("packages", await insertMany(db, "packages", packages.map(dbRow)));
            add("package_items", await insertMany(db, "package_items", packageItems));
            add("customers", await insertMany(db, "customers", customers));
            add("bookings", await insertMany(db, "bookings", bookingOut.bookings));
            add("booking_items", await insertMany(db, "booking_items", bookingOut.bookingItems));
            add("orders", await insertMany(db, "orders", sim.orders));
            add("order_items", await insertMany(db, "order_items", sim.orderItems));
            add("payments", await insertMany(db, "payments", [...bookingOut.payments, ...sim.payments]));
            add("refunds", await insertMany(db, "refunds", bookingOut.refunds));
            add("inventory_movements", await insertMany(db, "inventory_movements", sim.movements));
            add("stock_issues", await insertMany(db, "stock_issues", [...bookingOut.stockIssues, ...sim.stockIssues]));
            add("employee_actions", await insertMany(db, "employee_actions", actions));
            if (hasEvents) add("store_events", await insertMany(db, "store_events", await buildEvents({ ctx, ids, rng })));
            await db.commit();

            console.log(`  ✔ ${ctx.store.store_name} [${tier}, ${ctx.subscription.status}] ${ctx.branches.length} branch(es), ` +
                `${catalog.products.length} products, ${bookingOut.bookings.length} bookings, ${sim.orders.length} POS orders  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
            logins.push({ store: ctx.store.store_name, plan: tier, slug: ctx.store.slug,
                users: ctx.users.map((u) => `${u.role.padEnd(7)} ${u.email}`) });
        } catch (error) {
            await db.rollback();
            throw error;
        }
    }

    console.log(`\nRows added:`);
    for (const [table, n] of Object.entries(totals)) console.log(`  ${table.padEnd(24)} ${n.toLocaleString()}`);
    console.log(`\nLogins (password for all: ${CONFIG.password})`);
    console.log(`  platform admin  ${admin.email}`);
    for (const s of logins) {
        console.log(`  ${s.store} (${s.plan})  booking page slug: ${s.slug}`);
        for (const u of s.users) console.log(`    ${u}`);
    }
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Check it with: node scripts/seed/verify.js`);
    await db.end();
}

main().catch((error) => {
    console.error("\nSeeding failed:", error.message);
    if (process.env.SEED_DEBUG) console.error(error);
    process.exit(1);
});
