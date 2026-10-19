import type { FlowStatistics } from '../lib/flow-statistics'
import { dateLabel } from '../lib/flow-statistics'
import { reportModel } from '../lib/flow-report'
import { formatDuration } from '../lib/study-sessions'
import StatisticsChart, { StatisticsLegend } from './StatisticsChart'

export default function FlowReport({ data }: { data: FlowStatistics }) {
  const report = reportModel(data), daily = data.period.kind === 'week' || data.period.kind === 'month'
  return <article className="flow-report" aria-label="Flow arbeidsrapport">
    <header className="report-heading"><p className="section-label">Flow</p><h2>Arbeidsrapport</h2>
      <p className="report-period">{report.period}</p><p className="timer-meta">Generert {report.generated}</p></header>
    <dl className="report-summary"><div><dt>Total arbeidstid</dt><dd className="report-total">{report.total}</dd></div>
      <div><dt>Mest aktive område</dt><dd>{data.mostActive?.name ?? 'Ingen registrert arbeidstid'}</dd></div>
      {daily && <div><dt>Mest aktive dag</dt><dd>{report.busiest}</dd></div>}
    </dl>
    {!data.total && <p>Ingen registrert arbeidstid i denne perioden.</p>}
    {(daily || data.total > 0) && <><StatisticsChart summary={data} period={data.period} /><StatisticsLegend subjects={data.areas} /></>}
    <section><h3>Arbeid per område</h3><table className="report-table"><thead><tr><th scope="col">Område</th><th scope="col">Arbeidstid</th></tr></thead>
      <tbody>{data.areas.map(a => <tr key={a.id ?? 'none'}><th scope="row">{a.code && <span className="subject-code">{a.code} · </span>}{a.name}{a.is_archived && <small> · Arkivert</small>}</th><td>{formatDuration(a.work)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">Totalt</th><td>{report.total}</td></tr></tfoot></table></section>
    {daily && <section><h3>Daglige summer</h3><table className="report-table"><thead><tr><th scope="col">Flow-dato</th><th scope="col">Arbeidstid</th></tr></thead>
      <tbody>{data.days.map(d => <tr key={d.date}><th scope="row">{dateLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</th><td>{formatDuration(d.total)}</td></tr>)}</tbody></table></section>}
    <section><h3>Oppgaver og bidrag</h3><p className="timer-meta">Tid følger området som var lagret på arbeidsperioden. Navn og status er dagens tilgjengelige metadata.</p>
      {!report.contributions.length ? <p>Ingen oppgavebidrag i denne perioden.</p> : <table className="report-table report-contributions"><thead><tr><th scope="col">Oppgave</th><th scope="col">Område</th><th scope="col">Arbeidstid</th></tr></thead>
        <tbody>{report.contributions.map(c => <tr key={c.key}><th scope="row">{c.task}{c.status && <small> · {c.status}</small>}</th><td>{c.area}</td><td>{c.time}</td></tr>)}</tbody></table>}
    </section>
    <footer className="report-notes"><p>Flow-dager går fra kl. 04:00 til neste kl. 04:00 i lagret tidssone. Pauser teller ikke som arbeidstid. Pågående arbeid er klippet ved rapportens servertidspunkt.</p>
      {report.legacy && <p>Eldre registreringer mangler lagret historisk tidssone.{data.period.kind === 'total'
        ? ' Totalt er tidssoneuavhengig.' : ` De er gruppert etter valgt visningstidssone: ${data.period.timezone}.`}</p>}
    </footer>
  </article>
}
