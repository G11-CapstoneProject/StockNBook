"use client";

// Manager "Rental Return & Final Settlement" dialog (restored from the earlier ManagerBookings).
// Put this file next to _shared.tsx. It reads Staff return/inspection records and the booking's
// financial statement, then saves ONE settlement transaction through the Bookings Lambda
// (action: settle_booking_security_deposit). Money is moved only by the backend.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Booking, peso } from "./_shared";

type RentalReturnRecord = {
    allocationId: number; equipmentName: string; issuedQuantity: number; allocationStatus: string;
    returnedReceivedUnits: number | string | null; inspectionStatus: string | null;
    inspectedAt: string | null; inspectedBy: string | null;
    receivedBy: string | null; notes: string | null;
};
type RentalReturnIncident = {
    id: number; equipmentName: string; quantity: number | string; reason?: string;
    status?: string; decisionStatus?: string | null;
};
type RentalReturnReview = {
    returnReports: RentalReturnRecord[];
    damage: RentalReturnIncident[];
    missing: RentalReturnIncident[];
    recoveryInspectionPending: boolean;
};
type ReturnSettlementLedger = {
    depositRequired: number; depositCollected: number; depositHeld: number;
    depositApplied: number; depositRefunded: number; claimBalance: number;
    booking: { status: string; balance: number; agreedPrice: number | null; bookingPayments: number };
    rentalItems: Array<{ name: string; quantity: number }>;
    claims: Array<{ id: number; equipmentName?: string; status: string; amount: number;
        amountPaid: number; depositApplied: number; reason?: string }>;
};

