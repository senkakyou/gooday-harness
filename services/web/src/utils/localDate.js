// 本地时区（对本站即中国 UTC+8）日期 YYYY-MM-DD。
// 不要用 new Date().toISOString().slice(0,10)——那取的是 UTC 日期，
// 中国时间晚 8 点后到午夜会比本地早一天，导致日期条/「今天」判断差一天。
export const ymd = (d = new Date()) => {
  const x = d instanceof Date ? d : new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}
