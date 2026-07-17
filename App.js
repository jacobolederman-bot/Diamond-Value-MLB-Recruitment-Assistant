const $ = (s) => document.querySelector(s);

// Plain-language explanations for baseball stats (shown as tooltips)
const STAT_INFO = {
  G: "Games played",
  AB: "At-bats — official chances to hit",
  R: "Runs scored",
  H: "Hits",
  "2B": "Doubles — hits reaching second base",
  "3B": "Triples — hits reaching third base",
  HR: "Home runs — ball hit out of the park, an automatic score",
  RBI: "Runs batted in — teammates driven home by this hitter",
  SB: "Stolen bases — extra bases taken by running, a speed stat",
  BB: "Walks — free trips to first base for laying off bad pitches",
  SO: "Strikeouts — outs made swinging and missing (lower is better)",
  AVG: "Batting average — how often a hit results per at-bat (.300 is great)",
  OBP: "On-base percentage — how often the player avoids making an out (.370+ is elite)",
  SLG: "Slugging — batting average weighted for extra-base power",
  OPS: "OBP + slugging — the go-to single number for overall hitting (.800+ is very good)",
};

// One-line meanings for verdicts
const VERDICT_INFO = {
  "Steal": "Paid far less than their performance is worth — a bargain",
  "Undervalued": "Producing more than their paycheck suggests",
  "Fair Deal": "Salary roughly matches what the performance is worth",
  "Overpriced": "Paid more than the numbers justify",
  "Albatross": "A heavy contract — paid far above what the bat delivers",
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt$ = (n) => "$" + Math.round(n).toLocaleString();
const fmtM = (n) => "$" + (n / 1e6).toFixed(2) + "M";

// tabs
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("#tab-" + t.dataset.tab).classList.add("active");
  });
});

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { const j = await r.json(); if (j.detail) msg = typeof j.detail === "string" ? j.detail : msg; } catch {}
    return { error: msg, results: [], matches: [], suggestions: [] };
  }
  return r.json();
}

let YEARS = [];

async function init() {
  try {
    const m = await api("/api/meta");
    YEARS = m.years;
    $("#modelBadge").textContent =
      `Model R² ${m.metrics.r2_log} · ${m.n_train.toLocaleString()} seasons · ${m.train_years[0]}–${m.train_years[1]}`;
    for (const sel of ["#recYear", "#teamYear"]) {
      const el = $(sel);
      el.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join("");
    }
    $("#valYear").innerHTML =
      `<option value="">All seasons (${m.train_years[0]}–${m.train_years[1]})</option>` +
      YEARS.map((y) => `<option value="${y}">${y}</option>`).join("");
    loadTeams();
    const ex = await api("/api/examples");
    const row = $("#exampleRow");
    ex.examples.forEach((e) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.innerHTML = `${e.name} <span class="tag">${e.tag} · ${e.year}</span>`;
      b.addEventListener("click", () => loadPlayer(e.playerID, e.year));
      row.appendChild(b);
    });
  } catch (e) {
    $("#modelBadge").textContent = "Model failed to load";
  }
}

