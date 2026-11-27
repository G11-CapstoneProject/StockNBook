import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-analytics/index.js";
import { requireEffectivePlanFeature } from "../_helpers/require-effective-plan-feature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnalyticsRequestBody = {
    action?: string;
    period?: number | string;
    periodDays?: number | string;

    branch_id?: number | string | null;
    branchId?: number | string | null;

    start_date?: string;
    startDate?: string;

    end_date?: string;
    endDate?: string;
};

type LambdaResponse = {
    statusCode?: number;
    body?: string;
};

function normalizeAction(value: unknown): string {
    return String(value || "")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

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

    const response = (await handler(event)) as LambdaResponse;

    let data: unknown = {};

    try {
        data = response.body
            ? JSON.parse(response.body)
            : {};
    } catch {
        data = {
            error:
                response.body ||
                "Invalid response from Analytics service.",
        };
    }

    return {
        data,
        status: response.statusCode || 500,
    };
}

export async function POST(request: NextRequest) {
    try {
        const authHeader =
            request.headers.get("authorization") || "";

        if (!/^Bearer\s+\S+/i.test(authHeader)) {
            return NextResponse.json(
                {
                    error:
                        "Missing Authorization header. " +
                        "Please log out and sign in again.",
                },
                { status: 401 }
            );
        }

        let body: AnalyticsRequestBody;

        try {
            const parsed: unknown = await request.json();

            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                return NextResponse.json(
                    {
                        error:
                            "Analytics request must be a JSON object.",
                    },
                    { status: 400 }
                );
            }

            body = parsed as AnalyticsRequestBody;
        } catch {
            return NextResponse.json(
                {
                    error: "Invalid JSON in Analytics request.",
                },
                { status: 400 }
            );
        }

        const action = normalizeAction(
            body.action || "get_analytics_v2"
        );

        // Actions used by the Analytics page.
        // get_analytics is the old name of get_analytics_v2.
        const allowedActions = [
            "get_analytics_v2",
            "get_analytics",
            "get_month_comparison",
            "get_item_options",
            "get_item_insight",
        ];

        if (!allowedActions.includes(action)) {
            return NextResponse.json(
                {
                    error:
                        "Invalid Analytics action. " +
                        `Use ${allowedActions.join(", ")}.`,
                },
                { status: 400 }
            );
        }

        // Check whether the user's subscription allows Analytics.
        const subscriptionGate = await requireEffectivePlanFeature(
            authHeader,
            "has_analytics"
        );

        if (subscriptionGate) {
            return subscriptionGate;
        }

        // The main page always uses the revised Analytics response;
        // the other actions (month comparison, item insight) pass through.
        const lambdaBody: AnalyticsRequestBody = {
            ...body,
            action:
                action === "get_analytics"
                    ? "get_analytics_v2"
                    : action,
        };

        const response = await callLocalAnalyticsLambda(
            lambdaBody,
            authHeader
        );

        return NextResponse.json(response.data, {
            status: response.status,
            headers: {
                "Cache-Control":
                    "no-store, no-cache, must-revalidate",
            },
        });
    } catch (error) {
        console.error(
            "STOCKNBOOK ANALYTICS API ERROR:",
            error
        );

        return NextResponse.json(
            {
                error: "Analytics API request failed.",
            },
            { status: 500 }
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Methods":
                "POST, OPTIONS",
            "Access-Control-Allow-Headers":
                "Content-Type, Authorization",
        },
    });
}
