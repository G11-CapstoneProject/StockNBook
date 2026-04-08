import { NextRequest, NextResponse } from "next/server";

const CATEGORIES_API =
    "https://7oxhafersb.execute-api.ap-southeast-1.amazonaws.com/stocknbook-categories";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const authHeader = req.headers.get("authorization");

        const response = await fetch(CATEGORIES_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify(body),
            cache: "no-store",
        });

        const text = await response.text();
        let parsed: unknown;

        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = { error: text || "Non-JSON response from categories upstream" };
        }

        return NextResponse.json(parsed, { status: response.status });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Categories route failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}