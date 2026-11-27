import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-bookings/index.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    try {
        // Empty or interrupted POST bodies must not surface as server errors.
        const body = await req.json().catch(() => null);
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

        const event = {
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader || "",
            },
            body: JSON.stringify(body),
            httpMethod: "POST",
            requestContext: {
                http: {
                    method: "POST",
                },
            },
        };

        const response = await handler(event);

        console.log("LOCAL BOOKINGS API ACTION:", body.action);
        console.log("LOCAL BOOKINGS API STATUS:", response.statusCode);

        const rawText = response.body || "";
        let parsedData: unknown = {};

        try {
            parsedData = rawText ? JSON.parse(rawText) : {};
        } catch {
            parsedData = {
                error:
                    rawText ||
                    "Bookings API returned an invalid response.",
            };
        }

        if (response.statusCode && response.statusCode >= 400) {
            return NextResponse.json(
                {
                    error:
                        typeof parsedData === "object" &&
                        parsedData !== null &&
                        "error" in parsedData
                            ? String(
                                (
                                    parsedData as {
                                        error?: unknown;
                                    }
                                ).error
                            )
                            : "Bookings API request failed.",
                    action: body.action,
                    status: response.statusCode,
                    details: parsedData,
                },
                {
                    status: response.statusCode,
                }
            );
        }

        return NextResponse.json(parsedData, {
            status: response.statusCode || 200,
        });
    } catch (error: unknown) {
        console.error("LOCAL BOOKINGS ROUTE ERROR:", error);

        const message =
            error instanceof Error
                ? error.message
                : "Bookings route failed";

        return NextResponse.json(
            {
                error: message,
            },
            {
                status: 500,
            }
        );
    }
}