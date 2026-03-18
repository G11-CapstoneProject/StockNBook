"use client";

import Link from "next/link";
import { useRef, useState } from "react";

export default function customerportal() {
  const packageRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [selectedPackage, setSelectedPackage] = useState("");

  // ✅ ADDED STATES
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [notes, setNotes] = useState("");

  // ✅ ADDED FUNCTION
  const handleSubmit = () => {
    if (!name || !email || !phone || !date || !eventType || !selectedPackage) {
      alert("Please fill all required fields");
      return;
    }

    const newBooking = {
      id: Date.now(),
      name,
      email,
      phone,
      date,
      eventType,
      package: selectedPackage,
      notes,
      status: "Pending",
    };

    const existing =
      JSON.parse(localStorage.getItem("partypro_bookings") || "[]");

    const updated = [...existing, newBooking];

    localStorage.setItem("partypro_bookings", JSON.stringify(updated));

    alert("Booking submitted!");

    // reset
    setName("");
    setEmail("");
    setPhone("");
    setDate("");
    setEventType("");
    setSelectedPackage("");
    setNotes("");
  };

  return (
    <div className="min-h-screen bg-[#f5f6f8]">

      {/* HERO */}
      <div className="bg-gradient-to-r from-[#5f6ee7] to-[#d786e8] text-white px-6 py-16 text-center relative">
        <Link href="/" className="absolute top-6 right-6 bg-white/20 px-4 py-2 rounded-lg text-sm">
          ← Back
        </Link>

        <h1 className="text-4xl md:text-5xl font-bold">
          Make Your Event Unforgettable
        </h1>

        <p className="mt-3 text-white/90">
          Your Complete Party & Event Management Solution
        </p>

        <button
          onClick={() =>
            packageRef.current?.scrollIntoView({ behavior: "smooth" })
          }
          className="mt-6 bg-white text-purple-600 px-6 py-3 rounded-full font-semibold shadow"
        >
          View Packages ↓
        </button>
      </div>

      {/* PACKAGES */}
      <div ref={packageRef} className="px-6 py-12 max-w-6xl mx-auto text-center">
        <h2 className="text-2xl font-bold text-[#1f2a44]">
          Our Event Packages
        </h2>
        <p className="text-gray-500 mt-2">
          Choose the perfect package for your celebration
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">

          {/* BASIC */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="text-3xl mb-3">🎈</div>
            <h3 className="font-semibold text-lg text-black">Basic Party</h3>
            <p className="text-purple-600 font-bold text-xl mt-2">₱199</p>

            <ul className="mt-4 text-sm text-gray-500 space-y-1">
              <li>✔ 50 Balloon decorations</li>
              <li>✔ Basic party backdrop</li>
              <li>✔ Table centerpieces (3)</li>
              <li>✔ Party supplies for 20</li>
            </ul>

            <button
              onClick={() => {
                setSelectedPackage("Basic - ₱199");
                formRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="mt-6 w-full border border-purple-500 text-purple-600 py-2 rounded-lg"
            >
              Select Package
            </button>
          </div>

          {/* PREMIUM */}
          <div className="bg-white rounded-2xl p-6 shadow-md border-2 border-purple-500 relative">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-xs px-3 py-1 rounded-full">
              Most Popular
            </span>

            <div className="text-3xl mb-3">🎉</div>
            <h3 className="font-semibold text-lg text-black">Premium Party</h3>
            <p className="text-purple-600 font-bold text-xl mt-2">₱399</p>

            <ul className="mt-4 text-sm text-gray-500 space-y-1">
              <li>✔ 100 Balloon arch</li>
              <li>✔ Premium photo backdrop</li>
              <li>✔ Table setup (5 tables)</li>
              <li>✔ Party favors for 40</li>
              <li>✔ LED lighting setup</li>
            </ul>

            <button
              onClick={() => {
                setSelectedPackage("Premium - ₱399");
                formRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="mt-6 w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded-lg"
            >
              Select Package
            </button>
          </div>

          {/* DELUXE */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="text-3xl mb-3">👑</div>
            <h3 className="font-semibold text-lg text-black">Deluxe Party</h3>
            <p className="text-purple-600 font-bold text-xl mt-2">₱699</p>

            <ul className="mt-4 text-sm text-gray-500 space-y-1">
              <li>✔ 200 Balloon installation</li>
              <li>✔ Custom photo wall</li>
              <li>✔ Complete venue setup</li>
              <li>✔ Premium favors for 60</li>
              <li>✔ Professional styling</li>
              <li>✔ Setup & teardown</li>
            </ul>

            <button
              onClick={() => {
                setSelectedPackage("Deluxe - ₱699");
                formRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="mt-6 w-full border border-purple-500 text-purple-600 py-2 rounded-lg"
            >
              Select Package
            </button>
          </div>

        </div>
      </div>

      {/* BOOKING FORM */}
      <div className="px-6 pb-16">
        <div
          ref={formRef}
          className="max-w-3xl mx-auto bg-white rounded-2xl shadow-md p-10"
        >

          {/* HEADER */}
          <div className="text-center mb-8">
            <div className="text-3xl mb-2">📅</div>
            <h2 className="text-2xl font-semibold text-[#1f2a44]">
              Book Your Event
            </h2>
            <p className="text-gray-400 text-sm">
              Fill out the form below and we’ll get back to you
            </p>
          </div>

          {/* FORM GRID */}
          <div className="grid gap-5 md:grid-cols-2">

            <div>
              <label className="text-sm text-gray-600 mb-1 block">Your Name *</label>
              <input value={name} onChange={(e)=>setName(e.target.value)}
                placeholder="John Doe"
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 p-3 rounded-xl"
              />
            </div>

            <div>
              <label className="text-sm text-gray-600 mb-1 block">Email *</label>
              <input value={email} onChange={(e)=>setEmail(e.target.value)}
                placeholder="john@example.com"
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 p-3 rounded-xl"
              />
            </div>

            <div>
              <label className="text-sm text-gray-600 mb-1 block">Phone *</label>
              <input value={phone} onChange={(e)=>setPhone(e.target.value)}
                placeholder="+63 912..."
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 p-3 rounded-xl"
              />
            </div>

            <div>
              <label className="text-sm text-gray-600 mb-1 block">Date *</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 p-3 rounded-xl"
              />
            </div>

            <div>
              <label className="text-sm text-gray-600 mb-1 block">Event *</label>
              <select value={eventType} onChange={(e)=>setEventType(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 p-3 rounded-xl">
                <option value="">Select event</option>
                <option>Birthday</option>
                <option>Wedding</option>
                <option>Corporate</option>
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-600 mb-1 block">Package *</label>
              <select value={selectedPackage} onChange={(e)=>setSelectedPackage(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-800 p-3 rounded-xl">
                <option value="">Select</option>
                <option>Basic - ₱199</option>
                <option>Premium - ₱399</option>
                <option>Deluxe - ₱699</option>
              </select>
            </div>

          </div>

          <textarea value={notes} onChange={(e)=>setNotes(e.target.value)}
            placeholder="Notes..."
            className="w-full mt-5 bg-gray-50 border border-gray-200 p-3 rounded-xl"
          />

          <button onClick={handleSubmit}
            className="mt-6 w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl">
            Submit Booking Request
          </button>

        </div>
      </div>

    </div>
  );
}