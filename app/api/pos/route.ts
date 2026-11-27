import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-pos/index.js";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    try {
        // Empty or interrupted POST bodies must not surface as server errors.
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json(
                { error: "Invalid or empty JSON request body." },
                { status: 400 }
            );
        }

        const authHeader = req.headers.get("authorization");

        const event = {
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader || "",
            },
            body: JSON.stringify(body),
            requestContext: {
                http: {
                    method: "POST",
                },
            },
        };

        const response = await handler(event);

        let parsed: unknown = {};

        try {
            parsed = response.body ? JSON.parse(response.body) : {};
        } catch {
            parsed = {
                error: response.body || "Invalid server response",
            };
        }

        return NextResponse.json(parsed, {
            status: response.statusCode || 200,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "POS route failed";

        console.error("Local POS API Error:", error);

        return NextResponse.json({ error: message }, { status: 500 });
    }
}