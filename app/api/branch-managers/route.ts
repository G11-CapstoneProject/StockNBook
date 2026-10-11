import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";

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

        return await callLocalAuth(req, action, body);
    } catch (error) {
        console.error("Local update manager route error:", error);
        return NextResponse.json(
            { error: "Update manager server error" },
            { status: 500 }
        );
    }
}