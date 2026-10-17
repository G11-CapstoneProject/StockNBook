"use client";
import {useState,useEffect} from "react";
type Policy={deliveryFee:number;setupFee:number;refundableDeposit:number;deliveryIncludedPackage:boolean;setupIncludedPackage:boolean};
const defaultPolicy:Policy={deliveryFee:0,setupFee:0,refundableDeposit:0,deliveryIncludedPackage:false,setupIncludedPackage:false};
export default function BookingFeePolicySettings({branches}:{branches:{id:number;name:string}[]}){
    const [allBranches,setAllBranches]=useState(branches);
    const [branch,setBranch]=useState(0);const [policy,setPolicy]=useState<Policy>(defaultPolicy);
    useEffect(()=>{let cancelled=false;void (async()=>{try{
        const r=await fetch('/api/branches',{headers:{Authorization:`Bearer ${sessionStorage.getItem('token')}`}});
        const d=await r.json();const rows=Array.isArray(d)?d:Array.isArray(d.branches)?d.branches:[];
        if(!cancelled&&rows.length)setAllBranches(rows.map((x:{id:number;branch_id?:number;branch_name?:string;branchName?:string})=>({id:Number(x.id||x.branch_id),name:x.branch_name||x.branchName||'Branch'})));
    }catch{if(!cancelled)setAllBranches(branches);}})();return()=>{cancelled=true;};},[branches]);
    const [message,setMessage]=useState('');const [saving,setSaving]=useState(false);const [show,setShow]=useState(false);
    useEffect(()=>{if(allBranches.length&&!allBranches.some(b=>b.id===branch))setBranch(allBranches[0].id);},[allBranches,branch]);
    useEffect(()=>{
        if(!branch)return;let cancelled=false;
        void (async()=>{try{
            const token=sessionStorage.getItem('token'),r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
                body:JSON.stringify({action:'get_booking_fee_policy',branchId:branch})});
            const d=await r.json();if(!cancelled){if(r.ok)setPolicy(d.policy||defaultPolicy);else setMessage(d.error||'Could not read policy.');}
        }catch{if(!cancelled)setMessage('Could not load branch policy.');}})();return()=>{cancelled=true;};
    },[branch]);
    async function save(){setSaving(true);setMessage('');try{
        const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${sessionStorage.getItem('token')}`},
            body:JSON.stringify({action:'set_booking_fee_policy',branchId:branch,...policy})});
        const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save.');setPolicy(d.policy);setMessage('Saved for future bookings. Existing quotations remain unchanged.');
    }catch(e){setMessage(e instanceof Error?e.message:'Could not save.');}finally{setSaving(false);}}
    if(!allBranches.length)return null;
    return <section className="my-4 rounded-2xl border border-[#E6DDF0] bg-white p-4 text-sm text-[#2B174C]">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Customer Booking Fees & Deposits</h3><p className="mt-1 text-xs text-[#806A8C]">Owner-configured, per branch. Deposits are refundable balances, not rental income.</p></div><button type="button" onClick={()=>setShow(s=>!s)} className="rounded-xl border border-[#E6DDF0] px-3 py-2">{show?'Close':'Configure fees'}</button></div>
        {show&&<div className="mt-3 space-y-3 border-t pt-3"><label className="block">Branch<select value={branch} onChange={e=>setBranch(Number(e.target.value))} className="mt-1 w-full rounded-lg border p-2">{allBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{([
                ['deliveryFee','Delivery/pickup fee'],['setupFee','Setup/dismantling fee'],['refundableDeposit','Refundable security deposit']
            ] as const).map(([key,label])=><label key={key} className="block">{label} (₱)<input type="number" min={0} step="0.01" value={policy[key]} onChange={e=>setPolicy(p=>({...p,[key]:Number(e.target.value)}))} className="mt-1 w-full rounded-lg border p-2"/></label>)}</div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={policy.deliveryIncludedPackage} onChange={e=>setPolicy(p=>({...p,deliveryIncludedPackage:e.target.checked}))}/> Delivery already included in package pricing</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={policy.setupIncludedPackage} onChange={e=>setPolicy(p=>({...p,setupIncludedPackage:e.target.checked}))}/> Setup already included in package pricing</label>
            <button type="button" disabled={saving||!branch} onClick={()=>void save()} className="rounded-xl bg-[#2B174C] px-4 py-2 font-bold text-white disabled:opacity-50">{saving?'Saving…':'Save fee policy'}</button>
        </div>}{message&&<p className="mt-2 text-xs" role="status">{message}</p>}</section>;
}