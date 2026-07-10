import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://qyjajerkuc.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-auth";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const authHeader = req.headers.get("authorization");

        const response = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader || "",
            },
            body: JSON.stringify(body),
        });

        const text = await response.text();

        let data;

        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = {
                error: text || "Invalid response from staff management server",
            };
        }

        return NextResponse.json(data, {
            status: response.status,
        });
    } catch {
        return NextResponse.json(
            { error: "Staff management server error" },
            { status: 500 }
        );
    }
}

