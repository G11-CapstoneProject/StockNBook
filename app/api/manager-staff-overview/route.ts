import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";

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
            database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "stocknbook",
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
const PH_NOW = "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')";
const PH_TODAY = `DATE(${PH_NOW})`;
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
                m.manager_name AS managerName, s.store_name AS storeName,
                br.branch_name AS branchName
         FROM managers m
                  JOIN branches br ON br.id = m.branch_id AND br.store_id = m.store_id
                  JOIN stores s ON s.id = m.store_id
         WHERE m.id = ? AND m.store_id = ? LIMIT 1`,
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
            "SELECT id, staff_name AS name, status FROM staff WHERE store_id = ? AND branch_id = ?",
            scope,
        );
        const activeStaff = staffRows.filter(row => !["inactive", "disabled", "deleted", "revoked"].includes(String(row.status || "").toLowerCase()));
        const [attendance] = await db.query<RowDataPacket[]>(
            `SELECT employee_id AS employeeId, employee_name AS employeeName, attendance_status AS status,
                    DATE_FORMAT(time_in,'%Y-%m-%dT%H:%i:%s') AS timeIn,
                    DATE_FORMAT(time_out,'%Y-%m-%dT%H:%i:%s') AS timeOut
             FROM stocknbook_staff_attendance
             WHERE store_id=? AND branch_id=? AND employee_role='staff' AND attendance_date=?`,
            [...scope, date],
        );
        const [approved] = await db.query<RowDataPacket[]>(
            `SELECT DISTINCT employee_id AS employeeId FROM stocknbook_staff_leave_requests
             WHERE store_id=? AND branch_id=? AND employee_role='staff'
               AND leave_date=? AND approval_status='Approved'`, [...scope, date],
        );
        const [leaves] = await db.query<RowDataPacket[]>(
            `SELECT id, employee_id AS employeeId, employee_name AS employeeName,
                    employee_number AS employeeNumber,
                    DATE_FORMAT(leave_date,'%Y-%m-%d') AS leaveDate,
                    leave_type AS leaveType, reason, approval_status AS approvalStatus,
                    decision_reason AS decisionReason, approved_by AS reviewedBy,
                    DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt,
                    DATE_FORMAT(reviewed_at,'%Y-%m-%d %H:%i:%s') AS reviewedAt
             FROM stocknbook_staff_leave_requests
             WHERE store_id=? AND branch_id=? AND employee_role='staff'
             ORDER BY (approval_status='Pending') DESC, created_at DESC, leave_date ASC LIMIT 800`, scope,
        );
        const presentIds = new Set(attendance.filter(row => row.status === "Present").map(row => Number(row.employeeId)));
        const absentIds = new Set(attendance.filter(row => row.status === "Absent").map(row => Number(row.employeeId)));
        const leaveIds = new Set(approved.map(row => Number(row.employeeId)));
        const ids = activeStaff.map(row => Number(row.id));
        const counts = {
            total: ids.length,
            present: ids.filter(id => presentIds.has(id)).length,
            onLeave: ids.filter(id => !presentIds.has(id) && leaveIds.has(id)).length,
            absent: ids.filter(id => absentIds.has(id) && !presentIds.has(id) && !leaveIds.has(id)).length,
            notRecorded: 0,
        };
        counts.notRecorded = Math.max(0, counts.total - counts.present - counts.onLeave - counts.absent);

        // Personal manager log; use the VERIFIED manager ID, not any ID from the browser.
        // The same attendance/leave tables are used as the Staff Attendance Log.
        const [managerClockRows] = await db.query<RowDataPacket[]>(`
                    SELECT id, DATE_FORMAT(attendance_date,'%Y-%m-%d') AS date,
                   DATE_FORMAT(time_in,'%Y-%m-%dT%H:%i:%s') AS timeIn,
                   DATE_FORMAT(time_out,'%Y-%m-%dT%H:%i:%s') AS timeOut,
                   CASE WHEN time_in IS NOT NULL AND time_out IS NOT NULL
                        THEN ROUND(TIMESTAMPDIFF(MINUTE,time_in,time_out)/60,2) ELSE NULL END AS hoursWorked,
                   CASE WHEN attendance_status='Present' AND time_out IS NULL THEN 'On Duty'
                        WHEN attendance_status='Present' THEN 'Completed'
                        ELSE attendance_status END AS status
            FROM stocknbook_staff_attendance
            WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
            ORDER BY attendance_date DESC, id DESC LIMIT 800`,
            [manager.storeId, manager.branchId, manager.id]);
        const [managerLeaveRows] = await db.query<RowDataPacket[]>(`
                    SELECT id, DATE_FORMAT(leave_date,'%Y-%m-%d') AS date,
                   leave_type AS leaveType, reason, approval_status AS approvalStatus,
                   DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS requestCreatedAt,
                   decision_reason AS decisionReason,
                   DATE_FORMAT(reviewed_at,'%Y-%m-%d %H:%i:%s') AS reviewedAt
                    FROM stocknbook_staff_leave_requests
                    WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                    ORDER BY leave_date DESC, id DESC LIMIT 800`,
            [manager.storeId, manager.branchId, manager.id]);
        const managerAttendance = [
            ...managerClockRows,
            ...managerLeaveRows.map(row => ({
                id: -Number(row.id), date: row.date,
                timeIn: null, timeOut: null, hoursWorked: null,
                status: 'Leave', leaveType: row.leaveType, reason: row.reason,
                approvalStatus: row.approvalStatus,
                requestCreatedAt: row.requestCreatedAt,
                decisionReason: row.decisionReason,
                reviewedAt: row.reviewedAt,
            })),
        ].sort((a,b) => String(b.date).localeCompare(String(a.date)) || Number(b.id)-Number(a.id));
        const managerAttendanceToday = managerClockRows.find(row => row.date === phToday) || null;

        // Existing Team Attendance panel needs the branch's recent staff history.
        const [teamAttendance] = await db.query<RowDataPacket[]>(`
                    SELECT id, employee_id AS employeeId, employee_name AS employeeName,
                           DATE_FORMAT(attendance_date,'%Y-%m-%d') AS date,
                   DATE_FORMAT(time_in,'%Y-%m-%dT%H:%i:%s') AS timeIn,
                   DATE_FORMAT(time_out,'%Y-%m-%dT%H:%i:%s') AS timeOut,
                   CASE WHEN time_in IS NOT NULL AND time_out IS NOT NULL
                        THEN ROUND(TIMESTAMPDIFF(MINUTE,time_in,time_out)/60,2) ELSE NULL END AS hoursWorked,
                   CASE WHEN attendance_status='Present' AND time_out IS NULL THEN 'On Duty'
                        WHEN attendance_status='Present' THEN 'Completed'
                        ELSE attendance_status END AS status
            FROM stocknbook_staff_attendance
            WHERE store_id=? AND branch_id=? AND employee_role='staff'
              AND attendance_date >= DATE_SUB(${PH_TODAY}, INTERVAL 90 DAY)
                    ORDER BY attendance_date DESC, id DESC LIMIT 800`,
            scope);
        return response({ success: true, date, mayReviewLeave: manager.mayReviewLeave,
            attendanceSummary: counts, attendance, leaves,
            managerAttendance, managerAttendanceToday, teamAttendance });
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

        // A manager may record their OWN attendance and request leave, irrespective
        // of permission to review staff requests. Manager leave cannot be self-approved.
        if (["time_in", "time_out", "request_leave"].includes(action)) {
            await connection.beginTransaction();
            if (action === "time_in") {
                const [existing] = await connection.query<RowDataPacket[]>(`
                            SELECT id FROM stocknbook_staff_attendance
                            WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                              AND attendance_date=${PH_TODAY} LIMIT 1 FOR UPDATE`,
                    [manager.storeId, manager.branchId, manager.id]);
                if (existing.length) throw new ApiError(409, "You have already recorded attendance today.");
                const [approved] = await connection.query<RowDataPacket[]>(`
                            SELECT id FROM stocknbook_staff_leave_requests
                            WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                              AND leave_date=${PH_TODAY} AND approval_status='Approved' LIMIT 1`,
                    [manager.storeId, manager.branchId, manager.id]);
                if (approved.length) throw new ApiError(409, "You have approved leave today; attendance cannot also be recorded.");
                await connection.execute(`
                            INSERT INTO stocknbook_staff_attendance
                            (store_id,branch_id,employee_id,employee_role,store_name,branch_name,
                             employee_name,employee_number,attendance_date,time_in,attendance_status)
                            VALUES (?,?,?,'manager',?,?,?,?,${PH_TODAY},${PH_NOW},'Present')`,
                    [manager.storeId, manager.branchId, manager.id, manager.storeName,
                        manager.branchName, manager.managerName, String(manager.id)]);
            } else if (action === "time_out") {
                const [rows] = await connection.query<RowDataPacket[]>(`
                            SELECT id,time_in,time_out,attendance_status FROM stocknbook_staff_attendance
                            WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                              AND attendance_date=${PH_TODAY} LIMIT 1 FOR UPDATE`,
                    [manager.storeId, manager.branchId, manager.id]);
                if (!rows.length || !rows[0].time_in || rows[0].time_out || rows[0].attendance_status !== "Present") {
                    throw new ApiError(409, "Time In is required before Time Out, and Time Out can only be recorded once.");
                }
                await connection.execute(`UPDATE stocknbook_staff_attendance
                                          SET time_out=${PH_NOW},updated_at=CURRENT_TIMESTAMP WHERE id=?`, [rows[0].id]);
            } else {
                const startDate = String(body.start_date || body.leave_date || "");
                const endDate = String(body.end_date || body.leave_date || startDate);
                const reason = String(body.reason || "").trim();
                const kind = String(body.leave_type || "Personal");
                if (!isDay(startDate) || !isDay(endDate) || startDate > endDate ||
                    reason.length < 3 || reason.length > 1000 ||
                    !["Personal", "Sick", "Emergency", "Vacation", "Other"].includes(kind)) {
                    throw new ApiError(400, "Choose valid leave dates, leave type, and a reason of 3–1000 characters.");
                }
                const dayCount = Math.round((Date.parse(`${endDate}T00:00:00Z`) -
                    Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
                if (dayCount > 90) throw new ApiError(400, "Leave may cover at most 90 calendar days.");
                const [dateRows] = await connection.query<RowDataPacket[]>(
                    `SELECT DATE_FORMAT(${PH_TODAY},'%Y-%m-%d') AS today`);
                if (startDate < String(dateRows[0].today)) {
                    throw new ApiError(400, "Leave dates cannot be in the past.");
                }
                const [attendanceConflict] = await connection.query<RowDataPacket[]>(`
                            SELECT DATE_FORMAT(attendance_date,'%Y-%m-%d') AS date
                            FROM stocknbook_staff_attendance
                            WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                              AND attendance_date BETWEEN ? AND ? LIMIT 1 FOR UPDATE`,
                    [manager.storeId,manager.branchId,manager.id,startDate,endDate]);
                if (attendanceConflict.length) {
                    throw new ApiError(409, `Attendance already exists on ${attendanceConflict[0].date}. Choose other leave dates.`);
                }
                const [leaveConflict] = await connection.query<RowDataPacket[]>(`
                            SELECT DATE_FORMAT(leave_date,'%Y-%m-%d') AS date
                            FROM stocknbook_staff_leave_requests
                            WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                              AND leave_date BETWEEN ? AND ? LIMIT 1 FOR UPDATE`,
                    [manager.storeId,manager.branchId,manager.id,startDate,endDate]);
                if (leaveConflict.length) {
                    throw new ApiError(409, `A leave request already exists for ${leaveConflict[0].date}.`);
                }
                for (let index = 0; index < dayCount; index++) {
                    const day = new Date(Date.parse(`${startDate}T00:00:00Z`) + index*86400000).toISOString().slice(0,10);
                    await connection.execute(`
                                INSERT INTO stocknbook_staff_leave_requests
                                (store_id,branch_id,employee_id,employee_role,store_name,branch_name,
                                 employee_name,employee_number,leave_date,leave_type,reason,approval_status)
                                VALUES (?,?,?,'manager',?,?,?,?,?,?,?,'Pending')`,
                        [manager.storeId,manager.branchId,manager.id,manager.storeName,
                            manager.branchName,manager.managerName,String(manager.id),day,kind,reason]);
                }
            }
            await connection.commit();
            return response({ success: true, action, message: action === 'request_leave'
                    ? 'Your manager leave request was submitted for approval.' : 'Manager attendance recorded.' });
        }

        if (action !== "review_leave") throw new ApiError(400, "Unsupported manager action.");
        if (!manager.mayReviewLeave) throw new ApiError(403, "Staff Management permission is required to approve or disapprove leave.");
        const decision = String(body.decision || "");
        const ids = Array.isArray(body.requestIds) ? body.requestIds.map(positiveInt) : [];
        const decisionReason = String(body.decisionReason || "").trim();
        if (!["Approved", "Rejected"].includes(decision) || !ids.length || ids.length > 90 ||
            new Set(ids).size !== ids.length || ids.some(id => !id) || decisionReason.length > 500) {
            throw new ApiError(400, "Select valid leave request records and an approval decision.");
        }
        if (decision === "Rejected" && decisionReason.length < 3) {
            throw new ApiError(400, "Please provide a reason for disapproving the leave (at least 3 characters).");
        }
        await connection.beginTransaction();
        const placeholders = ids.map(() => "?").join(",");
        const [rows] = await connection.query<RowDataPacket[]>(
            `SELECT id, employee_id, leave_type, reason, approval_status,
                    DATE_FORMAT(leave_date,'%Y-%m-%d') AS leaveDate
             FROM stocknbook_staff_leave_requests
             WHERE id IN (${placeholders}) AND store_id=? AND branch_id=? AND employee_role='staff'
             ORDER BY id FOR UPDATE`,
            [...ids, manager.storeId, manager.branchId],
        );
        if (rows.length !== ids.length) throw new ApiError(404, "One or more leave dates were not found in your branch.");
        if (rows.some(row => row.approval_status !== "Pending")) {
            throw new ApiError(409, "This leave request was already reviewed. Refresh and try again.");
        }
        if (rows.some(row => Number(row.employee_id) !== Number(rows[0].employee_id) ||
            row.leave_type !== rows[0].leave_type || row.reason !== rows[0].reason)) {
            throw new ApiError(400, "A review must concern one employee's single leave request.");
        }
        if (decision === "Approved") {
            const dates = rows.map(row => row.leaveDate);
            const [recorded] = await connection.query<RowDataPacket[]>(
                `SELECT DATE_FORMAT(attendance_date,'%Y-%m-%d') AS day FROM stocknbook_staff_attendance
                 WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='staff'
                   AND attendance_date IN (${dates.map(() => "?").join(",")}) LIMIT 1 FOR UPDATE`,
                [manager.storeId, manager.branchId, rows[0].employee_id, ...dates],
            );
            if (recorded.length) throw new ApiError(409, `Attendance is already recorded on ${recorded[0].day}; it cannot also be approved as leave.`);
        }
        const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE stocknbook_staff_leave_requests
             SET approval_status=?, decision_reason=?, approved_by=?, reviewed_at=CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+08:00')
             WHERE id IN (${placeholders}) AND store_id=? AND branch_id=? AND approval_status='Pending'`,
            [decision, decisionReason || null, manager.id, ...ids, manager.storeId, manager.branchId],
        );
        if (result.affectedRows !== ids.length) throw new ApiError(409, "The leave request changed during review; please refresh.");
        await connection.commit();
        return response({ success: true, decision, updated: ids.length });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => undefined);
        return handleError(error, "Manager staff leave review POST failed:");
    } finally { connection?.release(); }
}

