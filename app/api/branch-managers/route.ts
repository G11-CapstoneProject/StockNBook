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

// Owner-only manager account access status. Existing invitation
// and manager-list operations continue through lambda-auth unchanged.
let ownerPool: Pool | undefined;
function ownerDatabase(): Pool {
    if (!ownerPool) {
        ownerPool = mysql.createPool({
            host: process.env.DB_HOST || process.env.MYSQL_HOST || "127.0.0.1",
            port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
            user: process.env.DB_USER || process.env.MYSQL_USER || "root",
            password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD! || "BTA5EYVWLfWcebF",
            database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "stocknbook_v2",
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
        throw new ManagerAccessError(403, "Only the store owner can change manager access.");
    }
    const storeId = validId(claims.store_id);
    const email = String(claims.email || "").trim();
    if (!storeId || !email) throw new ManagerAccessError(403, "Invalid owner identity.");
    // The owner is the store's users row with role 'owner'.
    const [stores] = await db.query<RowDataPacket[]>(
        "SELECT store_id AS id FROM users WHERE store_id=? AND role='owner' AND LOWER(email)=LOWER(?) LIMIT 1", [storeId, email]
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
                    ? "Configure DB_PASSWORD in .env.local for manager access changes, then restart Next.js."
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
                    UPDATE users SET status=?
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

        const allowedActions = new Set([
            "add_manager_to_branch",
            "resend_manager_invite",
            "deactivate_manager",
            "reactivate_manager",
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