// ---------- Player scout ----------
$("#searchBtn").addEventListener("click", doSearch);
$("#searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

async function doSearch() {
  const q = $("#searchInput").value.trim();
  if (!q) return;
  $("#searchResults").innerHTML = `<div class="loading">Searching…</div>`;
  $("#reportArea").innerHTML = "";
  const res = await api("/api/search?q=" + encodeURIComponent(q));
  const box = $("#searchResults");
  if (res.matches.length === 1) {
    box.innerHTML = "";
    loadPlayer(res.matches[0].playerID);
    return;
  }
  if (res.matches.length > 0) {
    box.innerHTML = `<div class="match-list">` + res.matches.map((m) =>
      `<div class="match-item" data-pid="${m.playerID}">
        <div><b>${m.name}</b><div class="sub">${m.latest_team ?? ""}</div></div>
        <div class="sub">${m.seasons.length} season${m.seasons.length > 1 ? "s" : ""} · ${Math.min(...m.seasons)}–${Math.max(...m.seasons)}</div>
      </div>`).join("") + `</div>`;
    box.querySelectorAll(".match-item").forEach((el) =>
      el.addEventListener("click", () => { box.innerHTML = ""; loadPlayer(el.dataset.pid); }));
    return;
  }
  if (res.suggestions.length > 0) {
    box.innerHTML = `<div class="suggestions"><p>No exact match. Did you mean:</p>` +
      res.suggestions.map((s) => `<button class="chip sugg">${s}</button>`).join(" ") + `</div>`;
    box.querySelectorAll(".sugg").forEach((el) =>
      el.addEventListener("click", () => { $("#searchInput").value = el.textContent; doSearch(); }));
    return;
  }
  box.innerHTML = `<div class="error-box">No players found matching "${esc(q)}".</div>`;
}

async function loadPlayer(pid, year) {
  $("#reportArea").innerHTML = `<div class="loading">Building scouting report…</div>`;
  const url = "/api/player/" + pid + (year ? "?year=" + year : "");
  const d = await api(url);
  if (d.error) { $("#reportArea").innerHTML = `<div class="error-box">${d.error}</div>`; return; }
  renderReport(d, pid);
  $("#reportArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function verdictClass(v) { return v.toLowerCase().replace(" ", "-"); }

function reportCard(r) {
  const maxV = Math.max(r.predicted_salary, r.actual_salary, 1);
  const surplusPos = r.surplus >= 0;
  const statKeys = ["G","AB","R","H","2B","3B","HR","RBI","SB","BB","AVG","OBP","SLG","OPS"];
  return `
  <div class="report-card">
    <div class="report-top">
      <div>
        <h3>${r.name}</h3>
        <div class="meta">${r.year} · ${r.team} (${r.league}) · Age ${r.age} · Year ${r.experience + 1} in MLB</div>
      </div>
      <div class="verdict-wrap">
        <div class="verdict ${verdictClass(r.verdict)}">${r.verdict}</div>
        <div class="verdict-note">${VERDICT_INFO[r.verdict] ?? ""}</div>
      </div>
    </div>
    <div class="report-body">
      <div class="value-compare">
        <h4>Value vs Cost</h4>
        <div class="bar-row">
          <div class="bar-label"><span>Predicted market value</span><span class="amt">${fmtM(r.predicted_salary)}</span></div>
          <div class="bar-track"><div class="bar-fill predicted" style="width:${(r.predicted_salary / maxV) * 100}%"></div></div>
        </div>
        <div class="bar-row">
          <div class="bar-label"><span>Actual salary</span><span class="amt">${fmtM(r.actual_salary)}</span></div>
          <div class="bar-track"><div class="bar-fill actual" style="width:${(r.actual_salary / maxV) * 100}%"></div></div>
        </div>
        <div class="surplus-line">
          ${surplusPos ? "Surplus value" : "Overpay"}: <b class="${surplusPos ? "pos" : "neg"}">${surplusPos ? "+" : "−"}${fmtM(Math.abs(r.surplus))}</b>
          &nbsp;·&nbsp; Value ratio <b>${r.value_ratio}×</b>
        </div>
      </div>
      <div class="stat-grid-wrap">
        <h4>${r.year} Offensive Line</h4>
        <div class="stat-grid">
          ${statKeys.map((k) => `<div class="stat-box" title="${STAT_INFO[k] ?? ""}"><div class="v">${typeof r.stats[k] === "number" && r.stats[k] < 2 && !Number.isInteger(r.stats[k]) ? r.stats[k].toFixed(3).replace(/^0/, "") : r.stats[k]}</div><div class="k">${k}</div></div>`).join("")}
        </div>
        <div class="stat-hint">Hover any stat for a plain-English explanation.</div>
      </div>
    </div>
    <div class="career-slot"></div>
  </div>`;
}

function renderReport(d, pid) {
  const r = d.report;
  let html = reportCard(r);
  $("#reportArea").innerHTML = html;
  // career chart + season pills
  const maxSal = Math.max(...d.career.flatMap((c) => [c.salary, c.predicted]), 1);
  const chart = `
    <div class="career-chart">
      <h4>Career: Predicted Value vs Actual Salary</h4>
      <div class="spark">
        ${d.career.map((c) => `
          <div class="col" data-year="${c.year}">
            <div class="tip">${c.year} ${c.team}<br>Pred ${fmtM(c.predicted)} · Paid ${fmtM(c.salary)}<br>OPS ${c.OPS.toFixed(3)} · ${c.HR} HR</div>
            <div class="bp" style="height:${(c.predicted / maxSal) * 100}px"></div>
            <div class="ba" style="height:${(c.salary / maxSal) * 100}px"></div>
          </div>`).join("")}
      </div>
      <div class="spark-years">${d.career.map((c) => `<span>${String(c.year).slice(2)}</span>`).join("")}</div>
      <div class="spark-legend">
        <span><span class="dot gold"></span>Predicted value</span>
        <span><span class="dot blue"></span>Actual salary</span>
        <span style="margin-left:auto">Click a season below to re-scout it</span>
      </div>
      <div class="season-pills" style="margin-top:12px">
        ${d.career.map((c) => `<button class="season-pill ${c.year === r.year ? "active" : ""}" data-y="${c.year}">${c.year}</button>`).join("")}
      </div>
    </div>`;
  $("#reportArea .career-slot").innerHTML = chart;
  $("#reportArea").querySelectorAll(".season-pill").forEach((b) =>
    b.addEventListener("click", () => loadPlayer(pid, b.dataset.y)));
}

// ---------- Recommend ----------
$("#recBtn").addEventListener("click", doRecommend);
$("#descInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doRecommend(); });
document.querySelectorAll(".chip[data-desc]").forEach((c) =>
  c.addEventListener("click", () => { $("#descInput").value = c.dataset.desc; doRecommend(); }));

async function doRecommend() {
  const desc = $("#descInput").value.trim();
  if (!desc) return;
  $("#recArea").innerHTML = `<div class="loading">Matching statistical profiles…</div>`;
  const d = await api("/api/recommend", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: desc, year: parseInt($("#recYear").value) }),
  });
  if (d.error) { $("#recArea").innerHTML = `<div class="error-box">${d.error}</div>`; return; }
  if (!d.results.length) {
    $("#recArea").innerHTML = `<div class="error-box">No players matched that profile in ${d.year}. Try loosening the description or another season.</div>`;
    return;
  }
  $("#recArea").innerHTML = `
    <div class="rec-head">
      ${d.profiles.map((p) => `<span class="profile-tag">${p}</span>`).join("")}
      <span class="examples-label" style="margin-left:6px">Season ${d.year} · ranked by fit &amp; value</span>
    </div>
    ${rankList(d.results, "rec")}`;
  bindRankClicks("#recArea");
}

function rankList(results, prefix) {
  return `<div class="rank-list">` + results.map((r, i) => `
    <div class="rank-item" data-pid="${r.playerID}" data-year="${r.year}">
      <div class="rank-num">${i + 1}</div>
      <div><div class="nm">${r.name}</div><div class="sub"><span>${r.team} · Age ${r.age}</span> · <span title="${STAT_INFO.OPS}">OPS ${r.stats.OPS.toFixed(3)}</span> · <span title="${STAT_INFO.HR}">${r.stats.HR} HR</span> · <span title="${STAT_INFO.SB}">${r.stats.SB} SB</span></div></div>
      <div class="mono hide-sm">Value ${fmtM(r.predicted_salary)}</div>
      <div class="mono hide-sm">Paid ${fmtM(r.actual_salary)}</div>
      <div class="mini-verdict ${verdictClass(r.verdict)}" title="${VERDICT_INFO[r.verdict] ?? ""}">${r.verdict}</div>
    </div>`).join("") + `</div>`;
}

function bindRankClicks(scope) {
  document.querySelectorAll(scope + " .rank-item").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelector('.tab[data-tab="scout"]').click();
      loadPlayer(el.dataset.pid, el.dataset.year);
    }));
}

