import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import AuthModal from '../../components/AuthModal'
import { listSubjects } from '../../api/courses'
import { subjectColor, withAlpha } from '../../utils/subjectTheme'
import SubjectIcon from '../../components/SubjectIcon'

export default function CoursesHome() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const [authModal, setAuthModal] = useState(null)
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    listSubjects().then(r => setSubjects(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = subjects.filter(s => s.name.includes(search) || s.iconEmoji.includes(search))

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 5rem' }}>

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #1e0d4e 0%, #0f1c46 60%, #080a18 100%)',
        border: '1px solid rgba(124,108,255,0.25)', borderRadius: 20,
        padding: '1.5rem', marginBottom: '1.25rem', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '40%', opacity: 0.06,
          background: 'radial-gradient(circle at 80% 50%, #7c6cff 0%, transparent 70%)', pointerEvents: 'none' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 6, color: '#fff' }}>找老师，约课程</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 1rem' }}>一对一 / 小班辅导，按需预约，灵活上课</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => user ? navigate('/courses/my-bookings') : setAuthModal('login')}
            style={{ flex: 1, padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--accent)',
              color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            📅 我的预约
          </button>
          <button
            onClick={() => user ? navigate('/teacher/dashboard') : setAuthModal('login')}
            style={{ flex: 1, padding: '13px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)',
              fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            🎓 教师入口
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--muted)', pointerEvents: 'none' }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索学科名称…"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text)', padding: '12px 12px 12px 44px', borderRadius: 12, fontSize: 16,
            outline: 'none', fontFamily: 'var(--sans)' }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
      </div>

      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>📚 全部学科</span>
        {!loading && <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{filtered.length} 门</span>}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[1,2,3,4,5,6].map(i => (
            <div key={i} style={{ height: 100, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '4rem 0', fontSize: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
          {search ? `没有找到"${search}"相关学科` : '暂无学科，管理员请在后台添加'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 12 }}>
          {filtered.map(s => {
            const c = subjectColor(s)
            return (
            <button key={s.id}
              onClick={() => navigate(`/courses/subject/${s.id}`, { state: { name: s.name, emoji: s.iconEmoji } })}
              style={{ position: 'relative', overflow: 'hidden', borderRadius: 16, cursor: 'pointer',
                padding: '1.1rem 0.5rem 0.95rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                border: `1px solid ${withAlpha(c, 0.35)}`,
                background: `linear-gradient(155deg, ${withAlpha(c, 0.20)} 0%, var(--surface) 62%)`,
                boxShadow: `0 4px 18px ${withAlpha(c, 0.10)}`,
                transition: 'box-shadow .18s, border-color .18s, transform .18s' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 28px ${withAlpha(c, 0.35)}`; e.currentTarget.style.borderColor = withAlpha(c, 0.7); e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 4px 18px ${withAlpha(c, 0.10)}`; e.currentTarget.style.borderColor = withAlpha(c, 0.35); e.currentTarget.style.transform = 'none' }}
            >
              {/* 图标瓦片：emoji + 主色发光 */}
              <div style={{ width: 58, height: 58, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `radial-gradient(circle at 50% 38%, ${withAlpha(c, 0.42)}, ${withAlpha(c, 0.10)} 70%)`,
                boxShadow: `inset 0 0 0 1px ${withAlpha(c, 0.35)}, 0 0 18px ${withAlpha(c, 0.40)}` }}>
                <SubjectIcon emoji={s.iconEmoji} color={c} size={34} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', textAlign: 'center', lineHeight: 1.3 }}>{s.name}</span>
              {/* 专属主色装饰条 */}
              <span style={{ width: 34, height: 4, borderRadius: 4, background: c, boxShadow: `0 0 8px ${withAlpha(c, 0.7)}` }} />
            </button>
          )})}
        </div>
      )}

      {authModal && <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} />}
    </div>
  )
}
