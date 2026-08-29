import { NextResponse } from "next/server";
import { getPublicPlans } from "../../../../lambda-subscription-admin/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const plans = await getPublicPlans();

        return NextResponse.json(
            { plans },
            {
                status: 200,
                headers: {
                    "Cache-Control": "no-store",
                },
            },
        );
    } catch (error) {
        console.error("Public subscription plans API error:", error);

        return NextResponse.json(
            {
                message:
                    error instanceof Error
                        ? error.message
                        : "Unable to load pricing plans.",
            },
            { status: 500 },
        );
    }
}
