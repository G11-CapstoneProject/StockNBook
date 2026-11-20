"use client";

// Manager "Settle Rental Return" popup. Opens from "Settle Deposit / Charges" on a Pending Settlement booking.
// Put this file next to _shared.tsx. It reads Staff's return records and the booking's money, then saves
// everything in ONE transaction through the Bookings Lambda (action: settle_booking_security_deposit).
//
// Three steps, in the order a Manager thinks about them:
//   1. Check what came back (read-only, recorded by Staff)
//   2. Decide the charge for damaged / missing items (only when Staff reported any)
//   3. Settle the money: the deposit pays the charge first, then the customer gets the rest back
//      or pays what is still owed.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Booking, peso } from "./_shared";

type ReturnRecord = {
    allocationId: number; equipmentName: string; issuedQuantity: number; allocationStatus: string;
    returnedReceivedUnits: number | string | null; inspectionStatus: string | null; inspectedAt: string | null;
    notes: string | null; damagedUnits?: number; missingUnits?: number;
};
type Incident = { id: number; equipmentName: string; quantity: number | string; reason?: string;
    status?: string; decisionStatus?: string | null; unitValue?: number | null };
type ClaimSources = { returnReports: ReturnRecord[]; damage: Incident[]; missing: Incident[]; recoveryInspectionPending: boolean };
type Ledger = {
    depositHeld: number; claimBalance: number;
    booking: { status: string };
    rentalItems: Array<{ name: string; quantity: number }>;
    claims: Array<{ status: string; amount: number }>;
};
type Method = "cash" | "gcash" | "bank_transfer";
type ChargeMethod = "replace" | "repair" | "none";
const incidentKey = (i: { kind: string; id: number }) => `${i.kind}-${i.id}`;

const METHODS: Array<[Method, string]> = [["cash", "Cash"], ["gcash", "GCash"], ["bank_transfer", "Bank transfer"]];
const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;
const validAmount = (raw: string) => raw.trim() !== "" && /^\d+(\.\d{1,2})?$/.test(raw.trim());

function StepTitle({ number, title, hint }: { number: number; title: string; hint?: string }) {
    return <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2B174C] text-xs font-bold text-white">{number}</span>
        <div><h3 className="text-[15px] font-bold text-[#1A1220]">{title}</h3>{hint && <p className="mt-0.5 text-xs text-[#806A8C]">{hint}</p>}</div>
    </div>;
}
function MoneyRow({ label, value, sign, strong, tone }: { label: string; value: number; sign?: "-" | "+"; strong?: boolean; tone?: string }) {
    return <div className={`flex items-center justify-between gap-3 ${strong ? "text-[15px] font-bold" : "text-sm"} ${tone || "text-[#2B174C]"}`}>
        <span>{label}</span><span className="tabular-nums">{sign ? `${sign} ` : ""}{peso(value)}</span>
    </div>;
}
function MethodSelect({ id, value, onChange, disabled }: { id: string; value: Method; onChange: (m: Method) => void; disabled: boolean }) {
    return <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value as Method)}
                   className="h-10 w-full rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm text-[#2B174C] sm:w-44">
        {METHODS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>;
}

