import { NextRequest, NextResponse } from "next/server";
import * as subscriptionAdminModule from "../../../lambda-subscription-admin/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLambdaBody(body: string | undefined) {
    if (!body) return {};

    try {
        return JSON.parse(body);
    } catch {
        return { message: body };
    }
}

export async function POST(req: NextRequest) {
    try {
        const bodyText = await req.text();

        const event = {
            httpMethod: "POST",
            body: bodyText,
            headers: {
                Authorization: req.headers.get("authorization") || "",
                "Content-Type":
                    req.headers.get("content-type") || "application/json",
                Origin: req.headers.get("origin") || "",
            },
            requestContext: {
                http: {
                    method: "POST",
                },
            },
        };

        // Handle CommonJS export correctly under Next.js/Turbopack
        const moduleAny = subscriptionAdminModule as any;

        const handler =
            moduleAny.handler ||
            moduleAny.default?.handler ||
            moduleAny.default;

        if (typeof handler !== "function") {
            console.error(
                "subscription-admin handler export:",
                moduleAny
            );

            return NextResponse.json(
                {
                    message:
                        "Subscription admin handler is not available."
                },
                { status: 500 }
            );
        }

        const result = await handler(event);

        return NextResponse.json(
            parseLambdaBody(result?.body),
            {
                status: result?.statusCode || 200,
            }
        );
    } catch (error) {
        console.error(
            "Subscription admin API route error:",
            error
        );

        return NextResponse.json(
            {
                message:
                    error instanceof Error
                        ? error.message
                        : "Internal Server Error",
            },
            { status: 500 }
        );
    }
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get("origin") || "*";

    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers":
                "Content-Type, Authorization",
            "Access-Control-Allow-Methods":
                "OPTIONS, POST",
        },
    });
}