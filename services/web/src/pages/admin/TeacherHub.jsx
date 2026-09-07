import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import TeacherApprovals from './TeacherApprovals'
import AdminTeachers from './AdminTeachers'

const TABS = [
  { key: 'approvals', label: '教师审核' },
  { key: 'manage',    label: '教师管理' },
]

export default function TeacherHub() {
  const location = useLocation()
  // 进入 /admin/teachers/:id 时保持「教师管理」tab 激活
  const defaultTab = location.pathname === '/admin/teachers' ? 'approvals' : 'manage'
  const [tab, setTab] = useState(defaultTab)

  return (
    <div>
      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 20px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? 'var(--accent)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'approvals' ? <TeacherApprovals /> : <AdminTeachers />}
    </div>
  )
}
