
/* eslint-disable @typescript-eslint/no-require-imports */
/*
  StockNBook defense demo data.
  Recreates ONLY the Demo Party Store with realistic Inventory, Packages,
  Bookings, POS, Analytics, Forecasting, Reports, and Subscription data.
*/
require("dotenv").config({ path: ".env.local" });

const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const { faker } = require("@faker-js/faker");

const DEMO_STORE_EMAIL = "demo.owner@stocknbook.com";
const DEMO_STORE_SLUG = "demo-party-store";
const DEMO_PASSWORD = "Demo12345";

const TARGET_PRODUCTS = 120;
const TARGET_PACKAGES = 15;
const TARGET_BOOKINGS = 120;
const CURRENT_YEAR_ORDERS = 360;
const BASELINE_ORDERS = 240;

const BRANCHES = [
    {
        name: "Main Branch",
        address: "Quezon City",
        contact: "09170000001",
        manager: "Ana Cruz",
        email: "demo.manager1@stocknbook.com",
    },
    {
        name: "North Branch",
        address: "Caloocan City",
        contact: "09170000002",
        manager: "Ben Santos",
        email: "demo.manager2@stocknbook.com",
    },
    {
        name: "South Branch",
        address: "Parañaque City",
        contact: "09170000003",
        manager: "Carla Reyes",
        email: "demo.manager3@stocknbook.com",
    },
];

const CATEGORIES = [
    "Balloons",
    "Backdrops",
    "Tables",
    "Chairs",
    "Lights",
    "Flowers",
    "Tableware",
    "Party Favors",
    "Audio",
    "Decorations",
    "Tents",
    "Catering Tools",
];

const PRODUCT_NAMES = [
    "Latex Balloon Set",
    "Foil Balloon Number",
    "Balloon Arch Kit",
    "Round Table",
    "Rectangular Table",
    "Tiffany Chair",
    "Monoblock Chair",
    "Fairy Lights",
    "LED Par Light",
    "Flower Stand",
    "Artificial Roses",
    "Dessert Stand",
    "Cake Stand",
    "Backdrop Frame",
    "Curtain Backdrop",
    "Table Runner",
    "Table Cloth",
    "Party Hat Set",
    "Loot Bag Set",
    "Speaker Set",
    "Microphone",
    "Tent 10x10",
    "Tent 20x20",
    "Serving Tray",
    "Chafing Dish",
    "Welcome Sign",
    "Acrylic Name Sign",
    "Balloon Pump",
    "Confetti Popper",
    "Centerpiece Set",
];

const EVENT_TYPES = [
    "Birthday",
    "Wedding",
    "Debut",
    "Christening",
    "Corporate Event",
    "Anniversary",
    "Graduation",
    "Baby Shower",
];

const THEMES = [
    "Elegant Gold",
    "Pastel Pink",
    "Rustic Garden",
    "Modern Minimalist",
    "Royal Blue",
    "Tropical Summer",
];

const VENUES = [
    "Quezon City Event Venue",
    "Makati Function Hall",
    "Pasig Garden Pavilion",
    "Taguig Events Center",
    "Parañaque Community Hall",
];

/* Lower demand in January and rainy months; high demand in graduation and holiday months. */
const MONTH_FACTOR = {
    1: 0.55,
    2: 0.75,
    3: 0.95,
    4: 1.35,
    5: 1.55,
    6: 1.1,
    7: 0.7,
    8: 0.62,
    9: 0.72,
    10: 0.95,
    11: 1.2,
    12: 1.6,
};

/* Monday is quiet; Friday to Sunday is busier. */
const DAY_FACTOR = {
    0: 1.45,
    1: 0.55,
    2: 0.68,
    3: 0.85,
    4: 0.95,
    5: 1.12,
    6: 1.35,
};

