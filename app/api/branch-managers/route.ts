import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://qyjajerkuc.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-auth";

async function callLambda(req: NextRequest, action: string, body: object = {}) {
    const authHeader = req.headers.get("authorization");

    const response = await fetch(LAMBDA_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader || "",
        },
        body: JSON.stringify({
            action,
            ...body,
        }),
        cache: "no-store",
    });

    const text = await response.text();

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { error: text || "Invalid response from branch managers server" };
    }

    return NextResponse.json(data, {
        status: response.status,
    });
}

export async function GET(req: NextRequest) {
    try {
        return await callLambda(req, "get_branch_managers");
    } catch {
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

        return await callLambda(req, action, body);
    } catch {
        return NextResponse.json(
            { error: "Update manager server error" },
            { status: 500 }
        );
    }
}