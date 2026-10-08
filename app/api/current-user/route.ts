import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";

type CurrentUserResult = {
    data: unknown;
    status: number;
};

// Several client components can ask for the current user at the same time.
// A tiny per-token cache + in-flight de-duplication prevents those requests
// from invoking the auth Lambda repeatedly during the same render burst.
const CACHE_TTL_MS = 3_000;
const currentUserCache = new Map<string, CurrentUserResult & { expiresAt: number }>();
const currentUserInFlight = new Map<string, Promise<CurrentUserResult>>();

function getAuthorizationKey(authorization: string) {
    return createHash("sha256").update(authorization).digest("hex");
}

async function resolveCurrentUser(authorization: string): Promise<CurrentUserResult> {
    const event = {
        headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
        },
        body: JSON.stringify({
            action: "get_current_user",
        }),
        requestContext: {
            http: {
                method: "POST",
            },
        },
    };

    const response = await handler(event);
    let data: unknown = {};

    try {
        data = response.body ? JSON.parse(response.body) : {};
    } catch {
        data = {
            error:
                response.body ||
                "Invalid response from current user server",
        };
    }

    return {
        data,
        status: response.statusCode || 200,
    };
}

export async function GET(req: NextRequest) {
    try {
        const authorization = req.headers.get("authorization") || "";

        // Do not cache anonymous requests.
        if (!authorization) {
            const result = await resolveCurrentUser(authorization);
            return NextResponse.json(result.data, { status: result.status });
        }

        const key = getAuthorizationKey(authorization);
        const now = Date.now();
        const cached = currentUserCache.get(key);

        if (cached && cached.expiresAt > now) {
            return NextResponse.json(cached.data, {
                status: cached.status,
                headers: {
                    "Cache-Control": "private, max-age=3",
                    Vary: "Authorization",
                },
            });
        }

        if (cached) currentUserCache.delete(key);

        let pending = currentUserInFlight.get(key);
        if (!pending) {
            pending = resolveCurrentUser(authorization);
            currentUserInFlight.set(key, pending);
        }

        let result: CurrentUserResult;
        try {
            result = await pending;
        } finally {
            currentUserInFlight.delete(key);
        }

        // Cache only successful authenticated responses.
        if (result.status >= 200 && result.status < 300) {
            currentUserCache.set(key, {
                ...result,
                expiresAt: Date.now() + CACHE_TTL_MS,
            });
        }

        return NextResponse.json(result.data, {
            status: result.status,
            headers: {
                "Cache-Control": "private, max-age=3",
                Vary: "Authorization",
            },
        });
    } catch (error) {
        console.error("Local current user route error:", error);
        return NextResponse.json(
            { error: "Current user server error" },
            { status: 500 },
        );
    }
}
