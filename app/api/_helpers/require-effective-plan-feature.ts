import { NextResponse } from "next/server";
import { handler as authHandler } from "../../../lambda-auth/index.js";

/**
 * Restrict paid-only analytics/forecasting at the API boundary, not just in
 * the disabled menu. Owner, manager and staff inherit the store's effective
 * plan, including an approved 48-hour pending-payment grace period.
 */
export async function requireEffectivePlanFeature(
    authHeader: string,
    feature: "has_analytics" | "has_forecasting",
): Promise<NextResponse | null> {
    if (!authHeader) {
        return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }
    const response = await authHandler({
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_subscription" }),
        requestContext: { http: { method: "POST" } },
    });
    let payload: any = {};
    try {
        payload = JSON.parse(response.body || "{}");
    } catch {
        return NextResponse.json({ error: "Unable to verify subscription access." }, { status: 503 });
    }
    if (Number(response.statusCode || 500) !== 200) {
        return NextResponse.json(
            { error: payload.error || "Unable to verify subscription access." },
            { status: response.statusCode || 403 },
        );
    }
    const effectivePlan = payload?.subscription?.effective_plan;
    if (!effectivePlan || effectivePlan[feature] !== true) {
        return NextResponse.json({
            error: `This feature is unavailable on your current effective subscription plan. Please renew or upgrade your subscription.`,
            code: "SUBSCRIPTION_FEATURE_RESTRICTED",
        }, { status: 403 });
    }
    return null;
}
