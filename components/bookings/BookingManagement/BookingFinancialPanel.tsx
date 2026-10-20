"use client";

import { useCallback, useEffect, useState } from "react";

type ClaimSource = {id:number;equipmentId:number;quantity:number;reason:string};
type Statement = {
    booking:{reference:string;name:string;bookingType:string;packageName:string;status:string;agreedPrice:number|null;downPayment:number;bookingPayments:number;balance:number};
    packageBase:number;salesSubtotal?:number;rentalSubtotal:number;deliveryFee:number;setupFee:number;
    depositRequired:number;depositCollected:number;depositApplied:number;depositRefunded:number;depositHeld:number;
    claimBalance:number;agreedCharges:number;
    rentalItems:{name:string;quantity:number;days:number;dailyRate:number;amount:number}[];
    salesItems?:{name:string;variantName?:string;quantity:number;unitPrice:number;amount:number}[];
    claims:{id:number;sourceType:string;sourceId:number;quantity:number;reason:string;amount:number;amountPaid:number;depositApplied:number;status:string}[];
};
const money=(n:number)=>`₱${Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export default function BookingFinancialPanel({bookingId,branchId,ownerView=false,editable=true}:{bookingId:number;branchId:number;ownerView?:boolean;editable?:boolean}){
    const [statement,setStatement]=useState<Statement|null>(null);
    const [viewerRole,setViewerRole]=useState('staff');const [canWrite,setCanWrite]=useState(false);
    const [sources,setSources]=useState<{missing:ClaimSource[];damage:ClaimSource[]}>({missing:[],damage:[]});
    const [error,setError]=useState('');const [busy,setBusy]=useState(false);
    const [eventType,setEventType]=useState('deposit_received');
    const [amount,setAmount]=useState('');const [claimId,setClaimId]=useState('');
    const [sourceType,setSourceType]=useState('missing');const [sourceId,setSourceId]=useState('');
    const [claimAmount,setClaimAmount]=useState('');const [reason,setReason]=useState('');
    // Backend checks current account role and branch on EVERY action.
    const request=useCallback(async (action:string,additional:Record<string,unknown>={})=>{
        const token=sessionStorage.getItem('token');if(!token)throw new Error('Login required.');
        const res=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
            body:JSON.stringify({action,bookingId,branch_id:branchId||undefined,...additional})});
        const json=await res.json();if(!res.ok||json.error)throw new Error(json.error||'Request failed.');
        return json;
    },[bookingId,branchId]);
    const refresh=useCallback(async()=>{
        try{
            const data=await request('get_booking_financial_statement');setStatement(data.statement);setViewerRole(data.viewerRole||'staff');setCanWrite(!!data.canWrite);
            if(!ownerView){const tasks=await request('get_booking_claim_sources');setSources({missing:tasks.missing||[],damage:tasks.damage||[]});}
            setError('');
        }catch(e){setError(e instanceof Error?e.message:'Could not load booking statement.');}
    },[request,ownerView]);
    useEffect(()=>{void refresh();},[refresh]);
    async function record(){
        const n=Number(amount);if(!Number.isFinite(n)||n<=0){setError('Enter an amount greater than zero.');return;}
        setBusy(true);setError('');
        try{
            await request('record_booking_financial_event',{eventType,amount:n,
                claimId:['deposit_applied','claim_paid'].includes(eventType)?Number(claimId):undefined,
                requestKey:crypto.randomUUID()});setAmount('');await refresh();
        }catch(e){setError(e instanceof Error?e.message:'Unable to save financial movement.');}finally{setBusy(false);}
    }
    async function approveClaim(){
        setBusy(true);setError('');
        try{await request('approve_booking_claim',{sourceType,sourceId:Number(sourceId),amount:Number(claimAmount),reason});
            setClaimAmount('');setReason('');await refresh();}
        catch(e){setError(e instanceof Error?e.message:'Unable to approve claim.');}finally{setBusy(false);}
    }
    if(!statement)return <div className="rounded-xl border border-[#E6DDF0] p-3 text-xs text-[#806A8C]">{error||'Loading itemized booking statement…'}</div>;
    const v=statement;
    return <section className="mt-4 rounded-xl border border-[#E6DDF0] bg-white p-3 text-xs text-[#2B174C]" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold">Booking billing & settlement</h4>
            <button type="button" onClick={()=>void refresh()} className="rounded-lg border px-2 py-1">Refresh</button></div>
        <p className="my-2 text-[#806A8C]">Agreed booking amounts remain separate from refundable deposits and loss/damage claims.</p>
        <div className="space-y-1 border-b pb-2">
            <div className="flex justify-between"><span>Package base</span><strong>{money(v.packageBase)}</strong></div>
            {(v.salesItems||[]).map((i,index)=><div key={`sale-${index}`} className="flex justify-between gap-2"><span>{i.name}{i.variantName ? ` (${i.variantName})` : ""} · {i.quantity} × {money(i.unitPrice)}</span><strong>{money(i.amount)}</strong></div>)}
            {v.rentalItems.map((i,index)=><div key={index} className="flex justify-between gap-2"><span>{i.name} · {i.quantity} × {i.days} days</span><strong>{money(i.amount)}</strong></div>)}
            <div className="flex justify-between"><span>Delivery/pickup</span><strong>{money(v.deliveryFee)}</strong></div>
            <div className="flex justify-between"><span>Setup</span><strong>{money(v.setupFee)}</strong></div>
            <div className="flex justify-between border-t pt-2 font-bold"><span>Itemized charge subtotal</span><strong>{money(v.agreedCharges)}</strong></div>
            <div className="flex justify-between"><span>Agreed booking price</span><strong>{v.booking.agreedPrice!=null?money(v.booking.agreedPrice):'Awaiting agreement'}</strong></div>
            <div className="flex justify-between"><span>Booking payments recorded</span><strong>{money(v.booking.bookingPayments)}</strong></div>
            <div className="flex justify-between"><span>Booking balance</span><strong>{money(v.booking.balance)}</strong></div>
        </div>
        <div className="mt-2 space-y-1 border-b pb-2">
            <div className="flex justify-between"><span>Refundable deposit required</span><strong>{money(v.depositRequired)}</strong></div>
            <div className="flex justify-between"><span>Deposit collected</span><strong>{money(v.depositCollected)}</strong></div>
            <div className="flex justify-between"><span>Deposit applied to approved claims</span><strong>{money(v.depositApplied)}</strong></div>
            <div className="flex justify-between"><span>Deposit refunded</span><strong>{money(v.depositRefunded)}</strong></div>
            <div className="flex justify-between font-bold"><span>Deposit currently held</span><strong>{money(v.depositHeld)}</strong></div>
        </div>
        <div className="mt-2"><h5 className="font-bold">Approved loss/damage charges</h5>
            {v.claims.length===0?<p className="text-[#806A8C]">No approved equipment claims.</p>:v.claims.map(c=><p key={c.id} className="mt-1">#{c.id} · {c.sourceType} · {c.quantity} units · {money(c.amount)} approved · {money(c.amount-c.amountPaid-c.depositApplied)} due · {c.status}</p>)}
            <p className="mt-1 font-bold">Outstanding customer claims: {money(v.claimBalance)}</p>
        </div>
        <button type="button" onClick={()=>window.print()} className="mt-3 rounded-lg border border-[#D8CBE7] px-3 py-2">Print statement (not tax invoice)</button>
        {!ownerView&&editable&&canWrite&&<div className="mt-3 space-y-2 border-t pt-3">
            <h5 className="font-bold">Record deposit or claim payment</h5>
            <select className="w-full rounded-lg border p-2" value={eventType} onChange={e=>setEventType(e.target.value)}>
                <option value="deposit_received">Deposit collected</option>{viewerRole==='manager'&&<option value="deposit_refunded">Deposit refunded (Manager authorization)</option>}
                {viewerRole==='manager'&&<option value="deposit_applied">Apply deposit to approved claim (Manager)</option>}
                <option value="claim_paid">Customer paid approved claim</option>
            </select>
            {['claim_paid','deposit_applied'].includes(eventType)&&<select value={claimId} onChange={e=>setClaimId(e.target.value)} className="w-full rounded-lg border p-2">
                <option value="">Select approved claim</option>{v.claims.filter(c=>c.status==='approved').map(c=><option key={c.id} value={c.id}>Claim #{c.id} · {money(c.amount-c.amountPaid-c.depositApplied)} due</option>)}
            </select>}
            <input aria-label="Transaction amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount (₱)" className="w-full rounded-lg border p-2"/>
            <button type="button" disabled={busy} onClick={()=>void record()} className="rounded-lg bg-[#2B174C] px-3 py-2 font-bold text-white disabled:opacity-50">Save transaction</button>
        </div>}
        {!ownerView&&editable&&canWrite&&viewerRole==='manager'&&(sources.missing.length>0||sources.damage.length>0)&&<div className="mt-3 space-y-2 border-t pt-3">
            <h5 className="font-bold">Manager: Approve documented loss/damage charge</h5>
            <p className="text-[#806A8C]">The amount must follow the rental agreement and documented claim. Manager permission is required.</p>
            <select value={sourceType} onChange={e=>{setSourceType(e.target.value);setSourceId('');}} className="w-full rounded-lg border p-2"><option value="missing">Missing equipment</option><option value="damage">Damaged equipment</option></select>
            <select value={sourceId} onChange={e=>setSourceId(e.target.value)} className="w-full rounded-lg border p-2"><option value="">Choose documented report</option>
                {sources[sourceType as 'missing'|'damage'].map(c=><option key={c.id} value={c.id}>#{c.id} · {c.quantity} units · {c.reason.slice(0,70)}</option>)}
            </select>
            <input type="number" min="0.01" step="0.01" value={claimAmount} onChange={e=>setClaimAmount(e.target.value)} placeholder="Approved charge (₱)" className="w-full rounded-lg border p-2"/>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason and basis under the rental agreement (min 10 characters)" className="w-full rounded-lg border p-2" rows={2}/>
            <button type="button" disabled={busy||!sourceId} onClick={()=>void approveClaim()} className="rounded-lg bg-[#2B174C] px-3 py-2 font-bold text-white disabled:opacity-50">Approve claim</button>
        </div>}
        {error&&<p role="alert" className="mt-2 text-red-600">{error}</p>}
    </section>;
}