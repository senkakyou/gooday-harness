// props: table, mySeat, onSit, onStand, disabled
export default function TableCard({ table, mySeat, onSit, onStand, disabled }) {
  const busy    = table.state === 'playing'
  const myTable = mySeat?.tableId === table.id
  const seats   = [
    { idx: 0, label: '黑方', color: '#bbb', bg: '#1a1a1a', occ: table.seat0 },
    { idx: 1, label: '白方', color: '#aaa', bg: '#252525', occ: table.seat1 },
  ]
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${myTable ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: myTable ? '0 0 0 1px var(--accent)' : 'none', minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.4rem 0.75rem', background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>桌 {table.id}</span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 3,
          background: busy ? '#2a1a1a' : '#1a2a1a', color: busy ? '#f88' : '#8f8', fontFamily: 'var(--mono)',
        }}>{busy ? '对弈中' : '等待中'}</span>
      </div>
      <div style={{ flex: 1, padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {seats.map(s => {
          const isMine  = myTable && mySeat?.seatIndex === s.idx
          const canSit  = !disabled && !busy && !s.occ && !myTable
          return (
            <div key={s.idx} onClick={() => canSit && onSit(table.id, s.idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.35rem 0.5rem', borderRadius: 6,
                background: isMine ? s.bg : s.occ ? 'var(--surface2)' : 'transparent',
                border: `1px solid ${isMine ? s.color+'55' : 'var(--border)'}`,
                cursor: canSit ? 'pointer' : 'default', minHeight: 34,
              }}
              onMouseEnter={e => { if (canSit) e.currentTarget.style.background = s.bg }}
              onMouseLeave={e => { if (canSit && !isMine) e.currentTarget.style.background = s.occ ? 'var(--surface2)' : 'transparent' }}
            >
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: s.idx===0?'#222':'#ddd', border:'1px solid #888', flexShrink:0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{s.label}</div>
                <div style={{ fontSize: 12, fontWeight: s.occ?600:400, color: s.occ?'var(--text)':'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {s.occ ? s.occ.username : canSit ? '点击入座' : '空位'}
                </div>
              </div>
              {isMine && (
                <button className="btn btn-ghost btn-sm" style={{ fontSize:10, padding:'2px 6px', flexShrink:0 }}
                  onClick={e => { e.stopPropagation(); onStand() }}>离座</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
