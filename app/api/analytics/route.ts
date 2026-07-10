import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Same server-side proxy pattern used by app/api/forecasting/route.ts.
// The browser calls only /api/analytics, so it never calls API Gateway directly.
const ANALYTICS_LAMBDA_URL =
    "https://7q4v8jp9uh.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-analytics";

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

function asPositiveInteger(value: unknown) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function asPeriod(value: unknown) {
    const number = Number(value);
    return number === 30 || number === 60 || number === 90 ? number : 30;
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");

        if (!authHeader) {
            return NextResponse.json(
                { error: "Missing Authorization header. Log out and sign in again." },
                { status: 401 }
            );
        }

        let body: AnalyticsRequestBody;

        try {
            body = (await request.json()) as AnalyticsRequestBody;
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON in Analytics request." },
                { status: 400 }
            );
        }

        if (body.action !== "get_analytics") {
            return NextResponse.json(
                { error: "Invalid Analytics action. Use get_analytics." },
                { status: 400 }
            );
        }

        const branchId = asPositiveInteger(body.branch_id ?? body.branchId);
        const startDate = String(body.start_date ?? body.startDate ?? "").trim();
        const endDate = String(body.end_date ?? body.endDate ?? "").trim();
        const hasCustomRange = Boolean(startDate || endDate);

        if (hasCustomRange && (!startDate || !endDate)) {
            return NextResponse.json(
                { error: "Both start_date and end_date are required for a custom Analytics period." },
                { status: 400 }
            );
        }

        const upstreamBody = {
            action: "get_analytics",
            ...(hasCustomRange
                ? { start_date: startDate, end_date: endDate }
                : { period: asPeriod(body.period) }),
            ...(branchId ? { branch_id: branchId } : {}),
        };

        const lambdaResponse = await fetch(ANALYTICS_LAMBDA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
            },
            body: JSON.stringify(upstreamBody),
            cache: "no-store",
        });

        const rawResponse = await lambdaResponse.text();
        let lambdaData: unknown;

        try {
            lambdaData = rawResponse ? JSON.parse(rawResponse) : {};
        } catch {
            lambdaData = {
                error:
                    rawResponse ||
                    "Invalid response from the Analytics Lambda.",
            };
        }

        return NextResponse.json(lambdaData, {
            status: lambdaResponse.status,
            headers: {
                "Cache-Control": "no-store, max-age=0",
            },
        });
    } catch (error) {
        console.error("Analytics API proxy error:", error);

        return NextResponse.json(
            {
                error: "Analytics API proxy failed.",
                details:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred.",
            },
            { status: 500 }
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });
}