function dbConfig() {
    const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
    const missing = required.filter(
        (key) => !String(process.env[key] || "").trim()
    );

    if (missing.length) {
        throw new Error(`Missing ${missing.join(", ")} in .env.local.`);
    }

    return {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 3306),
        ssl:
            String(process.env.DB_SSL || "").toLowerCase() === "true"
                ? { rejectUnauthorized: false }
                : undefined,
    };
}

function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function pick(list, index) {
    return list[Math.abs(Number(index) || 0) % list.length];
}

function chance(seed) {
    const value =
        Math.sin(Number(seed) * 12.9898 + 78.233) * 43758.5453;

    return value - Math.floor(value);
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function todayUtc() {
    const today = new Date();

    return new Date(
        Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate()
        )
    );
}

function futureDate(days) {
    return isoDate(addDays(todayUtc(), days));
}

function pastDate(days) {
    return isoDate(addDays(todayUtc(), -days));
}

function completeMonthPeriods() {
    const today = todayUtc();

    const lastCompleteMonthEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)
    );

    const currentStart = new Date(
        Date.UTC(
            lastCompleteMonthEnd.getUTCFullYear(),
            lastCompleteMonthEnd.getUTCMonth() - 11,
            1
        )
    );

    const baselineStart = new Date(
        Date.UTC(
            currentStart.getUTCFullYear() - 1,
            currentStart.getUTCMonth(),
            1
        )
    );

    const baselineEnd = addDays(currentStart, -1);

    return {
        currentStart,
        currentEnd: lastCompleteMonthEnd,
        baselineStart,
        baselineEnd,
    };
}

function weekendDate(startOffset) {
    for (let offset = 0; offset < 14; offset += 1) {
        const date = addDays(todayUtc(), startOffset + offset);
        const weekday = date.getUTCDay();

        if (weekday === 0 || weekday === 6) {
            return isoDate(date);
        }
    }

    return futureDate(startOffset);
}

async function tableHasColumn(db, table, column) {
    const [rows] = await db.execute(
        `SELECT 1
FROM information_schema.columns
WHERE table_schema = DATABASE()
AND table_name = ?
    AND column_name = ?
        LIMIT 1`,
        [table, column]
    );

    return rows.length > 0;
}

async function deleteByStoreId(db, table, storeId) {
    if (await tableHasColumn(db, table, "store_id")) {
        await db.execute(
            `DELETE FROM \`${table}\` WHERE store_id = ?`,
    [storeId]
);
}
}

async function deleteBySubscriptionId(db, table, storeId) {
    if (await tableHasColumn(db, table, "subscription_id")) {
        await db.execute(
            `DELETE FROM \`${table}\`
             WHERE subscription_id IN (
                SELECT id FROM subscriptions WHERE store_id = ?
             )`,
            [storeId]
        );
    }
}

async function resetOldDemoStore(db) {
    const [stores] = await db.execute(
        `SELECT id
         FROM stores
         WHERE email = ? OR slug = ?
         ORDER BY id DESC
         LIMIT 1`,
        [DEMO_STORE_EMAIL, DEMO_STORE_SLUG]
    );

    if (!stores.length) {
        return;
    }

    const storeId = Number(stores[0].id);

    console.log(
        `Removing existing Demo Party Store data (store_id=${storeId})...`
    );

    await db.execute(
        `DELETE FROM order_items
         WHERE order_id IN (
            SELECT order_id FROM orders WHERE store_id = ?
         )`,
        [storeId]
    );

    if (await tableHasColumn(db, "booking_items", "booking_id")) {
        await db.execute(
            `DELETE FROM booking_items
             WHERE booking_id IN (
                SELECT id FROM bookings WHERE store_id = ?
             )`,
            [storeId]
        );
    }

    for (const table of [
        "payment_submissions",
        "business_subscriptions",
        "subscription_audit_logs",
    ]) {
        await deleteBySubscriptionId(db, table, storeId);
        await deleteByStoreId(db, table, storeId);
    }

    await deleteByStoreId(db, "subscriptions", storeId);

    await db.execute("DELETE FROM orders WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM bookings WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM packages WHERE store_id = ?", [storeId]);

    await db.execute(
        `DELETE FROM product_variants
         WHERE product_id IN (
            SELECT id FROM products WHERE store_id = ?
         )`,
        [storeId]
    );

    await db.execute("DELETE FROM products WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM categories WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM staff WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM managers WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM branches WHERE store_id = ?", [storeId]);
    await db.execute("DELETE FROM stores WHERE id = ?", [storeId]);
}