export default function RentalReturnSettlementDialog({booking,onClose,onSaved}: {
    booking: Booking; onClose: () => void; onSaved: (completed: boolean, message: string) => Promise<void>;
}) {
    const [loading,setLoading] = useState(true);
    const [saving,setSaving] = useState(false);
    const [error,setError] = useState("");
    const [review,setReview] = useState<RentalReturnReview | null>(null);
    const [ledger,setLedger] = useState<ReturnSettlementLedger | null>(null);
    const [mode,setMode] = useState<"charge" | "refund">("refund");
    const [charge,setCharge] = useState("0.00");
    const [cashReceived,setCashReceived] = useState("0.00");
    const [refund,setRefund] = useState("");
    const [reason,setReason] = useState("");
    const [reviewConfirmed,setReviewConfirmed] = useState(false);
    const [permanentLossConfirmed,setPermanentLossConfirmed] = useState(false);
    const [cashConfirmed,setCashConfirmed] = useState(false);
    const [refundConfirmed,setRefundConfirmed] = useState(false);
    // Keep the same key if an API response is lost, preventing duplicate payments.
    const requestKey = useRef<string | null>(null);
    const branchId = Number(booking.branchId ?? booking.branch_id ?? 0);

    async function readReview() {
        const token=sessionStorage.getItem("token");
        if(!token)throw new Error("Please sign in before settling a booking.");
        const request=async(action:string)=>{
            const res=await fetch("/api/bookings",{
                method:"POST",cache:"no-store",
                headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
                body:JSON.stringify({action,bookingId:booking.id,branch_id:branchId||undefined})
            });
            const data=await res.json();
            if(!res.ok||data.error||data.success===false)
                throw new Error(data.error||`Unable to load ${action}.`);
            return data;
        };
        const [finance,incidents]=await Promise.all([
            request("get_booking_financial_statement"), request("get_booking_claim_sources")
        ]);
        if(!finance.statement || !Array.isArray(incidents.missing) || !Array.isArray(incidents.damage)
            || !Array.isArray(incidents.returnReports))
            throw new Error("Return inspection information is incomplete. Install the v2 booking backend update.");
        const nextLedger=finance.statement as ReturnSettlementLedger;
        if(!Number.isFinite(Number(nextLedger.depositHeld)) || !Number.isFinite(Number(nextLedger.claimBalance)))
            throw new Error("Booking financial records are unavailable; settlement is blocked.");
        setLedger(nextLedger);
        setReview(incidents as RentalReturnReview);
        const undecided=[...(incidents.damage as RentalReturnIncident[]),
            ...(incidents.missing as RentalReturnIncident[]).filter(item=>
                Number(item.quantity)>0 && ["pending","writeoff"].includes(String(item.status||"").toLowerCase()))]
            .filter(item=>!item.decisionStatus);
        setMode(undecided.length>0 || Number(nextLedger.claimBalance)>0.005 ? "charge" : "refund");
        setRefund(Number(nextLedger.depositHeld).toFixed(2));
    }
    useEffect(()=>{
        let cancelled=false;
        setLoading(true);
        void readReview().catch(cause=>{if(!cancelled)setError(cause instanceof Error?cause.message:"Unable to review returned goods.");})
            .finally(()=>{if(!cancelled)setLoading(false);});
        return ()=>{cancelled=true;};
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[booking.id]); // Read once on opening; reopen to refresh current Staff records.

    const allIncidents=review ? [
        ...review.damage.map(item=>({...item,kind:"Damage"})),
        ...review.missing.map(item=>({...item,kind:"Missing"}))
    ] : [];
    const undecided=allIncidents.filter(item=> !item.decisionStatus &&
        (item.kind==="Damage" || (Number(item.quantity)>0 &&
            ["pending","writeoff"].includes(String(item.status||"").toLowerCase()))));
    const pendingLoss=undecided.some(item=>item.kind==="Missing" && String(item.status).toLowerCase()==="pending");
    const inspectionsComplete=!!review && !review.recoveryInspectionPending &&
        (review.returnReports.length===0 ? (ledger?.rentalItems.length===0) :
            review.returnReports.every(item=>item.allocationStatus==="returned" &&
                Boolean(item.inspectedAt) && !["pending","cleaning"].includes(String(item.inspectionStatus||"").toLowerCase())));
    const due=Number(ledger?.claimBalance||0);
    const held=Number(ledger?.depositHeld||0);
    const amountValid=(value:string)=>value.trim()!=="" && Number.isFinite(Number(value)) &&
        Number(value)>=0 && Math.abs(Number(value)*100-Math.round(Number(value)*100))<0.00001;
    const proposedCharge=amountValid(charge)?Number(charge):0;
    const depositToApply=Math.min(held,due+(undecided.length?proposedCharge:0));
    const projectedDue=Math.max(0,due+(undecided.length?proposedCharge:0)-depositToApply-(amountValid(cashReceived)?Number(cashReceived):0));
    const availableRefund=Math.max(0,held-depositToApply);
    const canRefund=undecided.length===0 && due<0.005;
    const disableSubmit=loading||saving||!ledger||!review||!inspectionsComplete||
        String(ledger.booking.status).toLowerCase()!=="pending settlement";

    async function save() {
        if(disableSubmit)return;
        setError("");
        if(!reviewConfirmed){setError("Confirm that you reviewed the Staff return and inspection records.");return;}
        if(mode==="charge"){
            if(!allIncidents.length){setError("Additional charges require a Staff-recorded damage or missing-item report.");return;}
            if(!amountValid(charge)||!amountValid(cashReceived)){setError("Enter valid peso amounts with at most two decimals.");return;}
            if(undecided.length>0 && reason.trim().length<10){setError("Describe the Manager's charge or waiver decision (at least 10 characters).");return;}
            if(pendingLoss&&!permanentLossConfirmed){setError("Confirm the permanent loss of the Staff-reported missing goods.");return;}
            const cash=Number(cashReceived);
            if(cash>0&&!cashConfirmed){setError("Confirm additional payment was actually received before recording it.");return;}
            if(cash>Math.max(0,due+(undecided.length?Number(charge):0)-depositToApply)+0.005){
                setError("Recorded additional payment exceeds unpaid approved charges after deposit application.");return;
            }
            if(!undecided.length && due<=0.005){setError("There are no remaining reported incidents or approved charges to settle.");return;}
        }else{
            if(!canRefund){setError("Review all incidents and settle approved charges before returning the deposit.");return;}
            if(!amountValid(refund)||Number(refund)>held+0.005){setError("Refund cannot exceed the deposit currently held.");return;}
            if(held>0.005&&Number(refund)<=0){setError("Enter the refund amount actually returned to the customer.");return;}
            if(Number(refund)>0&&!refundConfirmed){setError("Confirm the customer actually received the refund before recording it.");return;}
        }
        setSaving(true);
        try {
            const token=sessionStorage.getItem("token");
            if(!token)throw new Error("Your session expired. Please sign in again.");
            const key=requestKey.current||`RETURN-${booking.id}-${crypto.randomUUID()}`;
            requestKey.current=key;
            const payload={
                action:"settle_booking_security_deposit",bookingId:booking.id,branch_id:branchId,
                requestKey:key,mode:mode==="charge"?"combined":"refund",
                chargeAmount:mode==="charge"&&undecided.length?Number(charge):0,
                additionalPaymentReceived:mode==="charge"?Number(cashReceived):0,
                refundAmount:mode==="refund"?Number(refund):0,
                reason:mode==="charge"?reason.trim():"",
                confirmPermanentLoss:permanentLossConfirmed,
                paymentVerified:mode==="charge"&&Number(cashReceived)>0&&cashConfirmed,
                refundVerified:mode==="refund"&&Number(refund)>0&&refundConfirmed,
            };
            const response=await fetch("/api/bookings",{
                method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
                body:JSON.stringify(payload)
            });
            const result=await response.json();
            if(!response.ok||result.error||result.success!==true)
                throw new Error(result.error||"The settlement could not be saved.");
            requestKey.current=null;
            // The transaction is committed. Refresh failure must not be reported
            // as a failed payment or issue a duplicate refund on retry.
            await onSaved(Boolean(result.completed),result.alreadyRecorded?
                "This settlement was already recorded. Financial records were not duplicated.":
                `Recorded deposit application ${peso(Number(result.appliedDeposit||0))}, additional payment ${peso(Number(result.additionalPaymentRecorded||0))}, and refund ${peso(Number(result.amountRefunded||0))}.`);
        }catch(cause){setError(cause instanceof Error?cause.message:"Unable to save settlement. Verify the ledger before retrying.");}
        finally{setSaving(false);}
    }
    const fmt=(raw:string|null)=>{
        if(!raw)return "Not recorded";
        const date=new Date(raw.replace(" ","T"));
        return Number.isNaN(date.getTime())?String(raw):date.toLocaleString("en-PH",{dateStyle:"medium",timeStyle:"short"});
    };
    return <div className="fixed inset-0 z-[230] flex items-center justify-center bg-[#1A1220]/60 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review rental returns and settle deposit">
    <div className="flex max-h-[92vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-white shadow-2xl">
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E6DDF0] p-5">
    <div><h2 className="text-lg font-bold text-[#1A1220]">Rental Return &amp; Final Settlement</h2>
    <p className="mt-1 text-xs text-[#806A8C]">{booking.name} · {booking.bookingReference||`#${booking.id}`}</p></div>
    <button type="button" disabled={saving} onClick={onClose} aria-label="Close return settlement" className="rounded-lg border border-[#E6DDF0] p-2 text-[#2B174C] disabled:opacity-50"><X size={17}/></button>
    </div>
    <div className="min-h-0 space-y-4 overflow-y-auto p-5 text-sm text-[#2B174C]">
        {loading?<p role="status">Loading Staff inspection records and booking ledger...</p>:null}
    {ledger && <section className="grid grid-cols-2 gap-3 rounded-xl border border-[#E6DDF0] bg-[#FBF8FD] p-4 sm:grid-cols-4">
        {([["Deposit held",held],["Deposit applied",Number(ledger.depositApplied)],["Refunds recorded",Number(ledger.depositRefunded)],["Unpaid claims",due]] as const).map(([label,value])=>
            <div key={label}><p className="text-xs text-[#806A8C]">{label}</p><strong className="mt-1 block text-[16px]">{peso(value)}</strong></div>)}
    </section>}
        {review && <section className="rounded-xl border border-[#E6DDF0] p-4">
        <h3 className="font-bold">Staff Return &amp; Inspection Records</h3>
        <p className="mt-1 text-xs text-[#806A8C]">Read-only records from the rental inventory workflow. The Manager reviews these before deciding charges.</p>
        <div className="mt-3 max-h-48 divide-y divide-[#EAE4F0] overflow-y-auto rounded-lg border border-[#E6DDF0]">
            {review.returnReports.length?review.returnReports.map(row=>
                    <div key={row.allocationId} className="px-3 py-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2"><strong>{row.equipmentName} · {row.issuedQuantity} unit(s)</strong><span>{row.allocationStatus} / {row.inspectionStatus||"Not inspected"}</span></div>
        <p className="mt-1 text-[#806A8C]">Received: {row.returnedReceivedUnits??"Not recorded"} · Inspected: {fmt(row.inspectedAt)}{row.inspectedBy?` · By ${row.inspectedBy}`:""}</p>
            {row.receivedBy&&<p className="mt-1 text-[#806A8C]">Received by: {row.receivedBy}</p>}
                {row.notes&&<p className="mt-1 break-words text-[#5F4E75]">Staff notes: {row.notes}</p>}
                </div>):<p className="p-3 text-xs text-[#806A8C]">{ledger?.rentalItems.length?"No Staff inspection records were found.":"No rental goods were assigned to this booking."}</p>}
                </div>
                {(!inspectionsComplete||review.recoveryInspectionPending)&&<p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Staff must finish receiving, inspecting and cleaning all rentals, including recovered items, before the Manager can settle.</p>}
                </section>}
                    {review&&<section className="rounded-xl border border-[#E6DDF0] p-4">
                    <h3 className="font-bold">Reported Damage / Missing Items</h3>
                    <div className="mt-3 space-y-2">{allIncidents.length?allIncidents.map(item=>
                            <div key={`${item.kind}-${item.id}`} className="rounded-lg border border-[#E6DDF0] bg-[#FFFDF8] p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2"><strong>{item.kind}: {item.equipmentName} · {item.quantity} unit(s)</strong><span>{item.decisionStatus?`Decision: ${item.decisionStatus}`:item.status||"Awaiting Manager decision"}</span></div>
                        {item.reason&&<p className="mt-1 break-words text-[#806A8C]">Staff record: {item.reason}</p>}
                        </div>):<p className="text-xs text-[#806A8C]">No damaged or missing rental items have been reported for this booking.</p>}</div>
                        {ledger?.claims?.length? <p className="mt-2 text-xs text-[#806A8C]">{ledger.claims.length} previous Manager claim decision(s) recorded; unpaid approved balance: {peso(due)}.</p>:null}
                        </section>}
                            {review&&ledger&&<section className="space-y-3 rounded-xl border border-[#E6DDF0] bg-[#FBF8FD] p-4">
                            <h3 className="font-bold">Manager&apos;s Final Financial Decision</h3>
                            <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={()=>{setMode("charge");requestKey.current=null;}} disabled={saving||(!undecided.length&&due<=0.005)}
                                className={`rounded-lg border px-2 py-2.5 text-xs font-semibold disabled:opacity-40 ${mode==="charge"?"border-[#2B174C] bg-[#2B174C] text-white":"border-[#D8CBE7] bg-white"}`}>Approve charges / waiver</button>
                            <button type="button" onClick={()=>{setMode("refund");requestKey.current=null;}} disabled={saving||!canRefund}
                                className={`rounded-lg border px-2 py-2.5 text-xs font-semibold disabled:opacity-40 ${mode==="refund"?"border-[#2B174C] bg-[#2B174C] text-white":"border-[#D8CBE7] bg-white"}`}>Refund deposit / close</button>
                            </div>
                                {mode==="charge"?<>
                                    <label className="block text-xs font-semibold">Final total charge for newly reported incidents (₱)
                                <input type="number" min="0" step="0.01" value={charge} disabled={saving||!undecided.length}
                                    onChange={e=>{setCharge(e.target.value);requestKey.current=null;}}
                                    className="mt-1 h-11 w-full rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm"/>
                                        </label>
                                    {!undecided.length&&<p className="text-xs text-[#806A8C]">Existing charges are locked. Only verified additional payments can be recorded.</p>}
                                        {undecided.length>0&&<label className="block text-xs font-semibold">Manager&apos;s reason for charge or waiver
                                        <textarea rows={2} maxLength={500} value={reason} disabled={saving} onChange={e=>{setReason(e.target.value);requestKey.current=null;}}
                                            placeholder="Explain the staff report, responsibility, and final decision..." className="mt-1 w-full rounded-lg border border-[#D8CBE7] bg-white p-3 text-sm"/>
                                            </label>}
                                            {pendingLoss&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={permanentLossConfirmed} disabled={saving} onChange={e=>setPermanentLossConfirmed(e.target.checked)} className="mt-0.5"/>
                                                <span>I reviewed the missing-item report and confirm those units are permanently lost.</span></label>}
                                            <div className="rounded-lg border border-[#E6DDF0] bg-white p-3 text-xs">
                                                <p>Deposit applied automatically to approved charges: <strong>{peso(depositToApply)}</strong></p>
                                        <p className="mt-1">Customer balance after proposed payment: <strong>{peso(projectedDue)}</strong></p>
                                        <p className="mt-1">Deposit remaining to return later: <strong>{peso(availableRefund)}</strong></p>
                                        </div>
                                        <label className="block text-xs font-semibold">Additional charge payment actually received (₱)
                                        <input type="number" min="0" step="0.01" value={cashReceived} disabled={saving} onChange={e=>{setCashReceived(e.target.value);requestKey.current=null;}}
                                            className="mt-1 h-11 w-full rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm"/>
                                                </label>
                                            {Number(cashReceived)>0&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={cashConfirmed} disabled={saving} onChange={e=>setCashConfirmed(e.target.checked)} className="mt-0.5"/>
                                                <span>I confirm that this additional payment was actually received and verified.</span></label>}
                                            </>:<>
                                            <label className="block text-xs font-semibold">Security deposit actually refunded to the customer (₱)
                                        <input type="number" min="0" step="0.01" max={held} value={refund} disabled={saving}
                                            onChange={e=>{setRefund(e.target.value);requestKey.current=null;}}
                                            className="mt-1 h-11 w-full rounded-lg border border-[#D8CBE7] bg-white px-3 text-sm"/>
                                                </label>
                                            {Number(refund)>0&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={refundConfirmed} disabled={saving} onChange={e=>setRefundConfirmed(e.target.checked)} className="mt-0.5"/>
                                                <span>I confirm that the customer has actually received this refund.</span></label>}
                                            </>}
                                            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewConfirmed} disabled={saving} onChange={e=>setReviewConfirmed(e.target.checked)} className="mt-0.5"/>
                                            <span>I reviewed the Staff inspection records and the booking&apos;s existing financial transactions.</span></label>
                                        <p className="text-xs leading-5 text-[#806A8C]">The booking price does not change. Verified charges and refundable deposits are recorded in separate ledgers; the booking completes only after all returns, claims and money are reconciled.</p>
                                        </section>}
                                            {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                                                </div>
                                                <div className="flex shrink-0 justify-end gap-2 border-t border-[#E6DDF0] bg-white p-4">
                                            <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-[#D8CBE7] px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Cancel</button>
                                                <button type="button" disabled={disableSubmit} onClick={()=>void save()}
                                                className="rounded-lg bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50">
                                                    {saving?"Saving...":mode==="charge"?"Save final charge / waiver":"Record refund / finish settlement"}
                                                    </button>
                                                    </div>
                                                    </div>
                                                    </div>;
                                            }
