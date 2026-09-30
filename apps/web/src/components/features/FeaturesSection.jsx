import { FEATURES } from "@/content/features";

import BenchmarkChart from "./BenchmarkChart";

const pad = (n) => String(n + 1).padStart(2, "0");

/**
 * Features: four pains and their answers, the benchmark chart, a row of
 * numbers, one closing line. The chart is the only client piece.
 */
export default function FeaturesSection() {
  const { pains, benchmarks, stats } = FEATURES;

  return (
    <section className="features" id="features">
      <header className="features__head">
        <h2 className="features__title">{FEATURES.title}</h2>
        <p className="features__lede">{FEATURES.lede}</p>
      </header>

      <ol className="features__pains">
        {pains.map((item, index) => (
          <li key={item.pain} className="features__pain">
            <span className="features__num">{pad(index)}</span>
            <p className="features__quote">{item.pain}</p>
            <p className="features__fix">{item.fix}</p>
          </li>
        ))}
      </ol>

      <div className="features__block">
        <h3 className="features__sub">{benchmarks.title}</h3>
        <p className="features__sub-lede">{benchmarks.lede}</p>
        <BenchmarkChart data={benchmarks} />
        <p className="features__note">
          <strong>{benchmarks.note}</strong>
        </p>
      </div>

      <dl className="features__stats">
        {stats.map((stat) => (
          <div key={stat.label} className="features__stat">
            <dt className="features__stat-label">{stat.label}</dt>
            <dd className="features__stat-value">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <p className="features__closing">{FEATURES.closing}</p>
    </section>
  );
}
