/**
 * The console page. One self-contained document: no build step, no bundler, no
 * third-party script. It fetches `/api/state` and renders it.
 */
export function renderConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CivicOS console</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbf9; --fg: #16150f; --muted: #6c6a5c; --line: #e2e0d5;
    --card: #ffffff; --allow: #1f7a4d; --deny: #a32b28; --escalate: #9a6510;
    --accent: #2b4c7e;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#12120f; --fg:#eeece2; --muted:#9a978a; --line:#2c2b25;
            --card:#1a1a16; --allow:#5cc38d; --deny:#e2726d; --escalate:#e0aa4e; --accent:#8fb0e0; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header { padding:28px 32px 16px; border-bottom:1px solid var(--line); }
  h1 { margin:0; font-size:20px; letter-spacing:-0.01em; }
  .sub { color:var(--muted); font-size:13px; margin-top:4px; }
  main { padding:24px 32px 64px; max-width:1180px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin-bottom:28px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .stat b { display:block; font-size:26px; font-weight:600; letter-spacing:-0.02em; }
  .stat span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.05em; }
  section { margin-bottom:32px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin:0 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; background:var(--card);
          border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; }
  tr:last-child td { border-bottom:none; }
  code { font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12px; }
  .allow { color:var(--allow); } .deny { color:var(--deny); } .escalate { color:var(--escalate); }
  .chain { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; font-size:13px; }
  .ok { color:var(--allow); font-weight:600; } .bad { color:var(--deny); font-weight:600; }
  .wrap { overflow-x:auto; }
</style>
</head>
<body>
<header>
  <h1>CivicOS console</h1>
  <div class="sub">Read-only view of the audit ledger, the approval queue and the rules in force.</div>
</header>
<main id="app">Loading…</main>
<script>
const effectClass = (e) => e === 'allow' ? 'allow' : e === 'deny' ? 'deny' : 'escalate';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function rows(items, cells) {
  return items.map((item) => '<tr>' + cells(item).map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('');
}

fetch('/api/state').then((r) => r.json()).then((state) => {
  const t = state.summary.totals;
  const integrity = state.summary.integrity;
  document.getElementById('app').innerHTML = [
    '<div class="grid">',
    stat(t.syscalls, 'mediated actions'),
    stat(t.byEffect.allow, 'allowed'),
    stat(t.byEffect.deny, 'denied'),
    stat(t.byEffect.require_approval, 'escalated'),
    stat(t.redactions, 'values redacted'),
    stat(t.runs, 'runs'),
    '</div>',
    '<section><h2>Ledger integrity</h2><div class="chain">',
    integrity.ok
      ? '<span class="ok">Chain intact</span> across ' + integrity.length + ' records.'
      : '<span class="bad">Chain broken</span> — ' + esc(integrity.reason),
    '<br><code>head ' + esc(integrity.headHash) + '</code></div></section>',
    section('Approval queue', ['id','status','role','votes','request'],
      rows(state.approvals, (a) => [
        '<code>' + esc(a.id) + '</code>', esc(a.status), esc(a.requiredRole),
        a.votes.length + '/' + a.quorum, esc(a.summary),
      ]) || '<tr><td colspan="5">Nothing awaiting review.</td></tr>'),
    section('Recent ledger records', ['seq','time','actor','event','kind','effect','resource'],
      rows(state.records.slice(-60).reverse(), (r) => [
        r.seq, esc((r.ts||'').slice(11,19)), esc(r.actor), esc(r.event), esc(r.kind || ''),
        '<span class="' + effectClass(r.decision && r.decision.effect) + '">' +
          esc((r.decision && r.decision.effect) || r.outcome || '') + '</span>',
        '<code>' + esc(r.resource || '') + '</code>',
      ])),
    section('Rules in force', ['pack','rule','effect','controls','description'],
      rows(state.packs, (p) => [
        esc(p.pack), '<code>' + esc(p.rule) + '</code>',
        '<span class="' + effectClass(p.effect) + '">' + esc(p.effect) + '</span>',
        '<code>' + esc(p.controls.join(', ')) + '</code>', esc(p.description),
      ])),
  ].join('');
});

function stat(value, label) {
  return '<div class="stat"><b>' + value + '</b><span>' + label + '</span></div>';
}
function section(title, headers, body) {
  return '<section><h2>' + title + '</h2><div class="wrap"><table><thead><tr>' +
    headers.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
}
</script>
</body>
</html>`;
}
