import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-analytics/index.js";
import { requireEffectivePlanFeature } from "../_helpers/require-effective-plan-feature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnalyticsRequestBody = {
    action?: string;
    period?: number | string;

    branch_id?: number | string;
    branchId?: number | string;

    start_date?: string;
    startDate?: string;

    end_date?: string;
    endDate?: string;
};

async function callLocalAnalyticsLambda(
    body: AnalyticsRequestBody,
    authHeader: string
) {
    const event = {
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
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

    let data: unknown = {};

    try {
        data = response.body
            ? JSON.parse(response.body)
            : {};
    } catch {
        data = {
            error:
                response.body ||
                "Invalid response from local Analytics server.",
        };
    }

    return {
        data,
        status: response.statusCode || 200,
    };
}

export async function POST(request: NextRequest) {
    try {
        const authHeader =
            request.headers.get("authorization") || "";

        if (!authHeader) {
            return NextResponse.json(
                {
                    error:
                        "Missing Authorization header. Log out and sign in again.",
                },
                {
                    status: 401,
                }
            );
        }

        let body: AnalyticsRequestBody;

        try {
            body =
                (await request.json()) as AnalyticsRequestBody;
        } catch {
            return NextResponse.json(
                {
                    error:
                        "Invalid JSON in Analytics request.",
                },
                {
                    status: 400,
                }
            );
        }

        if (body.action !== "get_analytics") {
            return NextResponse.json(
                {
                    error:
                        "Invalid Analytics action. Use get_analytics.",
                },
                {
                    status: 400,
                }
            );
        }

        const subscriptionGate = await requireEffectivePlanFeature(authHeader, "has_analytics");
        if (subscriptionGate) return subscriptionGate;

        console.log(
            "ANALYTICS LOCAL ROUTE BODY:",
            body
        );

        const response =
            await callLocalAnalyticsLambda(
                body,
                authHeader
            );

        console.log(
            "ANALYTICS LOCAL LAMBDA STATUS:",
            response.status
        );

        console.log(
            "ANALYTICS LOCAL LAMBDA RESPONSE:",
            response.data
        );

        return NextResponse.json(
            response.data,
            {
                status: response.status,

                headers: {
                    "Cache-Control":
                        "no-store, no-cache, must-revalidate",
                },
            }
        );
    } catch (error) {
        console.error(
            "LOCAL ANALYTICS ROUTE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Local Analytics API failed.",

                details:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred.",
            },
            {
                status: 500,
            }
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,

        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods":
                "POST, OPTIONS",
            "Access-Control-Allow-Headers":
                "Content-Type, Authorization",
        },
    });
}