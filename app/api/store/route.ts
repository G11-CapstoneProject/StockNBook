import { NextRequest, NextResponse } from "next/server";

const STORE_API = "https://7oxhafersb.execute-api.ap-southeast-1.amazonaws.com";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const response = await fetch(STORE_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            cache: "no-store",
        });

        const text = await response.text();
        console.log("STORE API STATUS:", response.status);
        console.log("STORE API RAW:", text);

        return new NextResponse(text, {
            status: response.status,
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (error: unknown) {
        console.error("STORE ROUTE ERROR:", error);

        const message =
            error instanceof Error ? error.message : "Store route failed";

        return NextResponse.json({ error: message }, { status: 500 });
    }
}