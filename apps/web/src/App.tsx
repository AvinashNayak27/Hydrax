import { useEffect, useMemo, useState } from 'react';
import { loadIncident } from './lib/api';
import type { Classification, IncidentUiContract, QueryEvidence, TemporalScope } from './lib/contracts';

type View = 'exposure' | 'witness' | 'containment';

const classes: Record<Classification, string> = {
  confirmed: 'status status--confirmed',
  unknown: 'status status--unknown',
  unaffected: 'status status--unaffected',
};
const labels: Record<Classification, string> = {
  confirmed: 'Confirmed', unknown: 'Unknown', unaffected: 'Unaffected',
};

function formatUtc(value: string) {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC';
}
function isExactCount(value: number | null, exact: boolean): value is number { return exact && value !== null; }
function displayCount(value: number | null, exact: boolean) { return isExactCount(value, exact) ? value : '—'; }
function queryEvidence(analysis: IncidentUiContract): QueryEvidence { return analysis.evidence; }

function QueryEvidenceCard({ evidence, title = 'Bounded query evidence' }: { evidence: QueryEvidence; title?: string }) {
  const available = evidence.availability === 'available';
  return <section className="card evidence-card">
    <div className="eyebrow">{title}</div>
    {available
      ? <><p className="query-guard">Bounded query text supplied by the backend. This UI never creates or executes query text.</p><code className="query-text">{evidence.queryText}</code>
        <div className="key-value"><span>Graph snapshot</span><b>{evidence.snapshot}</b></div>
        <div className="key-value"><span>Query duration</span><b>{evidence.durationMs} ms</b></div>
        <div className="key-value"><span>Integrity</span><b className="green">{evidence.integrity}</b></div></>
      : <p className="query-unavailable">Verification evidence is unavailable for this analysis. No query text, proof, duration, or integrity claim is shown.</p>}
    {evidence.truncated && <p className="fail-closed">Truncated result — exact path counts and verified containment are unavailable.</p>}
  </section>;
}

function Header({ analysis, mode }: { analysis: IncidentUiContract; mode: 'api' | 'demo' }) {
  return <header className="topbar"><div className="brand"><span>◆</span> BlastCut</div><div className="divider" />
    <div className="crumb">Incidents / <code>{analysis.incident.id}</code></div>
    <div className={`mode ${mode === 'demo' ? 'mode--demo' : 'mode--api'}`}><i />{mode === 'demo' ? 'demo fixture mode' : 'live API analysis'}</div>
  </header>;
}

