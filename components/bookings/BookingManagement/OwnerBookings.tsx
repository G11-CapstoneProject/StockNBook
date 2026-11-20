"use client";

// Owner Bookings: an all-branches summary of booking sales.
// Trends, averages and forecasts live in Analytics & Forecasting; this page answers
// "how much did each branch sell, how much is collected, and what gets booked?"
// Owners see totals per branch, not individual customer bookings.
// New layout pieces use inline styles so they never depend on newly generated Tailwind classes.

import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    CircleDollarSign,
    RefreshCw,
    Wallet,
    X,
} from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    Booking,
    dateKey,
    getAmountPaid,
    getBalance,
    getBookingTypeDisplay,
    getBranchGroupName,
    getTotalPrice,
    normalizeBooking,
    normalizeBookingStatus,
    peso,
} from "./_shared";

type Period = "month" | "year" | "all";

// A booking counts as a sale once its down payment is paid (Confirmed or later).
const SALES_STATUSES = new Set(["Confirmed", "Preparing", "Released", "Return Inspection", "Pending Settlement", "Completed"]);
const ACTIVE_STATUSES = new Set(["Confirmed", "Preparing", "Released", "Return Inspection", "Pending Settlement"]);
const PERIOD_LABEL: Record<Period, string> = { month: "This month", year: "This year", all: "All time" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Summary = { count: number; sales: number; collected: number; toCollect: number; cancelled: number; decided: number };

const statusOf = (b: Booking) => String(normalizeBookingStatus(b.status) ?? b.status ?? "");
const refundedOf = (b: Booking) => {
    const raw = b as Booking & { amountRefunded?: unknown; amount_refunded?: unknown };
    return Number(raw.amountRefunded ?? raw.amount_refunded ?? 0) || 0;
};

// Sales = Collected + To Collect.
function summarize(list: Booking[]): Summary {
    const s: Summary = { count: list.length, sales: 0, collected: 0, toCollect: 0, cancelled: 0, decided: 0 };
    for (const b of list) {
        const status = statusOf(b);
        const received = Math.max(0, getAmountPaid(b) - refundedOf(b));
        if (SALES_STATUSES.has(status)) {
            s.sales += getTotalPrice(b);
            s.collected += received;
            if (ACTIVE_STATUSES.has(status)) s.toCollect += getBalance(b);
        } else if (status === "Cancelled") {
            // Money kept after a cancellation (e.g. the down payment) is a sale that is already collected.
            s.sales += received;
            s.collected += received;
        }
        if (status === "Cancelled") s.cancelled += 1;
        // Cancellation rate counts every booking except ones the store rejected.
        if (status !== "Rejected") s.decided += 1;
    }
    return s;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const timeLabel = value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    return `${dateLabel} | ${timeLabel}`;
}

export default function OwnerBookings() {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>("month");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [depositsHeld, setDepositsHeld] = useState<number | null>(null);

    async function loadBookings() {
        setLoading(true);
        const token = sessionStorage.getItem("token");
        const storeId = sessionStorage.getItem("store_id") || sessionStorage.getItem("stocknbook_store_id");
        if (!token || !storeId) {
            setBookings([]);
            setLoading(false);
            return;
        }
        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "get_booking_page_bookings", store_id: Number(storeId), role: "owner" }),
                cache: "no-store",
            });
            const data: { bookings?: unknown } = await res.json();
            if (!res.ok) {
                setBookings([]);
                return;
            }
            const records = Array.isArray(data.bookings)
                ? data.bookings.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object" && !Array.isArray(b))
                : [];
            setBookings(records.map((b) => normalizeBooking(b)));
        } catch (err) {
            console.error("Bookings load failed:", err);
            setBookings([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadBookings();
    }, []);

    // Security deposits held right now (store-wide). Refundable, so never counted as sales.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) return;
                const r = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_owner_booking_financial_overview" }),
                });
                const data = await r.json();
                if (r.ok && !cancelled) setDepositsHeld(Number(data.overview?.refundableDepositsHeld ?? 0));
            } catch {
                /* The deposit note simply stays hidden. */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [bookings.length]);

    useEffect(() => {
        const update = () => setCurrentDateTime(new Date());
        update();
        const timer = window.setInterval(update, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    // Bookings whose event date falls in the chosen period.
    const scoped = useMemo(() => {
        if (period === "all") return bookings;
        const now = new Date();
        const prefix = period === "month"
            ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
            : String(now.getFullYear());
        return bookings.filter((b) => dateKey(b.date).startsWith(prefix));
    }, [bookings, period]);

    const totals = useMemo(() => summarize(scoped), [scoped]);

    const branchRows = useMemo(() => {
        const groups = new Map<string, Booking[]>();
        for (const b of scoped) {
            const name = getBranchGroupName(b);
            groups.set(name, [...(groups.get(name) || []), b]);
        }
        return [...groups.entries()]
            .map(([name, list]) => ({ name, ...summarize(list) }))
            .sort((a, b) => b.sales - a.sales || b.count - a.count || a.name.localeCompare(b.name));
    }, [scoped]);
    const topBranch = branchRows[0] && branchRows[0].sales > 0 ? branchRows[0] : null;
    const maxBranchSales = Math.max(1, ...branchRows.map((row) => row.sales));

    // Top packages by sales (counted bookings only).
    const topPackages = useMemo(() => {
        const map = new Map<string, { sales: number; count: number }>();
        for (const b of scoped) {
            if (getBookingTypeDisplay(b) !== "Package" || !SALES_STATUSES.has(statusOf(b))) continue;
            const name = String(b.packageName || b.package_name || b.package || "").trim();
            if (!name) continue;
            const entry = map.get(name) || { sales: 0, count: 0 };
            entry.sales += getTotalPrice(b);
            entry.count += 1;
            map.set(name, entry);
        }
        return [...map.entries()].map(([name, v]) => ({ name, ...v }))
            .sort((a, b) => b.sales - a.sales || b.count - a.count).slice(0, 5);
    }, [scoped]);

    // Busiest days of the week (by event date; cancelled and rejected bookings left out).
    const busiestDays = useMemo(() => {
        const counts = new Array(7).fill(0) as number[];
        let total = 0;
        for (const b of scoped) {
            if (["Cancelled", "Rejected"].includes(statusOf(b))) continue;
            const key = dateKey(b.date);
            if (!key) continue;
            counts[new Date(`${key}T00:00:00`).getDay()] += 1;
            total += 1;
        }
        return counts.map((count, day) => ({ day: WEEKDAYS[day], count, share: percent(count, total) }))
            .filter((d) => d.count > 0).sort((a, b) => b.count - a.count).slice(0, 4);
    }, [scoped]);

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const summaryCards = [
        { title: "Booking Sales", value: peso(totals.sales), note: "All branches",
            tip: "Price of confirmed bookings and later, plus money kept from cancellations",
            icon: <CircleDollarSign size={16} strokeWidth={1.9} />, tone: "bg-[#F0E9FF] text-[#5A35A5]" },
        { title: "Collected", value: peso(totals.collected), note: `${percent(totals.collected, totals.sales)}% of sales`,
            tip: "Paid so far on those sales, after refunds",
            icon: <Wallet size={16} strokeWidth={1.9} />, tone: "bg-[#EAF8EF] text-[#168A48]" },
        { title: "To Collect", value: peso(totals.toCollect), note: "Still unpaid",
            tip: "Unpaid balance of active bookings",
            icon: <BadgeCheck size={16} strokeWidth={1.9} />, tone: "bg-[#FFF3D8] text-[#9A6200]" },
        { title: "Cancellation Rate", value: `${percent(totals.cancelled, totals.decided)}%`,
            note: `${totals.cancelled} cancelled`,
            tip: "Cancelled bookings out of all bookings (rejected requests not counted)",
            icon: <X size={16} strokeWidth={1.9} />, tone: "bg-[#FFF0F0] text-[#C32F2F]" },
    ];
    const head = "px-3 py-3 text-xs font-semibold text-[#75657E]";
    const tone = (n: number, color: string) => (n > 0 ? color : "text-[#75657E]");

    return (
        <div className="font-sans text-[#1A1220]">
            <div className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <h1 className="text-[25px] font-bold text-[#1A1220]">Bookings</h1>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <label className="sr-only" htmlFor="owner-booking-period">Period</label>
                        <select id="owner-booking-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}
                                className="h-[42px] rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm outline-none">
                            <option value="month">This month</option>
                            <option value="year">This year</option>
                            <option value="all">All time</option>
                        </select>
                        <span className="inline-flex h-[42px] items-center whitespace-nowrap rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime ? formatCurrentDateTime(currentDateTime) : "Loading date..."}
                        </span>
                        <button onClick={() => void loadBookings()} disabled={loading} type="button"
                                aria-label="Refresh bookings" title="Refresh bookings"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60">
                            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            <section className="px-6 py-4 font-sans">
                {loading && bookings.length === 0 ? (
                    <ModuleSkeleton variant="bookings" />
                ) : (
                    <>
                        {/* 1. Totals across all branches */}
                        <div role="group" aria-label={`Booking totals, ${PERIOD_LABEL[period]}`}
                             style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                            {summaryCards.map((card) => (
                                <div key={card.title} title={card.tip}
                                     className="flex items-center gap-3 rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm"
                                     style={{ padding: "12px 14px" }}>
                                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${card.tone}`}>{card.icon}</span>
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium text-[#75657E]">{card.title}</p>
                                        <p className="truncate text-lg font-bold text-[#1A1220]">{card.value}</p>
                                        <p className="truncate text-[11px] text-[#8A7D90]">{card.note}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {depositsHeld !== null && depositsHeld > 0 && (
                            <p className="mt-2 text-xs text-[#75657E]">
                                Security deposits currently held: <strong className="text-[#2B174C]">{peso(depositsHeld)}</strong> (refundable, not counted in sales).
                            </p>
                        )}

                        {/* 2. Sales per branch, side by side */}
                        <div className="mb-2.5 mt-4">
                            <h2 className="text-[17px] font-bold text-[#1A1220]">Sales by Branch</h2>
                            <p className="text-xs text-[#7A6A84]">All branches · {PERIOD_LABEL[period]} · highest sales first</p>
                        </div>
                        {branchRows.length === 0 ? (
                            <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-10 text-center text-sm text-[#75657E] shadow-sm">
                                No bookings {period === "all" ? "yet" : `with an event date ${PERIOD_LABEL[period].toLowerCase()}`}.
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[930px] border-collapse">
                                        <thead>
                                        <tr className="border-b border-[#E6DDF0] bg-[#FFFCF7]">
                                            <th scope="col" className={`${head} text-left`}>Branch</th>
                                            <th scope="col" className={`${head} text-left`} style={{ width: "30%" }}>Sales</th>
                                            <th scope="col" className={`${head} text-right`}>Collected</th>
                                            <th scope="col" className={`${head} text-right`}>To Collect</th>
                                            <th scope="col" className={`${head} text-center`}>Bookings</th>
                                            <th scope="col" className={`${head} text-center`}>Cancelled</th>
                                            <th scope="col" className={`${head} text-center`}>Cancellation Rate</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {branchRows.map((row) => (
                                            <tr key={row.name} className="border-b border-[#EFE7F4] bg-white">
                                                <td className="px-3 py-3 text-sm font-bold text-[#1A1220]">
                                                    {row.name}
                                                    {topBranch?.name === row.name && <span className="ml-2 rounded-full bg-[#EAF1FF] px-2 py-0.5 text-[11px] font-semibold text-[#245EDB]">Top</span>}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {/* Bar = this branch's sales compared with the best branch */}
                                                    <div className="flex items-center" style={{ gap: 10 }}>
                                                        <div className="overflow-hidden rounded-full bg-[#EFE8F8]" style={{ flex: 1, height: 8 }} aria-hidden="true">
                                                            <div className="rounded-full" style={{ height: 8, width: `${Math.round((row.sales / maxBranchSales) * 100)}%`, background: topBranch?.name === row.name ? "#6C3AD6" : "#B9A3EA" }}/>
                                                        </div>
                                                        <span className="text-sm font-bold text-[#1A1220]" style={{ minWidth: 112, textAlign: "right" }}>{peso(row.sales)}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-right text-sm font-bold text-green-700">{peso(row.collected)}</td>
                                                <td className={`px-3 py-3 text-right text-sm font-bold ${tone(row.toCollect, "text-[#A56607]")}`}>{peso(row.toCollect)}</td>
                                                <td className="px-3 py-3 text-center text-sm font-bold text-[#1A1220]">{row.count}</td>
                                                <td className={`px-3 py-3 text-center text-sm font-semibold ${tone(row.cancelled, "text-red-600")}`}>{row.cancelled}</td>
                                                <td className={`px-3 py-3 text-center text-sm font-semibold ${tone(row.cancelled, "text-red-600")}`}>{percent(row.cancelled, row.decided)}%</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                        {branchRows.length > 1 && (
                                            <tfoot>
                                            <tr className="bg-[#FFFCF7]">
                                                <td className="px-3 py-3 text-sm font-bold text-[#2B174C]">All branches</td>
                                                <td className="px-3 py-3 text-right text-sm font-bold text-[#2B174C]">{peso(totals.sales)}</td>
                                                <td className="px-3 py-3 text-right text-sm font-bold text-[#2B174C]">{peso(totals.collected)}</td>
                                                <td className="px-3 py-3 text-right text-sm font-bold text-[#2B174C]">{peso(totals.toCollect)}</td>
                                                <td className="px-3 py-3 text-center text-sm font-bold text-[#2B174C]">{totals.count}</td>
                                                <td className="px-3 py-3 text-center text-sm font-bold text-[#2B174C]">{totals.cancelled}</td>
                                                <td className="px-3 py-3 text-center text-sm font-bold text-[#2B174C]">{percent(totals.cancelled, totals.decided)}%</td>
                                            </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 3. What gets booked */}
                        <div className="mt-4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
                            <section className="rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm" style={{ padding: "14px 16px" }} aria-label="Top packages">
                                <h3 className="text-sm font-bold text-[#1A1220]">Top Packages</h3>
                                <p className="text-xs text-[#7A6A84]">By sales · {PERIOD_LABEL[period]}</p>
                                <ol className="mt-2">
                                    {topPackages.length === 0 ? <li className="py-2 text-xs text-[#75657E]">No package sales yet.</li> :
                                        topPackages.map((pkg, index) => (
                                            <li key={pkg.name} className="flex items-center justify-between border-b border-[#F3EEF7] py-2 text-sm last:border-b-0" style={{ gap: 12 }}>
                                                <span className="flex min-w-0 items-center" style={{ gap: 10 }}>
                                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFE8F8] text-xs font-bold text-[#2B174C]">{index + 1}</span>
                                                    <span className="truncate font-medium text-[#1A1220]">{pkg.name}</span>
                                                </span>
                                                <span className="shrink-0 text-xs text-[#75657E]">{peso(pkg.sales)} · {plural(pkg.count, "booking")}</span>
                                            </li>
                                        ))}
                                </ol>
                            </section>
                            <section className="rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm" style={{ padding: "14px 16px" }} aria-label="Busiest days">
                                <h3 className="text-sm font-bold text-[#1A1220]">Busiest Days</h3>
                                <p className="text-xs text-[#7A6A84]">Events by day of the week · {PERIOD_LABEL[period]}</p>
                                <ol className="mt-2">
                                    {busiestDays.length === 0 ? <li className="py-2 text-xs text-[#75657E]">No bookings yet.</li> :
                                        busiestDays.map((d) => (
                                            <li key={d.day} className="flex items-center border-b border-[#F3EEF7] py-2 text-sm last:border-b-0" style={{ gap: 12 }}>
                                                <span className="font-medium text-[#1A1220]" style={{ width: 92 }}>{d.day}</span>
                                                <div className="overflow-hidden rounded-full bg-[#EFE8F8]" style={{ flex: 1, height: 8 }} aria-hidden="true">
                                                    <div className="rounded-full" style={{ height: 8, width: `${d.share}%`, background: "#B9A3EA" }}/>
                                                </div>
                                                <span className="shrink-0 text-xs text-[#75657E]" style={{ minWidth: 110, textAlign: "right" }}>{plural(d.count, "booking")} · {d.share}%</span>
                                            </li>
                                        ))}
                                </ol>
                            </section>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
