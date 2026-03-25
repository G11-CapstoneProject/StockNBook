"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Store = {
    id: number;
    store_name: string;
    slug: string;
};

type Booking = {
    id: number;
    name: string;
    date: string;
    status: string;
};

export default function StorePage() {
    const params = useParams();
    const slug = params?.storeId as string; // if your folder is [storeId]

    const [store, setStore] = useState<Store | null>(null);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!slug) return;

        const loadStoreAndBookings = async () => {
            try {
                setLoading(true);
                setError(null);

                // 1) Get store by slug
                const storeRes = await fetch("/api/store", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        action: "get_store_by_slug",
                        slug,
                    }),
                });

                const storeText = await storeRes.text();
                console.log("STORE LOOKUP:", storeRes.status, storeText);

                const storeData = JSON.parse(storeText);

                if (!storeRes.ok) {
                    throw new Error(storeData?.error || "Failed to load store");
                }

                const foundStore = storeData.store;
                setStore(foundStore);

                // 2) Get bookings using actual store id
                const bookingsRes = await fetch("/api/bookings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        action: "get_public_bookings",
                        storeId: foundStore.id,
                    }),
                });

                const bookingsText = await bookingsRes.text();
                console.log("BOOKINGS RAW RESPONSE:", bookingsRes.status, bookingsText);

                const bookingsData = JSON.parse(bookingsText);

                if (!bookingsRes.ok) {
                    throw new Error(bookingsData?.error || "Failed to fetch bookings");
                }

                setBookings(bookingsData.bookings || []);
            } catch (err: any) {
                console.error("STORE PAGE ERROR:", err);
                setError(err.message || "Something went wrong");
            } finally {
                setLoading(false);
            }
        };

        loadStoreAndBookings();
    }, [slug]);

    return (
        <div style={{ padding: 20 }}>
            <h1>{store ? `Store Portal: ${store.store_name}` : `Store Portal: ${slug}`}</h1>

            {store && <p>Slug: {store.slug}</p>}

            {loading && <p>Loading...</p>}

            {error && <p style={{ color: "red" }}>{error}</p>}

            {!loading && !error && bookings.length === 0 && <p>No bookings</p>}

            {!loading &&
                !error &&
                bookings.map((b) => (
                    <div
                        key={b.id}
                        style={{
                            border: "1px solid #ccc",
                            marginBottom: 10,
                            padding: 10,
                        }}
                    >
                        <p><b>{b.name}</b></p>
                        <p>{b.date}</p>
                        <p>{b.status}</p>
                    </div>
                ))}
        </div>
    );
}