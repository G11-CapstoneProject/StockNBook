import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Principal = {
    employeeId: number;
    role: "staff";
    storeId: number;
    branchId: number;
    storeName: string;
    branchName: string;
    employeeName: string;
    employeeNumber: string;
};

let pool: Pool | null = null;
function getPool(): Pool {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST || process.env.MYSQL_HOST || "127.0.0.1",
            port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
            user: process.env.DB_USER || process.env.MYSQL_USER || "root",
            password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || "BTA5EYVWLfWcebF",
            database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "stocknbook_v2",
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 100,
            timezone: "+08:00",
        });
    }
    return pool;
}

function unauthorized() { return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }); }
function invalid(message: string) { return NextResponse.json({ success: false, error: message }, { status: 400 }); }
function text(row: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = row[key];
        if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    }
    return "";
}
function positiveInteger(value: unknown): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

// Verify JWT using the same library and signing-key resolution as the
// existing /api/reports route. The legacy fallback is DEVELOPMENT-ONLY.
// Production MUST set JWT_SECRET to the secret used by the login backend.
class AttendanceAuthError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}
function verifiedJwtPayload(request: NextRequest): Record<string, unknown> {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) throw new AttendanceAuthError(401, "Please sign in again to record attendance.");

    const secret = process.env.JWT_SECRET?.trim() ||
        (process.env.NODE_ENV !== "production" ? "stocknbook-secret-key" : "");
    if (!secret) {
        console.error("Attendance server configuration: JWT_SECRET is not set.");
        throw new AttendanceAuthError(503, "Attendance authentication is not configured. Set JWT_SECRET to the login signing key.");
    }
    try {
        // jwt.verify checks signature, exp (when present), and nbf, like Reports.
        // Do not decode without verifying or trust client-supplied employee IDs.
        const verified = jwt.verify(token, secret, { algorithms: ["HS256"] });
        if (!verified || typeof verified !== "object" || Array.isArray(verified)) {
            throw new Error("Unexpected JWT payload");
        }
        return verified as Record<string, unknown>;
    } catch (error) {
        console.warn("Attendance token verification failed:", error instanceof Error ? error.name : "Invalid token");
        throw new AttendanceAuthError(401,
            "Your staff session could not be verified. Sign out and back in; check that Attendance and Reports use the same JWT_SECRET.");
    }
}

