import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import useToastStore from '../../store/toastStore'
import { teacherProfile, teacherApply, listSubjects, teacherBookings, updateTeacherProfile } from '../../api/courses'

const STATUS_MAP = {
  pending:  { label: '审核中',     color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: '⏳' },
  approved: { label: '已通过',     color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: '✅' },
  rejected: { label: '已拒绝',     color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: '❌' },
  revoked:  { label: '资格已撤销', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: '🚫' },
}

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const toast = useToastStore(s => s.toast)

  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [subjects, setSubjects] = useState([])
  const [pendingBookings, setPendingBookings] = useState([])

  // 申请表单
  const [showApply, setShowApply] = useState(false)
  const [isReapply, setIsReapply] = useState(false)
  const [bio, setBio] = useState('')
  const [selectedSubs, setSelectedSubs] = useState([])
  const [submitting, setSubmitting] = useState(false)

  // 编辑简介
  const [editingBio, setEditingBio] = useState(false)
  const [editBioValue, setEditBioValue] = useState('')
  const [savingBio, setSavingBio] = useState(false)

  const loadProfile = () =>
    teacherProfile().then(r => {
      setProfile(r.data)
      if (r.data?.status === 'approved') {
        teacherBookings('pending').then(rb => setPendingBookings(rb.data)).catch(() => {})
      }
    }).catch(e => {
      if (e.response?.status === 404) setProfile(null)
    })

  useEffect(() => {
    if (!user) { navigate('/'); return }
    Promise.all([loadProfile(), listSubjects().then(r => setSubjects(r.data)).catch(() => {})])
      .finally(() => setLoading(false))
  }, [user])

  const openApply = (reapply = false) => {
    setIsReapply(reapply)
    if (reapply && profile) {
      setBio(profile.bio || '')
      setSelectedSubs(profile.subjects?.map(s => s.id) || [])
    } else {
      setBio('')
      setSelectedSubs([])
    }
    setShowApply(true)
  }

  const doApply = async () => {
    if (!bio.trim()) { toast('请填写个人简介', true); return }
    if (!selectedSubs.length) { toast('请选择至少一个学科', true); return }
    setSubmitting(true)
    try {
      await teacherApply({ bio, subjectIds: selectedSubs })
      setShowApply(false)
      toast(isReapply ? '已重新提交申请，等待管理员审核' : '申请已提交，等待管理员审核')
      setLoading(true)
      await loadProfile()
    } catch (e) { toast(e.response?.data || '提交失败', true) }
    finally { setSubmitting(false); setLoading(false) }
  }

  const toggleSub = (id) => setSelectedSubs(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const openEditBio = () => {
    setEditBioValue(profile?.bio || '')
    setEditingBio(true)
  }

  const saveEditBio = async () => {
    if (!editBioValue.trim()) { toast('简介不能为空', true); return }
    setSavingBio(true)
    try {
      await updateTeacherProfile({ bio: editBioValue })
      setEditingBio(false)
      toast('简介已更新')
      await loadProfile()
    } catch (e) { toast(e.response?.data || '保存失败', true) }
    finally { setSavingBio(false) }
  }

  if (loading) return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/courses')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, padding: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>教师中心</span>
        </button>
      </div>
      <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--text)' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>加载中…
      </div>
    </div>
  )

  const st = profile ? STATUS_MAP[profile.status] : null
  const canReapply = profile?.status === 'rejected' || profile?.status === 'revoked'

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 5rem' }}>
      {/* 顶部导航 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('/courses')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, flex: 1, padding: 0, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 22, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>‹</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>教师中心</span>
        </button>
        {profile?.status === 'approved' && (
          <span style={{ fontSize: 11, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '3px 8px', borderRadius: 8 }}>认证教师</span>
        )}
      </div>

      <div style={{ padding: '1rem' }}>

        {/* ── 未申请 ── */}
        {!profile && !showApply && (
          <div style={{
            background: 'linear-gradient(135deg, #1e0d4e 0%, #0f1c46 60%, #080a18 100%)',
            border: '1px solid rgba(124,108,255,0.25)', borderRadius: 20, padding: '2.5rem 1.5rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎓</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#fff', marginBottom: 10 }}>成为老师，分享你的知识</div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
              提交申请后，管理员审核通过<br/>即可开始排班和接受学生预约
            </div>
            <button onClick={() => openApply(false)}
              style={{ padding: '13px 36px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              申请成为老师
            </button>
          </div>
        )}

        {/* ── 申请 / 重新申请 表单 ── */}
        {showApply && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '1.5rem' }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {isReapply ? '重新申请教师资格' : '教师申请'}
            </div>
            {isReapply && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, padding: '8px 12px', background: 'rgba(124,108,255,0.06)', borderRadius: 8, lineHeight: 1.6 }}>
                请更新你的简介和学科，重新提交后将进入审核队列
              </div>
            )}
            {!isReapply && <div style={{ marginBottom: 20 }} />}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                个人简介 <span style={{ color: '#ef4444' }}>*</span>
              </div>
              <textarea value={bio} onChange={e => setBio(e.target.value)}
                placeholder="介绍你的教学经历、教学方向、擅长的年级…" rows={5}
                style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', padding: '10px 12px', fontSize: 16, resize: 'vertical', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                擅长学科 <span style={{ color: '#ef4444' }}>*</span>
                <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>可多选</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {subjects.map(s => (
                  <button key={s.id} onClick={() => toggleSub(s.id)}
                    style={{ padding: '8px 16px', borderRadius: 20,
                      border: `2px solid ${selectedSubs.includes(s.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: selectedSubs.includes(s.id) ? 'var(--accent-soft)' : 'transparent',
                      color: selectedSubs.includes(s.id) ? 'var(--accent)' : 'var(--text)',
                      cursor: 'pointer', fontSize: 14, fontWeight: selectedSubs.includes(s.id) ? 600 : 400,
                      transition: 'border-color .12s, background .12s' }}>
                    {s.iconEmoji} {s.name}
                  </button>
                ))}
              </div>
              {selectedSubs.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8 }}>
                  已选 {selectedSubs.length} 个学科
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={doApply} disabled={submitting}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                {submitting ? '提交中…' : isReapply ? '重新提交申请' : '提交申请'}
              </button>
              <button onClick={() => setShowApply(false)}
                style={{ padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* ── 已有申请 ── */}
        {profile && !showApply && (
          <>
            {/* 状态卡 */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '1.25rem', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>我的教师资料</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: st?.color, background: st?.bg, padding: '4px 12px', borderRadius: 20 }}>
                  {st?.icon} {st?.label}
                </span>
              </div>
              {editingBio ? (
                <div style={{ marginBottom: 10 }}>
                  <textarea value={editBioValue} onChange={e => setEditBioValue(e.target.value)}
                    rows={5} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--accent)', padding: '10px 12px', fontSize: 16, resize: 'vertical', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={saveEditBio} disabled={savingBio}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                      {savingBio ? '保存中…' : '保存'}
                    </button>
                    <button onClick={() => setEditingBio(false)}
                      style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                  <p style={{ fontSize: 14, color: 'var(--text)', margin: 0, lineHeight: 1.7, flex: 1 }}>{profile.bio || '暂无简介'}</p>
                  {profile.status === 'approved' && (
                    <button onClick={openEditBio}
                      style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
                      编辑简介
                    </button>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {profile.subjects?.map(s => (
                  <span key={s.id} style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '3px 10px', borderRadius: 10 }}>{s.name}</span>
                ))}
              </div>

              {profile.rejectReason && (
                <div style={{ fontSize: 13, color: profile.status === 'revoked' ? '#f59e0b' : '#ef4444', marginTop: 2, padding: '8px 10px', background: profile.status === 'revoked' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
                  {profile.status === 'revoked' ? '⚠️ 撤销原因：' : '拒绝原因：'}{profile.rejectReason}
                </div>
              )}
              {profile.status === 'pending' && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>资料已提交，请耐心等待管理员审核（通常1~2天）</div>
              )}
              {profile.status === 'revoked' && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
                  您的教师资格已被撤销，相关课程和预约均已自动取消。如有疑问请联系管理员。
                </div>
              )}
            </div>

            {/* 被拒绝 / 被撤销：重新申请 */}
            {canReapply && (
              <button onClick={() => openApply(true)}
                style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: '2px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 16, transition: 'background .15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,108,255,0.18)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft)'}
              >
                🔄 重新申请教师资格
              </button>
            )}

            {/* 审核通过：功能入口 + 待处理提示（被撤销后不显示） */}
            {profile.status === 'approved' && (
              <>
                {/* 待处理预约提示 */}
                {pendingBookings.length > 0 && (
                  <button onClick={() => navigate('/teacher/bookings')}
                    style={{ width: '100%', marginBottom: 16, padding: '14px 16px', borderRadius: 16, border: '2px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.08)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 28 }}>🔔</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#f59e0b' }}>有 {pendingBookings.length} 条待处理预约</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>点击查看并处理</div>
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 18, marginLeft: 'auto' }}>›</span>
                  </button>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { icon: '📆', label: '排班管理', desc: '设置可上课时间段，学生可见后方可预约', path: '/teacher/schedule', color: '#6366f1' },
                    { icon: '📋', label: '预约管理', desc: '查看学生预约申请，确认或拒绝', path: '/teacher/bookings', color: '#10b981', badge: pendingBookings.length },
                    { icon: '💰', label: '学生管理 · 课时结算', desc: '管理学生、记录课时与缴费、查看每月统计', path: '/teacher/students', color: '#f59e0b' },
                  ].map(item => (
                    <button key={item.path} onClick={() => navigate(item.path)}
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.125rem 1rem', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, width: '100%', transition: 'border-color .15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(124,108,255,0.5)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: `${item.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                        {item.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{item.label}</span>
                          {item.badge > 0 && (
                            <span style={{ fontSize: 11, background: '#f59e0b', color: '#fff', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{item.badge}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{item.desc}</div>
                      </div>
                      <span style={{ color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>›</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
