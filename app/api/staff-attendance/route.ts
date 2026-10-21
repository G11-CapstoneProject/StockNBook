import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

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
            database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "stocknbook",
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
    // Prefer a staff-specific claim. If the JWT signs users.id instead, resolve
    // staff.user_id when that column exists; NEVER trust posted staff identifiers.
    let staffRows: RowDataPacket[] = [];
    if (staffId) {
        [staffRows] = await db.query<RowDataPacket[]>("SELECT * FROM staff WHERE id = ? LIMIT 1", [staffId]);
    }
    if (!staffRows.length && userId) {
        const [columns] = await db.query<RowDataPacket[]>("SHOW COLUMNS FROM staff");
        const names = new Set(columns.map(column => String(column.Field || "")));
        if (names.has("user_id")) {
            [staffRows] = await db.query<RowDataPacket[]>("SELECT * FROM staff WHERE user_id = ? LIMIT 1", [userId]);
        }
        if (!staffRows.length && !staffId) {
            // Original StockNBook versions sign staff.id as `id` or `sub`.
            [staffRows] = await db.query<RowDataPacket[]>("SELECT * FROM staff WHERE id = ? LIMIT 1", [userId]);
        }
    }
    if (!staffRows.length) {
        if (signedEmail && signedEmail.length <= 254) {
            const [columns] = await db.query<RowDataPacket[]>("SHOW COLUMNS FROM staff");
            const fields = new Set(columns.map(col => String(col.Field || "")));
            if (fields.has("email")) {
                // Only a SIGNED email claim is used; the JWT's store/branch must
                // still match the selected staff row and its database assignment.
                [staffRows] = await db.query<RowDataPacket[]>(
                    "SELECT * FROM staff WHERE LOWER(email) = ? LIMIT 2", [signedEmail]);
                if (staffRows.length !== 1) staffRows = [];
            }
        }
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
const PH_NOW = "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')";
const PH_TODAY = `DATE(${PH_NOW})`;

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
        const db = getPool();
        const [attendanceRows] = await db.query<RowDataPacket[]>(`
            SELECT CONCAT('A-',id) AS id, store_name AS storeName, branch_name AS branchName,
                   employee_name AS employeeName, CAST(employee_id AS CHAR) AS employeeNumber,
                   DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
                DATE_FORMAT(time_in, '%Y-%m-%dT%H:%i:%s') AS timeIn,
                DATE_FORMAT(time_out, '%Y-%m-%dT%H:%i:%s') AS timeOut,
                CASE WHEN time_in IS NOT NULL AND time_out IS NOT NULL
                    THEN ROUND(TIMESTAMPDIFF(MINUTE, time_in, time_out) / 60, 2) ELSE NULL END AS hoursWorked,
                CASE WHEN attendance_status = 'Present' AND time_out IS NULL THEN 'On Duty'
                    WHEN attendance_status = 'Present' THEN 'Completed'
                    ELSE attendance_status END AS status,
                '' AS reason, '' AS leaveType, '' AS approvalStatus
            FROM stocknbook_staff_attendance
            WHERE employee_id = ? AND employee_role = 'staff' AND attendance_date BETWEEN ? AND ?
        `, [principal.employeeId, startDate, endDate]);
        // The staff leave tab shows every application, including future dates.
        // Existing PDF exports (export=1) continue to use the chosen report period.
        const filterLeaveForExport = url.get("export") === "1";
        const leavePeriodSql = filterLeaveForExport
            ? " AND leave_date <= ? AND COALESCE(leave_end_date, leave_date) >= ?"
            : "";
        const leaveParams = filterLeaveForExport
            ? [principal.employeeId, principal.storeId, principal.branchId, endDate, startDate]
            : [principal.employeeId, principal.storeId, principal.branchId];
        const [leaveRows] = await db.query<RowDataPacket[]>(`
            SELECT CONCAT('L-',id) AS id, store_name AS storeName, branch_name AS branchName,
                   employee_name AS employeeName, CAST(employee_id AS CHAR) AS employeeNumber,
                   DATE_FORMAT(leave_date, '%Y-%m-%d') AS date,
                DATE_FORMAT(COALESCE(leave_end_date, leave_date), '%Y-%m-%d') AS endDate,
                NULL AS timeIn, NULL AS timeOut, NULL AS hoursWorked,
                'Leave' AS status, reason, leave_type AS leaveType,
                approval_status AS approvalStatus,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS requestCreatedAt,
                decision_reason AS decisionReason,
                DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewedAt
            FROM stocknbook_staff_leave_requests
            WHERE employee_id = ? AND employee_role = 'staff'
              AND store_id = ? AND branch_id = ? ${leavePeriodSql}
            ORDER BY created_at DESC, leave_date ASC
        `, leaveParams);
        const records = [...attendanceRows, ...leaveRows].sort((a, b) =>
            String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
        // Always load today's clock state, even when a user filters an older date.
        const [todayRows] = await db.query<RowDataPacket[]>(`
            SELECT CONCAT('A-', id) AS id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
                   DATE_FORMAT(time_in, '%Y-%m-%dT%H:%i:%s') AS timeIn,
                   DATE_FORMAT(time_out, '%Y-%m-%dT%H:%i:%s') AS timeOut,
                   CASE WHEN time_in IS NOT NULL AND time_out IS NOT NULL
                     THEN ROUND(TIMESTAMPDIFF(MINUTE, time_in, time_out) / 60, 2)
                     ELSE NULL END AS hoursWorked,
                   attendance_status AS status
            FROM stocknbook_staff_attendance
            WHERE employee_id = ? AND employee_role = 'staff' AND attendance_date = ${PH_TODAY}
            LIMIT 1
        `, [principal.employeeId]);
        return NextResponse.json({ success: true, records, todayRecord: todayRows[0] || null },
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
    let connection: PoolConnection | null = null;
    try {
        const principal = await verifyStaffPrincipal(request);
        const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
        if (!payload) return invalid("Invalid request body.");
        const action = String(payload.action || "");
        if (!["time_in", "time_out", "request_leave"].includes(action)) return invalid("Unsupported attendance action.");
        connection = await getPool().getConnection();
        await connection.beginTransaction();
        if (action === "time_in") {
            // Staff clock-in #1 for the day. Uniqueness prevents a second time-in.
            const [existing] = await connection.query<RowDataPacket[]>(`
                SELECT id FROM stocknbook_staff_attendance
                WHERE employee_id = ? AND employee_role = 'staff' AND attendance_date = ${PH_TODAY} LIMIT 1 FOR UPDATE
            `, [principal.employeeId]);
            if (existing.length) { await connection.rollback(); return invalid("Today's attendance is already recorded."); }
            const [approvedLeave] = await connection.query<RowDataPacket[]>(`
                SELECT id FROM stocknbook_staff_leave_requests
                WHERE employee_id = ? AND employee_role = 'staff'
                  AND leave_date <= ${PH_TODAY} AND COALESCE(leave_end_date, leave_date) >= ${PH_TODAY}
                  AND approval_status = 'Approved' LIMIT 1
            `, [principal.employeeId]);
            if (approvedLeave.length) { await connection.rollback(); return invalid("You have approved leave today. Contact your manager for corrections."); }
            await connection.execute(`
                INSERT INTO stocknbook_staff_attendance
                (store_id, branch_id, employee_id, employee_role, store_name, branch_name,
                 employee_name, employee_number, attendance_date, time_in, attendance_status)
                VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ${PH_TODAY}, ${PH_NOW}, 'Present')
            `, [principal.storeId, principal.branchId, principal.employeeId, principal.storeName,
                principal.branchName, principal.employeeName, principal.employeeNumber]);
        } else if (action === "time_out") {
            // Staff clock-out #2 for the day. Locking prevents repeated time-outs.
            const [rows] = await connection.query<RowDataPacket[]>(`
                SELECT id, time_in, time_out, attendance_status FROM stocknbook_staff_attendance
                WHERE employee_id = ? AND employee_role = 'staff' AND attendance_date = ${PH_TODAY} LIMIT 1 FOR UPDATE
            `, [principal.employeeId]);
            if (!rows.length || !rows[0].time_in || rows[0].time_out || rows[0].attendance_status !== "Present") {
                await connection.rollback(); return invalid("You must have an active time-in to time out.");
            }
            await connection.execute(`UPDATE stocknbook_staff_attendance SET time_out = ${PH_NOW}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [rows[0].id]);
        } else {
            // One leave application is stored as one row with start/end dates.
            // The manager reviews the whole date range in a single decision.
            const startDate = readDay(typeof payload.start_date === "string" ? payload.start_date :
                typeof payload.leave_date === "string" ? payload.leave_date : null);
            const endDate = readDay(typeof payload.end_date === "string" ? payload.end_date :
                typeof payload.leave_date === "string" ? payload.leave_date : null);
            const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
            const kind = String(payload.leave_type || "Personal");
            if (!startDate || !endDate || startDate > endDate ||
                reason.length < 3 || reason.length > 1000 ||
                !["Personal", "Sick", "Emergency", "Vacation", "Other"].includes(kind)) {
                await connection.rollback();
                return invalid("Enter a valid single date or date range, leave type, and reason (3–1000 characters).");
            }
            const countDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) -
                Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
            if (countDays > 90) {
                await connection.rollback(); return invalid("A leave request can cover up to 90 calendar days.");
            }
            const [dateCheck] = await connection.query<RowDataPacket[]>(
                `SELECT DATE_FORMAT(${PH_TODAY}, '%Y-%m-%d') AS today`);
            if (startDate < String(dateCheck[0].today).slice(0, 10)) {
                await connection.rollback(); return invalid("Leave dates cannot be in the past.");
            }
            const [attendance] = await connection.query<RowDataPacket[]>(`
                SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date
                FROM stocknbook_staff_attendance
                WHERE employee_id = ? AND employee_role = 'staff' AND attendance_date BETWEEN ? AND ?
                    LIMIT 1 FOR UPDATE
            `, [principal.employeeId, startDate, endDate]);
            if (attendance.length) {
                await connection.rollback();
                return NextResponse.json({ success: false,
                        error: `Recorded attendance exists on ${attendance[0].date}; choose another leave period.` },
                    { status: 409 });
            }
            // Serialize requests by this staff member so concurrent submissions cannot overlap.
            const [lockedStaff] = await connection.query<RowDataPacket[]>(
                "SELECT id FROM staff WHERE id = ? AND store_id = ? AND branch_id = ? FOR UPDATE",
                [principal.employeeId, principal.storeId, principal.branchId],
            );
            if (!lockedStaff.length) {
                await connection.rollback();
                return invalid("Your staff assignment could not be confirmed.");
            }
            const [existingLeave] = await connection.query<RowDataPacket[]>(`
                SELECT DATE_FORMAT(leave_date, '%Y-%m-%d') AS date
                FROM stocknbook_staff_leave_requests
                WHERE employee_id = ? AND employee_role = 'staff'
                  AND leave_date <= ? AND COALESCE(leave_end_date, leave_date) >= ?
                    LIMIT 1 FOR UPDATE
            `, [principal.employeeId, endDate, startDate]);
            if (existingLeave.length) {
                await connection.rollback();
                return NextResponse.json({ success: false,
                        error: `A leave request already exists on ${existingLeave[0].date}.` },
                    { status: 409 });
            }
            // Exactly one INSERT regardless of how many calendar days are requested.
            await connection.execute(`
                INSERT INTO stocknbook_staff_leave_requests
                (store_id, branch_id, employee_id, employee_role, store_name, branch_name,
                 employee_name, employee_number, leave_date, leave_end_date,
                 leave_type, reason, approval_status)
                VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
            `, [principal.storeId, principal.branchId, principal.employeeId, principal.storeName,
                principal.branchName, principal.employeeName, principal.employeeNumber,
                startDate, endDate, kind, reason]);
        }
        await connection.commit();
        return NextResponse.json({ success: true, message: "Attendance action saved." }, { headers: { "Cache-Control": "no-store" } });
    } catch (error: unknown) {
        if (connection) await connection.rollback().catch(() => undefined);
        const authenticationProblem = responseForAuthError(error);
        if (authenticationProblem) return authenticationProblem;
        const databaseProblem = responseForDatabaseError(error);
        if (databaseProblem) return databaseProblem;
        const duplicate = Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY");
        if (!duplicate) console.error("Attendance POST failed", error);
        return NextResponse.json({ success: false, error: duplicate ? "An attendance or leave record already exists for this date." : "Unable to save attendance. Please try again." }, { status: duplicate ? 409 : 500 });
    } finally { connection?.release(); }
}
