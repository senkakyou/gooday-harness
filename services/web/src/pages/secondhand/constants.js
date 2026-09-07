// 二手交易共享常量
export const CATEGORIES = ['全部', '数码', '服装', '书籍', '家具', '运动', '美妆', '其他']
export const CATEGORY_ICONS = { '全部': '🛍', '数码': '📱', '服装': '👕', '书籍': '📚', '家具': '🛋', '运动': '🏀', '美妆': '💄', '其他': '📦' }
export const CONDITIONS = ['全新', '几乎全新', '轻微使用', '明显使用']
export const conditionColor = { '全新': '#10b981', '几乎全新': '#00d4aa', '轻微使用': '#ffa502', '明显使用': '#ff4757' }
export const SORTS = [{ key: 'new', label: '最新' }, { key: 'priceAsc', label: '价格 ↑' }, { key: 'priceDesc', label: '价格 ↓' }]

// 折扣计算：原价存在且高于现价时返回 "X.X折"，否则返回 null
export function discountLabel(price, originalPrice) {
  if (!originalPrice || originalPrice <= price || price <= 0) return null
  const d = (price / originalPrice * 10).toFixed(1)
  return `${d}折`
}