function Exposure({ analysis, scope, setScope, onWitness, onContainment }: { analysis: IncidentUiContract; scope: TemporalScope; setScope: (scope: TemporalScope) => void; onWitness: () => void; onContainment: () => void }) {
  const { incident, inventory } = analysis;
  const pathCount = scope === 'historical' ? inventory.historicalPathCount : inventory.currentPathCount;
  const services = [...analysis.services].sort((a, b) => stateOrder(a.classification) - stateOrder(b.classification)).slice(0, 8);
  const canOpenWitness = Boolean(analysis.witness) && inventory.confirmedServices > 0;
  const canContain = analysis.plan?.status === 'feasible' && analysis.plan.exactCoverage;

  return <>
    <section className="incident-heading"><div><div className="eyebrow">Supply-chain incident · detected {formatUtc(incident.detectedAt)}</div>
      <h1>{incident.title} containment review</h1><p>{incident.affectedPackageCount} packages · {incident.affectedVersionCount} malicious versions · <code>{formatUtc(incident.windowStart)}–{formatUtc(incident.windowEnd)}</code> publication window</p>
    </div><div className="severity">{incident.severity} · CONFIRMED</div></section>
    <section className="time-context" aria-label="Exposure timeframe"><div><span className="eyebrow">Exposure timeframe</span><strong>{scope === 'historical' ? 'Historical live-window exposure' : 'Current deployed exposure'}</strong></div>
      <div className="segmented" role="group" aria-label="Select exposure timeframe"><button className={scope === 'historical' ? 'active' : ''} onClick={() => setScope('historical')}>Live window</button><button className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')}>Current</button></div>
    </section>
    <section className="metrics">
      <Metric tone="danger" value={inventory.confirmedServices} label="Confirmed exposed" note={scope === 'historical' ? 'observed during live window' : 'still reachable now'} />
      <Metric tone={isExactCount(pathCount, inventory.exactPathCounts) && pathCount > 0 ? 'danger' : 'warn'} value={displayCount(pathCount, inventory.exactPathCounts)} label="Dependency paths" note={inventory.exactPathCounts ? 'bounded witness total' : 'exact total unavailable'} />
      <Metric tone="warn" value={inventory.unknownServices} label="Unknown inventory" note="fail-closed; never treated safe" />
      <Metric tone="good" value={inventory.unaffectedServices} label="Unaffected / cleared" note="complete inventory only" />
    </section>
    <section className="content-grid"><div className="card inventory-card"><div className="card-head"><div><h2>Exposure inventory</h2><span>Exact deployed versions and lock paths</span></div><span className="count">{inventory.totalServices} production services</span></div>
      <div className="table-wrap"><table><thead><tr><th>Service</th><th>Owner</th><th>Deployed package</th><th>State</th><th>Paths</th></tr></thead><tbody>{services.map((service) => <tr key={service.id} onClick={canOpenWitness && service.id === analysis.witness?.serviceId ? onWitness : undefined} className={canOpenWitness && service.id === analysis.witness?.serviceId ? 'clickable-row' : ''}>
        <td><strong>{service.name}</strong>{service.lockPath && <small>{service.lockPath}</small>}</td><td>{service.owner}</td><td>{service.deployedPackage ? <code>{service.deployedPackage}</code> : '—'}</td><td><span className={classes[service.classification]}>{labels[service.classification]}</span>{service.inventoryReason && <small className="reason">{service.inventoryReason}</small>}</td><td className="path-number">{displayCount(scope === 'historical' ? service.historicalPaths : service.currentPaths, inventory.exactPathCounts)}</td>
      </tr>)}</tbody></table></div><div className="card-foot">Showing highest-risk services · unknown inventory remains outside containment proof</div></div>
      <aside className="rail"><section className="card classification-card"><div className="eyebrow">Classification</div><Legend status="confirmed" count={inventory.confirmedServices} /><Legend status="unknown" count={inventory.unknownServices} /><Legend status="unaffected" count={inventory.unaffectedServices} /></section>
        <QueryEvidenceCard evidence={queryEvidence(analysis)} title="HydraDB evidence" />
        <button className="cta" disabled={!canContain} onClick={onContainment}>{canContain ? 'Find containment cut' : 'Containment unavailable'} <span>→</span></button><p className="action-note">{canContain ? 'Computes a transparent, bounded counterfactual. No production change is executed.' : 'Requires an exact, feasible plan from the unified API.'}</p>
      </aside></section>
  </>;
}
function stateOrder(value: Classification) { return value === 'confirmed' ? 0 : value === 'unknown' ? 1 : 2; }
function Metric({ value, label, note, tone }: { value: number | string; label: string; note: string; tone: 'danger' | 'warn' | 'good' }) { return <div className={`metric metric--${tone}`}><span>{label}</span><b>{value}</b><small>{note}</small></div>; }
function Legend({ status, count }: { status: Classification; count: number }) { return <div className="legend"><span className={classes[status]}>{labels[status]}</span><b>{count}</b></div>; }

