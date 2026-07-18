import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BOOKINGS_API =
    "https://pljhhsstag.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-bookings";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const authHeader = req.headers.get("authorization");

        if (!body || typeof body !== "object") {
            return NextResponse.json(
                { error: "Invalid request body." },
                { status: 400 }
            );
        }

        if (!body.action) {
            return NextResponse.json(
                { error: "Missing booking action." },
                { status: 400 }
            );
        }

        const response = await fetch(BOOKINGS_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify(body),
            cache: "no-store",
        });

        const rawText = await response.text();

        console.log("BOOKINGS API ACTION:", body.action);
        console.log("BOOKINGS API STATUS:", response.status);
        console.log("BOOKINGS API RAW:", rawText);

        let parsedData: unknown = null;

        try {
            parsedData = rawText ? JSON.parse(rawText) : {};
        } catch {
            parsedData = {
                error: rawText || "Bookings API returned an invalid response.",
            };
        }

        if (!response.ok) {
            return NextResponse.json(
                {
                    error:
                        typeof parsedData === "object" && parsedData !== null
                            ? "error" in parsedData
                                ? String((parsedData as { error?: unknown }).error)
                                : "message" in parsedData
                                    ? String((parsedData as { message?: unknown }).message)
                                    : "Bookings API request failed."
                            : "Bookings API request failed.",
                    action: body.action,
                    status: response.status,
                    details: parsedData,
                },
                { status: response.status }
            );
        }

        return NextResponse.json(parsedData, { status: response.status });
    } catch (error: unknown) {
        console.error("BOOKINGS ROUTE ERROR:", error);

        const message =
            error instanceof Error ? error.message : "Bookings route failed";

        return NextResponse.json(
            {
                error: message,
            },
            { status: 500 }
        );
    }
}