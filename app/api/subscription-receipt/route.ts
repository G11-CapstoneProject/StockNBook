import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};

function parseLambdaBody(body: string | undefined) {
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

async function requireSubscriptionOwner(req: NextRequest) {
    const authResponse = await handler({
        headers: {
            "Content-Type": "application/json",
            Authorization: authorization(req),
        },
        body: JSON.stringify({ action: "get_subscription" }),
        requestContext: { http: { method: "POST" } },
    });

    const authBody = parseLambdaBody(authResponse.body);

    if ((authResponse.statusCode || 500) >= 400) {
        throw Object.assign(
            new Error(authBody.error || "Unable to verify the subscription owner."),
            { statusCode: authResponse.statusCode || 401 },
        );
    }

    if (authBody.role !== "owner" || authBody.can_manage_subscription !== true) {
        throw Object.assign(
            new Error("Only the store owner can upload subscription payment proof."),
            { statusCode: 403 },
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        if (!authorization(req)) {
            return NextResponse.json(
                { error: "Missing authorization token." },
                { status: 401 },
            );
        }

        await requireSubscriptionOwner(req);

        const formData = await req.formData();
        const receipt = formData.get("receipt");

        if (!(receipt instanceof File)) {
            return NextResponse.json(
                { error: "Select a GCash receipt image to upload." },
                { status: 400 },
            );
        }

        const extension = ALLOWED_RECEIPT_TYPES[receipt.type];
        if (!extension) {
            return NextResponse.json(
                { error: "Upload a PNG, JPG, JPEG, or WEBP receipt image." },
                { status: 400 },
            );
        }

        if (receipt.size <= 0) {
            return NextResponse.json(
                { error: "The selected receipt image is empty." },
                { status: 400 },
            );
        }

        if (receipt.size > MAX_RECEIPT_BYTES) {
            return NextResponse.json(
                { error: "The receipt image must be 5 MB or smaller." },
                { status: 413 },
            );
        }

        const uploadDirectory = join(
            process.cwd(),
            "public",
            "uploads",
            "subscription-receipts",
        );

        await mkdir(uploadDirectory, { recursive: true });

        const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
        const filePath = join(uploadDirectory, fileName);
        const bytes = Buffer.from(await receipt.arrayBuffer());

        await writeFile(filePath, bytes);

        return NextResponse.json(
            {
                message: "GCash receipt uploaded.",
                receipt_url: `/uploads/subscription-receipts/${fileName}`,
                file_name: receipt.name,
            },
            { status: 201 },
        );
    } catch (error) {
        const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            Number.isInteger(Number((error as { statusCode?: number }).statusCode))
                ? Number((error as { statusCode?: number }).statusCode)
                : 500;

        console.error("Subscription receipt upload error:", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to upload the GCash receipt.",
            },
            { status: statusCode },
        );
    }
}
