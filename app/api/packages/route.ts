import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://3pwsbsqwvwmuce5fgj6f574lmu0cfeje.lambda-url.ap-southeast-1.on.aws";

async function readLambdaResponse(response: Response) {
    const text = await response.text();

    try {
        return JSON.parse(text);
    } catch {
        return {
            error: text || "Invalid response from server.",
        };
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const authHeader = req.headers.get("authorization") || "";

        const response = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader && { Authorization: authHeader }),
            },
            body: JSON.stringify(body),
        });

        const data = await readLambdaResponse(response);

        return NextResponse.json(data, { status: response.status });
    } catch {
        return NextResponse.json(
            { error: "Failed to process package request." },
            { status: 500 }
        );
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const store_id = searchParams.get("store_id");
        const authHeader = req.headers.get("authorization") || "";

        if (!store_id) {
            return NextResponse.json(
                { error: "store_id is required." },
                { status: 400 }
            );
        }

        const response = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader && { Authorization: authHeader }),
            },
            body: JSON.stringify({
                action: "get_packages",
                store_id: Number(store_id),
            }),
        });

        const data = await readLambdaResponse(response);

        return NextResponse.json(data, { status: response.status });
    } catch {
        return NextResponse.json(
            { error: "Failed to load packages." },
            { status: 500 }
        );
    }
}