async function createStoreBranchesAndUsers(db, passwordHash) {
    const [storeResult] = await db.execute(
        `INSERT INTO stores
         (store_name, owner_name, email, password, slug)
         VALUES (?, ?, ?, ?, ?)`,
        [
            "Demo Party Store",
            "Demo Owner",
            DEMO_STORE_EMAIL,
            passwordHash,
            DEMO_STORE_SLUG,
        ]
    );

    const storeId = Number(storeResult.insertId);
    const branches = [];

    for (let index = 0; index < BRANCHES.length; index += 1) {
        const source = BRANCHES[index];

        const [branchResult] = await db.execute(
            `INSERT INTO branches
             (store_id, branch_name, contact_number, address)
             VALUES (?, ?, ?, ?)`,
            [storeId, source.name, source.contact, source.address]
        );

        const branchId = Number(branchResult.insertId);

        const managerPermissions = {
            dashboard: true,
            bookings: true,
            packages: true,
            packages_manage: true,
            inventory: true,
            pos: true,
            reports: true,
            staff_management: index === 0,
            staff_roles: index === 0,
            branch_settings: index === 0,
        };

        const [managerResult] = await db.execute(
            `INSERT INTO managers
             (
                store_id,
                branch_id,
                manager_name,
                manager_email,
                password,
                status,
                permissions
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branchId,
                source.manager,
                source.email,
                passwordHash,
                "active",
                JSON.stringify(managerPermissions),
            ]
        );

        const managerId = Number(managerResult.insertId);

        const staffSets = [
            {
                label: "Bookings Staff",
                permissions: {
                    dashboard: true,
                    bookings: true,
                    packages: false,
                    packages_manage: false,
                    inventory: false,
                    pos: false,
                    reports: false,
                    staff_management: false,
                    staff_roles: false,
                    branch_settings: false,
                },
            },
            {
                label: "Inventory and POS Staff",
                permissions: {
                    dashboard: true,
                    bookings: false,
                    packages: false,
                    packages_manage: false,
                    inventory: true,
                    pos: true,
                    reports: false,
                    staff_management: false,
                    staff_roles: false,
                    branch_settings: false,
                },
            },
            {
                label: "Packages Staff",
                permissions: {
                    dashboard: true,
                    bookings: false,
                    packages: true,
                    packages_manage: false,
                    inventory: false,
                    pos: false,
                    reports: false,
                    staff_management: false,
                    staff_roles: false,
                    branch_settings: false,
                },
            },
        ];

        for (
            let staffIndex = 0;
            staffIndex < staffSets.length;
            staffIndex += 1
        ) {
            const staff = staffSets[staffIndex];

            await db.execute(
                `INSERT INTO staff
                 (
                    store_id,
                    branch_id,
                    manager_id,
                    staff_name,
                    staff_email,
                    password,
                    status,
                    permissions
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    managerId,
                    `${source.name} ${staff.label}`,
                    `demo.staff${index + 1}-${staffIndex + 1}@stocknbook.com`,
                    passwordHash,
                    "active",
                    JSON.stringify(staff.permissions),
                ]
            );
        }

        branches.push({
            id: branchId,
            name: source.name,
        });
    }

    return { storeId, branches };
}

