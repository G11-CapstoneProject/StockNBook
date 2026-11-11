import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uses the existing login signing key. Do not rely on the development fallback in production.
const signingKey = () => process.env.JWT_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "stocknbook-secret-key" : "");
let pool: Pool | undefined;
function database(): Pool {
    if (!pool) {
        // Match the existing StockNBook attendance connection behavior:
        // the configured DB password takes precedence, while the existing
        // development fallback below can be used when no variable is set.
        pool = mysql.createPool({
            host: process.env.DB_HOST || process.env.MYSQL_HOST || "127.0.0.1",
            port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
            user: process.env.DB_USER || process.env.MYSQL_USER || "root",
            password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || "BTA5EYVWLfWcebF",
            database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "stocknbook_v2",
            waitForConnections: true,
            connectionLimit: 6,
            queueLimit: 60,
            timezone: "+08:00",
        });
    }
    return pool;
}
class ApiError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}
const response = (body: Record<string, unknown>, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const positiveInt = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0;
const isDay = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const day = new Date(v + "T00:00:00.000Z");
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === v;
};

type Manager = {
    id: number;
    storeId: number;
    branchId: number;
    managerName: string;
    storeName: string;
    branchName: string;
    mayReviewLeave: boolean;
};
async function verifyManager(request: NextRequest, db: Pool | PoolConnection): Promise<Manager> {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) throw new ApiError(401, "Manager sign-in is required.");
    const secret = signingKey();
    if (!secret) throw new ApiError(503, "Set JWT_SECRET to the signing key used by the login backend.");
    let claims: Record<string, unknown>;
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid token payload");
        claims = decoded as Record<string, unknown>;
    } catch {
        throw new ApiError(401, "Manager session expired or could not be verified. Sign in again.");
    }
    if (String(claims.role || "").toLowerCase() !== "manager") {
        throw new ApiError(403, "Only a branch manager may review staff leave requests.");
    }
    const managerId = positiveInt(claims.manager_id ?? claims.managerId);
    const signedStoreId = positiveInt(claims.store_id ?? claims.storeId);
    const signedBranchId = positiveInt(claims.branch_id ?? claims.branchId);
    if (!managerId || !signedStoreId) throw new ApiError(403, "Manager identity is missing from the verified login.");
    const [rows] = await db.query<RowDataPacket[]>(
        `SELECT m.id, m.store_id, m.branch_id, m.permissions, m.status,
                m.full_name AS managerName, s.store_name AS storeName,
                br.branch_name AS branchName
         FROM users m
                  JOIN branches br ON br.id = m.branch_id AND br.store_id = m.store_id
                  JOIN stores s ON s.id = m.store_id
         WHERE m.id = ? AND m.store_id = ? AND m.role = 'manager' LIMIT 1`,
        [managerId, signedStoreId],
    );
    if (!rows.length) throw new ApiError(403, "Your manager account does not match this store.");
    const account = rows[0];
    if (!["active", "accepted"].includes(String(account.status || "").toLowerCase())) {
        throw new ApiError(403, "An active branch manager account is required.");
    }
    const branchId = positiveInt(account.branch_id);
    if (!branchId || (signedBranchId && signedBranchId !== branchId)) {
        throw new ApiError(403, "Your manager branch assignment cannot be verified.");
    }
    let permissions: Record<string, unknown> = {};
    try {
        const parsed = typeof account.permissions === "string" ? JSON.parse(account.permissions) : account.permissions;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) permissions = parsed;
    } catch { /* Missing or invalid permissions never grant approval authority. */ }
    const mayReviewLeave = permissions.staff_management === true || permissions.staffManagement === true;
    return {
        id: managerId, storeId: signedStoreId, branchId, mayReviewLeave,
        managerName: String(account.managerName || `Manager ${managerId}`),
        storeName: String(account.storeName || `Store ${signedStoreId}`),
        branchName: String(account.branchName || `Branch ${branchId}`),
    };
}

