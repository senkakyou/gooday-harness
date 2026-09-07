// 个人中心共享：状态映射、Badge 徽章、日期格式化
import React from 'react'

export const STATUS_MAP = {
  pending:   { label: '待确认', color: '#f0a500' },
  activated: { label: '已激活', color: '#0c6'    },
  refunded:  { label: '已拒绝', color: '#e55'    },
  talking:   { label: '沟通中', color: '#4af'    },
  done:      { label: '已完成', color: '#0c6'    },
  rejected:  { label: '不接受', color: '#e55'    },
}

export function Badge({ status }) {
  const s = STATUS_MAP[status] || { label: status, color: 'var(--muted)' }
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: s.color + '22', color: s.color, fontWeight: 600 }}>
      {s.label}
    </span>
  )
}

export function fmt(d) {
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(d) ? d : d + 'Z').toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