function Witness({ analysis, onBack, onContainment }: { analysis: IncidentUiContract; onBack: () => void; onContainment: () => void }) {
  const witness = analysis.witness;
  if (!witness || witness.evidence.availability !== 'available' || witness.totalPaths === null) return <Empty title="Witness evidence unavailable" detail="A complete bounded witness was not supplied by the unified API." onBack={onBack} />;
  return <><section className="view-heading"><div><button className="back" onClick={onBack}>← Exposure inventory</button><div className="eyebrow">Exact witness · path {witness.pathNumber ?? 1} of {witness.totalPaths} for {witness.serviceName}</div><h1>Why <code>{witness.serviceName}</code> was exposed</h1></div><span className="muted">historical live window · complete lockfile</span></section>
    <section className="summary-strip"><Summary label="Source service" value={witness.serviceName} /><Summary label="Owner" value={witness.owner} /><Summary label="Path length" value={`${Math.max(0, witness.nodes.length - 1)} edges`} /><Summary label="Classification" value={labels[witness.classification]} danger={witness.classification === 'confirmed'} /></section>
    <section className="detail-grid"><div className="card witness-card"><div className="card-head"><div><h2>Typed HydraDB witness path</h2><span>Every node includes an exact version or occurrence path</span></div><span className="tiny-badge">bounded · API evidence</span></div><div className="path-stack">{witness.nodes.map((node, index) => <div key={`${node.label}-${index}`}><div className={`path-node ${node.malicious ? 'path-node--malicious' : ''}`}><span>{node.kind}</span><strong><code>{node.label}</code></strong><small>{node.detail}</small></div>{node.edge && <div className="edge">↓ {node.edge}</div>}</div>)}</div><div className="card-foot">Witness evidence returned by the unified API.</div></div>
      <aside className="rail"><PlanCard plan={analysis.plan} onContainment={onContainment} /><QueryEvidenceCard evidence={witness.evidence} title="Witness query evidence" /></aside></section>
  </>;
}
function Summary({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div><span>{label}</span><b className={danger ? 'red' : ''}>{value}</b></div>; }

function PlanCard({ plan, onContainment }: { plan?: IncidentUiContract['plan']; onContainment: () => void }) {
  if (!plan || plan.status !== 'feasible' || !plan.exactCoverage || plan.totalPaths === null) return <section className="card plan-card"><div className="eyebrow">Containment plan</div><h3>Plan unavailable</h3><p>{plan?.reason ?? 'No exact feasible plan was returned. Exposure remains unverified.'}</p></section>;
  return <section className="card plan-card"><div className="eyebrow">Minimum containment cut found</div><h2>Actions cover all {plan.totalPaths} bounded paths.</h2>{plan.actions.map((action, index) => <div className={`action ${action.recommended ? 'action--recommended' : ''}`} key={action.id}><div className="action-top"><span className="number">{index + 1}</span><div><h3>{action.title}</h3><code>{action.from} → {action.to}</code></div>{action.recommended && <span className="recommended">recommended</span>}</div><div className="chips"><span>{action.affectedServices} services</span><span>{action.changes} change</span>{action.estimateMinutes !== undefined && <span>est. {action.estimateMinutes} min</span>}</div></div>)}<div className="total"><span>Total modeled cost</span><b>{plan.actions.reduce((sum, action) => sum + action.cost, 0).toFixed(1)} · {plan.actions.reduce((sum, action) => sum + action.restarts, 0)} restarts</b></div><button className="cta" onClick={onContainment}>Apply counterfactual simulation →</button></section>;
}

function Containment({ analysis, onBack }: { analysis: IncidentUiContract; onBack: () => void }) {
  const verification = analysis.verification;
  const plan = analysis.plan;
  const verified = Boolean(verification && verification.status === 'verified' && verification.complete && verification.after.paths === 0 && verification.evidence.availability === 'available');
  if (!verification || !plan || !verified) return <Empty title="Containment not verified" detail={verification?.reason ?? 'The unified API did not provide a complete zero-residual verification.'} onBack={onBack} />;
  return <><section className="verification-hero"><div className="check">✓</div><div><div className="eyebrow">Containment verified</div><h1>No malicious dependency path remains</h1><p>The proposed actions intersect every bounded production path to the affected versions.</p></div><div className="proof"><b>VERIFIED · {verification.verifiedAt ? formatUtc(verification.verifiedAt) : 'API result'}</b>{verification.proofId && <code>{verification.proofId}</code>}</div></section>
    <section className="comparison"><Compare title="Before · production snapshot" services={verification.before.services} paths={verification.before.paths} before /><div className="compare-arrow">→</div><Compare title="After · counterfactual graph" services={verification.after.services} paths={verification.after.paths} /></section>
    <section className="detail-grid"><div><section className="card applied-card"><div className="card-head"><div><h2>Applied counterfactual actions</h2><span>No production changes executed</span></div><span className="tiny-badge">simulation only</span></div>{plan.actions.map((action) => <div className="applied-action" key={action.id}><span className="ok">✓</span><div><h3>{action.title}</h3><code>{action.from} → {action.to}</code><p>{action.description}</p><div className="cost-line">Cost: base {action.costs.base} + semver {action.costs.semver} + scope {action.costs.scope} + coordination {action.costs.coordination} = <b>{action.cost}</b></div></div><div className="impact">{action.coveredPaths !== null && <b>{action.coveredPaths} paths removed</b>}<span>{action.restarts} restarts{action.estimateMinutes !== undefined && ` · est. ${action.estimateMinutes} min`}</span></div></div>)}</section>
      <section className="card post-class"><div className="card-head"><div><h2>Post-cut classification</h2><span>{verification.evaluatedServices} production services evaluated</span></div></div><div><Metric tone="good" label="Confirmed exposed" value={verification.after.services} note="no bounded witness returned" /><Metric tone="warn" label="Unknown" value={0} note="complete supported inventory" /><Metric tone="good" label="Unaffected / cleared" value={verification.evaluatedServices} note="counterfactual only" /></div></section></div>
      <aside className="rail"><section className="card verification-card"><div className="eyebrow">HydraDB verification</div><div className="key-value"><span>Recomputed witnesses</span><b>{verification.after.paths} returned</b></div>{verification.coverage && <div className="key-value"><span>Paths covered</span><b className="green">{verification.coverage}</b></div>}<div className="key-value"><span>Services evaluated</span><b>{verification.evaluatedServices} / {verification.evaluatedServices}</b></div><div className="key-value"><span>Result</span><b className="green">verified</b></div></section><QueryEvidenceCard evidence={verification.evidence} title="Verification query evidence" /><button className="secondary-button" onClick={onBack}>← Return to exposure</button></aside>
    </section>
  </>;
}
function Compare({ title, services, paths, before = false }: { title: string; services: number; paths: number | null; before?: boolean }) { return <div className={`compare-card ${before ? 'compare-card--before' : 'compare-card--after'}`}><span>{title}</span><div><div><small>Exposed services</small><b>{services}</b></div><div><small>Dependency paths</small><b>{paths ?? '—'}</b></div></div></div>; }
function Empty({ title, detail, onBack }: { title: string; detail: string; onBack: () => void }) { return <section className="empty-state"><h1>{title}</h1><p>{detail}</p><button className="secondary-button" onClick={onBack}>Return to exposure</button></section>; }

function App() {
  const [view, setView] = useState<View>('exposure');
  const [scope, setScope] = useState<TemporalScope>('historical');
  const [state, setState] = useState<{ analysis?: IncidentUiContract; mode?: 'api' | 'demo'; error?: string }>({});
  useEffect(() => { loadIncident().then(({ analysis, mode }) => setState({ analysis, mode })).catch((error: Error) => setState({ error: error.message })); }, []);
  const content = useMemo(() => {
    if (state.error) return <main className="main"><section className="empty-state"><div className="eyebrow">Analysis unavailable</div><h1>Unable to load containment evidence</h1><p>{state.error}. Demo fallback is disabled.</p></section></main>;
    if (!state.analysis || !state.mode) return <main className="main"><section className="loading"><span /><p>Loading incident evidence…</p></section></main>;
    const shared = { analysis: state.analysis };
    return <><Header analysis={state.analysis} mode={state.mode} /><main className="main">{view === 'exposure' && <Exposure {...shared} scope={scope} setScope={setScope} onWitness={() => setView('witness')} onContainment={() => setView('containment')} />}{view === 'witness' && <Witness {...shared} onBack={() => setView('exposure')} onContainment={() => setView('containment')} />}{view === 'containment' && <Containment {...shared} onBack={() => setView('exposure')} />}</main></>;
  }, [state, view, scope]);
  return <div className="app">{content}</div>;
}
export default App;