export default function RentalReturnSettlementDialog({ booking, onClose, onSaved }: {
    booking: Booking; onClose: () => void; onSaved: (completed: boolean, message: string) => Promise<void>;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [sources, setSources] = useState<ClaimSources | null>(null);
    const [ledger, setLedger] = useState<Ledger | null>(null);
    // Step 2
    // How each damaged / missing item is charged: Replace (full replacement value), Repair (cost typed in), or No charge.
    const [methods, setMethods] = useState<Record<string, ChargeMethod>>({});
    const [repairText, setRepairText] = useState<Record<string, string>>({});
    const [note, setNote] = useState("");
    // Step 3
    const [receivedText, setReceivedText] = useState("");
    const [receivedTouched, setReceivedTouched] = useState(false);
    const [receivedMethod, setReceivedMethod] = useState<Method>("cash");
    const [receivedConfirmed, setReceivedConfirmed] = useState(false);
    const [refundMethod, setRefundMethod] = useState<Method>("cash");
    const [refundConfirmed, setRefundConfirmed] = useState(false);
    // Same key if a response is lost, so a retry never records money twice.
    const requestKey = useRef<string | null>(null);
    const branchId = Number(booking.branchId ?? booking.branch_id ?? 0);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Please sign in again.");
            const call = async (action: string) => {
                const res = await fetch("/api/bookings", { method: "POST", cache: "no-store",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action, bookingId: booking.id, branch_id: branchId || undefined }) });
                const data = await res.json();
                if (!res.ok || data.error || data.success === false) throw new Error(data.error || "Unable to load this booking.");
                return data;
            };
            const [finance, claimSources] = await Promise.all([call("get_booking_financial_statement"), call("get_booking_claim_sources")]);
            if (!finance.statement || !Array.isArray(claimSources.returnReports)) throw new Error("Return records are incomplete. Update the Bookings Lambda.");
            if (cancelled) return;
            setLedger(finance.statement as Ledger);
            setSources(claimSources as ClaimSources);
        };
        setLoading(true);
        void load().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load this booking."); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [booking.id, branchId]);

    // ── What Staff recorded ──
    const incidents = useMemo(() => sources ? [
        ...sources.damage.map(i => ({ ...i, kind: "Damaged" as const })),
        ...sources.missing.map(i => ({ ...i, kind: "Missing" as const })),
    ].filter(i => Number(i.quantity) > 0) : [], [sources]);
    const needsDecision = incidents.some(i => !i.decisionStatus);
    const staffDone = !!sources && !sources.recoveryInspectionPending && sources.returnReports.length > 0 &&
        sources.returnReports.every(r => r.allocationStatus === "returned" && !!r.inspectedAt);
    const damagedTotal = incidents.filter(i => i.kind === "Damaged").reduce((s, i) => s + Number(i.quantity), 0);
    const missingTotal = incidents.filter(i => i.kind === "Missing").reduce((s, i) => s + Number(i.quantity), 0);
    // Missing items are lost, so they start on "Replace" (when the replacement value is known). Damaged items need a choice.
    useEffect(() => {
        setMethods(current => {
            const next = { ...current };
            for (const i of incidents) if (i.kind === "Missing" && i.unitValue != null && !next[incidentKey(i)]) next[incidentKey(i)] = "replace";
            return next;
        });
    }, [incidents]);
    const replaceCents = (i: typeof incidents[number]) => i.unitValue != null ? cents(Number(i.quantity) * Number(i.unitValue)) : null;
    // Charge for one item in centavos, or null while it still needs a choice / a valid repair cost.
    const lineChargeC = (i: typeof incidents[number]): number | null => {
        const method = methods[incidentKey(i)];
        if (method === "none") return 0;
        if (method === "replace") return replaceCents(i);
        if (method === "repair") { const raw = repairText[incidentKey(i)] || ""; return validAmount(raw) ? cents(Number(raw)) : null; }
        return null;
    };
    const unchosen = needsDecision ? incidents.find(i => !methods[incidentKey(i)]) : undefined;
    const badRepair = needsDecision ? incidents.find(i => methods[incidentKey(i)] === "repair" && lineChargeC(i) === null) : undefined;
    // The reason saved with the decision is written from the choices; the Manager can add a note.
    const decisionReason = incidents.map(i => {
        const method = methods[incidentKey(i)], charge = lineChargeC(i);
        return `${i.equipmentName} ×${Number(i.quantity)} ${i.kind.toLowerCase()}: ${method === "none" ? "no charge" : `${method} (${peso(fromCents(charge || 0))})`}`;
    }).join("; ") + (note.trim() ? `. Note: ${note.trim()}` : "");
    const decidedCharge = ledger ? ledger.claims.filter(c => c.status !== "waived").reduce((s, c) => s + Math.max(0, Number(c.amount) || 0), 0) : 0;

    // ── Money (all in centavos to avoid rounding errors) ──
    const heldC = cents(Number(ledger?.depositHeld || 0));
    const dueC = cents(Number(ledger?.claimBalance || 0));
    const chargeValid = !needsDecision || (!unchosen && !badRepair);
    const newChargeC = needsDecision && chargeValid ? incidents.reduce((sum, i) => sum + (lineChargeC(i) || 0), 0) : 0;
    const chargeC = needsDecision ? newChargeC : dueC;          // the charge this settlement must cover
    const depositUsedC = Math.min(heldC, chargeC);
    const stillOwedC = chargeC - depositUsedC;
    // Pre-fill "received now" with the full amount still owed, unless the Manager typed their own.
    useEffect(() => { if (!receivedTouched) setReceivedText(stillOwedC > 0 ? fromCents(stillOwedC).toFixed(2) : "0"); }, [stillOwedC, receivedTouched]);
    const receivedValid = stillOwedC === 0 || (validAmount(receivedText) && cents(Number(receivedText)) <= stillOwedC);
    const receivedC = stillOwedC > 0 && receivedValid ? cents(Number(receivedText)) : 0;
    const owedAfterC = stillOwedC - receivedC;
    const giveBackC = heldC - depositUsedC;                      // only when nothing is owed (stillOwed > 0 means the deposit is used up)
    const completes = owedAfterC === 0;

    // The money step is step 3 when there is a charge to decide, otherwise step 2.
    const moneyStep = incidents.length > 0 ? 3 : 2;
    // ── What still blocks the Save button (shown next to it) ──
    const isPendingSettlement = String(ledger?.booking.status || "").toLowerCase() === "pending settlement";
    let blocker = "";
    if (!ledger || !sources) blocker = loading ? "Loading..." : "This booking could not be loaded.";
    else if (!isPendingSettlement) blocker = "This booking is no longer waiting for settlement.";
    else if (!staffDone) blocker = "Waiting for Staff to finish checking the returned items.";
    else if (unchosen) blocker = `Step 2: choose Replace, Repair or No charge for ${unchosen.equipmentName}.`;
    else if (badRepair) blocker = `Step 2: enter the repair cost for ${badRepair.equipmentName}.`;
    else if (!receivedValid) blocker = `Step ${moneyStep}: amount received can be ₱0 to ${peso(fromCents(stillOwedC))}.`;
    else if (receivedC > 0 && !receivedConfirmed) blocker = `Step ${moneyStep}: tick the box to confirm you received the payment.`;
    else if (giveBackC > 0 && !refundConfirmed) blocker = `Step ${moneyStep}: tick the box to confirm you gave the money back.`;
    else if (!needsDecision && dueC > 0 && receivedC === 0) blocker = `Step ${moneyStep}: enter the amount the customer paid.`;
    const canSave = !blocker && !saving;

    async function save() {
        if (!canSave || !ledger) return;
        setError(""); setSaving(true);
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Your session expired. Please sign in again.");
            requestKey.current = requestKey.current || `RETURN-${booking.id}-${crypto.randomUUID()}`;
            const combined = needsDecision || dueC > 0;
            const payload = {
                action: "settle_booking_security_deposit", bookingId: booking.id, branch_id: branchId, requestKey: requestKey.current,
                mode: combined ? "combined" : "refund",
                chargeAmount: fromCents(newChargeC),
                reason: needsDecision ? decisionReason.slice(0, 500) : "",
                additionalPaymentReceived: fromCents(receivedC), paymentVerified: receivedC > 0 && receivedConfirmed, paymentMethod: receivedMethod,
                refundAmount: fromCents(owedAfterC === 0 ? giveBackC : 0), refundVerified: giveBackC > 0 && refundConfirmed, refundMethod,
            };
            const response = await fetch("/api/bookings", { method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
            const result = await response.json();
            if (!response.ok || result.error || result.success !== true) throw new Error(result.error || "The settlement could not be saved.");
            requestKey.current = null;
            const parts = [
                Number(result.appliedDeposit) > 0 ? `${peso(Number(result.appliedDeposit))} of the deposit used for the charge` : "",
                Number(result.additionalPaymentRecorded) > 0 ? `${peso(Number(result.additionalPaymentRecorded))} received` : "",
                Number(result.amountRefunded) > 0 ? `${peso(Number(result.amountRefunded))} given back` : "",
            ].filter(Boolean);
            await onSaved(Boolean(result.completed), result.alreadyRecorded ? "This settlement was already saved. Nothing was recorded twice."
                : `Settlement saved${parts.length ? `: ${parts.join(", ")}` : ""}.${result.completed ? " Booking completed." : ""}`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to save. Check the booking before trying again.");
        } finally { setSaving(false); }
    }

    const card = "space-y-3 rounded-xl border border-[#E6DDF0] bg-white p-4";
    return <div className="fixed inset-0 z-[230] flex items-center justify-center bg-[#1A1220]/60 p-3 backdrop-blur-sm"
                role="dialog" aria-modal="true" aria-labelledby="settle-return-title">
        <div className="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-[#FBF8FD] shadow-2xl">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-5 py-4">
                <div>
                    <h2 id="settle-return-title" className="text-lg font-bold text-[#1A1220]">Settle Rental Return</h2>
                    <p className="mt-0.5 text-xs text-[#806A8C]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
                </div>
                <button type="button" disabled={saving} onClick={onClose} aria-label="Close" className="rounded-lg border border-[#E6DDF0] p-2 text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50"><X size={17}/></button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm text-[#2B174C]">
                {loading && <p role="status" className="text-[#806A8C]">Loading the return and payment records...</p>}

                {/* Step 1: what came back */}
                {sources && <section className={card} aria-label="Step 1: Check what came back">
                    <StepTitle number={1} title="Check what came back" hint="Recorded by Staff when they received the items."/>
                    <div className="overflow-hidden rounded-lg border border-[#E6DDF0]">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[#F7F2FC] text-[10px] font-bold uppercase tracking-wide text-[#6A5582]">
                            <tr><th className="px-3 py-2">Equipment</th><th className="px-2 py-2 text-center">Rented</th>
                                <th className="px-2 py-2 text-center">Returned</th><th className="px-2 py-2 text-center">Damaged</th><th className="px-2 py-2 text-center">Missing</th></tr>
                            </thead>
                            <tbody>{sources.returnReports.map(r => <tr key={r.allocationId} className="border-t border-[#EFE7F4]">
                                <td className="px-3 py-2 font-semibold">{r.equipmentName}</td>
                                <td className="px-2 py-2 text-center tabular-nums">{r.issuedQuantity}</td>
                                <td className="px-2 py-2 text-center tabular-nums">{r.returnedReceivedUnits ?? "—"}</td>
                                <td className={`px-2 py-2 text-center tabular-nums ${Number(r.damagedUnits) > 0 ? "font-bold text-[#B45309]" : "text-[#806A8C]"}`}>{Number(r.damagedUnits || 0)}</td>
                                <td className={`px-2 py-2 text-center tabular-nums ${Number(r.missingUnits) > 0 ? "font-bold text-[#C32F2F]" : "text-[#806A8C]"}`}>{Number(r.missingUnits || 0)}</td>
                            </tr>)}</tbody>
                        </table>
                    </div>
                    {sources.returnReports.filter(r => r.notes).map(r =>
                        <p key={`note-${r.allocationId}`} className="rounded-lg border-l-4 border-[#CEB9F3] bg-[#FBF8FF] px-3 py-2 text-xs text-[#4F3A5A]">
                            <span className="font-semibold">Staff note ({r.equipmentName}):</span> {r.notes}</p>)}
                    {staffDone
                        ? <p className="flex items-center gap-2 text-xs font-medium text-[#218246]"><CheckCircle2 size={15}/> Staff has received and checked everything.</p>
                        : <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0"/> Staff still needs to receive and check all returned items in the Rental queue. You can settle after that.</p>}
                </section>}

                {/* Step 2: decide the charge */}
                {sources && ledger && incidents.length > 0 && <section className={card} aria-label="Step 2: Decide the damage charge">
                    <StepTitle number={2} title="Decide the damage charge"
                               hint={`Staff reported ${[damagedTotal ? `${damagedTotal} damaged` : "", missingTotal ? `${missingTotal} missing` : ""].filter(Boolean).join(" and ")} unit(s).`}/>
                    {needsDecision ? <>
                        <p className="text-xs text-[#5F4E75]"><strong>Replace</strong> for severe damage or lost items (full replacement value). <strong>Repair</strong> for minor damage (enter the repair cost).</p>
                        {incidents.map(i => {
                            const key = incidentKey(i), method = methods[key], replace = replaceCents(i), charge = lineChargeC(i);
                            const options: Array<[ChargeMethod, string, boolean]> = [
                                ["replace", replace != null ? `Replace · ${peso(fromCents(replace))}` : "Replace (no value set)", replace == null],
                                ["repair", "Repair", false], ["none", "No charge", false]];
                            return <div key={key} className="space-y-2 rounded-lg border border-[#E6DDF0] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold text-[#1A1220]">{i.equipmentName}</p>
                                        <p className="text-xs text-[#806A8C]">{Number(i.quantity)} {i.kind.toLowerCase()}{i.unitValue != null ? ` · Replacement value ${peso(Number(i.unitValue))} each` : ""}</p>
                                    </div>
                                    <strong className="tabular-nums text-[#2B174C]">{charge != null ? peso(fromCents(charge)) : "—"}</strong>
                                </div>
                                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={`How to charge for ${i.equipmentName}`}>
                                    {options.map(([value, label, disabled]) =>
                                        <label key={value} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center text-xs font-semibold ${disabled ? "cursor-not-allowed opacity-40" : ""} ${method === value ? "border-[#2B174C] bg-[#F1EBFF] text-[#2B174C]" : "border-[#D8CBE7] bg-white text-[#5F4E75]"}`}>
                                            <input type="radio" name={`charge-${key}`} value={value} checked={method === value} disabled={saving || disabled} className="accent-[#2B174C]"
                                                   onChange={() => { setMethods(m => ({ ...m, [key]: value })); requestKey.current = null; }}/>{label}
                                        </label>)}
                                </div>
                                {method === "repair" && <div className="flex flex-wrap items-center gap-2">
                                    <label htmlFor={`repair-${key}`} className="text-xs font-semibold">Repair cost (₱)</label>
                                    <input id={`repair-${key}`} inputMode="decimal" placeholder="0.00" value={repairText[key] || ""} disabled={saving}
                                           onChange={e => { setRepairText(r => ({ ...r, [key]: e.target.value })); requestKey.current = null; }}
                                           className="h-9 w-32 rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm tabular-nums"/>
                                    {(repairText[key] || "").trim() !== "" && !validAmount(repairText[key] || "") && <span className="text-xs text-red-700">Enter an amount like 250 or 250.50.</span>}
                                    {replace != null && charge != null && charge > replace && <span className="text-xs text-amber-800">This is more than replacing it ({peso(fromCents(replace))}).</span>}
                                </div>}
                            </div>;
                        })}
                        <MoneyRow label="Total damage charge" value={fromCents(newChargeC)} strong/>
                        <div className="space-y-1">
                            <label htmlFor="settle-note" className="block text-xs font-semibold">Note (optional)</label>
                            <input id="settle-note" maxLength={200} value={note} disabled={saving} placeholder="e.g. Cracked leg, can't be fixed"
                                   onChange={e => { setNote(e.target.value); requestKey.current = null; }}
                                   className="h-10 w-full rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm"/>
                        </div>
                    </> : <MoneyRow label={decidedCharge > 0 ? "Charge already decided" : "Already decided: no charge"} value={decidedCharge}/>}
                </section>}

                {/* Step 3: settle the money */}
                {sources && ledger && <section className={card} aria-label="Settle the money">
                    <StepTitle number={moneyStep} title="Settle the money"
                               hint={incidents.length > 0 ? "The security deposit pays for the charge first. The rest goes back to the customer."
                                   : "Nothing was damaged or missing, so the whole deposit goes back to the customer."}/>
                    <div className="space-y-2 rounded-lg bg-[#FBF8FF] p-3">
                        <MoneyRow label="Security deposit held" value={fromCents(heldC)}/>
                        {chargeC > 0 && <MoneyRow label={needsDecision ? "Damage charge" : "Unpaid damage charge"} value={fromCents(chargeC)} sign="-"/>}
                        <div className="border-t border-dashed border-[#D8CBE7] pt-2">
                            {stillOwedC > 0
                                ? <MoneyRow label="Customer still owes" value={fromCents(stillOwedC)} strong tone="text-[#B45309]"/>
                                : <MoneyRow label="Give back to customer" value={fromCents(giveBackC)} strong tone="text-[#218246]"/>}
                        </div>
                    </div>

                    {stillOwedC > 0 && <div className="space-y-2">
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1">
                                <label htmlFor="settle-received" className="block text-xs font-semibold">Amount received now (₱)</label>
                                <input id="settle-received" inputMode="decimal" value={receivedText} disabled={saving}
                                       onChange={e => { setReceivedText(e.target.value); setReceivedTouched(true); requestKey.current = null; }}
                                       className="h-10 w-40 rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm tabular-nums"/>
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="settle-received-method" className="block text-xs font-semibold">Paid by</label>
                                <MethodSelect id="settle-received-method" value={receivedMethod} onChange={setReceivedMethod} disabled={saving}/>
                            </div>
                        </div>
                        <p className="text-[11px] text-[#806A8C]">If the customer will pay later, enter 0. The booking stays in Pending Settlement until it is paid.</p>
                        {receivedC > 0 && <label className="flex items-start gap-2 text-xs">
                            <input type="checkbox" checked={receivedConfirmed} disabled={saving} onChange={e => setReceivedConfirmed(e.target.checked)} className="mt-0.5 accent-[#2B174C]"/>
                            <span>I received <strong>{peso(fromCents(receivedC))}</strong> from the customer.</span></label>}
                    </div>}

                    {stillOwedC === 0 && giveBackC > 0 && <div className="space-y-2">
                        <div className="space-y-1">
                            <label htmlFor="settle-refund-method" className="block text-xs font-semibold">Give back by</label>
                            <MethodSelect id="settle-refund-method" value={refundMethod} onChange={setRefundMethod} disabled={saving}/>
                        </div>
                        <label className="flex items-start gap-2 text-xs">
                            <input type="checkbox" checked={refundConfirmed} disabled={saving} onChange={e => setRefundConfirmed(e.target.checked)} className="mt-0.5 accent-[#2B174C]"/>
                            <span>I gave <strong>{peso(fromCents(giveBackC))}</strong> back to the customer.</span></label>
                    </div>}
                    {stillOwedC === 0 && giveBackC === 0 && <p className="text-xs text-[#806A8C]">Nothing to collect or give back.</p>}
                </section>}

                {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            </div>

            <footer className="shrink-0 space-y-2 border-t border-[#E6DDF0] bg-white px-5 py-4">
                {ledger && sources && !blocker && <p className="text-xs text-[#4F3A5A]">
                    {completes ? <>After saving, the booking moves to <strong>Completed</strong>.</>
                        : <>After saving, the booking stays in <strong>Pending Settlement</strong> until the customer pays {peso(fromCents(owedAfterC))}.</>}
                </p>}
                {blocker && <p className="text-xs text-[#926400]">{blocker}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-[#D8CBE7] px-5 py-2.5 text-sm font-semibold text-[#2B174C] disabled:opacity-50">Cancel</button>
                    <button type="button" disabled={!canSave} onClick={() => void save()}
                            className="rounded-lg bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50">
                        {saving ? "Saving..." : completes ? "Settle & Complete Booking" : "Save Settlement"}</button>
                </div>
            </footer>
        </div>
    </div>;
}
