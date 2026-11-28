import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const event = {
            headers: {
                "Content-Type": "application/json",
                Authorization: req.headers.get("authorization") || "",
            },
            body: JSON.stringify(body),
            requestContext: {
                http: {
                    method: "POST",
                },
            },
        };

        const response = await handler(event);

        if (!response) {
            return NextResponse.json(
                { error: "Invalid response from invite server" },
                { status: 502 }
            );
        }

        let data: unknown = {};

        try {
            data = response.body ? JSON.parse(response.body) : {};
        } catch {
            data = {
                error: response.body || "Invalid response from invite server",
            };
        }

        return NextResponse.json(data, {
            status: response.statusCode || 200,
        });
    } catch (error) {
        console.error("Local manager invite route error:", error);
        return NextResponse.json(
            { error: "Invite server error" },
            { status: 500 }
        );
    }
}