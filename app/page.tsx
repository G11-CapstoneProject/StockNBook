"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  LayoutDashboard,
  Package,
  Sparkles,
  Users,
  Mail,
  Lock,
  X,
} from "lucide-react";

type AuthMode = "login" | "signup" | null;

export default function Home() {
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  return (
    <main className="min-h-screen overflow-x-hidden bg-gradient-to-br from-[#6d7ae0] via-[#8b5cf6] to-[#c084fc] text-white">
      <div className="mx-auto max-w-7xl px-6 py-6 lg:px-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur-md">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight">StockNBook</span>
          </div>

          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/10 p-1 backdrop-blur-md">
            <button
              onClick={() => setAuthMode("login")}
              className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-purple-700 transition hover:bg-white/90"
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className="rounded-full px-5 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10"
            >
              Sign Up
            </button>
          </div>
        </header>

        <section className="relative pt-16 pb-20 text-center lg:pt-20">
          <h1 className="mx-auto max-w-5xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            Manage Bookings, Inventory &{" "}
            <span className="bg-gradient-to-r from-pink-300 to-purple-200 bg-clip-text text-transparent">
              Decor
            </span>
            <br />
            — All in One Place
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-white/75 sm:text-lg">
            Track inventory, manage bookings, monitor sales, and run your entire
            party business from a single dashboard.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => setAuthMode("signup")}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 font-semibold text-purple-700 shadow-2xl shadow-purple-900/30 transition hover:scale-[1.02] hover:bg-white/95"
            >
              <Sparkles className="h-4 w-4" />
              Get Started Free
            </button>

            <button
              onClick={() => setAuthMode("login")}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-7 py-4 font-semibold text-white backdrop-blur-md transition hover:scale-[1.02] hover:bg-white/15"
            >
              <ArrowRight className="h-4 w-4" />
              Login
            </button>
          </div>

          <div className="relative mx-auto mt-14 max-w-4xl">
            <div className="absolute inset-0 -z-10 rounded-[36px] bg-pink-400/20 blur-3xl" />

            <div className="overflow-hidden rounded-[32px] border border-white/15 bg-white/10 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-center gap-2 border-b border-white/10 bg-white/10 px-5 py-4">
                <div className="h-3 w-3 rounded-full bg-red-400/80" />
                <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
                <div className="h-3 w-3 rounded-full bg-green-400/80" />
                <div className="ml-4 hidden flex-1 rounded-full bg-white/10 px-4 py-1.5 text-left text-xs text-white/50 sm:block">
                  app.stocknbook.com/dashboard
                </div>
              </div>

              <div className="grid min-h-[420px] md:grid-cols-[220px_1fr]">
                <aside className="border-r border-white/10 bg-[#4c1d95]/40 p-5">
                  <div className="mb-8 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                      <Package className="h-5 w-5" />
                    </div>
                    <span className="text-xl font-bold tracking-tight">
                      StockNBook
                    </span>
                  </div>

                  <nav className="space-y-2 text-sm">
                    <SidebarItem icon={LayoutDashboard} label="Dashboard" active />
                    <SidebarItem icon={CalendarDays} label="Bookings" />
                    <SidebarItem icon={Boxes} label="Inventory" />
                    <SidebarItem icon={BarChart3} label="Reports" />
                    <SidebarItem icon={Users} label="Customers" />
                  </nav>
                </aside>

                <div className="p-5 sm:p-6">
                  <div className="mb-5 text-center text-lg font-semibold text-white/90">
                    Good morning, Alex 👋
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <StatCard label="Today's Bookings" value="12" />
                    <StatCard label="Revenue" value="$840" />
                    <StatCard label="Low Stock" value="3" accent />
                  </div>

                  <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
                    <p className="mb-5 text-sm font-medium text-white/70">
                      Weekly Revenue
                    </p>

                    <div className="flex h-40 items-end gap-3">
                      {[35, 52, 44, 58, 86, 50, 38].map((height, i) => (
                        <div
                          key={i}
                          className={`flex-1 rounded-t-2xl ${
                            i === 4 ? "bg-white/45" : "bg-white/15"
                          }`}
                          style={{ height: `${height}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={CalendarDays}
              title="Booking Management"
              desc="Handle reservations, schedules, and customer bookings with ease."
            />
            <FeatureCard
              icon={Boxes}
              title="Inventory Control"
              desc="Track decor items, stock levels, and package availability in real-time."
            />
            <FeatureCard
              icon={BarChart3}
              title="Sales & Analytics"
              desc="Monitor revenue, trends, and business performance at a glance."
            />
          </div>
        </section>
      </div>

      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSwitch={setAuthMode} />
      )}
    </main>
  );
}

function AuthModal({
  mode,
  onClose,
  onSwitch,
}: {
  mode: "login" | "signup";
  onClose: () => void;
  onSwitch: (mode: "login" | "signup") => void;
}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(false);

  const API_URL = "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "login") {
        const res = await fetch(`/api/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "login", email, password }),
        });
        const data = await res.json();
        if (data.token) {
          localStorage.clear(); // ← clears all old data
          localStorage.setItem("token", data.token);
          localStorage.setItem("store_id", String(data.store_id));
          localStorage.setItem("store_name", data.store_name);
          localStorage.setItem("isLoggedIn", "true");
          router.push("/admin");
        } else {
          alert(data.error || "Login failed");
        }
      } else {
        if (!storeName) return alert("Please enter your store name");
        const res = await fetch(`/api/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "signup", store_name: storeName, email, password }),
        });
        const data = await res.json();
        if (data.token) {
          localStorage.clear(); 
          localStorage.setItem("token", data.token);
          localStorage.setItem("store_id", String(data.store_id));
          localStorage.setItem("store_name", data.store_name);
          localStorage.setItem("isLoggedIn", "true");
          router.push("/admin");
        } else {
          alert(data.error || "Signup failed");
        }
      }
    } catch (err) {
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-[28px] bg-white p-8 text-gray-900 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
            <Package className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold text-purple-700">StockNBook</span>
        </div>

        <h2 className="text-3xl font-bold">
          {mode === "login" ? "Login" : "Create Account"}
        </h2>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Store Name
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 focus-within:border-purple-500">
                <Package className="h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Enter your store name"
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Email Address
            </label>
            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 focus-within:border-purple-500">
              <Mail className="h-5 w-5 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full bg-transparent outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Password
            </label>
            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 focus-within:border-purple-500">
              <Lock className="h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "login" ? "Enter your password" : "Create a password"
                }
                className="w-full bg-transparent outline-none"
                required
              />
            </div>
          </div>

          {mode === "signup" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Confirm Password
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 focus-within:border-purple-500">
                <Lock className="h-5 w-5 text-gray-400" />
                <input
                  type="password"
                  placeholder="Confirm your password"
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </div>
          )}

          {mode === "login" && (
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-gray-600">
                <input type="checkbox" className="rounded border-gray-300" />
                Remember me
              </label>

              <Link href="#" className="font-medium text-purple-600 hover:text-purple-700">
                Forgot password?
              </Link>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
          >
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Login"
              : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => onSwitch(mode === "login" ? "signup" : "login")}
            className="font-semibold text-purple-600 hover:text-purple-700"
          >
            {mode === "login" ? "Sign up" : "Login"}
          </button>
        </p>
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active = false,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition ${
        active
          ? "bg-white/15 text-white shadow-lg"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border border-white/10 p-5 text-center ${
        accent ? "bg-cyan-300/20" : "bg-white/10"
      }`}
    >
      <p className="text-sm text-white/65">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/10 p-6 text-left backdrop-blur-md">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/70">{desc}</p>
    </div>
  );
}