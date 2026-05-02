import { useState, type ReactElement } from 'react';
import {
  Banknote,
  Bolt,
  ChevronDown,
  ChevronRight,
  Eye,
  Factory,
  GitBranch,
  Hammer,
  Landmark,
} from 'lucide-react';

import type {
  AdvisorAction,
  AdvisorReport,
  CityCouncilState,
  CitySystemKey,
  CitySystemReport,
} from './city-systems';

interface AdvisorCouncilProps {
  city: CityCouncilState;
  onAction: (action: AdvisorAction, targetPath: string) => void;
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
    return <Hammer size={13} />;
  }

  return <Eye size={13} />;
}

function renderSystem(report: CitySystemReport): ReactElement {
  return (
    <div className={`city-system-card tone-${report.tone}`} key={report.key}>
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
    </div>
  );
}

function renderAdvisor(advisor: AdvisorReport, onAction: AdvisorCouncilProps['onAction']): ReactElement {
  const canAct = advisor.action !== null && advisor.targetPath !== null;

  return (
    <article className={`advisor-card mood-${advisor.mood}`} key={advisor.id}>
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
      <div className="advisor-footer">
        <span className="advisor-system">
          {systemIcon(advisor.system)}
          {advisor.system}
        </span>
        <button
          className="advisor-action"
          disabled={!canAct}
          onClick={() => {
            if (advisor.action && advisor.targetPath) {
              onAction(advisor.action, advisor.targetPath);
            }
          }}
          title={canAct ? `${advisor.actionLabel}: ${advisor.targetPath}` : 'No actionable target'}
          type="button"
        >
          {actionIcon(advisor.action)}
          <span>{advisor.actionLabel ?? 'Stand By'}</span>
        </button>
      </div>
    </article>
  );
}

export function AdvisorCouncil({ city, onAction }: AdvisorCouncilProps): ReactElement {
  const [briefingOpen, setBriefingOpen] = useState(false);
  const systems = [city.systems.power, city.systems.traffic, city.systems.pollution];

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
          <div className="city-system-grid">
            {systems.map((system) => renderSystem(system))}
          </div>

          <div className="advisor-counts">
            <span>{city.counts.structures} zones</span>
            <span>{city.counts.asymmetry} faults</span>
            <span>{city.counts.criticalMass} critical</span>
            <span>{city.counts.queueDepth} queue</span>
          </div>

          <div className="advisor-list">
            {city.advisors.map((advisor) => renderAdvisor(advisor, onAction))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
