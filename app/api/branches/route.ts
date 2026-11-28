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
            ...body,
            action,
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
            { error: "No response from the branches server." },
            { status: 502 }
        );
    }

    let data: unknown = {};

    try {
        data = response.body ? JSON.parse(response.body) : {};
    } catch {
        data = {
            error: response.body || "Invalid response from branches server",
        };
    }

    return NextResponse.json(data, {
        status: response.statusCode || 200,
    });
}

export async function GET(req: NextRequest) {
    try {
        return await callLocalAuth(req, "get_branches");
    } catch (error) {
        console.error("Local branches route error:", error);
        return NextResponse.json(
            { error: "Branches server error" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        return await callLocalAuth(req, "create_branch", body);
    } catch (error) {
        console.error("Local create branch route error:", error);
        return NextResponse.json(
            { error: "Create branch server error" },
            { status: 500 }
        );
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        return await callLocalAuth(req, "update_branch", body);
    } catch (error) {
        console.error("Local update branch route error:", error);
        return NextResponse.json(
            { error: "Update branch server error" },
            { status: 500 }
        );
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json();
        return await callLocalAuth(req, "delete_branch", body);
    } catch (error) {
        console.error("Local delete branch route error:", error);
        return NextResponse.json(
            { error: "Delete branch server error" },
            { status: 500 }
        );
    }
}