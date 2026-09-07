// 相对时间格式化：后端时间为 UTC（无时区后缀），补 'Z' 后再计算
export default function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(/(Z|[+-]\d\d:?\d\d)$/.test(dateStr) ? dateStr : dateStr + 'Z')) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(dateStr) ? dateStr : dateStr + 'Z').toLocaleDateString('zh-CN')
}
