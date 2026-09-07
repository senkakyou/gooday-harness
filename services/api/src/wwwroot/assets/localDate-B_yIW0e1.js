const o=(t=new Date)=>{const e=t instanceof Date?t:new Date(t),n=a=>String(a).padStart(2,"0");return`${e.getFullYear()}-${n(e.getMonth()+1)}-${n(e.getDate())}`};export{o as y};
