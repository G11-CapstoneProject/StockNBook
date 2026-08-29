import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBody(body: string | undefined) {
    if (!body) return {};

    try {
        return JSON.parse(body);
    } catch {
        return { error: body };
    }
}

function authorization(req: NextRequest) {
    return req.headers.get("authorization") || "";
}

export async function GET(req: NextRequest) {
    try {
        const response = await handler({
            headers: {
                "Content-Type": "application/json",
                Authorization: authorization(req),
            },
            body: JSON.stringify({ action: "get_subscription" }),
            requestContext: { http: { method: "POST" } },
        });

        return NextResponse.json(parseBody(response.body), {
            status: response.statusCode || 200,
        });
    } catch (error) {
        console.error("Subscription GET API error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to load subscription.",
            },
            { status: 500 },
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const response = await handler({
            headers: {
                "Content-Type": "application/json",
                Authorization: authorization(req),
            },
            body: JSON.stringify({
                ...body,
                action: "submit_subscription_payment",
            }),
            requestContext: { http: { method: "POST" } },
        });

        return NextResponse.json(parseBody(response.body), {
            status: response.statusCode || 200,
        });
    } catch (error) {
        console.error("Subscription POST API error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to submit subscription payment.",
            },
            { status: 500 },
        );
    }
}
