import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";
import jwt from "jsonwebtoken";
import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function callLocalAuth(
    req: NextRequest,
    action: string,
    body: Record<string, unknown> = {}
) {
    const event = {
        headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.get("authorization") || "",
        },
        body: JSON.stringify({
            action,
            ...body,
        }),
        requestContext: {
            http: {
                method: "POST",
            },
        },
    };

    const response = await handler(event);

    let data: unknown = {};

    try {
        data = response.body ? JSON.parse(response.body) : {};
    } catch {
        data = {
            error:
                response.body ||
                "Invalid response from branch managers server",
        };
    }

    return NextResponse.json(data, {
        status: response.statusCode || 200,
    });
}

// Owner-only manager leave requests and account access status. Existing invitation
// and manager-list operations continue through lambda-auth unchanged.
let ownerPool: Pool | undefined;
function ownerDatabase(): Pool {
    if (!ownerPool) {
        ownerPool = mysql.createPool({
            host: process.env.DB_HOST || process.env.MYSQL_HOST || "127.0.0.1",
            port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
            user: process.env.DB_USER || process.env.MYSQL_USER || "root",
            password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD! || "BTA5EYVWLfWcebF",
            database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "stocknbook",
            waitForConnections: true,
            connectionLimit: 6,
            timezone: "+08:00",
        });
    }
    return ownerPool;
}