// ---------- Team ----------
$("#teamYear")?.addEventListener("change", loadTeams);
$("#teamBtn").addEventListener("click", doTeam);

async function loadTeams() {
  const y = $("#teamYear").value || undefined;
  const d = await api("/api/teams" + (y ? "?year=" + y : ""));
  $("#teamSelect").innerHTML = d.teams.map((t) =>
    `<option value="${t.teamID}">${t.teamName ?? t.teamID}</option>`).join("");
}

async function doTeam() {
  const y = parseInt($("#teamYear").value);
  const t = $("#teamSelect").value;
  $("#teamArea").innerHTML = `<div class="loading">Analyzing roster vs league…</div>`;
  const d = await api(`/api/team/${t}?year=${y}`);
  if (d.error) { $("#teamArea").innerHTML = `<div class="error-box">${d.error}</div>`; return; }
  const surplus = d.predicted_value - d.payroll;
  $("#teamArea").innerHTML = `
    <div class="team-summary">
      <div class="sum-card"><div class="k">${d.year} ${d.teamName} payroll (hitters)</div><div class="v">${fmtM(d.payroll)}</div></div>
      <div class="sum-card"><div class="k">Predicted roster value</div><div class="v">${fmtM(d.predicted_value)}</div></div>
      <div class="sum-card"><div class="k">${surplus >= 0 ? "Surplus value" : "Overpay"}</div><div class="v ${surplus >= 0 ? "pos" : "neg"}">${surplus >= 0 ? "+" : "−"}${fmtM(Math.abs(surplus))}</div></div>
    </div>
    <div class="section-title">Offense vs League Average</div>
    <div class="break-grid">
      ${d.breakdown.map((b) => {
        const w = Math.min(Math.abs(b.pct_vs_league), 30) / 30 * 50;
        return `<div class="break-row">
          <div class="cat" title="${STAT_INFO[b.stat] ?? ""}">${b.category} <span class="st">${b.stat}</span></div>
          <div class="diverge"><div class="mid"></div><div class="df ${b.pct_vs_league >= 0 ? "up" : "down"}" style="width:${w}%"></div></div>
          <div class="pct ${b.pct_vs_league >= 0 ? "pos" : "neg"}">${b.pct_vs_league >= 0 ? "+" : ""}${b.pct_vs_league}%</div>
        </div>`;
      }).join("")}
    </div>
    <div class="target-callout">
      ${d.gaps.length
        ? `Biggest gap: <b>${d.gaps[0].category}</b> (${d.gaps[0].pct_vs_league}% vs league). Recommended target profile: <b>${d.target_profile}</b>.`
        : `No major offensive gaps vs league average. Recommended: pursue <b>${d.target_profile}</b> to add depth efficiently.`}
    </div>
    <div class="section-title">Recommended Targets (${d.year} league-wide)</div>
    ${rankList(d.targets, "tgt")}
    <div class="section-title">Roster Value Board</div>
    ${rankList(d.roster, "ros")}`;
  bindRankClicks("#teamArea");
}

