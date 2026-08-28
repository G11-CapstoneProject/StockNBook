import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-packages/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function callLocalPackagesLambda(
    body: Record<string, unknown>,
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
                "Invalid response from local plans server.",
        };
    }

    return {
        data,
        status: response.statusCode || 200,
    };
}

function normalizeAction(value: unknown) {
    return String(value || "")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

export async function POST(req: NextRequest) {
    try {
        const incomingBody = await req.json();

        if (
            !incomingBody ||
            typeof incomingBody !== "object"
        ) {
            return NextResponse.json(
                {
                    error: "Invalid request body.",
                },
                {
                    status: 400,
                }
            );
        }

        if (!incomingBody.action) {
            return NextResponse.json(
                {
                    error: "Missing package action.",
                },
                {
                    status: 400,
                }
            );
        }

        const authHeader =
            req.headers.get("authorization") || "";

        const body: Record<string, unknown> = {
            ...incomingBody,
        };

        const requestedAction =
            normalizeAction(incomingBody.action);

        /*
         * CUSTOMER PORTAL FIX
         *
         * The public booking page may still send:
         *
         *     action: "get_packages"
         *
         * A customer does not have an owner/manager/staff token,
         * so automatically convert that read-only request to the
         * public action.
         */
        if (
            !authHeader &&
            requestedAction === "get_packages"
        ) {
            body.action = "get_public_packages";
        }

        console.log(
            "PACKAGES ROUTE ORIGINAL ACTION:",
            incomingBody.action
        );

        console.log(
            "PACKAGES ROUTE FINAL ACTION:",
            body.action
        );

        console.log(
            "PACKAGES ROUTE AUTH:",
            authHeader
                ? "AUTHENTICATED"
                : "PUBLIC"
        );

        console.log(
            "PACKAGES ROUTE BODY:",
            body
        );

        const response =
            await callLocalPackagesLambda(
                body,
                authHeader
            );

        console.log(
            "PACKAGES LOCAL LAMBDA STATUS:",
            response.status
        );

        console.log(
            "PACKAGES LOCAL LAMBDA RESPONSE:",
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
            "PACKAGES ROUTE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to process package request.",
            },
            {
                status: 500,
            }
        );
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } =
            new URL(req.url);

        const storeId =
            searchParams.get("store_id") ||
            searchParams.get("storeId");

        const branchId =
            searchParams.get("branch_id") ||
            searchParams.get("branchId");

        const authHeader =
            req.headers.get("authorization") || "";

        const body: Record<string, unknown> = {
            action: authHeader
                ? "get_packages"
                : "get_public_packages",
        };

        if (storeId) {
            body.store_id = Number(storeId);
        }

        if (branchId) {
            body.branch_id = Number(branchId);
        }

        console.log(
            "PACKAGES GET MODE:",
            authHeader
                ? "AUTHENTICATED"
                : "PUBLIC"
        );

        console.log(
            "PACKAGES GET BODY:",
            body
        );

        const response =
            await callLocalPackagesLambda(
                body,
                authHeader
            );

        console.log(
            "PACKAGES GET LOCAL LAMBDA STATUS:",
            response.status
        );

        console.log(
            "PACKAGES GET LOCAL LAMBDA RESPONSE:",
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
            "PACKAGES GET ROUTE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load plans.",
            },
            {
                status: 500,
            }
        );
    }
}