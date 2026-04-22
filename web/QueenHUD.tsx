export function QueenHUD({ cycle, alarm, urgency }: { cycle: number; alarm: number; urgency: number }) {
  return (
    <div className="queen-hud">
      <div className="queen-hud-title">Queen</div>
      <div className="queen-hud-row">Cycle {cycle}</div>
      <div className="queen-hud-row">
        <span>Alarm</span>
        <div
          className="queen-bar"
          style={{
            width: `${(alarm / 255) * 100}%`,
            background: alarm > 128 ? '#ef4444' : '#22c55e',
          }}
        />
      </div>
      <div className="queen-hud-row">
        <span>Urgency</span>
        <div
          className="queen-bar"
          style={{
            width: `${(urgency / 255) * 100}%`,
            background: urgency > 128 ? '#f97316' : '#3b82f6',
          }}
        />
      </div>
    </div>
  );
}
