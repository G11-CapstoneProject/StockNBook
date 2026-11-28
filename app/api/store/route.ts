import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
    let incomingBody: unknown;

    try {
        incomingBody = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body." },
            { status: 400, headers: NO_STORE_CACHE }
        );
    }

    if (
        !incomingBody ||
        typeof incomingBody !== "object" ||
        Array.isArray(incomingBody)
    ) {
        return NextResponse.json(
            { error: "Invalid request body." },
            { status: 400, headers: NO_STORE_CACHE }
        );
    }

    const { action, slug } = incomingBody as {
        action?: unknown;
        slug?: unknown;
    };

    // This is a public store-lookup endpoint, not a general authentication proxy.
    if (action !== "get_store_by_slug") {
        return NextResponse.json(
            { error: "Unsupported store action." },
            { status: 400, headers: NO_STORE_CACHE }
        );
    }

    if (
        typeof slug !== "string" ||
        !slug.trim() ||
        slug.length > 255
    ) {
        return NextResponse.json(
            { error: "Invalid store slug." },
            { status: 400, headers: NO_STORE_CACHE }
        );
    }

    try {
        // Use the existing StockNBook Authentication Lambda and MySQL connection.
        // Only pass the public lookup action and its slug to the handler.
        const response = await handler({
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "get_store_by_slug",
                slug: slug.trim(),
            }),
            httpMethod: "POST",
            requestContext: { http: { method: "POST" } },
        });

        if (!response) {
            return NextResponse.json(
                { error: "Invalid store lookup response." },
                { status: 502, headers: NO_STORE_CACHE }
            );
        }

        let data: unknown;

        try {
            data = response.body ? JSON.parse(response.body) : {};
        } catch {
            console.error("LOCAL STORE API: Invalid backend response.");
            return NextResponse.json(
                { error: "Invalid store lookup response." },
                { status: 502, headers: NO_STORE_CACHE }
            );
        }

        return NextResponse.json(data, {
            status: response.statusCode || 200,
            headers: NO_STORE_CACHE,
        });
    } catch (error: unknown) {
        console.error(
            "LOCAL STORE ROUTE ERROR:",
            error instanceof Error ? error.message : "Unknown error"
        );

        return NextResponse.json(
            { error: "Unable to load store." },
            { status: 500, headers: NO_STORE_CACHE }
        );
    }
}