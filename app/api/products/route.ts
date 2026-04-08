import { NextRequest, NextResponse } from "next/server";

const PRODUCTS_API =
    "https://7oxhafersb.execute-api.ap-southeast-1.amazonaws.com/stocknbook-products";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const authHeader = req.headers.get("authorization");

        const response = await fetch(PRODUCTS_API, {
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
            parsed = { error: text || "Non-JSON response from products upstream" };
        }

        return NextResponse.json(parsed, { status: response.status });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Products route failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}