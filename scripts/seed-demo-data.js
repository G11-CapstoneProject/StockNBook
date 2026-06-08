require("dotenv").config({ path: ".env.local" });

const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const DEMO_STORE_EMAIL = "demo.owner@stocknbook.com";
const DEMO_STORE_SLUG = "demo-party-store";
const DEMO_PASSWORD = "Demo12345";

const managerPermissionSets = [
    {
        label: "Full Access Manager",
        permissions: {
            dashboard: true,
            bookings: true,
            packages: true,
            packages_manage: true,
            inventory: true,
            pos: true,
            reports: true,
            staff_management: true,
            staff_roles: true,
            branch_settings: true,
        },
    },
    {
        label: "Operations Manager",
        permissions: {
            dashboard: true,
            bookings: true,
            packages: true,
            packages_manage: true,
            inventory: true,
            pos: true,
            reports: false,
            staff_management: false,
            staff_roles: false,
            branch_settings: false,
        },
    },
    {
        label: "Bookings Manager",
        permissions: {
            dashboard: true,
            bookings: true,
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

const staffPermissionSets = [
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

const categories = [
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

const productNames = [
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

const eventTypes = [
    "Birthday",
    "Wedding",
    "Debut",
    "Christening",
    "Corporate Event",
    "Anniversary",
    "Graduation",
    "Baby Shower",
];

const customerFirstNames = [
    "Maria",
    "Ana",
    "Carla",
    "Sofia",
    "Mika",
    "Jasmine",
    "Patricia",
    "Angela",
    "Mark",
    "John",
    "Ben",
    "Carlo",
    "Miguel",
    "Paulo",
    "Daniel",
];

const customerLastNames = [
    "Santos",
    "Cruz",
    "Reyes",
    "Garcia",
    "Dela Cruz",
    "Mendoza",
    "Ramos",
    "Torres",
    "Flores",
    "Castillo",
];

function pick(list, index) {
    return list[index % list.length];
}

function randomInt(min, max, index) {
    const raw = Math.abs(Math.sin(index + 1) * 10000);
    return Math.floor(raw % (max - min + 1)) + min;
}

function futureDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().slice(0, 10);
}

function pastDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().slice(0, 10);
}

function makeCustomerName(index) {
    return `${pick(customerFirstNames, index)} ${pick(customerLastNames, index)}`;
}

async function main() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 3306),
    });

    console.log("Connected to database.");

    try {
        await db.beginTransaction();

        const [existingStores] = await db.execute(
            "SELECT id FROM stores WHERE email = ? OR slug = ?",
            [DEMO_STORE_EMAIL, DEMO_STORE_SLUG]
        );

        if (existingStores.length > 0) {
            console.log(
                "Demo store already exists. Run npm run seed:destroy first if you want to reset it."
            );
            await db.rollback();
            await db.end();
            return;
        }

        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

        const [storeResult] = await db.execute(
            `INSERT INTO stores (store_name, owner_name, email, password, slug)
       VALUES (?, ?, ?, ?, ?)`,
            [
                "Demo Party Store",
                "Demo Owner",
                DEMO_STORE_EMAIL,
                passwordHash,
                DEMO_STORE_SLUG,
            ]
        );

        const storeId = storeResult.insertId;
        console.log(`Created demo store. store_id=${storeId}`);

        const branchData = [
            {
                branch_name: "Main Branch",
                contact_number: "09170000001",
                address: "Quezon City",
                manager_name: "Ana Cruz",
                manager_email: "demo.manager1@stocknbook.com",
            },
            {
                branch_name: "North Branch",
                contact_number: "09170000002",
                address: "Caloocan City",
                manager_name: "Ben Santos",
                manager_email: "demo.manager2@stocknbook.com",
            },
            {
                branch_name: "South Branch",
                contact_number: "09170000003",
                address: "Parañaque City",
                manager_name: "Carla Reyes",
                manager_email: "demo.manager3@stocknbook.com",
            },
        ];

        const branchIds = [];

        for (let branchIndex = 0; branchIndex < branchData.length; branchIndex++) {
            const branch = branchData[branchIndex];
            const branchNumber = branchIndex + 1;
            const managerPermissionSet = managerPermissionSets[branchIndex];

            const [branchResult] = await db.execute(
                `INSERT INTO branches (store_id, branch_name, contact_number, address)
         VALUES (?, ?, ?, ?)`,
                [storeId, branch.branch_name, branch.contact_number, branch.address]
            );

            const branchId = branchResult.insertId;
            branchIds.push(branchId);

            const [managerResult] = await db.execute(
                `INSERT INTO managers
          (store_id, branch_id, manager_name, manager_email, password, status, permissions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    `${branch.manager_name} (${managerPermissionSet.label})`,
                    branch.manager_email,
                    passwordHash,
                    "active",
                    JSON.stringify(managerPermissionSet.permissions),
                ]
            );

            const managerId = managerResult.insertId;

            for (let staffIndex = 0; staffIndex < staffPermissionSets.length; staffIndex++) {
                const staffNumber = staffIndex + 1;
                const staffPermissionSet = staffPermissionSets[staffIndex];

                await db.execute(
                    `INSERT INTO staff
            (store_id, branch_id, manager_id, staff_name, staff_email, password, status, permissions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        storeId,
                        branchId,
                        managerId,
                        `${branch.branch_name} ${staffPermissionSet.label}`,
                        `demo.staff${branchNumber}-${staffNumber}@stocknbook.com`,
                        passwordHash,
                        "active",
                        JSON.stringify(staffPermissionSet.permissions),
                    ]
                );
            }

            console.log(
                `Created ${branch.branch_name}: ${managerPermissionSet.label} + 3 staff`
            );
        }

        for (let i = 0; i < categories.length; i++) {
            await db.execute(
                `INSERT INTO categories (store_id, category_name, description, status)
         VALUES (?, ?, ?, ?)`,
                [
                    storeId,
                    categories[i],
                    `Demo category for ${categories[i].toLowerCase()} items.`,
                    "active",
                ]
            );
        }

        console.log(`Created ${categories.length} categories.`);

        const productIds = [];

        for (let i = 1; i <= 120; i++) {
            const category = pick(categories, i);
            const branchId = pick(branchIds, i);
            const baseName = pick(productNames, i);
            const stock = randomInt(2, 150, i);
            const alertLevel = randomInt(5, 20, i);
            const originalPrice = randomInt(80, 3000, i);
            const salesPrice = originalPrice + randomInt(50, 1200, i);
            const hasVariants = i <= 30 ? 1 : 0;

            const [productResult] = await db.execute(
                `INSERT INTO products
          (store_id, branch_id, name, category, stock, alert_level, original_price, sales_price, has_variants)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    `${baseName} ${i}`,
                    category,
                    stock,
                    alertLevel,
                    originalPrice,
                    salesPrice,
                    hasVariants,
                ]
            );

            const productId = productResult.insertId;
            productIds.push({
                id: productId,
                name: `${baseName} ${i}`,
                price: salesPrice,
            });

            if (hasVariants) {
                await db.execute(
                    `INSERT INTO product_variants
            (product_id, variant_values, stock, alert_level, original_price, sales_price)
           VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        productId,
                        JSON.stringify({
                            color: pick(["Gold", "Silver", "Pink", "Blue", "White"], i),
                            size: pick(["Small", "Medium", "Large"], i),
                        }),
                        randomInt(1, 80, i),
                        randomInt(3, 15, i),
                        originalPrice,
                        salesPrice,
                    ]
                );
            }
        }

        console.log("Created 120 products and 30 product variants.");

        const packageIds = [];

        for (let i = 1; i <= 15; i++) {
            const branchId = pick(branchIds, i);
            const packagePrice = randomInt(3500, 25000, i);
            const originalValue = packagePrice + randomInt(1000, 5000, i);
            const packageName = `${pick(eventTypes, i)} Package ${i}`;

            const inclusions = [
                { item: "Backdrop setup", quantity: 1 },
                { item: "Table and chair setup", quantity: randomInt(10, 50, i) },
                { item: "Balloon decoration", quantity: randomInt(20, 100, i) },
                { item: "Basic lights", quantity: 2 },
            ];

            const [packageResult] = await db.execute(
                `INSERT INTO packages
          (store_id, branch_id, name, description, original_value, discount_type, discount_value, package_price, duration, status, inclusions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    packageName,
                    `Demo ${packageName.toLowerCase()} for event clients.`,
                    originalValue,
                    "amount",
                    originalValue - packagePrice,
                    packagePrice,
                    "1 day",
                    "Active",
                    JSON.stringify(inclusions),
                ]
            );

            packageIds.push({
                id: packageResult.insertId,
                name: packageName,
                price: packagePrice,
                inclusions,
            });
        }

        console.log("Created 15 packages.");

        for (let i = 1; i <= 120; i++) {
            const branchId = pick(branchIds, i);
            const selectedPackage = pick(packageIds, i);
            const eventType = pick(eventTypes, i);
            const bookingStatus = pick(["pending", "confirmed", "completed", "cancelled"], i);
            const paymentStatus = pick(["unpaid", "partial", "paid"], i);

            await db.execute(
                `INSERT INTO bookings
          (store_id, branch_id, booking_type, name, phone, event_date, event_type, package_name, custom_order, notes, status, booking_reference, package_json, packageJSON, facebook_name, email, event_time, theme, venue, agreed_price, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    i % 4 === 0 ? "custom" : "package",
                    makeCustomerName(i),
                    `09${String(170000000 + i).slice(0, 9)}`,
                    futureDate(randomInt(1, 180, i)),
                    eventType,
                    selectedPackage.name,
                    i % 4 === 0 ? "Custom balloon and backdrop arrangement" : null,
                    `Demo booking notes ${i}`,
                    bookingStatus,
                    `BK-${String(i).padStart(5, "0")}`,
                    JSON.stringify(selectedPackage),
                    JSON.stringify(selectedPackage),
                    makeCustomerName(i + 2),
                    `customer${i}@example.com`,
                    pick(["9:00 AM", "1:00 PM", "3:00 PM", "6:00 PM"], i),
                    pick(["Elegant Gold", "Pastel Pink", "Rustic Garden", "Modern Minimalist"], i),
                    `${pick(["Quezon City", "Makati", "Pasig", "Taguig", "Parañaque"], i)} Event Venue`,
                    selectedPackage.price,
                    paymentStatus,
                ]
            );
        }

        console.log("Created 120 bookings.");

        for (let i = 1; i <= 150; i++) {
            const orderId = `ORD-DEMO-${String(i).padStart(5, "0")}`;
            const itemCount = 2;
            const firstProduct = pick(productIds, i);
            const secondProduct = pick(productIds, i + 15);
            const firstQty = randomInt(1, 5, i);
            const secondQty = randomInt(1, 5, i + 20);
            const total =
                Number(firstProduct.price) * firstQty +
                Number(secondProduct.price) * secondQty;

            await db.execute(
                `INSERT INTO orders
          (order_id, store_id, customer_name, item, total, order_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    storeId,
                    makeCustomerName(i + 5),
                    `${firstProduct.name}, ${secondProduct.name}`,
                    total,
                    pastDate(randomInt(0, 120, i)),
                ]
            );

            await db.execute(
                `INSERT INTO order_items
          (order_id, product_name, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
                [orderId, firstProduct.name, firstQty, firstProduct.price]
            );

            await db.execute(
                `INSERT INTO order_items
          (order_id, product_name, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
                [orderId, secondProduct.name, secondQty, secondProduct.price]
            );
        }

        console.log("Created 150 orders and 300 order items.");

        await db.commit();

        console.log("");
        console.log("Demo data created successfully.");
        console.log("");
        console.log(`Owner login: ${DEMO_STORE_EMAIL}`);
        console.log("");
        console.log("Manager login examples:");
        console.log("demo.manager1@stocknbook.com = Full Access Manager");
        console.log("demo.manager2@stocknbook.com = Operations Manager");
        console.log("demo.manager3@stocknbook.com = Bookings Manager");
        console.log("");
        console.log("Staff login examples:");
        console.log("demo.staff1-1@stocknbook.com = Bookings Staff");
        console.log("demo.staff1-2@stocknbook.com = Inventory and POS Staff");
        console.log("demo.staff1-3@stocknbook.com = Packages Staff");
        console.log("");
        console.log(`Password for all demo accounts: ${DEMO_PASSWORD}`);

        await db.end();
    } catch (error) {
        await db.rollback();
        await db.end();
        throw error;
    }
}

main().catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
});