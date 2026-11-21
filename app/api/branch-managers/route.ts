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
    if (!response) {
        return NextResponse.json(
            { error: "Authentication server did not return a response." },
            { status: 502 },
        );
    }

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

// Owner-only manager account access status. Existing invitation
// and manager-list operations continue through lambda-auth unchanged.
let ownerPool: Pool | undefined;
// ===== ENV SECURITY CHANGE: Required environment variable helper BEGIN =====
function requiredEnv(name: string): string {
    const value = process.env[name];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function ownerDatabase(): Pool {
// ===== ENV SECURITY CHANGE: Required environment variable helper END =====
    if (!ownerPool) {
        ownerPool = mysql.createPool({
            // ===== ENV SECURITY CHANGE: MySQL environment configuration BEGIN =====
            host: requiredEnv("DB_HOST"),
            port: Number(process.env.DB_PORT || 3306),
            user: requiredEnv("DB_USER"),
            password: requiredEnv("DB_PASSWORD"),
            database: requiredEnv("DB_NAME"),
            // ===== ENV SECURITY CHANGE: MySQL environment configuration END =====
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
    // ===== ENV SECURITY CHANGE: Remove development JWT fallback BEGIN =====
    const secret = process.env.JWT_SECRET?.trim();
    // ===== ENV SECURITY CHANGE: Remove development JWT fallback END =====
    if (!secret) throw new ManagerAccessError(503, "JWT_SECRET is not configured.");
    let claims: Record<string, unknown>;
    try {
        const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw Error();
        claims = decoded as Record<string, unknown>;
    } catch { throw new ManagerAccessError(401, "Your session expired. Please sign in again."); }
    if (String(claims.role || "").toLowerCase() !== "owner") {
        throw new ManagerAccessError(403, "Only the store owner can change manager access.");
    }
    const storeId = validId(claims.store_id);
    const email = String(claims.email || "").trim();
    if (!storeId || !email) throw new ManagerAccessError(403, "Invalid owner identity.");
    // The owner is the store's users row with role 'owner'.
    // Check the exact active Owner and current auth_version. A password reset
    // invalidates previously issued tokens even on this direct Next.js route.
    const ownerId = validId(claims.user_id);
    const version = claims.auth_version;
    if (!ownerId || !Number.isSafeInteger(version) || Number(version) < 0) {
        throw new ManagerAccessError(401, "Your session expired. Please sign in again.");
    }
    const [stores] = await db.query<RowDataPacket[]>(
        `SELECT id FROM users WHERE id=? AND store_id=? AND role='owner'
                                AND LOWER(email)=LOWER(?) AND LOWER(status)='active' AND auth_version=? LIMIT 1`,
        [ownerId, storeId, email, version]
    );
    if (!stores.length) throw new ManagerAccessError(401, "Your session expired. Please sign in again.");
    return storeId;
}
function handleOwnerError(error: unknown) {
    if (error instanceof ManagerAccessError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("Owner branch-manager request error:", error);
    return NextResponse.json({ success: false, error:
            // ===== ENV SECURITY CHANGE: Match requiredEnv errors and root .env BEGIN =====
                error instanceof Error && error.message.startsWith("Missing required environment variable: DB_")
                    ? "Configure the required database variables in .env, then restart Next.js."
                    // ===== ENV SECURITY CHANGE: Match requiredEnv errors and root .env END =====
                    : "Unable to update manager access. Check the server log and database configuration." },
        { status: 503 });
}

async function setManagerAccess(req: NextRequest, body: Record<string, unknown>, action: string) {
    try {
        const db = ownerDatabase();
        const storeId = await verifyOwner(req, db);
        const managerId = validId(body.manager_id);
        if (!managerId) throw new ManagerAccessError(400, "A valid manager ID is required.");
        const activate = action === "reactivate_manager";
        const [result] = await db.execute<ResultSetHeader>(`
                    UPDATE users SET status=?, auth_version=auth_version+1
                    WHERE id=? AND store_id=? AND role='manager' AND status=?`,
            [activate ? "active" : "inactive", managerId, storeId,
                activate ? "inactive" : "active"]);
        if (result.affectedRows !== 1) throw new ManagerAccessError(409,
            "Manager status was already changed, or manager does not belong to your store.");
        return NextResponse.json({ success: true, status: activate ? "active" : "inactive" });
    } catch (error) { return handleOwnerError(error); }
}

export async function GET(req: NextRequest) {
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

        // Owner-only manager account management. lambda-auth verifies the
        // Owner token and store for every action listed here.
        const allowedActions = new Set([
            "add_manager_to_branch",
            "resend_manager_invite",
            "deactivate_manager",
            "reactivate_manager",
            "update_manager_details",
            "request_manager_email_change",
            "confirm_manager_email_change",
            "cancel_manager_invite",
        ]);

        if (!allowedActions.has(action)) {
            return NextResponse.json(
                { error: "Unsupported branch manager action" },
                { status: 400 }
            );
        }

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