async function verifyStaffPrincipal(request: NextRequest): Promise<Principal> {
    const claims = verifiedJwtPayload(request);
    const nested = claims.user && typeof claims.user === "object" && !Array.isArray(claims.user)
        ? claims.user as Record<string, unknown> : {};
    const role = String(claims.role ?? claims.user_role ?? claims.userRole ?? claims.user_type ?? nested.role ?? "").trim().toLowerCase();
    if (role !== "staff") throw new AttendanceAuthError(403, "Attendance clock-in and clock-out are available to authenticated staff accounts.");
    const staffId = positiveInteger(claims.staff_id ?? claims.staffId ?? claims.employee_id ?? claims.employeeId ?? nested.staff_id);
    const userId = positiveInteger(claims.user_id ?? claims.userId ?? claims.id ?? claims.sub ?? nested.id);
    const signedEmail = String(claims.email ?? claims.user_email ?? nested.email ?? "").trim().toLowerCase();
    if (!staffId && !userId && !signedEmail) throw new AttendanceAuthError(403, "Your verified login has no staff ID or email identifier. Contact the administrator.");
    const db = getPool();
    // Staff accounts are users rows with role 'staff' (users.id is the staff ID).
    let staffRows: RowDataPacket[] = [];
    if (staffId) {
        [staffRows] = await db.query<RowDataPacket[]>(
            "SELECT *, full_name AS staff_name FROM users WHERE id = ? AND role = 'staff' LIMIT 1", [staffId]);
    }
    if (!staffRows.length && userId && !staffId) {
        [staffRows] = await db.query<RowDataPacket[]>(
            "SELECT *, full_name AS staff_name FROM users WHERE id = ? AND role = 'staff' LIMIT 1", [userId]);
    }
    if (!staffRows.length && signedEmail && signedEmail.length <= 254) {
        // Only a SIGNED email claim is used; the JWT's store/branch must
        // still match the selected staff row and its database assignment.
        [staffRows] = await db.query<RowDataPacket[]>(
            "SELECT *, full_name AS staff_name FROM users WHERE LOWER(email) = ? AND role = 'staff' LIMIT 2", [signedEmail]);
        if (staffRows.length !== 1) staffRows = [];
    }
    if (!staffRows.length) throw new AttendanceAuthError(403, "Your verified login does not match a staff record. Check the JWT staff ID/email and staff table assignment.");
    const member = staffRows[0] as Record<string, unknown>;
    const state = text(member, ["status", "account_status", "employment_status"]).toLowerCase();
    if (["inactive", "disabled", "terminated", "deleted", "revoked"].includes(state)) {
        throw new AttendanceAuthError(403, "This staff account is not active.");
    }
    const employeeId = positiveInteger(member.id);
    const branchId = positiveInteger(member.branch_id ?? member.branchId);
    let storeId = positiveInteger(member.store_id ?? member.storeId);
    if (!employeeId || !branchId) throw new AttendanceAuthError(403, "Your staff assignment is missing a branch. Contact your administrator.");
    const signedBranchId = positiveInteger(claims.branch_id ?? claims.branchId ?? nested.branch_id);
    const signedStoreId = positiveInteger(claims.store_id ?? claims.storeId ?? nested.store_id);
    if (signedBranchId && branchId !== signedBranchId) throw new AttendanceAuthError(403, "Staff branch in your login session does not match the database.");
    if (signedStoreId && storeId && storeId !== signedStoreId) throw new AttendanceAuthError(403, "Staff store in your login session does not match the database.");
    const [branchRows] = await db.query<RowDataPacket[]>("SELECT * FROM branches WHERE id = ? LIMIT 1", [branchId]);
    if (branchRows.length !== 1) throw new AttendanceAuthError(403, "Your assigned branch was not found.");
    const branch = branchRows[0] as Record<string, unknown>;
    const branchStoreId = positiveInteger(branch.store_id ?? branch.storeId);
    if (branchStoreId && storeId && branchStoreId !== storeId) throw new AttendanceAuthError(403, "Staff and branch store assignments do not match.");
    storeId = branchStoreId || storeId;
    if (signedStoreId && storeId !== signedStoreId) throw new AttendanceAuthError(403, "Your signed-in store does not match the assigned branch.");
    if (!storeId) throw new AttendanceAuthError(403, "Your assigned store was not found.");
    const [storeRows] = await db.query<RowDataPacket[]>("SELECT * FROM stores WHERE id = ? LIMIT 1", [storeId]);
    if (storeRows.length !== 1) throw new AttendanceAuthError(403, "Your assigned store was not found.");
    const store = storeRows[0] as Record<string, unknown>;
    return {
        employeeId, role: "staff", storeId, branchId,
        employeeNumber: String(employeeId), // Employee No. is identical to staff.id (authoritative DB key).
        employeeName: text(member, ["full_name", "fullName", "name", "staff_name"]) ||
            [text(member, ["first_name", "firstName"]), text(member, ["last_name", "lastName"])].filter(Boolean).join(" ") || String(employeeId),
        branchName: text(branch, ["branch_name", "branchName", "name"]) || `Branch ${branchId}`,
        storeName: text(store, ["store_name", "storeName", "name"]) || `Store ${storeId}`,
    };
}
function responseForDatabaseError(error: unknown): NextResponse | null {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const known: Record<string, string> = {
        ER_ACCESS_DENIED_ERROR: "Attendance cannot connect to MySQL. Set DB_USER and DB_PASSWORD in .env.local to the same database credentials used by the existing Reports API, then restart Next.js.",
        ER_BAD_DB_ERROR: "Attendance database not found. Check DB_NAME in .env.local.",
        ECONNREFUSED: "MySQL is not reachable. Start the local MySQL service and verify DB_HOST / DB_PORT.",
        ER_NO_SUCH_TABLE: "Attendance tables are missing. Run staff_attendance_schema.sql in the stocknbook database.",
    };
    return known[code] ? NextResponse.json({ success: false, error: known[code] }, { status: 503 }) : null;
}
function responseForAuthError(error: unknown): NextResponse | null {
    if (!(error instanceof AttendanceAuthError)) return null;
    return NextResponse.json({ success: false, error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
}

function readDay(value: string | null): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

// Do not cache private employee data.
export async function GET(request: NextRequest) {
    try {
        const principal = await verifyStaffPrincipal(request);
        const url = request.nextUrl.searchParams;
        const now = new Date();
        const manilaDateParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
        const datePart = (kind: string) => manilaDateParts.find((part) => part.type === kind)?.value ?? "";
        const localDay = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
        const startDate = readDay(url.get("startDate")) || `${datePart("year")}-01-01`;
        const endDate = readDay(url.get("endDate")) || localDay;
        if (startDate > endDate) return invalid("Start date must be before end date.");
        void principal;
        // Employee attendance and leave are not part of stocknbook_v2.
        return NextResponse.json({ success: true, records: [], todayRecord: null },
            { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        const authenticationProblem = responseForAuthError(error);
        if (authenticationProblem) return authenticationProblem;
        const databaseProblem = responseForDatabaseError(error);
        if (databaseProblem) return databaseProblem;
        console.error("Attendance GET failed", error);
        return NextResponse.json({ success: false, error: "Attendance records could not be loaded." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await verifyStaffPrincipal(request);
        const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
        if (!payload) return invalid("Invalid request body.");
        const action = String(payload.action || "");
        if (!["time_in", "time_out", "request_leave"].includes(action)) return invalid("Unsupported attendance action.");
        // Employee attendance (time in / time out) and leave requests are not part of stocknbook_v2.
        return NextResponse.json({ success: false, error: "Employee attendance and leave requests are no longer available." },
            { status: 410, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        const authenticationProblem = responseForAuthError(error);
        if (authenticationProblem) return authenticationProblem;
        console.error("Attendance POST failed", error);
        return NextResponse.json({ success: false, error: "Unable to save attendance. Please try again." }, { status: 500 });
    }
}