import { useState, type ReactElement } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bolt,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  Factory,
  FileText,
  GitBranch,
  Hammer,
  Landmark,
  MapPin,
  Radio,
  Wrench,
} from 'lucide-react';

import type {
  AdvisorAction,
  AdvisorReport,
  CityCouncilState,
  CitySystemKey,
  CitySystemReport,
} from './city-systems';

interface AdvisorCouncilProps {
  activeTargetPath?: string | null;
  city: CityCouncilState;
  controlMode?: 'live' | 'preview';
  isDispatching?: boolean;
  onAction: (action: AdvisorAction, targetPath: string) => void;
  onFocusTarget: (targetPath: string) => void;
}

function systemIcon(system: CitySystemKey): ReactElement {
  if (system === 'power') {
    return <Bolt size={14} />;
  }

  if (system === 'traffic') {
    return <GitBranch size={14} />;
  }

  return <Factory size={14} />;
}

function advisorIcon(advisor: AdvisorReport): ReactElement {
  if (advisor.id === 'architect') {
    return <Landmark size={15} />;
  }

  if (advisor.id === 'economy') {
    return <Banknote size={15} />;
  }

  return <Hammer size={15} />;
}

function actionIcon(action: AdvisorAction | null): ReactElement {
  if (action === 'repair') {
    return <Wrench size={13} />;
  }

  if (action === 'read') {
    return <FileText size={13} />;
  }

  return <Eye size={13} />;
}

function formatTargetPath(path: string | null): string {
  if (!path) {
    return 'No target';
  }

  if (path.length <= 44) {
    return path;
  }

  return `...${path.slice(-41)}`;
}

function getPrimaryIssue(city: CityCouncilState): AdvisorReport | null {
  return city.advisors[0] ?? null;
}