async function createCategories(db, storeId) {
    for (const category of CATEGORIES) {
        await db.execute(
            `INSERT INTO categories
             (store_id, category_name, description, status)
             VALUES (?, ?, ?, ?)`,
            [
                storeId,
                category,
                `Demo category for ${category.toLowerCase()} items.`,
                "active",
            ]
        );
    }
}

function productStock(index, hasVariants) {
    if (hasVariants) {
        if (index <= 6) return 0;
        if (index <= 15) return 5 + (index % 4);

        return 55 + ((index * 9) % 95);
    }

    if (index <= 40) return 0;
    if (index <= 60) return 4 + (index % 5);

    return 45 + ((index * 13) % 125);
}

async function createProducts(db, storeId, branches) {
    const products = [];
    const saleItems = [];

    for (let index = 1; index <= TARGET_PRODUCTS; index += 1) {
        const branch = pick(branches, index - 1);
        const hasVariants = index <= 30;
        const alertLevel = 8 + (index % 10);
        const originalPrice = 100 + ((index * 47) % 2800);
        const salesPrice = originalPrice + 80 + ((index * 29) % 1200);
        const name = `${pick(PRODUCT_NAMES, index - 1)} ${index}`;

        const [result] = await db.execute(
            `INSERT INTO products
             (
                store_id,
                branch_id,
                name,
                category,
                stock,
                alert_level,
                original_price,
                sales_price,
                has_variants
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branch.id,
                name,
                pick(CATEGORIES, index - 1),
                productStock(index, hasVariants),
                alertLevel,
                originalPrice,
                salesPrice,
                hasVariants ? 1 : 0,
            ]
        );

        const product = {
            id: Number(result.insertId),
            branchId: branch.id,
            branchName: branch.name,
            name,
            category: pick(CATEGORIES, index - 1),
            salesPrice,
        };

        products.push(product);

        if (!hasVariants) {
            saleItems.push({
                productId: product.id,
                variantId: null,
                branchId: branch.id,
                productName: name,
                variantLabel: "",
                unitPrice: salesPrice,
            });

            continue;
        }

        const variants = [
            {
                color: pick(
                    ["Gold", "Silver", "Pink", "Blue", "White"],
                    index
                ),
                size: "Small",
            },
            {
                color: pick(
                    ["Gold", "Silver", "Pink", "Blue", "White"],
                    index + 1
                ),
                size: "Large",
            },
        ];

        for (
            let variantIndex = 0;
            variantIndex < variants.length;
            variantIndex += 1
        ) {
            const values = variants[variantIndex];

            const variantStock =
                index <= 6
                    ? 0
                    : index <= 15
                        ? 4 + ((index + variantIndex) % 4)
                        : 30 + ((index * 7 + variantIndex * 13) % 65);

            const variantPrice = salesPrice + variantIndex * 120;

            const [variantResult] = await db.execute(
                `INSERT INTO product_variants
                 (
                    product_id,
                    variant_values,
                    stock,
                    alert_level,
                    original_price,
                    sales_price
                 )
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    product.id,
                    JSON.stringify(values),
                    variantStock,
                    Math.max(3, Math.floor(alertLevel / 2)),
                    originalPrice,
                    variantPrice,
                ]
            );

            saleItems.push({
                productId: product.id,
                variantId: Number(variantResult.insertId),
                branchId: branch.id,
                productName: name,
                variantLabel: `${values.color} / ${values.size}`,
                unitPrice: variantPrice,
            });
        }
    }

    return { products, saleItems };
}

function itemsForBranch(saleItems, branchId) {
    return saleItems.filter((item) => item.branchId === branchId);
}

function packageInclusions(saleItems, branchId, index) {
    const choices = itemsForBranch(saleItems, branchId);

    return [0, 4, 9, 14].map((offset, position) => {
        const item = pick(choices, index + offset);

        return {
            item: `${item.productName}${
                item.variantLabel ? ` (${item.variantLabel})` : ""
            }`,
            productId: item.productId,
            product_id: item.productId,
            ...(item.variantId
                ? {
                    variantId: item.variantId,
                    variant_id: item.variantId,
                }
                : {}),
            quantity: 1 + ((index + position) % 4),
        };
    });
}

