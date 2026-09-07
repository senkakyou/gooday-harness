import React, { useEffect, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { listTeachers } from '../../api/courses'

export default function SubjectPage() {
  const { subjectId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const subjectName = location.state?.name ?? '该学科'
  const subjectEmoji = location.state?.emoji ?? '📚'
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    listTeachers(subjectId).then(r => setTeachers(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [subjectId])

  const filtered = teachers.filter(t =>
    !search || t.username.includes(search) || (t.bio || '').includes(search)
  )

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航栏 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('/courses')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 26, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{subjectEmoji}</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{subjectName}</span>
        </button>
        {!loading && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{filtered.length} 位老师</span>
        )}
      </div>

      <div style={{ padding: '1rem 1rem 0' }}>
        {/* 搜索框 */}
        <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--muted)', pointerEvents: 'none' }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索老师名称…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '11px 12px 11px 42px', borderRadius: 12, fontSize: 16,
              outline: 'none', fontFamily: 'var(--sans)' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 110, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '4rem 0', fontSize: 14 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
            {search ? `没有找到"${search}"相关老师` : '该学科暂无老师，敬请期待'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(t => (
              <button key={t.id}
                onClick={() => navigate(`/courses/teacher/${t.id}`)}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 16, padding: '1.125rem 1rem', cursor: 'pointer',
                  textAlign: 'left', width: '100%', transition: 'border-color .15s',
                  display: 'flex', gap: 14, alignItems: 'flex-start',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(124,108,255,0.5)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                {/* 头像 */}
                {t.avatarUrl
                  ? <img src={t.avatarUrl} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>👤</div>
                }
                {/* 信息 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{t.username}</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 8px', borderRadius: 10 }}>
                      {t.subjects?.map(s => s.name).join(' · ')}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.55,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {t.bio || '该老师暂未填写简介'}
                  </p>
                </div>
                {/* 箭头 */}
                <span style={{ color: 'var(--muted)', fontSize: 18, alignSelf: 'center', flexShrink: 0 }}>›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
