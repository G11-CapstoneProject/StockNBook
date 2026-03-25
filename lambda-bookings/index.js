/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "stocknbook-db.clyuqe48evd0.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json",
    };

    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers,
            body: "",
        };
    }

    let body = {};
    try {
        body = JSON.parse(event.body || "{}");
    } catch (error) {
        body = {};
    }

    const action = body.action;
    const connection = await mysql.createConnection(dbConfig);

    try {
        // PUBLIC: create booking
        if (action === "create_booking") {
            const {
                storeId,
                bookingType,
                name,
                phone,
                date,
                eventType,
                package: packageName,
                customOrder,
                notes,
                status,
            } = body;

            if (!storeId || !bookingType || !name || !phone || !date || !eventType) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing required booking fields" }),
                };
            }

            const [result] = await connection.execute(
                `INSERT INTO bookings
                 (store_id, booking_type, name, phone, event_date, event_type, package_name, custom_order, notes, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    Number(storeId),
                    bookingType,
                    name,
                    phone,
                    date,
                    eventType,
                    packageName || "",
                    customOrder || "",
                    notes || "",
                    status || "Pending",
                ]
            );

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    success: true,
                    id: result.insertId,
                }),
            };
        }

        if (action === "get_public_bookings") {
            const { storeId } = body;

            if (!storeId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing storeId" }),
                };
            }

            const [rows] = await connection.execute(
                `SELECT
       id,
       name,
       event_date AS date,
       status
     FROM bookings
     WHERE store_id = ?
     ORDER BY created_at DESC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ bookings: rows }),
            };
        }

        // PROTECTED actions
        const authHeader = event.headers?.Authorization || event.headers?.authorization;

        if (!authHeader) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: "No token" }),
            };
        }

        let store_id;
        try {
            const token = authHeader.replace("Bearer ", "");
            const decoded = jwt.verify(token, JWT_SECRET);
            store_id = decoded.store_id;
        } catch (error) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: "Invalid token" }),
            };
        }

        if (action === "get_bookings") {
            const [rows] = await connection.execute(
                `SELECT
          id,
          booking_type AS bookingType,
          name,
          phone,
          event_date AS date,
          event_type AS eventType,
          package_name AS package,
          custom_order AS customOrder,
          notes,
          status
         FROM bookings
         WHERE store_id = ?
         ORDER BY created_at DESC`,
                [store_id]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ bookings: rows }),
            };
        }

        if (action === "update_status") {
            const { booking_id, status } = body;

            if (!booking_id || !status) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing booking_id or status" }),
                };
            }

            await connection.execute(
                "UPDATE bookings SET status = ? WHERE id = ? AND store_id = ?",
                [status, booking_id, store_id]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true }),
            };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid action" }),
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message }),
        };
    } finally {
        await connection.end();
    }
};