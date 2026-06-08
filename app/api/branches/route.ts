import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://7oxhafersb.execute-api.ap-southeast-1.amazonaws.com";

async function callLambda(req: NextRequest, action: string, body: object = {}) {
    const authHeader = req.headers.get("authorization");

    const response = await fetch(`${LAMBDA_URL}/onboarding`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader || "",
        },
        body: JSON.stringify({
            action,
            ...body,
        }),
    });

    const text = await response.text();

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { error: text || "Invalid response from branches server" };
    }

    return NextResponse.json(data, {
        status: response.status,
    });
}

export async function GET(req: NextRequest) {
    try {
        return await callLambda(req, "get_branches");
    } catch {
        return NextResponse.json(
            { error: "Branches server error" },
            { status: 500 }
        );
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        return await callLambda(req, "update_branch", body);
    } catch {
        return NextResponse.json(
            { error: "Update branch server error" },
            { status: 500 }
        );
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json();
        return await callLambda(req, "delete_branch", body);
    } catch {
        return NextResponse.json(
            { error: "Delete branch server error" },
            { status: 500 }
        );
    }
}

