import { NextRequest, NextResponse } from "next/server";

const BOOKINGS_API =
    "https://orbevev383.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-bookings";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const authHeader = req.headers.get("authorization");

        const response = await fetch(BOOKINGS_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify(body),
            cache: "no-store",
        });

        const text = await response.text();
        console.log("BOOKINGS API STATUS:", response.status);
        console.log("BOOKINGS API RAW:", text);

        return new NextResponse(text, {
            status: response.status,
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (error: unknown) {
        console.error("BOOKINGS ROUTE ERROR:", error);

        const message =
            error instanceof Error ? error.message : "Bookings route failed";

        return NextResponse.json({ error: message }, { status: 500 });
    }
}