async function createPackages(db, storeId, branches, saleItems) {
    const packages = [];

    for (let index = 1; index <= TARGET_PACKAGES; index += 1) {
        const branch = pick(branches, index - 1);
        const name = `${pick(EVENT_TYPES, index - 1)} Package ${index}`;
        const packagePrice = 3500 + ((index * 1300) % 22000);
        const originalValue = packagePrice + 1500 + ((index * 400) % 3500);

        const inclusions = packageInclusions(
            saleItems,
            branch.id,
            index
        );

        const [result] = await db.execute(
            `INSERT INTO packages
             (
                store_id,
                branch_id,
                name,
                description,
                original_value,
                discount_type,
                discount_value,
                package_price,
                duration,
                status,
                inclusions
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branch.id,
                name,
                `Demo ${name.toLowerCase()} for event clients.`,
                originalValue,
                "amount",
                originalValue - packagePrice,
                packagePrice,
                "1 day",
                "Active",
                JSON.stringify(inclusions),
            ]
        );

        packages.push({
            id: Number(result.insertId),
            branchId: branch.id,
            name,
            price: packagePrice,
            inclusions,
        });
    }

    return packages;
}

function bookingPlan(index) {
    if (index <= 55) {
        return {
            status: "completed",
            date: pastDate(20 + ((index * 13) % 330)),
        };
    }

    if (index <= 70) {
        return {
            status: "cancelled",
            date: pastDate(10 + ((index * 17) % 300)),
        };
    }

    if (index <= 85) {
        return {
            status: "confirmed",
            date: weekendDate(2 + ((index * 2) % 25)),
        };
    }

    if (index <= 95) {
        return {
            status: "preparing",
            date: weekendDate(1 + ((index * 2) % 20)),
        };
    }

    return {
        status: "pending",
        date: weekendDate(35 + ((index * 3) % 70)),
    };
}

function packageForBranch(packages, branchId, index) {
    const choices = packages.filter(
        (item) => item.branchId === branchId
    );

    return choices.length ? pick(choices, index) : pick(packages, index);
}

async function createBookings(db, storeId, branches, packages) {
    for (let index = 1; index <= TARGET_BOOKINGS; index += 1) {
        const branch = pick(branches, index - 1);
        const pack = packageForBranch(packages, branch.id, index);
        const plan = bookingPlan(index);

        const bookingType = index % 4 === 0 ? "custom" : "package";

        const agreedPrice =
            bookingType === "custom"
                ? pack.price + 500 + ((index * 137) % 3000)
                : pack.price;

        const paymentStatus =
            plan.status === "completed"
                ? "paid"
                : plan.status === "cancelled"
                    ? "unpaid"
                    : index % 2 === 0
                        ? "partial"
                        : "unpaid";

        const amountPaid =
            paymentStatus === "paid"
                ? agreedPrice
                : paymentStatus === "partial"
                    ? Math.round(agreedPrice * 0.5 * 100) / 100
                    : 0;

        const customer = faker.person.fullName();

        const packageJson = JSON.stringify({
            id: pack.id,
            packageId: pack.id,
            name: pack.name,
            price: pack.price,
            inclusions: pack.inclusions,
        });

        await db.execute(
            `INSERT INTO bookings
             (
                store_id,
                branch_id,
                booking_type,
                name,
                phone,
                event_date,
                event_type,
                package_name,
                custom_order,
                notes,
                status,
                booking_reference,
                package_json,
                packageJSON,
                facebook_name,
                email,
                event_time,
                theme,
                venue,
                agreed_price,
                package_price,
                payment_status,
                required_down_payment,
                amount_paid,
                balance
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branch.id,
                bookingType,
                customer,
                faker.phone.number("09#########"),
                plan.date,
                pick(EVENT_TYPES, index - 1),
                pack.name,
                bookingType === "custom"
                    ? "Custom balloon and backdrop arrangement"
                    : null,
                `Demo ${plan.status} booking for forecasting.`,
                plan.status,
                `BKG-DEMO-${String(index).padStart(5, "0")}`,
                packageJson,
                packageJson,
                customer,
                faker.internet
                    .email({
                        firstName: customer.split(" ")[0],
                    })
                    .toLowerCase(),
                pick(
                    ["9:00 AM", "1:00 PM", "3:00 PM", "6:00 PM"],
                    index - 1
                ),
                pick(THEMES, index - 1),
                pick(VENUES, index - 1),
                agreedPrice,
                pack.price,
                paymentStatus,
                plan.status === "cancelled"
                    ? 0
                    : Math.round(agreedPrice * 0.5 * 100) / 100,
                amountPaid,
                Math.max(0, agreedPrice - amountPaid),
            ]
        );
    }
}

