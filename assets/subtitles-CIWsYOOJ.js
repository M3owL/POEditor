import{c as v,n as x}from"./index-iFV9NKz4.js";const g=/^\s*(.+?)\s*-->\s*(.+?)\s*$/;function T(i){const s=String(i??"").replace(/\r\n?/g,`
`).replace(/^\ufeff/,""),t=[];let e=[];for(const o of s.split(`
`)){if(o.trim()===""){e.length&&t.push(e),e=[];continue}e.push(o)}return e.length&&t.push(e),t}function b(i,s={}){var l;const t=String(i.text??""),e=/^\s*WEBVTT/.test(t)||s.kind==="vtt",o=[],r=[];let n=0;for(const c of T(t)){let a=0;if(/^\s*WEBVTT/.test(c[0])||/^\s*NOTE\b/.test(c[0]))continue;let u=null;g.test(c[0])||(u=c[0],a=1);const f=(l=c[a])==null?void 0:l.match(g);if(!f){r.push(c.join(" ").slice(0,80));continue}const p=f[1],d=f[2],k=c.slice(a+1);n+=1,o.push(v({id:x(),key:u??String(n),source:k.join(`
`),origin:{start:p,end:d,cue:n,identifier:u,kind:e?"vtt":"srt"}}))}return{entries:o,meta:{format:"subtitles",kind:e?"vtt":"srt",cueCount:o.length,malformedBlocks:r.length}}}function h(i,s){if(!s||s<=0)return String(i??"").split(`
`);const t=[];for(const e of String(i??"").split(`
`)){const o=e.split(/\s+/).filter(Boolean);if(o.length===0){t.push("");continue}let r="";for(const n of o)r===""?r=n:(r+" "+n).length<=s?r+=` ${n}`:(t.push(r),r=n);t.push(r)}return t}function m(i,s={},t={}){const e=t.kind??s.kind??"srt",o=t.bilingual===!0,r=t.wrapWidth??0,n=[];return e==="vtt"&&n.push(`WEBVTT

`),i.forEach((l,c)=>{const{start:a,end:u,cue:f,identifier:p}=l.origin??{};e==="vtt"&&p?n.push(`${p}
`):e==="srt"&&n.push(`${c+1}
`),n.push(`${a??"00:00:00,000"} --> ${u??"00:00:02,000"}
`);const d=l.target.trim()!==""?l.target:l.source;if(o&&l.target.trim()!==""&&l.source.trim()!==""){n.push(`${h(d,r).join(`
`)}
`),n.push(`${h(l.source,r).join(`
`)}

`);return}n.push(`${h(d,r).join(`
`)}

`)}),{text:n.join(""),mime:e==="vtt"?"text/vtt":"application/x-subrip",extension:e}}const S={id:"srt",label:"SubRip subtitles",extensions:["srt"],binary:!1,capabilities:{plurals:!1,notes:!1,references:!1,approved:!1},parse:(i,s)=>b(i,{...s,kind:"srt"}),serialize:(i,s,t)=>m(i,s,{...t,kind:"srt"})},E={id:"vtt",label:"WebVTT subtitles",extensions:["vtt"],binary:!1,capabilities:{plurals:!1,notes:!1,references:!1,approved:!1},parse:(i,s)=>b(i,{...s,kind:"vtt"}),serialize:(i,s,t)=>m(i,s,{...t,kind:"vtt"})};export{b as parseSubtitles,m as serializeSubtitles,S as srtFormat,E as vttFormat};
