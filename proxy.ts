import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname.startsWith("/platform-admin")) {
        const token = request.cookies.get("admin_token")?.value;

        if (!token) {
            return NextResponse.redirect(new URL("/", request.url));
        }

        try {
            const secret = process.env.JWT_SECRET;
            if (!secret?.trim()) {
                return NextResponse.redirect(new URL("/", request.url));
            }

            const payload = jwt.verify(token, secret) as { role: string };

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