function buildOrderSchedule(startDate, endDate, target, multiplier) {
    const days = [];
    let cursor = new Date(startDate.getTime());

    while (cursor <= endDate) {
        const monthFactor = MONTH_FACTOR[cursor.getUTCMonth() + 1];
        const dayFactor = DAY_FACTOR[cursor.getUTCDay()];

        const noise = chance(
            cursor.getUTCFullYear() * 1000 +
            cursor.getUTCMonth() * 31 +
            cursor.getUTCDate()
        );

        let orderCount = Math.floor(
            0.75 * monthFactor * dayFactor * multiplier +
            noise * 1.35
        );

        if (noise < 0.08 && monthFactor < 1) {
            orderCount = 0;
        }

        days.push({
            date: isoDate(cursor),
            orderCount: Math.max(0, Math.min(4, orderCount)),
            score: monthFactor * dayFactor + noise,
            demandFactor: monthFactor * dayFactor,
        });

        cursor = addDays(cursor, 1);
    }

    let count = days.reduce((total, day) => total + day.orderCount, 0);

    const high = [...days].sort((a, b) => b.score - a.score);

    const low = [...days]
        .filter((day) => day.orderCount > 0)
        .sort((a, b) => a.score - b.score);

    let index = 0;

    while (count < target) {
        const day = high[index % high.length];

        if (day.orderCount < 4) {
            day.orderCount += 1;
            count += 1;
        }

        index += 1;
    }

    index = 0;

    while (count > target && low.length) {
        const day = low[index % low.length];

        if (day.orderCount > 0) {
            day.orderCount -= 1;
            count -= 1;
        }

        index += 1;
    }

    return days;
}

function saleLines(
    saleItems,
    branchId,
    orderIndex,
    demandFactor,
    quantityMultiplier
) {
    const choices = itemsForBranch(saleItems, branchId);

    const featured = choices.slice(0, Math.min(8, choices.length));

    const other = choices.slice(
        Math.min(8, choices.length),
        Math.min(25, choices.length)
    );

    const first = pick(
        featured.length ? featured : choices,
        orderIndex
    );

    const second = pick(
        other.length ? other : choices,
        orderIndex * 3 + 7
    );

    const peakBoost =
        demandFactor >= 1.4
            ? 2
            : demandFactor >= 1.05
                ? 1
                : 0;

    return [
        {
            ...first,
            quantity: Math.max(
                1,
                Math.round(
                    (2 + (orderIndex % 3) + peakBoost) *
                    quantityMultiplier
                )
            ),
        },
        {
            ...second,
            quantity: Math.max(
                1,
                Math.round(
                    (1 +
                        ((orderIndex + 1) % 3) +
                        (demandFactor >= 1.25 && orderIndex % 2 === 0
                            ? 1
                            : 0)) *
                    quantityMultiplier
                )
            ),
        },
    ];
}

