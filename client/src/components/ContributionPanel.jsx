import { useMemo, useState } from "react";
import { analyzeContribution } from "../api.js";

// Keep in sync with MAX_SAMPLES in server/contribution.js.
const MAX_SAMPLES = 50;

const CLASS_META = {
  critical: { label: "关键", hint: "移除该样本后契约 Schema 会发生变化" },
  redundant: { label: "冗余", hint: "移除该样本后契约 Schema 保持不变" },
};

const FILTERS = [
  ["all", "全部"],
  ["critical", "仅关键"],
  ["redundant", "仅冗余"],
];

export default function ContributionPanel({ sampleTexts, parsed, allValid, onLocate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null); // { fingerprint, data }
  const [filter, setFilter] = useState("all");

  // Fingerprint of the raw editor contents: any sample edit invalidates the
  // previous analysis, so stale results are never shown.
  const fingerprint = useMemo(() => JSON.stringify(sampleTexts), [sampleTexts]);
  const stale = analysis !== null && analysis.fingerprint !== fingerprint;
  const result = stale ? null : analysis?.data ?? null;

  const count = parsed.length;
  const overLimit = count > MAX_SAMPLES;

  async function run() {
    setError(null);
    if (!allValid || count === 0) return;
    if (overLimit) {
      setError(`单次最多分析 ${MAX_SAMPLES} 条样本，当前共 ${count} 条，请减少样本后再试。`);
      return;
    }
    setBusy(true);
    try {
      const data = await analyzeContribution(parsed.map((p) => p.value));
      setAnalysis({ fingerprint, data });
      setFilter("all");
    } catch (e) {
      setAnalysis(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => {
    if (!result) return [];
    return result.samples.filter((s) => filter === "all" || s.classification === filter);
  }, [result, filter]);

  return (
    <div className="contribution">
      <div className="scan-head">
        <span className="panel-label">样本贡献度</span>
        <span className="panel__meta">
          逐条移除样本并重新归纳 Schema，按规范化后的规则差异判定每条样本为关键或冗余（单次最多{" "}
          {MAX_SAMPLES} 条）
        </span>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={run}
          disabled={busy || !allValid || count === 0 || overLimit}
          title={
            !allValid
              ? "请先修正无效的 JSON 样本"
              : overLimit
                ? `单次最多分析 ${MAX_SAMPLES} 条样本`
                : ""
          }
        >
          {busy ? "分析中…" : "分析样本贡献度"}
        </button>
      </div>

      {overLimit && (
        <div className="alert alert--err">
          当前共 {count} 条样本，超过单次上限 {MAX_SAMPLES} 条，请删除部分样本后再分析。
        </div>
      )}
      {error && <div className="alert alert--err">{error}</div>}
      {stale && (
        <div className="alert alert--warn">样本内容已变化，之前的分析结果已失效，请重新分析。</div>
      )}

      {result && (
        <>
          <div className="scan-summary">
            <span className="contrib-badge contrib-badge--critical">
              关键 {result.summary.critical}
            </span>
            <span className="contrib-badge contrib-badge--redundant">
              冗余 {result.summary.redundant}
            </span>
            <span className="panel__meta">共 {result.total} 条 · 点击「定位样本」跳转到左侧对应样本</span>
          </div>

          <div className="diff-toolbar">
            <div className="perspective-toggle">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 && (
            <div className="empty-hint">当前筛选条件下没有样本，切换上方筛选查看。</div>
          )}

          <ul className="scan-list contrib-list">
            {visible.map((item) => (
              <li key={item.index} className={`contrib-item contrib-item--${item.classification}`}>
                <div className="contrib-item__head">
                  <span className="scan-item__index">#{item.index}</span>
                  <span className={`contrib-badge contrib-badge--${item.classification}`}>
                    {CLASS_META[item.classification].label}样本
                  </span>
                  <span className="panel__meta">{CLASS_META[item.classification].hint}</span>
                  <button
                    type="button"
                    className="btn btn--sm contrib-item__locate"
                    onClick={() => onLocate(item.index)}
                  >
                    定位样本
                  </button>
                </div>
                {item.affectedPointers.length > 0 && (
                  <div className="contrib-item__pointers">
                    <span className="panel__meta">受影响规则（JSON Pointer）：</span>
                    <span className="contrib-pointers">
                      {item.affectedPointers.map((p) => (
                        <code key={p} className="contrib-pointer">
                          {p || "(root)"}
                        </code>
                      ))}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
