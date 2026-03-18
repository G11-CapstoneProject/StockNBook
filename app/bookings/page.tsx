"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Booking = {
  id: number;
  name: string;
  date: string;
  eventType: string;
  package: string;
  phone: string;
  email: string;
  notes: string;
  status: "Pending" | "Confirmed" | "Completed" | "Cancelled";
};

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<
    "All" | "Pending" | "Confirmed" | "Completed" | "Cancelled"
  >("All");

  // ✅ LOAD FROM LOCALSTORAGE
  useEffect(() => {
    const stored =
      JSON.parse(localStorage.getItem("partypro_bookings") || "[]");
    setBookings(stored);
  }, []);

  // ✅ UPDATE STATUS FUNCTION
  const updateStatus = (id: number, newStatus: Booking["status"]) => {
    const updated = bookings.map((b) =>
      b.id === id ? { ...b, status: newStatus } : b
    );

    setBookings(updated);
    localStorage.setItem("partypro_bookings", JSON.stringify(updated));
  };

  const filteredBookings =
    filter === "All"
      ? bookings
      : bookings.filter((b) => b.status === filter);

  return (
    <div className="min-h-screen flex bg-[#f5f6f8]">
      
      {/* SIDEBAR */}
      <aside className="w-64 bg-gradient-to-b from-[#5f6ee7] to-[#d786e8] text-white flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 border-b border-white/20 px-5 py-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black">
              🎉
            </div>
            <div>
              <h1 className="font-bold">PartyPro</h1>
              <p className="text-sm text-white/80">Admin Dashboard</p>
            </div>
          </div>

          <nav className="mt-4 space-y-2 px-3">
            <Link href="/admin" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">
              Dashboard
            </Link>

            <Link href="/inventory" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">
              Inventory
            </Link>

            <Link
              href="/bookings"
              className="block rounded-xl px-4 py-3 bg-white/20 font-medium"
            >
              Bookings
            </Link>

            <div className="rounded-xl px-4 py-3 text-white/90">Calendar</div>
            <div className="rounded-xl px-4 py-3 text-white/90">POS / Sales</div>
            <div className="rounded-xl px-4 py-3 text-white/90">Forecasting</div>
          </nav>
        </div>

        <div className="border-t border-white/20 px-5 py-5 text-white/90">
          Exit Admin
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-6">

        {/* HEADER */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-[#1f2a44]">
            Booking Management
          </h1>
          <p className="text-gray-500">
            View and manage customer bookings
          </p>
        </div>

        {/* FILTER */}
        <div className="flex gap-3 mb-6">
          {["All", "Pending", "Confirmed", "Completed", "Cancelled"].map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab as any)}
                className={`px-4 py-2 rounded-full text-sm
                  ${
                    filter === tab
                      ? "bg-purple-500 text-white"
                      : "bg-white text-gray-600"
                  }`}
              >
                {tab}
              </button>
            )
          )}
        </div>

        {/* LIST */}
        <div className="rounded-2xl bg-white p-6 shadow-sm min-h-[200px] flex items-center justify-center">
          {filteredBookings.length === 0 ? (
            <p className="text-gray-400">
              No {filter.toLowerCase()} bookings
            </p>
          ) : (
            <div className="w-full space-y-3">
              {filteredBookings.map((b) => (
                <div
                  key={b.id}
                  className="flex justify-between items-center border p-4 rounded-xl"
                >
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-gray-500">{b.date}</p>
                    <p className="text-xs text-gray-400">
                      {b.package} • {b.eventType}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">

                    {/* STATUS */}
                    <span className="text-sm font-medium mr-2">
                      {b.status}
                    </span>

                    {/* ACTIONS */}
                    {b.status === "Pending" && (
                      <>
                        <button
                          onClick={() => updateStatus(b.id, "Confirmed")}
                          className="text-xs bg-green-500 text-white px-2 py-1 rounded"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => updateStatus(b.id, "Cancelled")}
                          className="text-xs bg-red-500 text-white px-2 py-1 rounded"
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {b.status === "Confirmed" && (
                      <button
                        onClick={() => updateStatus(b.id, "Completed")}
                        className="text-xs bg-blue-500 text-white px-2 py-1 rounded"
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