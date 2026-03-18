"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5f6ee7] to-[#d786e8] px-6 py-20">
      
      <div className="max-w-6xl mx-auto text-center text-white">

        {/* LOGO */}
        <div className="mb-6 flex justify-center">
          <div className="h-20 w-20 flex items-center justify-center rounded-2xl bg-white text-black text-3xl shadow-lg">
            🎉
          </div>
        </div>

        {/* TITLE */}
        <h1 className="text-6xl font-bold tracking-tight">PartyPro</h1>
        <p className="mt-3 text-lg text-white/90">
          Your Complete Party &amp; Event Management Solution
        </p>

        {/* CARDS */}
        <div className="mt-20 grid gap-8 md:grid-cols-2 items-stretch">

          {/* ADMIN */}
          <Link href="/admin">
            <div className="h-full cursor-pointer rounded-3xl bg-white p-12 text-left text-black shadow-xl transition hover:scale-[1.03]">
              
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-purple-100 text-purple-600 text-2xl">
                ⚙️
              </div>

              <h2 className="text-2xl font-semibold">Admin Portal</h2>

              <p className="mt-3 text-gray-600">
                Manage inventory, bookings, sales, and view analytics
              </p>

              <p className="mt-8 font-semibold text-purple-600">
                Enter Dashboard →
              </p>
            </div>
          </Link>

          {/* CUSTOMER */}
          <Link href="/customerportal">
            <div className="h-full cursor-pointer rounded-3xl bg-white p-12 text-left text-black shadow-xl transition hover:scale-[1.03]">
              
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-pink-100 text-pink-600 text-2xl">
                🎉
              </div>

              <h2 className="text-2xl font-semibold">Customer Portal</h2>

              <p className="mt-3 text-gray-600">
                Browse packages, make bookings, and plan your event.
              </p>

              <p className="mt-8 font-semibold text-pink-600">
                Book Now →
              </p>
            </div>
          </Link>

        </div>
      </div>
    </div>
  );
}