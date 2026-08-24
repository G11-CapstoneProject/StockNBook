import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname.startsWith("/platform-admin")) {
        const token = request.cookies.get("admin_token")?.value;

        if (!token) {
            return NextResponse.redirect(new URL("/", request.url));
        }

        try {
            const payload = jwt.verify(token, JWT_SECRET) as { role: string };

            if (payload.role !== "PLATFORM_ADMIN") {
                return NextResponse.redirect(new URL("/", request.url));
            }
        } catch {
            return NextResponse.redirect(new URL("/", request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/platform-admin/:path*"],
};