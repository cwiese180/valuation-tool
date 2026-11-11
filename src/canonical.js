"use strict";
/**
 * Pure, dependency-free canonical normalisation functions.
 * Synthetic-safe core. These do not connect to production systems.
 */
function requireString(v,name){if(typeof v!=="string"||!v.trim())throw new Error(name+" is required");return v.trim()}
function optionalNumber(v,name){if(v===null||v===undefined||v==="")return null;const n=Number(v);if(!Number.isFinite(n))throw new Error(name+" must be numeric");return n}
function sourceEnvelope({system,id,type,payload,version="1",effectiveAt=null}){
  if(!["sharepoint","cirrus8","salesforce","external"].includes(system))throw new Error("Unsupported source");
  requireString(id,"source ID");requireString(type,"record type");
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("payload must be an object");
  return {sourceSystem:system,sourceRecordId:id,recordType:type,payloadVersion:version,effectiveAt,payload};
}
function normaliseAddress(address){
  return requireString(address,"address").toUpperCase().replace(/[.,]/g," ").replace(/\bSTREET\b/g,"ST").replace(/\bROAD\b/g,"RD").replace(/\bTERRACE\b/g,"TCE").replace(/\s+/g," ").trim();
}
function matchProperty(candidate,properties){
  if(!Array.isArray(properties))throw new Error("properties must be array");
  const sourceMatch=properties.find(p=>Array.isArray(p.sourceIds)&&p.sourceIds.some(s=>s.system===candidate.sourceSystem&&s.id===candidate.sourceRecordId));
  if(sourceMatch)return {decision:"match",propertyId:sourceMatch.id,method:"verified-source-id"};
  const title=String(candidate.titleReference||"").trim().toUpperCase();
  const titleCandidates=title?properties.filter(p=>String(p.titleReference||"").trim().toUpperCase()===title):[];
  // Even title matches can refer to multiple property scopes: review, do not auto-merge.
  if(titleCandidates.length)return {decision:"review",candidates:titleCandidates.map(p=>p.id),method:"title-reference"};
  const addr=candidate.address?normaliseAddress(candidate.address):null;
  const candidates=addr?properties.filter(p=>p.address&&normaliseAddress(p.address)===addr):[];
  return {decision:"review",candidates:candidates.map(p=>p.id),method:candidates.length?"address-candidate":"unmatched"};
}
function classifyTransaction(kind,status){
  const s=String(status||"").trim().toLowerCase();
  if(kind==="sale")return ["settled","completed settlement"].includes(s)?"settled":["exchanged","contracted"].includes(s)?"contracted":"indicative";
  if(kind==="lease")return ["executed","signed lease"].includes(s)?"executed":"indicative";
  throw new Error("Unknown transaction kind");
}
function validateEvidence(e){
  const issues=[];
  if(!e.sourceSystem||!e.sourceRecordId)issues.push("missing source identity");
  if(!e.measure||!e.unit||!e.basis)issues.push("missing measure, unit or basis");
  if(e.value===null||e.value===undefined||!Number.isFinite(Number(e.value)))issues.push("invalid numeric value");
  if(e.documentId&&!Number.isInteger(e.page))issues.push("document evidence requires source page");
  return {valid:issues.length===0,issues};
}
if(typeof module!=="undefined")module.exports={sourceEnvelope,normaliseAddress,matchProperty,classifyTransaction,validateEvidence,optionalNumber};
