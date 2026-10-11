import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-rental-inventory/index.js";

// Same local Next.js -> Lambda-handler design as app/api/products/route.ts.
// This is a NEW endpoint. Keep the existing Sales Inventory endpoint unchanged.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+/i.test(authorization)) {
        return NextResponse.json(
            { success: false, error: "Please sign in to access Rental Inventory." },
            { status: 401, headers: noStore }
        );
    }

    let body: unknown;
    try {
        const raw = await req.text();
        if (raw.length > 2_000_000) {
            return NextResponse.json(
                { success: false, error: "Rental inventory request is too large." },
                { status: 413, headers: noStore }
            );
        }
        body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error("Body is not a JSON object.");
        }
    } catch {
        return NextResponse.json(
            { success: false, error: "Invalid rental inventory JSON request." },
            { status: 400, headers: noStore }
        );
    }

    try {
        const response = await handler({
            headers: { Authorization: authorization },
            body: JSON.stringify(body),
            requestContext: { http: { method: "POST" } },
        });

        let parsed: unknown;
        try {
            parsed = response.body ? JSON.parse(response.body) : {};
        } catch {
            return NextResponse.json(
                { success: false, error: "Rental backend returned an invalid response." },
                { status: 502, headers: noStore }
            );
        }
        const status = Number(response.statusCode) || 500;
        return NextResponse.json(parsed, {
            status: status >= 200 && status <= 599 ? status : 500,
            headers: noStore,
        });
    } catch (error) {
        console.error("Local Rental Inventory API error:", error);
        return NextResponse.json(
            { success: false, error: "Unable to process rental inventory. Check the Next.js server logs." },
            { status: 500, headers: noStore }
        );
    }
}
