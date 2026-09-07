import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminGetTeacherStudentDetail } from '../../api/courses'
import { StudentStatementModal } from '../teacher/Statements'
import useToastStore from '../../store/toastStore'

const yuan = (n) => '￥' + Number(n || 0).toFixed(2)

export default function AdminTeacherStudentDetail() {
  const { id, sid } = useParams()
  const navigate = useNavigate()
  const toast = useToastStore(s => s.toast)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showStatement, setShowStatement] = useState(false)

  useEffect(() => {
    adminGetTeacherStudentDetail(id, sid)
      .then(r => setData(r.data))
      .catch(() => { toast('加载失败', true); setData(null) })
      .finally(() => setLoading(false))
  }, [id, sid])

  if (loading) return <div style={{ color: 'var(--muted)', padding: '3rem', textAlign: 'center' }}>加载中…</div>
  if (!data) return <div style={{ color: 'var(--muted)', padding: '3rem', textAlign: 'center' }}>未找到该学生</div>

  const totalDue = data.totalDue, totalPaid = data.totalPaid, balance = data.balance
  const owe = balance < 0, settled = balance === 0
  const balColor = settled ? '#6b7280' : owe ? '#ef4444' : '#10b981'
  const balBg = settled ? 'rgba(107,114,128,0.1)' : owe ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'
  const balText = settled ? '已结清' : owe ? `欠费 ${yuan(-balance)}` : `预存 ${yuan(balance)}`

  return (
    <div>
      {/* 返回 */}
      <button onClick={() => navigate(`/admin/teachers/${id}`)}
        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 4 }}>
        ‹ 返回教师详情
      </button>

      {/* 学生信息头 */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.25rem', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          {data.avatarUrl
            ? <img src={data.avatarUrl} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            : <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{data.studentUserId ? '👤' : '🧑'}</div>
          }
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{data.displayName}</span>
              {data.username && <span style={{ fontSize: 12, color: 'var(--muted)' }}>@{data.username}</span>}
              {!data.studentUserId && <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', padding: '1px 6px', borderRadius: 6 }}>线下</span>}
              {data.isArchived && <span style={{ fontSize: 11, color: '#6b7280', background: 'rgba(107,114,128,0.12)', padding: '1px 6px', borderRadius: 6 }}>已归档</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {data.phone && <span>📞 {data.phone}</span>}
              {data.defaultFee != null && <span>常用课时费：{yuan(data.defaultFee)}/节</span>}
              {data.note && <span>备注：{data.note}</span>}
            </div>
          </div>
          <button onClick={() => setShowStatement(true)}
            style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
            导出对账单
          </button>
        </div>

        {/* 余额汇总 */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, padding: '12px 14px', background: 'var(--bg)', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>累计应收</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)' }}>{yuan(totalDue)}</div>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', background: 'var(--bg)', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>累计已收</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981', fontFamily: 'var(--mono)' }}>{yuan(totalPaid)}</div>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', background: balBg, borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>当前余额</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: balColor, fontFamily: 'var(--mono)' }}>{balText}</div>
          </div>
        </div>
      </div>

      {/* 课时记录 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>课时记录 <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>共 {data.lessons.length} 节</span></div>
        {data.lessons.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '1rem 0', textAlign: 'center' }}>暂无课时记录</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.lessons.map(l => (
              <div key={l.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{l.lessonDate}</div>
                  {l.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{l.note}</div>}
                </div>
                {l.durationMinutes && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{l.durationMinutes} 分钟</span>
                )}
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{yuan(l.fee)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 缴费记录 */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>缴费记录 <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>共 {data.payments.length} 笔</span></div>
        {data.payments.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '1rem 0', textAlign: 'center' }}>暂无缴费记录</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.payments.map(p => (
              <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.paidDate}</div>
                  {p.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{p.note}</div>}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#10b981', fontFamily: 'var(--mono)' }}>{yuan(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 对账单导出 */}
      {showStatement && (
        <StudentStatementModal
          student={{ displayName: data.displayName, phone: data.phone }}
          lessons={data.lessons}
          payments={data.payments}
          totalDue={totalDue}
          totalPaid={totalPaid}
          teacherName="（管理员查看）"
          onClose={() => setShowStatement(false)}
        />
      )}
    </div>
  )
}
