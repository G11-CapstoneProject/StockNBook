const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

function generateSlug(storeName) {
  return storeName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
}

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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const body = JSON.parse(event.body || "{}");
  const { action, store_name, email, password } = body;

  const connection = await mysql.createConnection(dbConfig);

  try {
    // SIGNUP
    if (action === "signup") {
      const [existing] = await connection.execute(
          "SELECT id FROM stores WHERE email = ?",
          [email]
      );

      if (existing.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Email already exists" }),
        };
      }

      const slug = generateSlug(store_name);
      const hashed = await bcrypt.hash(password, 10);

      const [result] = await connection.execute(
          "INSERT INTO stores (store_name, email, password, slug) VALUES (?, ?, ?, ?)",
          [store_name, email, hashed, slug]
      );

      const token = jwt.sign(
          { store_id: result.insertId, email },
          JWT_SECRET,
          { expiresIn: "7d" }
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          token,
          store_id: result.insertId,
          store_name,
        }),
      };
    }

    if (action === "get_store_by_slug") {
      const { slug } = body;

      if (!slug) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing slug" }),
        };
      }

      const [rows] = await connection.execute(
          `SELECT id, store_name, slug
           FROM stores
           WHERE slug = ?
             LIMIT 1`,
          [slug]
      );

      if (!rows.length) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Store not found" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ store: rows[0] }),
      };
    }

    // LOGIN
    if (action === "login") {
      const [rows] = await connection.execute(
          "SELECT * FROM stores WHERE email = ?",
          [email]
      );

      if (rows.length === 0) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: "Invalid email or password" }),
        };
      }

      const store = rows[0];
      const match = await bcrypt.compare(password, store.password);

      if (!match) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: "Invalid email or password" }),
        };
      }

      const token = jwt.sign(
          { store_id: store.id, email },
          JWT_SECRET,
          { expiresIn: "7d" }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          token,
          store_id: store.id,
          store_name: store.store_name,
        }),
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