function handleError(error: unknown, context: string) {
    if (error instanceof ApiError) return response({ success: false, error: error.message }, error.status);
    console.error(context, error);
    const sqlCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (sqlCode === "ER_ACCESS_DENIED_ERROR") {
        return response({ success: false, error: "MySQL rejected the manager attendance connection. Configure DB_PASSWORD in .env.local to match the database credentials used by your working Reports API, then restart Next.js." }, 503);
    }
    if (sqlCode === "ECONNREFUSED" || sqlCode === "ENOTFOUND") {
        return response({ success: false, error: "MySQL is unreachable. Check that MySQL is running and the DB_HOST and DB_PORT settings are correct." }, 503);
    }
    if (sqlCode === "ER_BAD_DB_ERROR") {
        return response({ success: false, error: "The StockNBook database could not be found. Check DB_NAME in .env.local." }, 503);
    }
    if (sqlCode === "ER_NO_SUCH_TABLE" || sqlCode === "ER_BAD_FIELD_ERROR") {
        return response({ success: false, error: "Staff attendance/leave tables or columns are missing. Install the existing attendance SQL schema." }, 503);
    }
    if (sqlCode === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" || sqlCode === "WARN_DATA_TRUNCATED" || sqlCode === "ER_DATA_TOO_LONG") {
        return response({ success: false, error: "The attendance schema does not accept manager records. Verify that employee_role supports 'manager' in both attendance and leave tables." }, 503);
    }
    if (sqlCode === "ER_DUP_ENTRY") {
        return response({ success: false, error: "An attendance or leave record already exists for the selected date." }, 409);
    }
    return response({ success: false, error: "Unable to process manager staff records. Check the server log." }, 500);
}

export async function GET(request: NextRequest) {
    try {
        const db = database();
        const manager = await verifyManager(request, db);
        const phParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
        const phPart = (key: string) => phParts.find(part => part.type === key)?.value || "";
        const phToday = `${phPart("year")}-${phPart("month")}-${phPart("day")}`;
        const date = request.nextUrl.searchParams.get("date") || phToday;
        if (!isDay(date)) throw new ApiError(400, "Choose a valid attendance date (YYYY-MM-DD).");
        const scope = [manager.storeId, manager.branchId];
        const [staffRows] = await db.query<RowDataPacket[]>(
            "SELECT id, full_name AS name, status FROM users WHERE store_id = ? AND branch_id = ? AND role = 'staff'",
            scope,
        );
        const activeStaff = staffRows.filter(row => !["inactive", "disabled", "deleted", "revoked"].includes(String(row.status || "").toLowerCase()));
        // Employee attendance and leave are not part of stocknbook_v2: nothing is
        // recorded, so every active staff member counts as "not recorded".
        const counts = {
            total: activeStaff.length,
            present: 0,
            onLeave: 0,
            absent: 0,
            notRecorded: activeStaff.length,
        };
        // The signed-in manager's own permanent Employee ID.
        const [codeRows] = await db.query<RowDataPacket[]>(
            "SELECT employee_code AS employeeCode FROM users WHERE id=? AND store_id=? AND role='manager' LIMIT 1",
            [manager.id, manager.storeId]);
        const managerEmployeeCode = codeRows[0]?.employeeCode ? String(codeRows[0].employeeCode) : null;
        return response({ success: true, date, mayReviewLeave: manager.mayReviewLeave,
            attendanceSummary: counts, attendance: [], leaves: [],
            managerAttendance: [], managerAttendanceToday: null, teamAttendance: [], managerEmployeeCode });
    } catch (error) { return handleError(error, "Manager staff overview GET failed:"); }
}

export async function POST(request: NextRequest) {
    let connection: PoolConnection | null = null;
    try {
        connection = await database().getConnection();
        const manager = await verifyManager(request, connection);
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        if (!body) throw new ApiError(400, "Invalid attendance request.");
        const action = String(body.action || "");
        if (!["time_in", "time_out", "request_leave", "review_leave"].includes(action)) {
            throw new ApiError(400, "Unsupported manager action.");
        }
        if (action === "review_leave" && !manager.mayReviewLeave) {
            throw new ApiError(403, "Staff Management permission is required to approve or disapprove leave.");
        }
        // Employee attendance (time in / time out) and leave requests are not part of stocknbook_v2.
        throw new ApiError(410, "Employee attendance and leave requests are no longer available.");
    } catch (error) {
        return handleError(error, "Manager staff leave review POST failed:");
    } finally { connection?.release(); }
}