// ---------- Best Value Finder ----------
$("#valBtn").addEventListener("click", doBestValue);

async function doBestValue() {
  const y = $("#valYear").value;
  const limit = $("#valLimit").value;
  $("#valArea").innerHTML = `<div class="loading">Scanning the league for bargains…</div>`;
  const d = await api(`/api/best-value?limit=${limit}` + (y ? `&year=${y}` : ""));
  if (d.error) { $("#valArea").innerHTML = `<div class="error-box">${d.error}</div>`; return; }
  if (!d.results.length) {
    $("#valArea").innerHTML = `<div class="error-box">No qualifying players found.</div>`;
    return;
  }
  $("#valArea").innerHTML = `
    <div class="rec-head">
      <span class="profile-tag">Most undervalued ${y ? "in " + y : "across all seasons"}</span>
      <span class="examples-label" style="margin-left:6px">Ranked by surplus value — predicted market value minus actual pay</span>
    </div>
    <div class="rank-list">` + d.results.map((r, i) => `
      <div class="rank-item" data-pid="${r.playerID}" data-year="${r.year}">
        <div class="rank-num">${i + 1}</div>
        <div><div class="nm">${r.name}</div><div class="sub"><span>${r.year} · ${r.team}</span> · <span title="${STAT_INFO.OPS}">OPS ${r.stats.OPS.toFixed(3)}</span> · <span title="${STAT_INFO.HR}">${r.stats.HR} HR</span></div></div>
        <div class="mono hide-sm">Value ${fmtM(r.predicted_salary)} · Paid ${fmtM(r.actual_salary)}</div>
        <div class="mono surplus-badge ${r.surplus >= 0 ? "" : "neg"}" title="Predicted market value minus actual salary — how much extra performance the club got for free">${r.surplus >= 0 ? "+" : "−"}${fmtM(Math.abs(r.surplus))}</div>
        <div class="mini-verdict ${verdictClass(r.verdict)}" title="${VERDICT_INFO[r.verdict] ?? ""}">${r.verdict}</div>
      </div>`).join("") + `</div>`;
  bindRankClicks("#valArea");
}

