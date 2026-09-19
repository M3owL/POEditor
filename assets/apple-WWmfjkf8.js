import{c as m,n as d}from"./index-Blbd2aF0.js";const g={n:`
`,t:"	",r:"\r",'"':'"',"'":"'","\\":"\\",0:"\0"};function u(o){let n="";for(let r=0;r<o.length;r+=1){const s=o[r];if(s!=="\\"){n+=s;continue}const e=o[r+1];if(e===void 0)break;if(e==="u"||e==="U"){const c=o.slice(r+2,r+6);if(/^[0-9A-Fa-f]{4}$/.test(c)){n+=String.fromCharCode(parseInt(c,16)),r+=5;continue}}n+=Object.prototype.hasOwnProperty.call(g,e)?g[e]:e,r+=1}return n}function h(o){return String(o??"").replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\t/g,"\\t").replace(/\r/g,"\\r")}function x(o){const n=String(o??""),r=[];let s=[],e=0;const c=()=>{e+=1;let i="";for(;e<n.length;){const t=n[e];if(t==="\\"){i+=t+(n[e+1]??""),e+=2;continue}if(t==='"')return e+=1,u(i);i+=t,e+=1}return u(i)};for(;e<n.length;){const i=n[e];if(i==="/"&&n[e+1]==="*"){const t=n.indexOf("*/",e+2),l=n.slice(e+2,t===-1?n.length:t);for(const a of l.split(`
`)){const p=a.replace(/^\s*\*?\s?/,"").trimEnd();p.trim()!==""&&s.push(p)}e=t===-1?n.length:t+2;continue}if(i==="/"&&n[e+1]==="/"){const t=n.indexOf(`
`,e),l=n.slice(e+2,t===-1?n.length:t).trim();l&&s.push(l),e=t===-1?n.length:t+1;continue}if(i==='"'){const t=c();for(;e<n.length&&/\s/.test(n[e]);)e+=1;for(n[e]==="="&&(e+=1);e<n.length&&/\s/.test(n[e]);)e+=1;const l=n[e]==='"'?c():"";for(;e<n.length&&n[e]!==";"&&n[e]!==`
`;)e+=1;n[e]===";"&&(e+=1);const a=n.indexOf(`
`,e),f=n.slice(e,a===-1?n.length:a).match(/\/\*\s*(.*?)\s*\*\//);f&&s.push(f[1]),r.push({key:t,value:l,comment:s.join(`
`)}),s=[];continue}e+=1}return r}function y(o){const n=String(o.text??"");return{entries:x(n).map((e,c)=>m({id:d(),key:e.key,source:e.value,comment:e.comment,origin:{stringsIndex:c}})),meta:{format:"apple",originalText:n,hasHeaderComment:/^\s*\/\*/.test(n)}}}function S(o,n={},r={}){const s=[],c=String(n.originalText??"").match(/^\s*(\/\*[\s\S]*?\*\/)/);c&&s.push(`${c[1]}

`);for(const i of o){i.comment&&(s.push("/* "),s.push(i.comment.replace(/\*\//g,"*\\/").split(`
`).join(`
   `)),s.push(` */
`));const t=i.target.trim()!==""?i.target:i.source;s.push(`"${h(i.key)}" = "${h(t)}";

`)}return{text:s.join(""),mime:"text/plain",extension:"strings"}}const w={id:"apple",label:"Apple .strings",extensions:["strings"],binary:!1,capabilities:{plurals:!1,notes:!0,references:!1,approved:!1},parse:y,serialize:S};export{w as appleFormat,y as parseApple,x as parseStringsFile,S as serializeApple};
