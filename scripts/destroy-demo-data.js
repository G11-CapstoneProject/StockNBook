/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config({ path: ".env.local" });

const mysql = require("mysql2/promise");

const DEMO_STORE_EMAIL = "demo.owner@stocknbook.com";
const DEMO_STORE_SLUG = "demo-party-store";

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

        const [stores] = await db.execute(
            "SELECT id FROM stores WHERE email = ? OR slug = ?",
            [DEMO_STORE_EMAIL, DEMO_STORE_SLUG]
        );

        if (stores.length === 0) {
            console.log("No demo store found.");
            await db.rollback();
            await db.end();
            return;
        }

        const storeId = stores[0].id;

        console.log(`Found demo store. store_id=${storeId}`);
        console.log("Deleting demo data...");

        await db.execute(
            `DELETE FROM order_items
       WHERE order_id IN (
         SELECT order_id FROM orders WHERE store_id = ?
       )`,
            [storeId]
        );
        console.log("Deleted demo order items.");

        await db.execute("DELETE FROM orders WHERE store_id = ?", [storeId]);
        console.log("Deleted demo orders.");

        await db.execute("DELETE FROM bookings WHERE store_id = ?", [storeId]);
        console.log("Deleted demo bookings.");

        await db.execute("DELETE FROM packages WHERE store_id = ?", [storeId]);
        console.log("Deleted demo packages.");

        await db.execute(
            `DELETE FROM product_variants
       WHERE product_id IN (
         SELECT id FROM products WHERE store_id = ?
       )`,
            [storeId]
        );
        console.log("Deleted demo product variants.");

        await db.execute("DELETE FROM products WHERE store_id = ?", [storeId]);
        console.log("Deleted demo products.");

        await db.execute("DELETE FROM categories WHERE store_id = ?", [storeId]);
        console.log("Deleted demo categories.");

        await db.execute("DELETE FROM staff WHERE store_id = ?", [storeId]);
        console.log("Deleted demo staff.");

        await db.execute("DELETE FROM managers WHERE store_id = ?", [storeId]);
        console.log("Deleted demo managers.");

        await db.execute("DELETE FROM branches WHERE store_id = ?", [storeId]);
        console.log("Deleted demo branches.");

        await db.execute("DELETE FROM stores WHERE id = ?", [storeId]);
        console.log("Deleted demo store.");

        await db.commit();

        console.log("");
        console.log("Demo data destroyed successfully.");

        await db.end();
    } catch (error) {
        await db.rollback();
        await db.end();
        throw error;
    }
}

main().catch((error) => {
    console.error("Destroy failed:", error);
    process.exit(1);
});