// ---------- Player History ----------
$("#histBtn").addEventListener("click", doHistorySearch);
$("#histInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doHistorySearch(); });

async function doHistorySearch() {
  const q = $("#histInput").value.trim();
  if (!q) return;
  $("#histResults").innerHTML = `<div class="loading">Searching…</div>`;
  $("#histArea").innerHTML = "";
  const res = await api("/api/search?q=" + encodeURIComponent(q));
  const box = $("#histResults");
  if (res.matches.length === 1) { box.innerHTML = ""; loadHistory(res.matches[0].playerID); return; }
  if (res.matches.length > 0) {
    box.innerHTML = `<div class="match-list">` + res.matches.map((m) =>
      `<div class="match-item" data-pid="${m.playerID}">
        <div><b>${m.name}</b><div class="sub">${m.latest_team ?? ""}</div></div>
        <div class="sub">${m.seasons.length} season${m.seasons.length > 1 ? "s" : ""} · ${Math.min(...m.seasons)}–${Math.max(...m.seasons)}</div>
      </div>`).join("") + `</div>`;
    box.querySelectorAll(".match-item").forEach((el) =>
      el.addEventListener("click", () => { box.innerHTML = ""; loadHistory(el.dataset.pid); }));
    return;
  }
  if (res.suggestions.length > 0) {
    box.innerHTML = `<div class="suggestions"><p>No exact match. Did you mean:</p>` +
      res.suggestions.map((s) => `<button class="chip sugg">${s}</button>`).join(" ") + `</div>`;
    box.querySelectorAll(".sugg").forEach((el) =>
      el.addEventListener("click", () => { $("#histInput").value = el.textContent; doHistorySearch(); }));
    return;
  }
  box.innerHTML = `<div class="error-box">No players found matching "${esc(q)}".</div>`;
}

async function loadHistory(pid) {
  $("#histArea").innerHTML = `<div class="loading">Building value history…</div>`;
  const d = await api("/api/player/" + pid);
  if (d.error) { $("#histArea").innerHTML = `<div class="error-box">${d.error}</div>`; return; }
  const r = d.report;
  const career = d.career;
  const maxSal = Math.max(...career.flatMap((c) => [c.salary, c.predicted]), 1);
  const first = career[0], last = career[career.length - 1];
  const trend = career.length < 2 ? "Only one salary-era season on record."
    : last.predicted > first.predicted * 1.25 ? "Trend: predicted value has climbed over their career."
    : last.predicted < first.predicted * 0.8 ? "Trend: predicted value has declined from its earlier peak."
    : "Trend: predicted value has stayed fairly consistent.";
  $("#histArea").innerHTML = `
  <div class="report-card">
    <div class="report-top">
      <div>
        <h3>${r.name}</h3>
        <div class="meta">${career.length} salary-era season${career.length > 1 ? "s" : ""} · ${first.year}–${last.year}</div>
      </div>
      <div class="verdict-wrap">
        <div class="verdict ${verdictClass(r.verdict)}">${r.verdict}</div>
        <div class="verdict-note">Latest season (${r.year}): ${VERDICT_INFO[r.verdict] ?? ""}</div>
      </div>
    </div>
    <div class="career-chart" style="padding-top:20px">
      <h4>Predicted Value vs Actual Salary by Season</h4>
      <div class="spark">
        ${career.map((c) => `
          <div class="col">
            <div class="tip">${c.year} ${c.team}<br>Pred ${fmtM(c.predicted)} · Paid ${fmtM(c.salary)}<br>${c.verdict}</div>
            <div class="bp" style="height:${(c.predicted / maxSal) * 100}px"></div>
            <div class="ba" style="height:${(c.salary / maxSal) * 100}px"></div>
          </div>`).join("")}
      </div>
      <div class="spark-years">${career.map((c) => `<span>${String(c.year).slice(2)}</span>`).join("")}</div>
      <div class="spark-legend">
        <span><span class="dot gold"></span>Predicted value</span>
        <span><span class="dot blue"></span>Actual salary</span>
      </div>
      <div class="surplus-line" style="margin-top:14px">${trend}</div>
      <h4 style="margin-top:22px">Season-by-Season Breakdown</h4>
      <div class="hist-table">
        <div class="hist-row hist-head">
          <span>Year</span><span>Team</span><span title="${STAT_INFO.OPS}">OPS</span>
          <span>Predicted</span><span>Paid</span><span>Verdict</span>
        </div>
        ${career.map((c) => `
        <div class="hist-row" data-y="${c.year}">
          <span class="mono">${c.year}</span>
          <span>${c.team}</span>
          <span class="mono">${c.OPS.toFixed(3)}</span>
          <span class="mono">${fmtM(c.predicted)}</span>
          <span class="mono">${fmtM(c.salary)}</span>
          <span class="mini-verdict ${verdictClass(c.verdict)}" title="${VERDICT_INFO[c.verdict] ?? ""}">${c.verdict}</span>
        </div>`).join("")}
      </div>
      <div class="stat-hint" style="margin-top:10px">Click any season row to open its full scouting report.</div>
    </div>
  </div>`;
  $("#histArea").querySelectorAll(".hist-row[data-y]").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelector('.tab[data-tab="scout"]').click();
      loadPlayer(pid, el.dataset.y);
    }));
}

init();