class ManagerAccessError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
const validId = (value: unknown): number => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
};
async function verifyOwner(req: NextRequest, db: Pool): Promise<number> {
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new ManagerAccessError(401, "Owner login is required.");
    const secret = process.env.JWT_SECRET?.trim() ||
        (process.env.NODE_ENV !== "production" ? "stocknbook-secret-key" : "");
    if (!secret) throw new ManagerAccessError(503, "JWT_SECRET is not configured.");
    let claims: Record<string, unknown>;
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw Error();
        claims = decoded as Record<string, unknown>;
    } catch { throw new ManagerAccessError(401, "Your session expired. Please sign in again."); }
    if (String(claims.role || "").toLowerCase() !== "owner") {
        throw new ManagerAccessError(403, "Only the store owner can review manager requests.");
    }
    const storeId = validId(claims.store_id);
    const email = String(claims.email || "").trim();
    if (!storeId || !email) throw new ManagerAccessError(403, "Invalid owner identity.");
    const [stores] = await db.query<RowDataPacket[]>(
        "SELECT id FROM stores WHERE id=? AND LOWER(email)=LOWER(?) LIMIT 1", [storeId, email]
    );
    if (!stores.length) throw new ManagerAccessError(403, "Owner account could not be verified.");
    return storeId;
}
function handleOwnerError(error: unknown) {
    if (error instanceof ManagerAccessError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("Owner branch-manager request error:", error);
    return NextResponse.json({ success: false, error:
                error instanceof Error && error.message.startsWith("DB_PASSWORD is not configured")
                    ? "Configure DB_PASSWORD in .env.local for Manager Requests, then restart Next.js."
                    : "Unable to process manager requests. Check the server log and database configuration." },
        { status: 503 });
}

async function listManagerRequests(req: NextRequest) {
    try {
        const db = ownerDatabase();
        const storeId = await verifyOwner(req, db);
        const [rows] = await db.query<RowDataPacket[]>(`
            SELECT l.id, l.employee_id AS managerId,
                   COALESCE(m.manager_name, l.employee_name) AS managerName,
                   COALESCE(b.branch_name, l.branch_name) AS branchName,
                   l.branch_id AS branchId,
                   DATE_FORMAT(l.leave_date,'%Y-%m-%d') AS leaveDate,
                   l.leave_type AS leaveType, l.reason,
                   l.approval_status AS approvalStatus,
                   l.decision_reason AS decisionReason,
                   DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
            FROM stocknbook_staff_leave_requests l
                     JOIN managers m ON m.id = l.employee_id AND m.store_id = l.store_id AND m.branch_id = l.branch_id
                     JOIN branches b ON b.id = l.branch_id AND b.store_id = l.store_id
            WHERE l.store_id=? AND l.employee_role='manager'
            ORDER BY (l.approval_status='Pending') DESC, l.created_at DESC, l.leave_date ASC
                LIMIT 1500`, [storeId]);
        return NextResponse.json({ success: true, requests: rows },
            { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return handleOwnerError(error); }
}

async function reviewManagerRequest(req: NextRequest, body: Record<string, unknown>) {
    let connection: Awaited<ReturnType<Pool["getConnection"]>> | undefined;
    try {
        const db = ownerDatabase();
        const storeId = await verifyOwner(req, db);
        const ids = Array.isArray(body.requestIds) ? body.requestIds.map(validId) : [];
        const decision = String(body.decision || "");
        const note = String(body.decisionReason || "").trim();
        if (!ids.length || ids.length > 90 || new Set(ids).size !== ids.length || ids.some(id => !id) ||
            !["Approved", "Rejected"].includes(decision) || note.length > 500 ||
            (decision === "Rejected" && note.length < 3)) {
            throw new ManagerAccessError(400, "Select one valid manager request. Provide a reason when rejecting.");
        }
        connection = await db.getConnection();
        await connection.beginTransaction();
        const placeholders = ids.map(() => "?").join(",");
        const [rows] = await connection.query<RowDataPacket[]>(`
            SELECT id, employee_id AS managerId, branch_id AS branchId,
                   leave_type AS leaveType, reason, approval_status AS status,
                   DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt,
                   DATE_FORMAT(leave_date,'%Y-%m-%d') AS leaveDate
            FROM stocknbook_staff_leave_requests
            WHERE id IN (${placeholders}) AND store_id=? AND employee_role='manager'
            ORDER BY leave_date FOR UPDATE`, [...ids, storeId]);
        if (rows.length !== ids.length) throw new ManagerAccessError(404, "Manager request not found in your store.");
        if (rows.some(row => row.status !== "Pending")) throw new ManagerAccessError(409, "The manager request was already reviewed.");
        if (rows.some(row => Number(row.managerId) !== Number(rows[0].managerId) ||
            Number(row.branchId) !== Number(rows[0].branchId) ||
            row.leaveType !== rows[0].leaveType || row.reason !== rows[0].reason ||
            row.createdAt !== rows[0].createdAt)) {
            throw new ManagerAccessError(400, "Only dates from the same manager request can be reviewed together.");
        }
        if (decision === "Approved") {
            const dates = rows.map(row => String(row.leaveDate));
            const [attendance] = await connection.query<RowDataPacket[]>(`
                SELECT DATE_FORMAT(attendance_date,'%Y-%m-%d') AS day
                FROM stocknbook_staff_attendance
                WHERE store_id=? AND branch_id=? AND employee_id=? AND employee_role='manager'
                  AND attendance_date IN (${dates.map(() => "?").join(",")})
                    LIMIT 1 FOR UPDATE`, [storeId, rows[0].branchId, rows[0].managerId, ...dates]);
            if (attendance.length) throw new ManagerAccessError(409,
                `Manager attendance is already recorded for ${attendance[0].day}.`);
        }
        const [result] = await connection.execute<ResultSetHeader>(`
                    UPDATE stocknbook_staff_leave_requests
                    SET approval_status=?, decision_reason=?, approved_by=?,
                        reviewed_at=CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+08:00')
                    WHERE id IN (${placeholders}) AND store_id=? AND employee_role='manager' AND approval_status='Pending'`,
            [decision, note || null, storeId, ...ids, storeId]);
        if (result.affectedRows !== ids.length) throw new ManagerAccessError(409, "Request changed. Please refresh.");
        await connection.commit();
        return NextResponse.json({ success: true, updated: ids.length });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => undefined);
        return handleOwnerError(error);
    } finally { connection?.release(); }
}

async function setManagerAccess(req: NextRequest, body: Record<string, unknown>, action: string) {
    try {
        const db = ownerDatabase();
        const storeId = await verifyOwner(req, db);
        const managerId = validId(body.manager_id);
        if (!managerId) throw new ManagerAccessError(400, "A valid manager ID is required.");
        const activate = action === "reactivate_manager";
        const [result] = await db.execute<ResultSetHeader>(`
                    UPDATE managers SET status=?
                    WHERE id=? AND store_id=? AND status=?`,
            [activate ? "active" : "inactive", managerId, storeId,
                activate ? "inactive" : "active"]);
        if (result.affectedRows !== 1) throw new ManagerAccessError(409,
            "Manager status was already changed, or manager does not belong to your store.");
        return NextResponse.json({ success: true, status: activate ? "active" : "inactive" });
    } catch (error) { return handleOwnerError(error); }
}

export async function GET(req: NextRequest) {
    if (req.nextUrl.searchParams.get("view") === "manager_requests") {
        return listManagerRequests(req);
    }
    try {
        return await callLocalAuth(req, "get_branch_managers");
    } catch (error) {
        console.error("Local branch managers route error:", error);
        return NextResponse.json(
            { error: "Branch managers server error" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const requestedAction = String(body.action || "").trim();

        const action =
            requestedAction ||
            (body.status === "active"
                ? "reactivate_manager"
                : body.status === "inactive"
                    ? "deactivate_manager"
                    : "");

        const allowedActions = new Set([
            "add_manager_to_branch",
            "resend_manager_invite",
            "deactivate_manager",
            "reactivate_manager",
            "review_manager_leave",
        ]);

        if (!allowedActions.has(action)) {
            return NextResponse.json(
                { error: "Unsupported branch manager action" },
                { status: 400 }
            );
        }

        if (action === "review_manager_leave") return reviewManagerRequest(req, body);
        if (action === "deactivate_manager" || action === "reactivate_manager") {
            return setManagerAccess(req, body, action);
        }
        return await callLocalAuth(req, action, body);
    } catch (error) {
        console.error("Local branch managers route error:", error);
        return NextResponse.json(
            { error: "Branch managers server error" },
            { status: 500 }
        );
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();

        const action =
            body.status === "active"
                ? "reactivate_manager"
                : "deactivate_manager";

        return setManagerAccess(req, body, action);
    } catch (error) {
        console.error("Local update manager route error:", error);
        return NextResponse.json(
            { error: "Update manager server error" },
            { status: 500 }
        );
    }
}