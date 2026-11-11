import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The old uploader wrote sensitive receipts under /public/uploads. The owner
// now sends the image with submit_subscription_payment, after OTP verification.
// Keep this endpoint disabled so old browser tabs cannot recreate public files.
export async function POST() {
    return NextResponse.json(
        { error: "Receipt uploads now happen securely when you submit a subscription payment. Refresh the page." },
        { status: 410, headers: { "Cache-Control": "no-store" } },
    );
}