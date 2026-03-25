"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Booking = {
  id: number;
  bookingType?: string;
  name: string;
  phone?: string;
  date: string;
  eventType?: string;
  package?: string;
  customOrder?: string;
  notes?: string;
  status: "Pending" | "Confirmed" | "Completed" | "Cancelled";
};

const tabs = ["All", "Pending", "Confirmed", "Completed", "Cancelled"] as const;
type FilterType = (typeof tabs)[number];

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<FilterType>("All");
  const [storeName, setStoreName] = useState("Store Name");

  useEffect(() => {
    const loadBookings = async () => {
      const token = localStorage.getItem("token");
      const savedStoreName =
          localStorage.getItem("store_name") ||
          localStorage.getItem("stocknbook_store_name") ||
          "Store Name";

      setStoreName(savedStoreName);

      if (!token) {
        setBookings([]);
        return;
      }

      try {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "get_bookings",
          }),
        });

        const text = await res.text();
        console.log("BOOKINGS PAGE RAW:", res.status, text);

        const data = JSON.parse(text);

        if (!res.ok) {
          console.warn("Bookings fetch failed:", data?.error || "Failed to fetch bookings");
          setBookings([]);
          return;
        }

        setBookings(data.bookings || []);
      } catch (err) {
        console.warn("Bookings fetch failed:", err);
        setBookings([]);
      }
    };

    loadBookings();
  }, []);

  const updateStatus = async (id: number, newStatus: Booking["status"]) => {
    const token = localStorage.getItem("token");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "update_status",
          booking_id: id,
          status: newStatus,
        }),
      });

      const text = await res.text();
      console.log("UPDATE STATUS RAW:", res.status, text);

      if (!res.ok) {
        throw new Error("Failed to update booking status");
      }

      setBookings((prev) =>
          prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b))
      );
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const filteredBookings =
      filter === "All" ? bookings : bookings.filter((b) => b.status === filter);

  return (
      <div className="flex min-h-screen bg-[#f5f6f8]">
        <aside className="flex min-h-screen w-52 flex-col justify-between bg-linear-to-b from-[#5f6ee7] to-[#d786e8] text-white">
          <div>
            <div className="px-3 pt-3">
              <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <h1 className="text-sm font-bold">StockNBook</h1>
              </div>

              <div className="mt-2 rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <p className="text-xs font-semibold text-white">{storeName}</p>
                <p className="mt-1 text-[9px] uppercase tracking-[0.15em] text-white/60">
                  Store Owner
                </p>
              </div>
            </div>

            <nav className="mt-3 px-2 pb-4">
              <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                Core
              </p>

              <div className="space-y-1">
                <Link
                    href="/admin"
                    className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                >
                  Dashboard
                </Link>

                <Link
                    href="/bookings"
                    className="block rounded-lg bg-white/20 px-3 py-2 text-xs font-medium"
                >
                  Bookings
                </Link>

                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Calendar
                </div>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                Business
              </p>

              <div className="space-y-1">
                <Link
                    href="/inventory"
                    className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                >
                  Inventory
                </Link>

                <Link
                    href="/pos"
                    className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                >
                  Sales / POS
                </Link>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                Analytics
              </p>

              <div className="space-y-1">
                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Forecasting
                </div>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                System
              </p>

              <div className="space-y-1">
                <Link
                    href="/booking-link"
                    className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                >
                  Booking Link
                </Link>

                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Settings
                </div>
              </div>
            </nav>
          </div>

          <div className="px-2 pb-3">
            <Link
                href="/"
                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
            >
              Logout
            </Link>
          </div>
        </aside>

        <main className="flex-1 p-5">
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-[#1f2a44]">Booking Management</h1>
            <p className="mt-1 text-sm text-gray-500">
              View and manage customer bookings
            </p>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {tabs.map((tab) => (
                <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                        filter === tab
                            ? "bg-purple-500 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                >
                  {tab}
                </button>
            ))}
          </div>

          <div className="min-h-[320px] rounded-2xl bg-white p-5 shadow-sm">
            {filteredBookings.length === 0 ? (
                <div className="flex min-h-[220px] items-center justify-center">
                  <p className="text-xs font-medium text-gray-600">No bookings yet</p>
                </div>
            ) : (
                <div className="w-full space-y-3">
                  {filteredBookings.map((b) => (
                      <div
                          key={b.id}
                          className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[#1f2a44]">{b.name}</p>

                            <span
                                className={`rounded-full px-2 py-1 text-xs font-medium
                          ${b.status === "Pending" ? "bg-yellow-100 text-yellow-700" : ""}
                          ${b.status === "Confirmed" ? "bg-green-100 text-green-700" : ""}
                          ${b.status === "Completed" ? "bg-blue-100 text-blue-700" : ""}
                          ${b.status === "Cancelled" ? "bg-red-100 text-red-700" : ""}
                        `}
                            >
                        {b.status}
                      </span>
                          </div>

                          <p className="text-sm text-gray-600">{b.date}</p>
                          <p className="text-xs text-gray-400">
                            {b.package || b.customOrder || "No package"} •{" "}
                            {b.eventType || "No event type"}
                          </p>

                          {b.notes && (
                              <p className="mt-1 text-xs text-gray-500">
                                Notes: {b.notes}
                              </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {b.status === "Pending" && (
                              <>
                                <button
                                    onClick={() => updateStatus(b.id, "Confirmed")}
                                    className="rounded-md bg-green-500 px-3 py-1 text-xs text-white"
                                >
                                  Confirm
                                </button>
                                <button
                                    onClick={() => updateStatus(b.id, "Cancelled")}
                                    className="rounded-md bg-red-400 px-3 py-1 text-xs text-white"
                                >
                                  Cancel
                                </button>
                              </>
                          )}

                          {b.status === "Confirmed" && (
                              <button
                                  onClick={() => updateStatus(b.id, "Completed")}
                                  className="rounded-md bg-blue-500 px-3 py-1 text-xs text-white"
                              >
                                Complete
                              </button>
                          )}
                        </div>
                      </div>
                  ))}
                </div>
            )}
          </div>
        </main>
      </div>
  );
}