function saleBranch(branches, index) {
    const roll = chance(index * 41 + 7);

    if (branches.length < 3) {
        return pick(branches, index);
    }

    return roll < 0.48
        ? branches[0]
        : roll < 0.77
            ? branches[2]
            : branches[1];
}

async function insertOrders(
    db,
    {
        storeId,
        branches,
        saleItems,
        schedule,
        prefix,
        startIndex,
        quantityMultiplier,
    }
) {
    let index = startIndex;

    for (const day of schedule) {
        for (let number = 0; number < day.orderCount; number += 1) {
            index += 1;

            const branch = saleBranch(branches, index);

            const lines = saleLines(
                saleItems,
                branch.id,
                index,
                day.demandFactor,
                quantityMultiplier
            );

            const total = lines.reduce(
                (sum, line) => sum + line.unitPrice * line.quantity,
                0
            );

            const orderId = `${prefix}-${String(index).padStart(5, "0")}`;

            await db.execute(
                `INSERT INTO orders
                 (
                     order_id,
                     store_id,
                     branch_id,
                     customer_name,
                     item,
                     total,
                     order_date
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    storeId,
                    branch.id,
                    `Customer ${index}`,
                    lines
                        .map(
                            (line) =>
                                `${line.productName} x${line.quantity}`
                        )
                        .join(", "),
                    total,
                    day.date,
                ]
            );

            for (const line of lines) {
                await db.execute(
                    `INSERT INTO order_items
                     (
                        order_id,
                        product_id,
                        variant_id,
                        product_name,
                        quantity,
                        unit_price
                     )
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        orderId,
                        line.productId,
                        line.variantId,
                        line.productName,
                        line.quantity,
                        line.unitPrice,
                    ]
                );
            }
        }
    }

    return index;
}

async function createOrders(db, storeId, branches, saleItems) {
    const period = completeMonthPeriods();

    const baseline = buildOrderSchedule(
        period.baselineStart,
        period.baselineEnd,
        BASELINE_ORDERS,
        0.82
    );

    const current = buildOrderSchedule(
        period.currentStart,
        period.currentEnd,
        CURRENT_YEAR_ORDERS,
        1
    );

    const lastIndex = await insertOrders(db, {
        storeId,
        branches,
        saleItems,
        schedule: baseline,
        prefix: "POS-DEMO-B",
        startIndex: 0,
        quantityMultiplier: 0.82,
    });

    await insertOrders(db, {
        storeId,
        branches,
        saleItems,
        schedule: current,
        prefix: "POS-DEMO-C",
        startIndex: lastIndex,
        quantityMultiplier: 1,
    });
}

const PLANS = [
    {
        code: "starter",
        name: "Starter",
        label: "Free",
        price: 0,
        inventoryLimit: 50,
        bookingLimit: 20,
        staffLimit: 1,
    },
    {
        code: "business",
        name: "Business",
        label: "Standard",
        price: 499,
        inventoryLimit: 500,
        bookingLimit: null,
        staffLimit: 3,
    },
    {
        code: "enterprise",
        name: "Enterprise",
        label: "Advanced",
        price: 1299,
        inventoryLimit: 2000,
        bookingLimit: null,
        staffLimit: 10,
    },
];

