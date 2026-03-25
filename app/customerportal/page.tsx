"use client";

import Link from "next/link";
import { useRef, useState } from "react";

const STORE_MESSENGER = "your.page.username";

const packages = [
  {
    name: "Basic",
    price: 1500,
    downpayment: 1500,
    downpaymentLabel: "Full payment upfront",
    emoji: "🎈",
    badge: "",
    inclusions: [
      "50 balloon decorations",
      "Basic party backdrop",
      "3 table centerpieces",
      "Party supplies for 20",
    ],
  },
  {
    name: "Premium",
    price: 3500,
    downpayment: 1750,
    downpaymentLabel: "50% down payment",
    emoji: "🎉",
    badge: "Most Popular",
    inclusions: [
      "100 balloon arch",
      "Premium photo backdrop",
      "5-table setup",
      "Party favors for 40",
      "LED lighting setup",
    ],
  },
  {
    name: "Deluxe",
    price: 6000,
    downpayment: 3000,
    downpaymentLabel: "50% down payment",
    emoji: "👑",
    badge: "",
    inclusions: [
      "200 balloon installation",
      "Custom photo wall",
      "Complete venue setup",
      "Premium favors for 60",
      "Professional styling",
      "Setup and teardown",
    ],
  },
];

export default function CustomerPortal() {
  const packageRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [bookingType, setBookingType] = useState<"package" | "custom">("package");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [customOrder, setCustomOrder] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [notes, setNotes] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedPkgData = packages.find((p) => selectedPackage.startsWith(p.name));

  const handleSelectPackage = (pkg: string, price: number) => {
    setBookingType("package");
    setSelectedPackage(`${pkg} - ₱${price.toLocaleString()}`);
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const resetForm = () => {
    setBookingType("package");
    setSelectedPackage("");
    setCustomOrder("");
    setName("");
    setPhone("");
    setEmail("");
    setDate("");
    setEventType("");
    setNotes("");
  };

  const handleSubmit = async () => {
    const hasPackageSelection =
        bookingType === "package" ? !!selectedPackage : !!customOrder.trim();

    if (!name || !phone || !date || !eventType || !hasPackageSelection) {
      alert("Please fill in all required fields.");
      return;
    }

    const newBooking = {
      bookingType,
      name,
      phone,
      email,
      date,
      eventType,
      package: bookingType === "package" ? selectedPackage : "",
      customOrder: bookingType === "custom" ? customOrder : "",
      notes,
      status: "Pending",
    };

    try {
      setSubmitting(true);

      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "create_booking",
          storeId: 3,
          ...newBooking,
        }),
      });

      const text = await response.text();
      console.log("Booking submit response:", response.status, text);

      if (!response.ok) {
        alert(`Submit failed: ${text}`);
        return;
      }

      setShowSuccess(true);
      resetForm();
    } catch (error) {
      console.error("Booking submit error:", error);
      alert("Failed to submit booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <div className="min-h-screen bg-[#f5f6f8]">
        <section className="relative overflow-hidden bg-linear-to-r from-[#5f6ee7] to-[#d786e8] px-6 py-16 text-white">
          <div className="mx-auto max-w-6xl">
            <Link
                href="/"
                className="absolute right-6 top-6 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/30"
            >
              ← Back
            </Link>

            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-4 text-5xl">🎊</div>
              <h1 className="text-4xl font-bold md:text-5xl">
                Make Your Event Unforgettable
              </h1>
              <p className="mt-4 text-base text-white/90 md:text-lg">
                Choose a package or send a customized request based on what you need.
              </p>
              <button
                  onClick={() => packageRef.current?.scrollIntoView({ behavior: "smooth" })}
                  className="mt-8 rounded-full bg-white px-6 py-3 font-semibold text-purple-600 shadow hover:opacity-90"
              >
                View Packages ↓
              </button>
            </div>
          </div>
        </section>

        <section ref={packageRef} className="mx-auto max-w-6xl px-6 py-14">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-[#1f2a44]">Choose Your Event Package</h2>
            <p className="mt-2 text-gray-500">Pick a package or send a personalized request.</p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {packages.map((pkg) => (
                <div
                    key={pkg.name}
                    className={`relative rounded-2xl bg-white p-6 shadow-sm ${
                        pkg.badge ? "border-2 border-purple-500 shadow-md" : ""
                    }`}
                >
                  {pkg.badge && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-3 py-1 text-xs font-medium text-white">
                  {pkg.badge}
                </span>
                  )}

                  <div className="mb-3 text-4xl">{pkg.emoji}</div>
                  <h3 className="text-lg font-semibold text-[#1f2a44]">{pkg.name} Package</h3>
                  <p className="mt-2 text-2xl font-bold text-purple-600">
                    ₱{pkg.price.toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {pkg.name === "Basic"
                        ? "Full payment required to confirm"
                        : `₱${pkg.downpayment.toLocaleString()} down payment to confirm`}
                  </p>

                  <ul className="mt-5 space-y-2 text-sm text-gray-500">
                    {pkg.inclusions.map((item) => (
                        <li key={item}>✔ {item}</li>
                    ))}
                  </ul>

                  <button
                      onClick={() => handleSelectPackage(pkg.name, pkg.price)}
                      className={`mt-6 w-full rounded-xl py-2.5 font-medium ${
                          pkg.badge
                              ? "bg-linear-to-r from-purple-500 to-pink-500 text-white"
                              : "border border-purple-500 text-purple-600 hover:bg-purple-50"
                      }`}
                  >
                    Select Package
                  </button>
                </div>
            ))}
          </div>
        </section>

        <section className="px-6 pb-16">
          <div
              ref={formRef}
              className="mx-auto max-w-4xl rounded-2xl bg-white p-8 shadow-md md:p-10"
          >
            {showSuccess ? (
                <div className="py-10 text-center">
                  <div className="mb-4 text-6xl">🎉</div>
                  <h2 className="text-2xl font-bold text-[#1f2a44]">Booking Received!</h2>
                  <p className="mt-3 text-gray-500">
                    Your booking has been submitted and is now under review. We&apos;ll get back to you shortly to confirm.
                  </p>

                  <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 px-6 py-5 text-left">
                    <p className="text-sm font-medium text-blue-800">Have questions about your booking?</p>
                    <p className="mt-1 text-sm text-blue-600">
                      Feel free to message us on Messenger and we&apos;ll be happy to help.
                    </p>
                    <a
                        href={`https://m.me/${STORE_MESSENGER}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      💬 Message Us on Messenger
                    </a>
                  </div>

                  <button
                      onClick={() => setShowSuccess(false)}
                      className="mt-6 text-sm text-gray-400 underline hover:text-gray-600"
                  >
                    Submit another booking
                  </button>
                </div>
            ) : (
                <>
                  <div className="mb-8 text-center">
                    <div className="mb-2 text-3xl">📅</div>
                    <h2 className="text-3xl font-bold text-[#1f2a44]">Book Your Event</h2>
                    <p className="mt-2 text-sm text-gray-500">
                      Fill out the details below and we&apos;ll review your request.
                    </p>
                  </div>

                  <div className="mb-6">
                    <label className="mb-2 block text-sm font-medium text-gray-600">
                      Booking Type *
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <button
                          type="button"
                          onClick={() => setBookingType("package")}
                          className={`rounded-xl border px-4 py-3 text-left ${
                              bookingType === "package"
                                  ? "border-purple-500 bg-purple-50 text-purple-700"
                                  : "border-gray-300 bg-white text-gray-700"
                          }`}
                      >
                        Package Booking
                      </button>

                      <button
                          type="button"
                          onClick={() => setBookingType("custom")}
                          className={`rounded-xl border px-4 py-3 text-left ${
                              bookingType === "custom"
                                  ? "border-purple-500 bg-purple-50 text-purple-700"
                                  : "border-gray-300 bg-white text-gray-700"
                          }`}
                      >
                        Customized Booking
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-600">
                        Your Name *
                      </label>
                      <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="John Doe"
                          className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-600">
                        Contact Number *
                      </label>
                      <input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+63 912 345 6789"
                          className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-600">
                        Email Address
                      </label>
                      <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="johndoe@email.com"
                          className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-600">
                        Event Date *
                      </label>
                      <input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-gray-600">
                        Event Type *
                      </label>
                      <select
                          value={eventType}
                          onChange={(e) => setEventType(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black focus:outline-none focus:ring-2 focus:ring-purple-400"
                      >
                        <option value="">Select event type</option>
                        <option>Birthday</option>
                        <option>Wedding</option>
                        <option>Corporate</option>
                        <option>Christening</option>
                        <option>Anniversary</option>
                        <option>Other</option>
                      </select>
                    </div>

                    {bookingType === "package" && (
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-sm font-medium text-gray-600">
                            Selected Package *
                          </label>
                          <select
                              value={selectedPackage}
                              onChange={(e) => setSelectedPackage(e.target.value)}
                              className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black focus:outline-none focus:ring-2 focus:ring-purple-400"
                          >
                            <option value="">Select package</option>
                            <option>Basic - ₱1,500</option>
                            <option>Premium - ₱3,500</option>
                            <option>Deluxe - ₱6,000</option>
                          </select>
                        </div>
                    )}

                    {bookingType === "custom" && (
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-sm font-medium text-gray-600">
                            Customized Order Details *
                          </label>
                          <textarea
                              value={customOrder}
                              onChange={(e) => setCustomOrder(e.target.value)}
                              placeholder="Describe the setup, theme, colors, add-ons, guest count, or anything you specifically want for your event..."
                              rows={5}
                              className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
                          />
                        </div>
                    )}
                  </div>

                  <div className="mt-5">
                    <label className="mb-1 block text-sm font-medium text-gray-600">
                      Additional Notes
                    </label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Other requests or details..."
                        rows={4}
                        className="w-full rounded-xl border border-gray-300 bg-gray-50 p-3 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  </div>

                  <div className="mt-6 rounded-2xl border border-purple-100 bg-purple-50 p-5">
                    <h3 className="mb-3 font-semibold text-[#1f2a44]">Booking Summary</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p>
                        <span className="font-medium">Booking Type:</span>{" "}
                        {bookingType === "package" ? "Package Booking" : "Customized Booking"}
                      </p>
                      <p>
                        <span className="font-medium">Package / Order:</span>{" "}
                        {bookingType === "package"
                            ? selectedPackage || "Not selected"
                            : customOrder || "Not provided"}
                      </p>
                      <p>
                        <span className="font-medium">Event Type:</span>{" "}
                        {eventType || "Not selected"}
                      </p>
                      <p>
                        <span className="font-medium">Event Date:</span>{" "}
                        {date || "Not selected"}
                      </p>
                      {bookingType === "package" && selectedPkgData && (
                          <p className="rounded-lg bg-yellow-50 px-3 py-2 font-medium text-yellow-800">
                            💳 {selectedPkgData.downpaymentLabel}: ₱
                            {selectedPkgData.downpayment.toLocaleString()}
                            {selectedPkgData.name !== "Basic" && (
                                <span className="ml-1 font-normal text-yellow-700">
                          (Balance: ₱
                                  {(selectedPkgData.price - selectedPkgData.downpayment).toLocaleString()} on
                          event day)
                        </span>
                            )}
                          </p>
                      )}
                      <p>
                        <span className="font-medium">Status:</span> Pending Review
                      </p>
                    </div>
                  </div>

                  <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="mt-6 w-full rounded-xl bg-linear-to-r from-purple-500 to-pink-500 py-3 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting ? "Submitting..." : "Submit Booking Request"}
                  </button>
                </>
            )}
          </div>
        </section>
      </div>
  );
}