function renderSystem(
  report: CitySystemReport,
  onFocusTarget: AdvisorCouncilProps['onFocusTarget'],
  activeTargetPath: string | null,
): ReactElement {
  const hasTarget = report.targetPath !== null;
  const isActive = report.targetPath !== null && report.targetPath === activeTargetPath;

  return (
    <div className={`city-system-card tone-${report.tone} ${isActive ? 'is-active-target' : ''}`} key={report.key}>
      <div className="city-system-card-header">
        <span className="city-system-icon">{systemIcon(report.key)}</span>
        <span className="city-system-name">{report.name}</span>
        <span className="city-system-value">{report.value}</span>
      </div>
      <div
        aria-label={`${report.name} health ${report.value}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={report.value}
        className="city-system-meter"
        role="meter"
      >
        <span style={{ width: `${report.value}%` }} />
      </div>
      <div className="city-system-status">{report.status}</div>
      <div className="city-system-detail">{report.detail}</div>
      <button
        aria-label={hasTarget ? `Focus ${report.name} target ${report.targetPath}` : `${report.name} has no target`}
        className="city-system-focus"
        disabled={!hasTarget}
        onClick={() => {
          if (report.targetPath) {
            onFocusTarget(report.targetPath);
          }
        }}
        title={report.targetPath ?? 'No target'}
        type="button"
      >
        <Crosshair size={12} />
        <span>{isActive ? 'Selected' : 'Focus'}</span>
      </button>
    </div>
  );
}

function renderAdvisor(
  advisor: AdvisorReport,
  onAction: AdvisorCouncilProps['onAction'],
  onFocusTarget: AdvisorCouncilProps['onFocusTarget'],
  activeTargetPath: string | null,
  isDispatching: boolean,
): ReactElement {
  const canAct = advisor.action !== null && advisor.targetPath !== null;
  const isActive = advisor.targetPath !== null && advisor.targetPath === activeTargetPath;

  return (
    <article className={`advisor-card mood-${advisor.mood} ${isActive ? 'is-active-target' : ''}`} key={advisor.id}>
      <div className="advisor-card-header">
        <span className="advisor-portrait">{advisorIcon(advisor)}</span>
        <span className="advisor-heading">
          <span className="advisor-title">{advisor.title}</span>
          <span className="advisor-office">{advisor.office}</span>
        </span>
        <span className="advisor-mood">{advisor.mood}</span>
      </div>
      <div className="advisor-headline">{advisor.headline}</div>
      <p className="advisor-counsel">{advisor.counsel}</p>
      <div className="advisor-target-row">
        <span className="advisor-target-label">Target</span>
        <button
          className="advisor-target"
          disabled={!advisor.targetPath}
          onClick={() => {
            if (advisor.targetPath) {
              onFocusTarget(advisor.targetPath);
            }
          }}
          title={advisor.targetPath ?? 'No actionable target'}
          type="button"
        >
          <MapPin size={12} />
          <span>{formatTargetPath(advisor.targetPath)}</span>
        </button>
      </div>
      <div className="advisor-footer">
        <span className="advisor-system">
          {systemIcon(advisor.system)}
          {advisor.system}
        </span>
        <span className="advisor-actions">
          <button
            className="advisor-focus-action"
            disabled={!advisor.targetPath}
            onClick={() => {
              if (advisor.targetPath) {
                onFocusTarget(advisor.targetPath);
              }
            }}
            title={advisor.targetPath ? `Focus ${advisor.targetPath}` : 'No actionable target'}
            type="button"
          >
            <Crosshair size={13} />
            <span>Focus</span>
          </button>
          <button
            className="advisor-action"
            disabled={!canAct || isDispatching}
            onClick={() => {
              if (advisor.action && advisor.targetPath) {
                onAction(advisor.action, advisor.targetPath);
              }
            }}
            title={canAct ? `${advisor.actionLabel}: ${advisor.targetPath}` : 'No actionable target'}
            type="button"
          >
            {isDispatching && isActive ? <Radio size={13} /> : actionIcon(advisor.action)}
            <span>{isDispatching && isActive ? 'Sending' : advisor.actionLabel ?? 'Stand By'}</span>
          </button>
        </span>
      </div>
    </article>
  );
}

export function AdvisorCouncil({
  activeTargetPath = null,
  city,
  controlMode = 'preview',
  isDispatching = false,
  onAction,
  onFocusTarget,
}: AdvisorCouncilProps): ReactElement {
  const [briefingOpen, setBriefingOpen] = useState(true);
  const systems = [city.systems.power, city.systems.traffic, city.systems.pollution];
  const primaryIssue = getPrimaryIssue(city);
  const hasPrimaryTarget = primaryIssue?.targetPath != null;

  return (
    <aside className={`advisor-council ${briefingOpen ? 'is-open' : 'is-collapsed'}`} aria-label="Advisor Council">
      <button
        aria-controls="advisor-council-body"
        aria-expanded={briefingOpen}
        className="advisor-council-toggle"
        onClick={() => setBriefingOpen((current) => !current)}
        type="button"
      >
        <span className="advisor-council-heading">
          <span className="advisor-council-kicker">Council</span>
          <span className="advisor-council-title">Mayor Briefing</span>
        </span>
        <span className="city-integrity">
          <span>{city.integrity}</span>
          <small>Integrity</small>
        </span>
        <span className="advisor-council-chevron" aria-hidden="true">
          {briefingOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {briefingOpen ? (
        <div className="advisor-council-body" id="advisor-council-body">
          <div className={`mayor-priority mood-${primaryIssue?.mood ?? 'pleased'}`}>
            <span className="mayor-priority-icon">
              {primaryIssue?.mood === 'alarmed' ? <AlertTriangle size={16} /> : <Activity size={16} />}
            </span>
            <span className="mayor-priority-copy">
              <span className="mayor-priority-kicker">Current Priority</span>
              <span className="mayor-priority-title">
                {primaryIssue?.headline ?? 'No urgent council motion is pending.'}
              </span>
              <span className="mayor-priority-target">{formatTargetPath(primaryIssue?.targetPath ?? null)}</span>
            </span>
            <button
              className="mayor-priority-action"
              disabled={!hasPrimaryTarget}
              onClick={() => {
                if (primaryIssue?.targetPath) {
                  onFocusTarget(primaryIssue.targetPath);
                }
              }}
              title={primaryIssue?.targetPath ?? 'No priority target'}
              type="button"
            >
              <Crosshair size={13} />
              <span>{activeTargetPath === primaryIssue?.targetPath ? 'Selected' : 'Focus'}</span>
            </button>
          </div>

          <div className={`mayor-mode is-${controlMode}`}>
            <span>{controlMode === 'live' ? 'Live control link' : 'Preview controls'}</span>
            <small>{controlMode === 'live' ? 'Commands dispatch to the engine.' : 'Buttons focus targets locally.'}</small>
          </div>

          <div className="city-system-grid">
            {systems.map((system) => renderSystem(system, onFocusTarget, activeTargetPath))}
          </div>

          <div className="advisor-counts">
            <span>{city.counts.structures} zones</span>
            <span>{city.counts.asymmetry} faults</span>
            <span>{city.counts.criticalMass} critical</span>
            <span>{city.counts.queueDepth} queue</span>
          </div>

          <div className="advisor-list">
            {city.advisors.map((advisor) =>
              renderAdvisor(advisor, onAction, onFocusTarget, activeTargetPath, isDispatching),
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
