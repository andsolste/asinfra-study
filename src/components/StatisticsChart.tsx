import { useId } from 'react'
import { axisTime, chartScale, dayAxisLabel, subjectAppearance } from '../lib/statistics'
import type { StatisticsPeriod, StatisticsSummary, SubjectWork } from '../lib/statistics'
import { formatDuration } from '../lib/study-sessions'

const subjectLabel = (subject: SubjectWork) => [subject.code, subject.name].filter(Boolean).join(' · ')
const key = (subject: SubjectWork) => subject.id ?? 'none'
const paint = (prefix: string, subject: SubjectWork) => `url(#${prefix}-${key(subject)})`

function SubjectPatterns({ prefix, subjects }: { prefix: string; subjects: SubjectWork[] }) {
  return <defs>{subjects.map(subject => {
    const { color, pattern } = subjectAppearance(subject.id)
    return <pattern key={key(subject)} id={`${prefix}-${key(subject)}`} width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill={color} />
      {pattern === 1 && <path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="#0F172A" strokeOpacity=".45" strokeWidth="1.5" />}
      {pattern === 2 && <circle cx="4" cy="4" r="1.25" fill="#0F172A" fillOpacity=".5" />}
      {pattern === 3 && <path d="M0 4H8" stroke="#0F172A" strokeOpacity=".45" strokeWidth="1.5" />}
    </pattern>
  })}</defs>
}

export function StatisticsLegend({ subjects }: { subjects: SubjectWork[] }) {
  const prefix = useId()
  return <ul className="statistics-legend" aria-label="Arbeidstid per fag">{subjects.map(subject =>
    <li key={key(subject)}>
      <svg className="statistics-swatch" viewBox="0 0 20 20" aria-hidden="true">
        <SubjectPatterns prefix={prefix} subjects={[subject]} />
        <rect width="20" height="20" rx="3" fill={paint(prefix, subject)} />
      </svg>
      <span>{subject.code && <span className="subject-code">{subject.code} · </span>}{subject.name}</span>
      <strong>{formatDuration(subject.work)}</strong>
    </li>)}</ul>
}

export default function StatisticsChart({ summary, period }: { summary: StatisticsSummary; period: StatisticsPeriod }) {
  const prefix = useId()
  const day = period.kind === 'day'
  const month = period.kind === 'month'
  const width = month ? 1000 : day ? 620 : 400
  const height = day ? 50 : 260
  const left = month ? 62 : 54, right = 12, top = 12, bottom = 222
  const plotWidth = width - left - right
  const scale = chartScale(Math.max(...summary.days.map(value => value.total), 0))
  const slot = plotWidth / summary.days.length
  const barWidth = slot * .65
  let dayX = 0
  return <figure className="statistics-figure">
    <figcaption>{day ? 'Fordeling av arbeidstid' : 'Faktisk arbeidstid per dag'}</figcaption>
    {month && <p className="timer-meta">Bla sidelengs for å se alle dagene på små skjermer.</p>}
    <div className={month ? 'statistics-chart-scroll' : 'statistics-chart'}
      tabIndex={month ? 0 : undefined} role={month ? 'region' : undefined} aria-label={month ? 'Diagram for hele måneden, rullbart' : undefined}>
      <svg className={month ? 'statistics-svg is-month' : 'statistics-svg'} viewBox={`0 0 ${width} ${height}`}
        role="img" aria-labelledby={`${prefix}-title ${prefix}-desc`}>
        <title id={`${prefix}-title`}>{day ? 'Arbeidstid fordelt på fag' : 'Daglig arbeidstid fordelt på fag'}</title>
        <desc id={`${prefix}-desc`}>Kun avsluttede arbeidsperioder, uten pauser. Fag, datoer og eksakt tid finnes i faglisten og under Vis tallgrunnlag.</desc>
        <SubjectPatterns prefix={prefix} subjects={summary.subjects} />
        <g aria-hidden="true">
          {day ? summary.subjects.map(subject => {
            const bar = summary.total ? subject.work / summary.total * width : 0
            const x = dayX; dayX += bar
            return <rect key={key(subject)} x={x} y="10" width={bar} height="30" fill={paint(prefix, subject)}>
              <title>{subjectLabel(subject)}: {formatDuration(subject.work)}</title>
            </rect>
          }) : <>
            {scale.ticks.map(tick => {
              const y = bottom - tick / scale.max * (bottom - top)
              return <g key={tick}><line className="statistics-gridline" x1={left} x2={width - right} y1={y} y2={y} />
                <text className="statistics-axis" x={left - 10} y={y + 4} textAnchor="end">{axisTime(tick)}</text></g>
            })}
            {summary.days.map((value, index) => {
              const x = left + slot * index + (slot - barWidth) / 2
              let stacked = 0
              return <g key={value.from}>
                <title>{value.label}: {formatDuration(value.total)}</title>
                {!value.total && <rect className="statistics-zero" x={x} y={bottom - 3} width={barWidth} height="3" />}
                {summary.subjects.map(subject => {
                  const work = value.subjects.find(row => row.id === subject.id)?.work ?? 0
                  const barHeight = work / scale.max * (bottom - top)
                  const y = bottom - stacked - barHeight; stacked += barHeight
                  return work > 0 && <rect key={key(subject)} x={x} y={y} width={barWidth} height={barHeight} fill={paint(prefix, subject)}>
                    <title>{value.label} · {subjectLabel(subject)}: {formatDuration(work)}</title>
                  </rect>
                })}
                <text className="statistics-axis" x={x + barWidth / 2} y={bottom + 23} textAnchor="middle">
                  {dayAxisLabel(value, period.kind, index, summary.days.length)}
                </text>
              </g>
            })}
          </>}
        </g>
      </svg>
    </div>
  </figure>
}

export function StatisticsTable({ summary, period }: { summary: StatisticsSummary; period: StatisticsPeriod }) {
  return <details className="statistics-data"><summary>Vis tallgrunnlag</summary>
    <div className="statistics-table-scroll" tabIndex={0} role="region" aria-label="Tallgrunnlag, rullbart ved behov">
      <table>
        <caption>Arbeidstid i lokal tid · timer:minutter:sekunder</caption>
        {period.kind === 'day' ? <>
          <thead><tr><th scope="col">Fag</th><th scope="col">Arbeidstid</th></tr></thead>
          <tbody>{summary.subjects.map(subject => <tr key={key(subject)}><th scope="row">{subjectLabel(subject)}</th><td>{formatDuration(subject.work)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Totalt</th><td>{formatDuration(summary.total)}</td></tr></tfoot>
        </> : <>
          <thead><tr><th scope="col">Dato</th>{summary.subjects.map(subject => <th key={key(subject)} scope="col">{subjectLabel(subject)}</th>)}<th scope="col">Totalt</th></tr></thead>
          <tbody>{summary.days.map(value => <tr key={value.from}><th scope="row">{value.label}</th>
            {summary.subjects.map(subject => <td key={key(subject)}>{formatDuration(value.subjects.find(row => row.id === subject.id)?.work ?? 0)}</td>)}
            <td>{formatDuration(value.total)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Totalt</th>{summary.subjects.map(subject => <td key={key(subject)}>{formatDuration(subject.work)}</td>)}<td>{formatDuration(summary.total)}</td></tr></tfoot>
        </>}
      </table>
    </div>
  </details>
}