async function createSubscriptions(db, storeId) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            plan_code VARCHAR(30) NOT NULL UNIQUE,
            plan_name VARCHAR(50) NOT NULL,
            plan_label VARCHAR(50) NOT NULL,
            monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            inventory_limit INT NULL,
            booking_limit INT NULL,
            staff_limit INT NOT NULL DEFAULT 1,
            features JSON NULL,
            is_active TINYINT NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            store_id INT NOT NULL,
            plan_id INT NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending_verification',
            amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',
            payment_reference VARCHAR(100) NULL,
            payment_date DATE NULL,
            proof_path VARCHAR(500) NULL,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at DATETIME NULL,
            starts_at DATE NULL,
            ends_at DATE NULL,
            admin_notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    for (const plan of PLANS) {
        const features = JSON.stringify([
            "Inventory",
            "Bookings",
            "POS",
            "Analytics",
            "Reports",
            "Forecasting",
        ]);

        const [existing] = await db.execute(
            `SELECT id
             FROM subscription_plans
             WHERE plan_code = ?
             LIMIT 1`,
            [plan.code]
        );

        if (existing.length) {
            await db.execute(
                `UPDATE subscription_plans
                 SET
                    plan_name = ?,
                    plan_label = ?,
                    monthly_price = ?,
                    inventory_limit = ?,
                    booking_limit = ?,
                    staff_limit = ?,
                    features = ?,
                    is_active = 1
                 WHERE plan_code = ?`,
                [
                    plan.name,
                    plan.label,
                    plan.price,
                    plan.inventoryLimit,
                    plan.bookingLimit,
                    plan.staffLimit,
                    features,
                    plan.code,
                ]
            );
        } else {
            await db.execute(
                `INSERT INTO subscription_plans
                 (
                    plan_code,
                    plan_name,
                    plan_label,
                    monthly_price,
                    inventory_limit,
                    booking_limit,
                    staff_limit,
                    features,
                    is_active
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [
                    plan.code,
                    plan.name,
                    plan.label,
                    plan.price,
                    plan.inventoryLimit,
                    plan.bookingLimit,
                    plan.staffLimit,
                    features,
                ]
            );
        }
    }

    const [planRows] = await db.execute(
        `SELECT id, plan_code, monthly_price
         FROM subscription_plans
         WHERE plan_code IN ('enterprise', 'business')`
    );

    const plans = Object.fromEntries(
        planRows.map((row) => [String(row.plan_code), row])
    );

    await db.execute(
        `INSERT INTO subscriptions
         (
            store_id,
            plan_id,
            status,
            amount,
            billing_period,
            starts_at,
            ends_at,
            admin_notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            storeId,
            plans.enterprise.id,
            "active",
            num(plans.enterprise.monthly_price),
            "monthly",
            pastDate(10),
            futureDate(20),
            "Enterprise plan is active for the full defense demo.",
        ]
    );

    await db.execute(
        `INSERT INTO subscriptions
         (
            store_id,
            plan_id,
            status,
            amount,
            billing_period,
            payment_reference,
            payment_date,
            proof_path,
            admin_notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            storeId,
            plans.business.id,
            "pending_verification",
            num(plans.business.monthly_price),
            "monthly",
            `GCASH-DEMO-${storeId}-001`,
            pastDate(1),
            "uploads/subscriptions/demo-business-payment-proof.png",
            "Demo upgrade request awaiting verification.",
        ]
    );
}

async function main() {
    faker.seed(20260701);

    const db = await mysql.createConnection(dbConfig());

    console.log("Connected to database.");

    try {
        await db.beginTransaction();

        await resetOldDemoStore(db);

        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

        const { storeId, branches } =
            await createStoreBranchesAndUsers(db, passwordHash);

        await createCategories(db, storeId);

        const { saleItems } = await createProducts(
            db,
            storeId,
            branches
        );

        const packages = await createPackages(
            db,
            storeId,
            branches,
            saleItems
        );

        await createBookings(db, storeId, branches, packages);

        await createOrders(db, storeId, branches, saleItems);

        await createSubscriptions(db, storeId);

        await db.commit();

        console.log("\nDefense demo data was created successfully.");
        console.log(`Owner login: ${DEMO_STORE_EMAIL}`);
        console.log(`Password: ${DEMO_PASSWORD}`);
        console.log(
            "Open /dashboard/analytics and /dashboard/forecasting, then click Refresh."
        );
    } catch (error) {
        await db.rollback();
        throw error;
    } finally {
        await db.end();
    }
}

main().catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
});
