import{c as D,n as I}from"./index-iFV9NKz4.js";import{p as E,w as $,a as c,f as A,r as L,e as M,d as W,b as k,n as O,c as z}from"./xml-nfWwjqid.js";function _(n){return c(n,"xml:lang")||c(n,"lang")||""}function X(n,e){if(!n||!e)return!1;const r=m=>String(m).toLowerCase().replace(/_/g,"-"),a=r(n),t=r(e);return a===t||a.startsWith(`${t}-`)||t.startsWith(`${a}-`)}function C(n){const e=M(n,"seg");return e?O(z(e)):""}function j(n){const e=[];for(const r of A(n,"prop")){const a=c(r,"type")??"",t=O(z(r)).trim();t&&e.push(a?`${a}: ${t}`:t)}return e}function B(n,e={}){const r=String(n.text??""),a=E(r);let t=null;$(a,({node:x,tag:o})=>{o==="header"&&!t&&(t=x)});const m=e.sourceLanguage||c(t,"srclang")||"en",s=e.targetLanguage||"",h=[],v=new Set;let T=0,b=0;return $(a,({node:x,tag:o})=>{if(o!=="tu")return;const f=A(x,"tuv"),i=f.find(l=>X(_(l),m)),g=s?f.find(l=>X(_(l),s)):null;if(f.forEach(l=>{const w=_(l);w&&v.add(w)}),!i){T+=1;return}g||(b+=1);const d=c(x,"tuid")||c(x,"id")||"";h.push(D({id:I(),key:d||`tu${h.length+1}`,source:C(i),target:g?C(g):"",comment:j(x).join(`
`),origin:{tmxTuid:d,targetLanguage:s,hadTarget:!!g}}))}),{entries:h,meta:{format:"tmx",version:c(t,"version")||"1.4",sourceLanguage:m,targetLanguage:s,languages:[...v],originalXml:r,missingSource:T,missingTarget:b}}}function F(n,e={},r={}){const a=r.sourceLanguage??e.sourceLanguage??"en",t=r.targetLanguage??e.targetLanguage??"",m=String(e.originalXml??"");let s=null;try{s=E(m)}catch{s=null}if(Array.isArray(s)&&s.length>0){const o=[];$(s,({node:i,tag:g})=>{g==="tu"&&o.push(i)});const f=[...n];return o.forEach(i=>{const g=c(i,"tuid")||c(i,"id")||"",d=f.findIndex(u=>{var p;return((p=u.origin)==null?void 0:p.tmxTuid)&&u.origin.tmxTuid===g});if(d===-1)return;const[l]=f.splice(d,1);let y=A(i,"tuv").find(u=>X(_(u),t));if(!y&&t){const u={tuv:[{"#text":`
        `},{seg:L(l.target)},{"#text":`
      `}],":@":{"@_xml:lang":t}},p=i.tu;Array.isArray(p)&&p.push(u),y=u}if(!y)return;const S=M(y,"seg");if(S){const u=W(S);S[u]=L(l.target)}}),{text:k(s),mime:"application/xml",extension:"tmx"}}const v=n.map(o=>({tu:[{"#text":`
      `},{tuv:[{"#text":`
        `},{seg:L(o.source)},{"#text":`
      `}],":@":{"@_xml:lang":a}},{"#text":`
      `},{tuv:[{"#text":`
        `},{seg:L(o.target)},{"#text":`
      `}],":@":{"@_xml:lang":t}},{"#text":`
    `}],":@":{"@_tuid":o.key}})),T={body:[{"#text":`
    `},...v,{"#text":`
  `}]};return{text:`${k([{"?xml":[{"#text":""}],":@":{"@_version":"1.0"}},{tmx:[{"#text":`
  `},{header:[],":@":{"@_creationtool":"M3owL","@_creationtoolversion":"2.0","@_datatype":"plaintext","@_segtype":"sentence","@_adminlang":a,"@_srclang":a,"@_o-tmf":"M3owL"}},{"#text":`
  `},T,{"#text":`
`}],":@":{"@_version":"1.4"}}])}
`,mime:"application/xml",extension:"tmx"}}const q={id:"tmx",label:"TMX translation memory",extensions:["tmx"],binary:!1,capabilities:{plurals:!1,notes:!0,references:!1,approved:!1},parse:B,serialize:F};export{B as parseTmx,F as serializeTmx,q as tmxFormat};
