const fs = require('fs');
let content = fs.readFileSync('web/App.tsx', 'utf-8');

// Find left panel
const leftStart = content.indexOf('lux-panel lux-panel-left') - 20;
let leftEnd = content.indexOf('</aside>', leftStart);
while (leftEnd !== -1) {
  const after = content.slice(leftEnd + '</aside>'.length, leftEnd + '</aside>'.length + 30);
  if (after.includes('<section')) break;
  leftEnd = content.indexOf('</aside>', leftEnd + 1);
}
leftEnd += '</aside>'.length;

// Find right panel
const rightStart = content.indexOf('lux-panel lux-panel-right') - 20;
let rightEnd = content.indexOf('</aside>', rightStart);
while (rightEnd !== -1) {
  const after = content.slice(rightEnd + '</aside>'.length, rightEnd + '</aside>'.length + 30);
  if (after.includes('</main>')) break;
  rightEnd = content.indexOf('</aside>', rightEnd + 1);
}
rightEnd += '</aside>'.length;

const leftReplacement = `      {selectedEntity && inspectPopupPosition ? (
        <div className="floating-inspector" style={{ left: inspectPopupPosition.left, top: inspectPopupPosition.top }}>
          <div className="floating-inspector-header">
            <span className="floating-inspector-title">{selectedEntity.name ?? 'Unnamed Node'}</span>
            <button className="floating-inspector-close" onClick={() => setSelectedEntity(null)} type="button">
              <X size={14} />
            </button>
          </div>
          <div className="floating-inspector-body">
            <div className="floating-inspector-meta">
              <span>{selectedEntity.type}</span>
              <span>{selectedEntity.descriptor ?? 'No descriptor'}</span>
              <span>Mass {selectedEntity.mass}</span>
              <span>Chiral {computeChiralMass(selectedEntity)}</span>
              <span>{selectedEntity.git_status ?? 'clean'}</span>
              <span>{getNodeStateLabel(selectedEntity.node_state ?? 'stable')}</span>
            </div>
            {selectedEntity.path ? (
              <div className="floating-inspector-actions">
                <button onClick={() => { void dispatchFileAction('read', selectedEntity.path ?? ''); }} type="button">Send Architect</button>
                <button onClick={() => { void dispatchFileAction('repair', selectedEntity.path ?? ''); }} type="button">Repair File</button>
                <button onClick={() => { void dispatchFileAction('explain', selectedEntity.path ?? ''); }} type="button">Explain</button>
              </div>
            ) : null}
            {selectedEntity.content_preview || selectedEntity.content ? (
              <CodeSyntaxPreview code={selectedEntity.content ?? selectedEntity.content_preview ?? ''} />
            ) : (
              <div className="code-frame">
                <div className="code-line">
                  <span className="code-gutter">—</span>
                  <span className="code-content">{selectedEntity.is_binary ? 'Binary asset — hash-only transfer.' : 'No content preview available.'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {commandPaletteOpen ? (
        <>
          <div className="command-palette-backdrop" onClick={() => setCommandPaletteOpen(false)} />
          <div className="command-palette">
            <div className="command-palette-header">
              <span className="command-palette-title">Command Palette</span>
              <button className="floating-inspector-close" onClick={() => setCommandPaletteOpen(false)} type="button">
                <X size={14} />
              </button>
            </div>
            <div className="command-palette-body">
              <div className="command-palette-section">
                <span className="command-palette-label">Repository Path</span>
                <input
                  className="command-palette-input"
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="C:/Users/... or repo URL"
                  type="text"
                  value={repoInput}
                />
              </div>
              <div className="command-palette-section">
                <span className="command-palette-label">Operator Prompt</span>
                <textarea
                  className="command-palette-textarea"
                  onChange={(e) => setDirectiveInput(e.target.value)}
                  placeholder="Enter directive..."
                  value={directiveInput}
                />
              </div>
              <div className="command-palette-actions">
                <button disabled={engineLoading} onClick={() => { void handleToggleEngine(); }} type="button">
                  {engineLoading ? 'Working...' : engineRunning ? 'Stop Engine' : 'Start Engine'}
                </button>
                <button disabled={isSavingControl} onClick={() => { void handleControlSubmit({ preventDefault: () => {} } as FormEvent<HTMLFormElement>); }} type="button">
                  Commit Control
                </button>
                <button onClick={() => setShowPlumbing((prev) => !prev)} type="button">
                  {showPlumbing ? 'Hide Plumbing' : 'Show Plumbing'}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <button className="fab" onClick={() => setCommandPaletteOpen(true)} title="Command Palette ( / )" type="button">
        <Command size={18} />
      </button>

      <div className="kbd-hint">Press <kbd>/</kbd> for commands</div>
`;

const rightReplacement = `      <div className="bottom-status-bar">
        <div className="status-bar-left">
          <span className="status-bar-item">{activeRepositoryName}</span>
          <span className={\`status-bar-item \${engineRunning ? 'is-live' : 'is-error'}\`}>
            {engineRunning ? 'Engine On' : 'Engine Off'}
          </span>
          <span className="status-bar-item">T{worldState.tick}:{worldState.phase}</span>
        </div>
        <div className="status-bar-right">
          <span className="status-bar-item">Queue {worldState.queue_depth ?? 0}</span>
          <span className="status-bar-item">{worldState.weather ?? 'clear'}</span>
          <span className="status-bar-item">{formatControlStatus(controlStatus)}</span>
          <button className="status-bar-action" onClick={() => setCommandPaletteOpen(true)} type="button">
            Open Console
          </button>
        </div>
      </div>

      <div
        className={\`floating-log \${logExpanded ? 'is-expanded' : ''}\`}
        onMouseEnter={() => setLogExpanded(true)}
        onMouseLeave={() => setLogExpanded(false)}
      >
        <div className="floating-log-header">
          <span className="floating-log-title">Cognition Log</span>
          <span className="floating-log-count">{logEntries.length}</span>
        </div>
        <div className="floating-log-body">
          {logEntries.length > 0 ? (
            logEntries.slice(-15).map((entry) => (
              <div className={\`log-entry log-\${entry.kind}\`} key={entry.id}>
                <div className="log-meta">
                  <span>{entry.timestamp}</span>
                  <span>T+{entry.tick}</span>
                </div>
                <div className="log-message">{entry.message}</div>
              </div>
            ))
          ) : (
            <p className="panel-placeholder">Awaiting first tick from the lattice.</p>
          )}
        </div>
      </div>
`;

content = content.slice(0, leftStart) + leftReplacement + content.slice(leftEnd);

// Recalculate right positions after left replacement
const rightStart2 = content.indexOf('lux-panel lux-panel-right') - 20;
let rightEnd2 = content.indexOf('</aside>', rightStart2);
while (rightEnd2 !== -1) {
  const after = content.slice(rightEnd2 + '</aside>'.length, rightEnd2 + '</aside>'.length + 30);
  if (after.includes('</main>')) break;
  rightEnd2 = content.indexOf('</aside>', rightEnd2 + 1);
}
rightEnd2 += '</aside>'.length;

content = content.slice(0, rightStart2) + rightReplacement + content.slice(rightEnd2);

fs.writeFileSync('web/App.tsx', content);
console.log('Done. New length:', content.length);
