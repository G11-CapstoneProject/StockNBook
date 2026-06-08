"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function createSlug(name: string) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

export default function BookingLinkCard() {
    const [storeName, setStoreName] = useState("StockNBook");
    const [storeSlug, setStoreSlug] = useState("");

    useEffect(() => {
        const savedStoreName =
            sessionStorage.getItem("store_name") ||
            sessionStorage.getItem("stocknbook_store_name") ||
            "StockNBook";

        const savedSlug =
            sessionStorage.getItem("store_slug") ||
            sessionStorage.getItem("stocknbook_store_slug") ||
            "";

        setStoreName(savedStoreName);

        if (savedSlug) {
            setStoreSlug(savedSlug);
        } else {
            const generatedSlug = createSlug(savedStoreName);
            setStoreSlug(generatedSlug);
            sessionStorage.setItem("store_slug", generatedSlug);
        }
    }, []);

    const bookingPath = `/book/${storeSlug}`;

    const bookingUrl = useMemo(() => {
        if (typeof window === "undefined") return bookingPath;
        return `${window.location.origin}${bookingPath}`;
    }, [bookingPath]);

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(
        bookingUrl
    )}`;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(bookingUrl);
        alert("Booking link copied!");
    };

    const handleDownloadQr = async () => {
        const response = await fetch(qrUrl);
        const blob = await response.blob();

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;
        a.download = `${storeSlug}-booking-qr.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        window.URL.revokeObjectURL(url);
    };

    return (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                    <p className="text-sm font-semibold text-[#1f2a44]">Booking Link</p>

                    <p className="mt-2 text-sm text-gray-500">
                        Share this link with customers so they can view your booking page.
                    </p>

                    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs text-gray-500">Public booking URL</p>

                        <div className="mt-2 flex gap-2">
                            <input
                                readOnly
                                value={bookingUrl}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
                            />

                            <button
                                type="button"
                                onClick={handleCopy}
                                className="rounded-lg bg-[#2D1B4E] px-4 py-2 text-sm font-medium text-white"
                            >
                                Copy
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                        <Link
                            href={bookingPath}
                            target="_blank"
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#2D1B4E] hover:bg-gray-50"
                        >
                            Open booking page
                        </Link>

                        <button
                            type="button"
                            onClick={handleDownloadQr}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#2D1B4E] hover:bg-gray-50"
                        >
                            Download QR
                        </button>
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <img
                        src={qrUrl}
                        alt={`${storeName} booking QR code`}
                        className="h-40 w-40 rounded-xl bg-white p-2"
                    />

                    <p className="mt-3 text-center text-xs text-gray-500">
                        Scan to open booking page
                    </p>
                </div>
            </div>
        </div>
    );
}

