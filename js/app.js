/* Systematic Analyst Tool (SAT) UI. Plain DOM, no dependencies; all user text is inserted as text, never as HTML. */
(function () {
  'use strict';

  const S = window.SAT;
  const STORE_KEY = 'sat:project';
  const LEGACY_STORE_KEY = 'cti-analyst:project';   // pre-rename key: still read so saved projects survive
  const MAX_IMPORT = 5 * 1024 * 1024;

  const ui = { achRows: 'entry', achCols: 'entry', indSort: false, mhgAll: false };
  let state = loadStored();

  // -------------------------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------------------------
  const SVG_TAGS = new Set(['svg', 'rect', 'circle', 'text', 'line', 'g', 'path', 'title', 'polygon']);

  function h(tag, props, ...kids) {
    const el = SVG_TAGS.has(tag)
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') value = v;
      else if (k === 'checked') el.checked = Boolean(v);
      else if (k === 'style') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    if (value !== undefined) el.value = value; // after <option>s exist
    return el;
  }

  const $ = (sel) => document.querySelector(sel);

  /** Text field bound to obj[key]. Typing saves but does not re-render, so focus is kept. */
  function field(obj, key, opts = {}) {
    const tag = opts.multi ? 'textarea' : 'input';
    return h(tag, {
      type: opts.multi ? null : opts.type || 'text',
      value: obj[key] ?? '',
      placeholder: opts.placeholder,
      rows: opts.multi ? opts.rows || 2 : null,
      'aria-label': opts.label || opts.placeholder,
      class: opts.cls,
      oninput: (ev) => {
        obj[key] = ev.target.value;
        save();
        if (opts.onInput) opts.onInput(ev.target.value, ev.target);
      },
    });
  }

  /** Select bound to obj[key]. Changing it re-renders, so derived scores update. */
  function choice(obj, key, options, opts = {}) {
    const list = Array.isArray(options) ? options : Object.entries(options);
    return h('select', {
      value: obj[key] == null ? '' : String(obj[key]),
      class: opts.cls,
      'aria-label': opts.label,
      title: opts.title,
      onchange: (ev) => {
        const v = ev.target.value;
        obj[key] = opts.number ? Number(v) || 0 : v;
        save();
        rerender();
      },
    },
    opts.blank !== undefined ? h('option', { value: '' }, opts.blank) : null,
    list.map(([v, label]) => h('option', { value: String(v) }, label)));
  }

  function labelled(label, control, hint) {
    return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
  }

  function removeBtn(onClick, what) {
    return h('button', { type: 'button', class: 'ghost small', title: `Remove ${what}`, 'aria-label': `Remove ${what}`, onclick: onClick }, '✕');
  }

  function badge(text, cls) {
    return h('span', { class: `badge ${cls || ''}` }, text);
  }

  function method(title, steps, extra) {
    return h('details', { class: 'method' },
      h('summary', {}, title),
      h('ol', {}, steps.map((s) => h('li', {}, s))),
      extra || null);
  }

  function notes(items) {
    if (!items.length) return null;
    return h('ul', { class: 'notes' }, items.map((i) => h('li', { class: i.cls || '' }, i.text)));
  }

  function bar(label, value, max, cls, right) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return h('div', { class: 'bar-row' },
      h('span', {}, label),
      h('div', { class: 'bar-track' }, h('div', { class: `bar-fill ${cls || ''}`, style: { width: `${pct}%` } })),
      h('span', { class: 'mono small' }, right ?? String(value)));
  }

  const hLabel = (i) => `H${i + 1}`;
  const eLabel = (i) => `E${i + 1}`;
  const levelOpts = [['H', 'High'], ['M', 'Medium'], ['L', 'Low']];
  const scale5 = [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']];

  // -------------------------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------------------------
  function loadStored() {
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY);
      if (raw) return S.normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('Could not read the saved project', err);
    }
    return S.emptyState();
  }

  let saveTimer = null;
  function save() {
    state.meta.updated = new Date().toISOString();
    clearTimeout(saveTimer);
    $('#save-state').textContent = 'Saving…';
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        $('#save-state').textContent = 'Saved in this browser';
      } catch (err) {
        $('#save-state').textContent = 'Not saved (storage unavailable)';
      }
    }, 300);
    updateTopbar();
  }

  function replaceState(next) {
    state = S.normalize(next);
    save();
    renderNav();
    go('overview');
  }

  function slug(text) {
    return (text || 'analysis').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'analysis';
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // -------------------------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------------------------
  const SECTIONS = [
    { group: 'Project' },
    { id: 'overview', label: 'Overview', render: renderOverview },
    { group: 'Explore' },
    { id: 'starburst', label: 'Starbursting', render: renderStarburst, count: () => S.starburstSummary(state.starburst).total },
    { id: 'timeline', label: 'Chronology & timeline', render: renderTimeline, count: () => state.timeline.length },
    { group: 'Diagnostic' },
    { id: 'assumptions', label: 'Key Assumptions Check', render: renderAssumptions, count: () => state.assumptions.length },
    { id: 'evidence', label: 'Quality of Information', render: renderEvidence, count: () => state.evidence.length },
    { id: 'ach', label: 'Competing Hypotheses', render: renderACH, count: () => state.hypotheses.length },
    { id: 'deception', label: 'Deception Detection', render: renderDeception },
    { group: 'Foresight' },
    { id: 'drivers', label: 'Key drivers', render: renderDrivers, count: () => state.drivers.length },
    { id: 'scenarios', label: 'Multiple scenarios', render: renderScenarios, count: () => S.scenarioList(state.scenarios, state.drivers, state.scenarioDrivers).length },
    { id: 'indicators', label: 'Indicators', render: renderIndicators, count: () => state.indicators.length },
    { group: 'Challenge' },
    { id: 'challenge', label: 'Contrarian techniques', render: renderChallenge },
    { group: 'Decision support' },
    { id: 'decision', label: 'Decision support', render: renderDecision },
    { group: 'Output' },
    { id: 'uncertainties', label: 'Key uncertainties', render: renderUncertainties, count: () => S.keyUncertainties(state).length },
    { id: 'judgments', label: 'Key judgments', render: renderJudgments, count: () => state.judgments.length },
    { id: 'report', label: 'Report', render: renderReport },
  ];
  const byId = Object.fromEntries(SECTIONS.filter((s) => s.id).map((s) => [s.id, s]));

  function current() {
    const id = decodeURIComponent(location.hash.slice(1));
    return byId[id] ? id : 'overview';
  }

  function go(id) {
    if (location.hash.slice(1) === id) rerender();
    else location.hash = id;
  }

  function renderNav() {
    const nav = $('#nav');
    const cur = current();
    nav.replaceChildren(...SECTIONS.map((s) => {
      if (s.group) return h('div', { class: 'group' }, s.group);
      const n = s.count ? s.count() : null;
      return h('button', {
        type: 'button', 'aria-current': s.id === cur ? 'page' : null,
        onclick: () => go(s.id),
      }, h('span', {}, s.label), n ? h('span', { class: 'count' }, n) : null);
    }));
  }

  function updateTopbar() {
    $('#project-title').textContent = state.meta.title || 'Untitled analysis';
    const tlp = $('#tlp-badge');
    tlp.textContent = state.meta.tlp;
    tlp.dataset.tlp = state.meta.tlp;
    document.title = `${state.meta.title ? `${state.meta.title} · ` : ''}Systematic Analyst Tool (SAT)`;
  }

  function rerender() {
    const main = $('#main');
    const y = window.scrollY;
    const section = byId[current()];
    main.replaceChildren(section.render());
    renderNav();
    updateTopbar();
    window.scrollTo(0, y);
  }

  window.addEventListener('hashchange', () => {
    rerender();
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
  });

  // -------------------------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------------------------
  function isEmpty() {
    return !state.meta.title && !state.assumptions.length && !state.evidence.length &&
      !state.hypotheses.length && !state.drivers.length;
  }

  function renderOverview() {
    const m = state.meta;
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'section-head' },
      h('div', {}, h('h1', {}, 'Overview'),
        h('p', { class: 'lede' }, 'Frame the intelligence question, then work through the techniques. Everything is stored only in this browser until you save the project as a file.'))));

    if (isEmpty()) {
      wrap.append(h('div', { class: 'card accent' },
        h('h2', {}, 'Start here'),
        h('p', {}, 'Load the worked example (a fictional attack on a water utility\'s control system) to see every technique filled in, or start with an empty project.'),
        h('div', { class: 'toolbar' },
          h('button', { type: 'button', class: 'primary', onclick: () => replaceState(window.EXAMPLE) }, 'Load the worked example'),
          h('button', { type: 'button', onclick: () => { $('#main').querySelector('input')?.focus(); } }, 'Start empty'))));
    }

    const frame = h('div', { class: 'card' },
      h('h2', {}, 'The question'),
      labelled('Title', field(m, 'title', { placeholder: 'e.g. Attribution of the March intrusion', onInput: updateTopbar })),
      labelled('Focal question', field(m, 'question', { multi: true, placeholder: 'One sentence. What does the customer need to know?' }),
        'A good focal question is specific, answerable and open: it does not assume the answer.'),
      labelled('Current analytic line', field(m, 'analyticLine', { multi: true, placeholder: 'What do we (or the customer, or the media) currently believe?' }),
        'Write down the prevailing view so the Key Assumptions Check and Devil\'s Advocacy have something to challenge.'),
      h('div', { class: 'grid three' },
        labelled('Time horizon', field(m, 'horizon', { placeholder: 'e.g. next 12 months' })),
        labelled('Analyst / team', field(m, 'analyst', { placeholder: 'optional' })),
        labelled('Traffic Light Protocol', choice(m, 'tlp', S.TLP.map((t) => [t, t])))));
    wrap.append(frame);

    const startFilled = S.GETTING_STARTED.filter(([k]) => state.start[k]).length;
    wrap.append(h('details', { class: 'card', open: startFilled < S.GETTING_STARTED.length ? true : null },
      h('summary', {}, h('strong', {}, 'Getting Started Checklist'), h('span', { class: 'small muted' }, ` ${startFilled}/${S.GETTING_STARTED.length} answered`)),
      h('p', { class: 'small muted' }, 'Get the fundamentals right before choosing techniques, so you don\'t have to change course later.'),
      S.GETTING_STARTED.map(([k, q, hint]) => labelled(q, field(state.start, k, { multi: true }), hint))));

    // Dashboard
    const stats = h('div', { class: 'grid three' });
    if (state.hypotheses.length && state.evidence.length) {
      const sum = S.achSummary(state.hypotheses, state.evidence, state.ratings);
      const conf = S.analyticConfidence(state);
      const lead = sum.leaders.map((id) => {
        const i = state.hypotheses.findIndex((x) => x.id === id);
        return `${hLabel(i)}: ${state.hypotheses[i].text}`;
      });
      stats.append(h('div', { class: 'card accent' },
        h('div', { class: 'stat-label' }, 'Least inconsistent hypothesis'),
        h('p', { class: 'stat lead' }, lead.length === 1 ? lead[0] : lead.length ? 'Tie' : 'Not rated'),
        lead.length > 1 ? h('p', { class: 'small' }, lead.join(' · ')) : null,
        h('p', {}, 'Analytic confidence: ', badge(conf.level, conf.level === 'High' ? 'good' : conf.level === 'Low' ? 'bad' : 'warn'))));
    }
    const ku = S.keyUncertainties(state);
    stats.append(h('div', { class: 'card sand' },
      h('div', { class: 'stat-label' }, 'Key uncertainties'),
      h('p', { class: 'stat' }, String(ku.length)),
      h('p', { class: 'small muted' }, `${ku.filter((k) => k.impact === 'H').length} high priority`)));
    const scen = S.scenarioList(state.scenarios, state.drivers, state.scenarioDrivers);
    stats.append(h('div', { class: 'card lav' },
      h('div', { class: 'stat-label' }, 'Scenarios'),
      h('p', { class: 'stat' }, String(scen.length)),
      h('p', { class: 'small muted' }, `${scen.filter((x) => x.selected).length} selected, ${scen.filter((x) => x.wildcard).length} wild card(s)`)));
    const dec = S.deceptionAssessment(state.deception.answers);
    stats.append(h('div', { class: 'card' },
      h('div', { class: 'stat-label' }, 'Deception concern'),
      h('p', { class: 'stat' }, dec.level),
      h('p', { class: 'small muted' }, `${dec.answered} of ${dec.total} questions answered`)));
    wrap.append(h('h2', {}, 'Where the analysis stands'), stats);

    // Workflow, after the Primer's "timeline for using analytic techniques"
    const steps = [
      ['Starting out', 'starburst', 'Starburst the question: who, what, how, when, where, why', S.starburstSummary(state.starburst).total >= 6],
      ['Starting out', 'timeline', 'Build the chronology', state.timeline.length >= 3],
      ['Starting out', 'assumptions', 'List and challenge key assumptions', state.assumptions.some((a) => a.rating)],
      ['Starting out', 'drivers', 'Outside-in: identify key drivers and uncertainties', state.drivers.length >= 3],
      ['Testing hypotheses', 'evidence', 'Grade the information base', state.evidence.length > 0 && state.evidence.every((e) => e.source)],
      ['Testing hypotheses', 'ach', 'Analysis of Competing Hypotheses', state.hypotheses.length >= 3 && Object.keys(state.ratings).length > 0],
      ['Testing hypotheses', 'deception', 'Check for deception', dec.answered >= dec.total * 0.3],
      ['Looking ahead', 'scenarios', 'Generate multiple scenarios', scen.some((x) => x.selected)],
      ['Looking ahead', 'indicators', 'Indicators and Indicators Validator', state.indicators.length > 0],
      ['Final check', 'challenge', 'Devil\'s Advocacy / Premortem / Self-Critique', Boolean(state.challenge.devil.case || state.challenge.premortem.causes || Object.keys(state.selfCritique).length)],
      ['Final check', 'judgments', 'Write key judgments in estimative language', state.judgments.some((j) => j.text && j.likelihood && j.confidence)],
      ['Final check', 'report', 'Write it up', false],
    ];
    wrap.append(h('div', { class: 'card' },
      h('h2', {}, 'Suggested workflow'),
      h('p', { class: 'small muted' }, 'Based on the Tradecraft Primer\'s timeline for using analytic techniques during a project.'),
      h('ol', { class: 'steps' }, steps.map(([phase, id, text, done], i) => h('li', { class: done ? 'done' : '' },
        h('span', { class: 'dot' }, done ? '✓' : String(i + 1)),
        h('button', { type: 'button', class: 'ghost', onclick: () => go(id) }, text),
        h('span', { class: 'small muted' }, phase))))));
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Key Assumptions Check
  // -------------------------------------------------------------------------------------------
  function renderAssumptions() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Key Assumptions Check'),
      h('p', { class: 'lede' }, 'List the premises the analytic line depends on, stated or not, and challenge each one. The goal is not to drop assumptions but to make them explicit and know what would make you rethink them.'),
      method('How to do it', [
        'Write down the current analytic line (Overview).',
        'List every premise that must be true for that line to hold. Ask who, what, how, when, where and why.',
        'Challenge each one: why must it be true, and does it hold under all conditions?',
        'Rate each: basically supported, correct with caveats, or unsupported. Unsupported ones are your key uncertainties.',
        'Turn key uncertainties into collection requirements or research tasks.',
      ], h('div', {}, h('p', { class: 'small' }, h('strong', {}, 'Questions to ask: ')), h('ul', {}, S.KAC_QUESTIONS.map((q) => h('li', { class: 'small' }, q))))));

    if (state.meta.analyticLine) {
      wrap.append(h('div', { class: 'card sand' }, h('div', { class: 'stat-label' }, 'Analytic line under review'), h('p', {}, state.meta.analyticLine)));
    }

    const rows = state.assumptions.map((a, i) => {
      const tell = h('small', { class: 'muted' });
      const setTell = (v) => { tell.textContent = S.ASSUMPTION_TELLS.test(v || '') ? 'Wording like "always", "must" or "based on" often hides an unchallenged assumption.' : ''; };
      setTell(a.text);
      return h('tr', {},
        h('td', { class: 'mono' }, `A${i + 1}`),
        h('td', {}, field(a, 'text', { multi: true, placeholder: 'Assumption', onInput: setTell }), tell),
        h('td', {}, field(a, 'commentary', { multi: true, placeholder: 'Why do we believe it? When might it not hold?' })),
        h('td', {}, choice(a, 'rating', S.ASSUMPTION_RATINGS, { blank: 'Rate…', label: 'Assessment' }),
          h('div', {}, a.rating ? badge(a.rating === 'solid' ? 'Solid' : a.rating === 'caveat' ? 'Caveat' : 'Key uncertainty', a.rating === 'solid' ? 'good' : a.rating === 'caveat' ? 'warn' : 'bad') : null)),
        h('td', {}, choice(a, 'impact', levelOpts, { blank: '…', label: 'Impact if wrong' })),
        h('td', {}, field(a, 'whatWouldChange', { multi: true, placeholder: 'What information would make us drop it?' })),
        h('td', {}, removeBtn(() => { state.assumptions.splice(i, 1); save(); rerender(); }, 'assumption')));
    });

    wrap.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Key assumption', 'Commentary', 'Assessment', 'Impact if wrong', 'What would change it', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'No assumptions yet.'))))));
    wrap.append(h('div', { class: 'toolbar' }, h('button', {
      type: 'button', class: 'primary',
      onclick: () => { state.assumptions.push({ id: S.uid('a'), text: '', commentary: '', rating: '', impact: 'M', whatWouldChange: '' }); save(); rerender(); },
    }, '+ Add assumption')));

    const sum = S.assumptionSummary(state.assumptions);
    if (sum.total) {
      wrap.append(h('div', { class: 'card' }, h('h2', {}, 'Result'),
        h('div', { class: 'bars' },
          bar('Basically supported', sum.counts.solid, sum.total),
          bar('With caveats', sum.counts.caveat, sum.total, 'sand'),
          bar('Unsupported', sum.counts.unsupported, sum.total, 'bad'),
          sum.counts.unrated ? bar('Not rated yet', sum.counts.unrated, sum.total) : null),
        sum.risky.length ? h('p', {}, h('strong', {}, `${sum.risky.length} assumption(s) put the analysis at risk`), ' (unsupported, or high impact with caveats). They are carried over to Key uncertainties.') : null));
    }
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Quality of Information Check
  // -------------------------------------------------------------------------------------------
  function newEvidence(text = '') {
    return { id: S.uid('e'), text, source: '', type: 'OSINT', date: '', reliability: '', infoCredibility: '', credibility: 'M', relevance: 'M', corroborated: false };
  }

  function renderEvidence() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Quality of Information Check'),
      h('p', { class: 'lede' }, 'Everything that bears on the question: reporting, telemetry, forensics, arguments and notable absences of evidence. Grade each item, because confidence in a judgment can only be as good as the information behind it.'),
      method('How to do it', [
        'Record each item with its source, type and date.',
        'Grade source reliability (A-F) and information credibility (1-6) with the Admiralty code.',
        'Set credibility and relevance (High/Medium/Low). These weigh the item in the ACH matrix.',
        'Check whether critical items are corroborated by an independent source, and look again at information you dismissed earlier.',
        'Flag recalled or withdrawn reporting and check whether a judgment depended on it.',
      ]));

    const rows = state.evidence.map((e, i) => h('tr', {},
      h('td', { class: 'mono' }, eLabel(i)),
      h('td', {}, field(e, 'text', { multi: true, placeholder: 'What was observed or reported' })),
      h('td', {}, field(e, 'source', { placeholder: 'Source' })),
      h('td', {}, choice(e, 'type', S.EVIDENCE_TYPES.map((t) => [t, t]), { label: 'Type' })),
      h('td', {}, field(e, 'date', { type: 'date', label: 'Date' })),
      h('td', {}, h('div', { class: 'toolbar' },
        choice(e, 'reliability', Object.entries(S.RELIABILITY).map(([k, v]) => [k, `${k}: ${v}`]), { blank: '-', label: 'Source reliability', title: 'Source reliability' }),
        choice(e, 'infoCredibility', Object.entries(S.INFO_CREDIBILITY).map(([k, v]) => [k, `${k}: ${v}`]), { blank: '-', label: 'Information credibility', title: 'Information credibility' }))),
      h('td', {}, choice(e, 'credibility', levelOpts, { label: 'Credibility' })),
      h('td', {}, choice(e, 'relevance', levelOpts, { label: 'Relevance' })),
      h('td', { class: 'num' }, h('input', {
        type: 'checkbox', checked: e.corroborated, 'aria-label': 'Corroborated',
        onchange: (ev) => { e.corroborated = ev.target.checked; save(); rerender(); },
      })),
      h('td', { class: 'num mono' }, String(S.evidenceWeight(e))),
      h('td', {}, removeBtn(() => removeEvidence(e.id), 'evidence'))));

    wrap.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Evidence', 'Source', 'Type', 'Date', 'Admiralty grade', 'Credibility', 'Relevance', 'Corrob.', 'ACH weight', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 11, class: 'muted' }, 'No evidence yet.'))))));
    wrap.append(h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'primary', onclick: () => { state.evidence.push(newEvidence()); save(); rerender(); } }, '+ Add evidence'),
      h('span', { class: 'small muted' }, 'ACH weight = credibility × relevance (High 1.5, Medium 1, Low 0.5).')));

    const issues = S.qualityChecks(state.evidence, state.ratings, state.hypotheses);
    wrap.append(h('div', { class: 'card' }, h('h2', {}, 'Checks'),
      issues.length ? notes(issues.map((x) => ({ text: x.text, cls: x.level === 'warn' ? 'warn' : '' })))
        : h('p', { class: 'muted' }, state.evidence.length ? 'No problems found. The diagnostic checks use the ACH ratings, so rate the matrix first.' : 'Add evidence to run the checks.')));
    return wrap;
  }

  function removeEvidence(id) {
    state.evidence = state.evidence.filter((x) => x.id !== id);
    delete state.ratings[id];
    save();
    rerender();
  }

  // -------------------------------------------------------------------------------------------
  // Analysis of Competing Hypotheses
  // -------------------------------------------------------------------------------------------
  function renderACH() {
    const wrap = h('div', {});
    const hyps = state.hypotheses;
    const ev = state.evidence;
    wrap.append(h('h1', {}, 'Analysis of Competing Hypotheses'),
      h('p', { class: 'lede' }, 'Array all the evidence against all the hypotheses at once and try to disprove them instead of proving one. The hypothesis with the least inconsistent evidence is tentatively the most likely.'),
      method('How to do it', [
        'Brainstorm all reasonable hypotheses, ideally mutually exclusive. Include a deception or false-flag hypothesis where it fits.',
        'List all significant evidence and arguments, including absences of evidence (Quality of Information).',
        'Work across each row: is this item consistent, inconsistent or not applicable to each hypothesis?',
        'Refine the matrix: add, merge or split hypotheses, and drop evidence that is consistent with all of them (it has no diagnostic value).',
        'Draw tentative conclusions from the inconsistencies, not the consistencies.',
        'Check sensitivity: what if a critical item were wrong or planted?',
        'Ask what evidence you would expect to see for each hypothesis but don\'t.',
        'Report all hypotheses, including the weaker ones to keep monitoring, and set indicators.',
      ]));

    wrap.append(renderMHG());

    // Hypotheses editor
    const hypRows = hyps.map((x, i) => h('tr', {},
      h('td', { class: 'mono' }, hLabel(i)),
      h('td', {}, field(x, 'text', { multi: true, placeholder: 'Hypothesis' })),
      h('td', { class: 'num' }, h('input', {
        type: 'checkbox', checked: x.deception, 'aria-label': 'Deception or false-flag hypothesis',
        onchange: (evt) => { x.deception = evt.target.checked; save(); rerender(); },
      })),
      h('td', {}, field(x, 'missing', { multi: true, placeholder: 'Evidence we would expect if this were true, but have not seen' })),
      h('td', {}, removeBtn(() => {
        state.hypotheses.splice(i, 1);
        for (const r of Object.values(state.ratings)) delete r[x.id];
        save(); rerender();
      }, 'hypothesis'))));
    wrap.append(h('h2', {}, 'Hypotheses'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['#', 'Hypothesis', 'Deception?', 'Expected but not seen', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, hypRows.length ? hypRows : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No hypotheses yet.'))))),
      h('div', { class: 'toolbar' }, h('button', {
        type: 'button', class: 'primary',
        onclick: () => { state.hypotheses.push({ id: S.uid('h'), text: '', deception: false, missing: '' }); save(); rerender(); },
      }, '+ Add hypothesis')));

    const warnings = S.achWarnings(hyps, ev, state.ratings);
    if (warnings.length) wrap.append(notes(warnings.map((t) => ({ text: t, cls: 'warn' }))));
    if (!hyps.length || !ev.length) {
      wrap.append(h('div', { class: 'empty' }, !hyps.length ? 'Add hypotheses to build the matrix.' : 'Add evidence (here or under Quality of Information) to build the matrix.'));
      if (hyps.length) wrap.append(quickAddEvidence());
      return wrap;
    }

    const sum = S.achSummary(hyps, ev, state.ratings);
    const score = Object.fromEntries(sum.ranking.map((r) => [r.id, r]));
    const critical = new Set(sum.critical.map((c) => c.evidenceId));
    const cols = hyps.map((x, i) => ({ x, i }));
    if (ui.achCols === 'rank') cols.sort((a, b) => score[a.x.id].inconsistency - score[b.x.id].inconsistency);
    const rows = ev.map((e, i) => ({ e, i }));
    if (ui.achRows === 'diag') rows.sort((a, b) => sum.diagnosticity[b.e.id].value - sum.diagnosticity[a.e.id].value);

    const ratingOpts = [['', '·'], ...Object.entries(S.ACH_RATINGS).map(([k]) => [k, k])];
    const head = h('tr', {},
      h('th', {}, 'Evidence'), h('th', { class: 'num' }, 'Weight'), h('th', { class: 'num' }, 'Diagnostic'),
      cols.map(({ x, i }) => h('th', {
        class: `hyp ${sum.leaders.includes(x.id) ? 'leader' : ''}`, title: x.text,
      }, h('span', { class: 'rank' }, `${hLabel(i)} · #${score[x.id].rank}`), S.truncate(x.text, 48) || '(unnamed)', x.deception ? h('div', {}, badge('deception', 'lav')) : null)));
    const scoreRow = h('tr', { class: 'score' },
      h('td', { colspan: 3 }, 'Weighted inconsistency (lower = more likely)'),
      cols.map(({ x }) => h('td', {}, String(score[x.id].inconsistency))));
    const body = rows.map(({ e, i }) => {
      const d = sum.diagnosticity[e.id];
      state.ratings[e.id] = state.ratings[e.id] || {};
      return h('tr', { class: critical.has(e.id) ? 'critical' : '' },
        h('td', { class: 'ev' }, h('span', { class: 'mono small' }, `${eLabel(i)} `), e.text || h('em', { class: 'muted' }, '(no text)'),
          critical.has(e.id) ? h('div', {}, badge('conclusion depends on this', 'bad')) : null,
          e.credibility === 'L' ? h('div', {}, badge('low credibility', 'warn')) : null),
        h('td', { class: 'num mono' }, String(S.evidenceWeight(e))),
        h('td', { class: 'num' }, badge(d.label, d.label === 'High' ? 'teal' : d.label === 'Medium' ? 'sand' : '')),
        cols.map(({ x }) => {
          const code = S.rating(state.ratings, e.id, x.id);
          return h('td', { class: `r r-${code || 'none'}` },
            choice(state.ratings[e.id], x.id, ratingOpts, { cls: 'rating', label: `${eLabel(i)} against ${x.text}`, title: code ? S.ACH_RATINGS[code].label : 'Not rated' }));
        }));
    });

    wrap.append(h('h2', {}, 'Matrix'),
      h('div', { class: 'toolbar' },
        h('span', { class: 'small muted' }, 'Rows:'),
        h('button', { type: 'button', class: ui.achRows === 'entry' ? 'primary small' : 'small', onclick: () => { ui.achRows = 'entry'; rerender(); } }, 'as entered'),
        h('button', { type: 'button', class: ui.achRows === 'diag' ? 'primary small' : 'small', onclick: () => { ui.achRows = 'diag'; rerender(); } }, 'most diagnostic first'),
        h('span', { class: 'small muted' }, ' Columns:'),
        h('button', { type: 'button', class: ui.achCols === 'entry' ? 'primary small' : 'small', onclick: () => { ui.achCols = 'entry'; rerender(); } }, 'as entered'),
        h('button', { type: 'button', class: ui.achCols === 'rank' ? 'primary small' : 'small', onclick: () => { ui.achCols = 'rank'; rerender(); } }, 'most likely first')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'ach' }, h('thead', {}, head), h('tbody', {}, scoreRow, body))),
      h('p', { class: 'small muted' }, 'CC very consistent · C consistent · N neutral · NA not applicable · I inconsistent (1 × weight) · II very inconsistent (2 × weight). Diagnostic = spread between the most and least consistent rating in the row.'),
      quickAddEvidence());

    // Results
    const max = Math.max(...sum.ranking.map((r) => r.inconsistency), 1);
    const name = (id) => { const i = hyps.findIndex((x) => x.id === id); return `${hLabel(i)}: ${S.truncate(hyps[i].text, 60)}`; };
    const results = h('div', { class: 'grid two' },
      h('div', { class: 'card accent' }, h('h2', {}, 'Relative likelihood'),
        h('p', { class: 'small muted' }, 'Shorter bar = fewer weighted inconsistencies.'),
        h('div', { class: 'bars' }, sum.ranking.map((r) => bar(`#${r.rank} ${name(r.id)}`, r.inconsistency, max, r.rank === 1 ? '' : 'sand', `${r.inconsistency} (${r.inconsistent} I)`))),
        sum.leaders.length > 1 ? h('p', {}, h('strong', {}, 'Tie: '), 'the evidence does not separate the leading hypotheses. Look for evidence that is inconsistent with one but not the other.') : null),
      h('div', { class: 'card sand' }, h('h2', {}, 'Sensitivity'),
        sum.critical.length
          ? [h('p', {}, 'If one of these items proved wrong, misleading or planted, a different hypothesis would lead:'),
            notes(sum.critical.map((c) => {
              const i = ev.findIndex((x) => x.id === c.evidenceId);
              return { cls: 'bad', text: `${eLabel(i)} ${S.truncate(ev[i].text, 90)} → ${c.newLeaders.map(name).join(' / ')}` };
            })),
            h('p', { class: 'small muted' }, 'Corroborate these first. They also show up under Key uncertainties.')]
          : h('p', {}, 'No single item of evidence decides the outcome on its own.'),
        sum.nonDiagnostic.length ? h('p', { class: 'small muted' }, `${sum.nonDiagnostic.length} item(s) are consistent with every hypothesis and do not help decide between them.`) : null));
    wrap.append(h('h2', {}, 'Tentative conclusions'), results);
    return wrap;
  }

  function hasHypothesis(text) {
    const t = text.trim().toLowerCase();
    return state.hypotheses.some((x) => x.text.trim().toLowerCase() === t);
  }

  function addHypothesis(text) {
    if (!text.trim() || hasHypothesis(text)) return;
    state.hypotheses.push({ id: S.uid('h'), text: text.trim(), deception: false, missing: '' });
    save();
    rerender();
  }

  /** Multiple Hypotheses Generator: permutations of the lead hypothesis's who/what/how/... */
  function renderMHG() {
    const mhg = state.mhg;
    const gen = S.mhgPermutations(mhg);
    const used = S.MHG_COMPONENTS.some((c) => mhg.components[c].lead || mhg.components[c].alts);
    const card = h('details', { class: 'card lav', open: used ? true : null },
      h('summary', {}, h('strong', {}, 'Generate hypotheses: Multiple Hypotheses Generator'),
        h('span', { class: 'small muted' }, gen.total ? ` ${gen.total} permutations` : ' optional')),
      h('p', { class: 'small muted' }, 'Break the lead hypothesis into who, what, how, when, where and why. List plausible alternatives for each, one per line. Every combination becomes a candidate hypothesis. Score each for credibility (1-5) and send the most deserving to the ACH matrix. Components with a single value are treated as given.'));
    card.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['', 'Lead hypothesis', 'Alternatives (one per line)'].map((t) => h('th', {}, t)))),
      h('tbody', {}, S.MHG_COMPONENTS.map((c) => h('tr', {},
        h('td', {}, h('strong', {}, `${c[0].toUpperCase()}${c.slice(1)}?`)),
        h('td', {}, field(mhg.components[c], 'lead', { placeholder: `Lead: ${c}`, label: `Lead ${c}` })),
        h('td', {}, field(mhg.components[c], 'alts', { multi: true, rows: 2, placeholder: 'Alternatives', label: `Alternative ${c}` }))))))),
    h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: rerender }, 'Generate permutations'),
      gen.givens.length ? h('span', { class: 'small muted' }, `Given: ${gen.givens.map(([c, o]) => `${c} = ${o[0]}`).join(' · ')}`) : null));

    if (gen.permutations.length) {
      const list = [...gen.permutations].sort((a, b) => b.score - a.score || Number(b.isLead) - Number(a.isLead));
      card.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Permutation', 'Credibility', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, list.slice(0, ui.mhgAll ? list.length : 12).map((p) => {
          const sentence = S.mhgSentence(p, gen.givens);
          return h('tr', {},
            h('td', {}, p.text, p.isLead ? h('span', {}, ' ', badge('lead', 'teal')) : null),
            h('td', {}, h('select', {
              'aria-label': 'Credibility', value: String(p.score || ''),
              onchange: (ev) => { const v = Number(ev.target.value); if (v) mhg.scores[p.key] = v; else delete mhg.scores[p.key]; save(); rerender(); },
            }, h('option', { value: '' }, '-'), [1, 2, 3, 4, 5].map((n) => h('option', { value: String(n) }, String(n))))),
            h('td', {}, hasHypothesis(sentence) ? badge('in ACH', 'good')
              : h('button', { type: 'button', class: 'small', title: sentence, onclick: () => addHypothesis(sentence) }, '→ ACH')));
        })))),
      list.length > 12 ? h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'small', onclick: () => { ui.mhgAll = !ui.mhgAll; rerender(); } },
        ui.mhgAll ? 'Show the top 12' : `Show all ${list.length}`)) : null,
      gen.truncated ? h('p', { class: 'small muted' }, `Showing the first ${S.MHG_LIMIT} of ${gen.total}. Fewer alternatives make a more useful list.`) : null,
      h('p', { class: 'small muted' }, 'Keep low-scoring permutations around: new information can change their credibility.'));
    }
    return card;
  }

  function quickAddEvidence() {
    const input = h('input', { type: 'text', placeholder: 'Add an item of evidence and press Enter', 'aria-label': 'New evidence' });
    const add = () => {
      if (!input.value.trim()) return;
      state.evidence.push(newEvidence(input.value.trim()));
      save();
      rerender();
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
    return h('div', { class: 'toolbar' }, input, h('button', { type: 'button', onclick: add }, 'Add'));
  }

  // -------------------------------------------------------------------------------------------
  // Deception Detection
  // -------------------------------------------------------------------------------------------
  function renderDeception() {
    const wrap = h('div', {});
    const answers = state.deception.answers;
    wrap.append(h('h1', {}, 'Deception Detection'),
      h('p', { class: 'lede' }, 'Attribution in CTI is a natural target for deception: personas, false flags, planted artefacts and actor-run "leaks". These checklists (MOM, POP, MOSES, EVE) help decide whether deception is likely. Every question is phrased so that "yes" points towards deception.'));
    const dec = S.deceptionAssessment(answers);
    wrap.append(h('div', { class: 'card accent' }, h('h2', {}, `Concern: ${dec.level}`),
      h('p', {}, dec.yes + dec.no ? `${dec.yes} of ${dec.yes + dec.no} answered questions point to deception. ${dec.unknown} unknown.` : 'Answer the questions below.'),
      h('div', { class: 'bars' }, dec.groups.map((g) => bar(g.title.split(':')[0], g.yes, g.total, 'bad', `${g.yes} yes · ${g.no} no · ${g.unknown} ?`))),
      dec.level === 'High' ? h('p', {}, 'Make sure the ACH matrix has a deception or false-flag hypothesis and that the evidence the deceiver controls is not what decides the outcome.') : null));

    for (const g of S.DECEPTION_CHECKLIST) {
      wrap.append(h('div', { class: 'card' }, h('h2', {}, g.title), h('p', { class: 'small muted' }, g.hint),
        g.questions.map(([qid, text]) => h('div', { class: 'q' }, h('span', {}, text),
          h('span', { class: 'seg', role: 'group', 'aria-label': text },
            ['yes', 'no', 'unknown'].map((v) => h('button', {
              type: 'button', class: v, 'aria-pressed': answers[qid] === v ? 'true' : 'false',
              onclick: () => { if (answers[qid] === v) delete answers[qid]; else answers[qid] = v; save(); rerender(); },
            }, v === 'unknown' ? '?' : v[0].toUpperCase() + v.slice(1))))))));
    }
    wrap.append(h('div', { class: 'card' }, labelled('Notes', field(state.deception, 'notes', { multi: true, rows: 3, placeholder: 'What does this mean for the analysis?' }))));
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Key drivers
  // -------------------------------------------------------------------------------------------
  function renderDrivers() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Key drivers and key uncertainties'),
      h('p', { class: 'lede' }, 'Think from the outside in: which forces shape how this issue develops? Rate each driver for impact and uncertainty. High-impact, high-uncertainty drivers are the critical uncertainties that become scenario axes. High-impact, predictable ones are key drivers that belong in every scenario.'),
      method('Outside-In Thinking', [
        'Describe the problem in general terms (the focal question).',
        'List the forces you have little influence over: social, technological, economic, environmental, political (STEEP).',
        'Add the factors that actors can influence: adversary intent and capability, and your own defensive posture.',
        'Assess how each force could affect the issue, and check against the evidence whether it actually does.',
        'Give every driver two endpoints, e.g. "opportunistic" ↔ "strategic". These become the axes of the scenario matrices.',
      ]));

    const rows = state.drivers.map((d, i) => {
      const cls = S.classifyDriver(d);
      return h('tr', {},
        h('td', { class: 'mono' }, `D${i + 1}`),
        h('td', {}, field(d, 'name', { multi: true, placeholder: 'Driver or force' })),
        h('td', {}, choice(d, 'category', S.DRIVER_CATEGORIES, { blank: 'Category…', label: 'Category' })),
        h('td', {}, field(d, 'low', { placeholder: 'One end' })),
        h('td', {}, field(d, 'high', { placeholder: 'Other end' })),
        h('td', { class: 'num' }, choice(d, 'impact', scale5, { number: true, label: 'Impact' })),
        h('td', { class: 'num' }, choice(d, 'uncertainty', scale5, { number: true, label: 'Uncertainty' })),
        h('td', {}, badge(S.DRIVER_CLASSES[cls].label, cls === 'critical' ? 'bad' : cls === 'predetermined' ? 'good' : cls === 'watch' ? 'warn' : '')),
        h('td', {}, removeBtn(() => {
          state.drivers.splice(i, 1);
          state.scenarioDrivers = state.scenarioDrivers.filter((x) => x !== d.id);
          save(); rerender();
        }, 'driver')));
    });
    wrap.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Driver', 'Category', 'Endpoint A', 'Endpoint B', 'Impact', 'Uncertainty', 'Class', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'No drivers yet.'))))));
    wrap.append(h('div', { class: 'toolbar' }, h('button', {
      type: 'button', class: 'primary',
      onclick: () => { state.drivers.push({ id: S.uid('d'), name: '', category: '', low: '', high: '', impact: 3, uncertainty: 3, notes: '' }); save(); rerender(); },
    }, '+ Add driver')));

    if (state.drivers.length) {
      const groups = Object.keys(S.DRIVER_CLASSES).map((c) => [c, state.drivers.filter((d) => S.classifyDriver(d) === c)]);
      wrap.append(h('div', { class: 'grid two' },
        h('div', { class: 'card' }, h('h2', {}, 'Impact / uncertainty'), driverPlot()),
        h('div', { class: 'card' }, h('h2', {}, 'What this means'),
          groups.map(([c, list]) => h('div', {},
            h('h3', {}, `${S.DRIVER_CLASSES[c].label} (${list.length})`),
            h('p', { class: 'small muted' }, S.DRIVER_CLASSES[c].hint),
            list.length ? h('ul', {}, list.map((d) => h('li', {}, d.name || '(unnamed)'))) : null)),
          h('button', { type: 'button', class: 'primary', onclick: () => go('scenarios') }, 'Build scenarios from these →'))));
    }
    if (state.drivers.length >= 2) wrap.append(renderCrossImpact());
    return wrap;
  }

  function renderCrossImpact() {
    const ds = state.drivers;
    const ci = S.crossImpactSummary(ds, state.crossImpact);
    const opts = [[0, '0'], ...S.IMPACT_VALUES.filter(([v]) => v !== 0)]; // unset cells show 0
    const roleCls = { lever: 'bad', relay: 'warn', reactive: 'teal', buffer: '', unrated: '' };
    return h('div', { class: 'card' },
      h('h2', {}, 'Cross-Impact Matrix'),
      h('p', { class: 'small muted' }, 'Drivers do not act alone. Read each row as "if this driver strengthens, what happens to the driver in the column?": ++ strongly reinforces, + reinforces, − weakens, −− strongly weakens. The sums show which drivers push the system and which ones react to it.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'ci' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Effect of ↓ on →'), ds.map((d, i) => h('th', { class: 'num', title: d.name }, `D${i + 1}`)), h('th', { class: 'num' }, 'Influences'), h('th', { class: 'num' }, 'Influenced'), h('th', {}, 'Role'))),
        h('tbody', {}, ds.map((r, i) => {
          state.crossImpact[r.id] = state.crossImpact[r.id] || {};
          return h('tr', {},
            h('td', {}, h('span', { class: 'mono small' }, `D${i + 1} `), S.truncate(r.name, 40) || '(unnamed)'),
            ds.map((c) => (c.id === r.id ? h('td', { class: 'self' }, '—')
              : h('td', { class: 'num' }, choice(state.crossImpact[r.id], c.id, opts, { number: true, label: `Effect of ${r.name} on ${c.name}` })))),
            h('td', { class: 'num mono' }, String(ci.active[r.id])),
            h('td', { class: 'num mono' }, String(ci.passive[r.id])),
            h('td', {}, badge(S.CROSS_IMPACT_ROLES[ci.roles[r.id]].label, roleCls[ci.roles[r.id]])));
        })))),
      ci.filled ? h('ul', { class: 'small' }, ['lever', 'relay', 'reactive', 'buffer'].map((k) => h('li', {}, h('strong', {}, `${S.CROSS_IMPACT_ROLES[k].label}: `), S.CROSS_IMPACT_ROLES[k].hint))) : null);
  }

  function driverPlot() {
    const size = 300;
    const pad = 40;
    const cellSize = (size - pad) / 5;
    const svg = h('svg', { viewBox: `0 0 ${size + 10} ${size + 10}`, class: 'plot', role: 'img', 'aria-label': 'Drivers plotted by impact and uncertainty' });
    for (let u = 1; u <= 5; u += 1) {
      for (let im = 1; im <= 5; im += 1) {
        const cls = S.classifyDriver({ impact: im, uncertainty: u });
        svg.append(h('rect', {
          x: pad + (u - 1) * cellSize, y: (5 - im) * cellSize, width: cellSize - 2, height: cellSize - 2, rx: 3,
          class: { critical: 'cell-critical', predetermined: 'cell-pre', watch: 'cell-watch', background: 'cell-bg' }[cls],
        }));
      }
      svg.append(h('text', { x: pad + (u - 0.5) * cellSize, y: 5 * cellSize + 14, 'text-anchor': 'middle', class: 'axis' }, String(u)));
      svg.append(h('text', { x: pad - 10, y: (5 - u + 0.5) * cellSize + 4, 'text-anchor': 'middle', class: 'axis' }, String(u)));
    }
    svg.append(h('text', { x: pad + (5 * cellSize) / 2, y: 5 * cellSize + 32, 'text-anchor': 'middle', class: 'axis' }, 'Uncertainty →'));
    svg.append(h('text', { x: 10, y: (5 * cellSize) / 2, 'text-anchor': 'middle', class: 'axis', transform: `rotate(-90 10 ${(5 * cellSize) / 2})` }, 'Impact →'));
    const seen = {};
    state.drivers.forEach((d, i) => {
      const u = Number(d.uncertainty) || 1;
      const im = Number(d.impact) || 1;
      const k = `${u}-${im}`;
      const n = (seen[k] = (seen[k] || 0) + 1) - 1;
      const cx = pad + (u - 1) * cellSize + 14 + (n % 3) * 15;
      const cy = (5 - im) * cellSize + 14 + Math.floor(n / 3) * 15;
      svg.append(h('g', {}, h('title', {}, d.name || `D${i + 1}`),
        h('circle', { cx, cy, r: 9 }),
        h('text', { x: cx, y: cy + 3.5, 'text-anchor': 'middle', class: 'dot-label' }, String(i + 1))));
    });
    return svg;
  }

  // -------------------------------------------------------------------------------------------
  // Multiple Scenarios Generation
  // -------------------------------------------------------------------------------------------
  function scenarioAt(key) {
    if (!state.scenarios[key]) state.scenarios[key] = { title: '', story: '', plausibility: 0, impact: 0, selected: false };
    return state.scenarios[key];
  }

  /** Quadrant Hypothesis Generation: a quadrant's end state becomes a hypothesis to test. */
  function quadrantToACH(s, where) {
    if (!s.title && !s.story) return null;
    const text = s.title ? `${s.title} (${where})` : where;
    return h('div', { class: 'row' }, hasHypothesis(text)
      ? badge('in ACH', 'good')
      : h('button', { type: 'button', class: 'small', title: 'Quadrant Hypothesis Generation: test this end state in the ACH matrix', onclick: () => addHypothesis(text) }, '→ ACH hypothesis'));
  }

  function renderScenarios() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Multiple Scenarios Generation'),
      h('p', { class: 'lede' }, 'The future is plural. Every pair of key drivers forms a 2 × 2 futures matrix, and each quadrant is a possible world. Generating many scenarios this way makes it less likely you will be surprised by the one that happens.'),
      method('How to do it', [
        'Define the focal issue and the goal of the exercise (Overview).',
        'Pick the key drivers, usually the critical uncertainties. Each needs two endpoints.',
        'Pair the drivers: n drivers give n(n-1)/2 matrices (4 drivers give 6).',
        'Write a short story for each quadrant: how could this world plausibly come about?',
        'Look for themes that repeat across matrices. They are more likely to matter.',
        'Select the three or four scenarios most deserving of attention, usually by voting (one vote for every three scenarios).',
        'Consider including a wild card or nightmare scenario: unlikely, but with severe consequences.',
        'Develop indicators for the selected scenarios.',
      ]));

    if (state.drivers.length < 2) {
      wrap.append(h('div', { class: 'empty' }, 'Add at least two key drivers first. ', h('button', { type: 'button', onclick: () => go('drivers') }, 'Go to Key drivers')));
      return wrap;
    }

    const sel = new Set(state.scenarioDrivers);
    const toggle = (id) => {
      if (sel.has(id)) state.scenarioDrivers = state.scenarioDrivers.filter((x) => x !== id);
      else state.scenarioDrivers.push(id);
      save(); rerender();
    };
    const n = state.scenarioDrivers.length;
    wrap.append(h('div', { class: 'card' }, h('h2', {}, 'Drivers to combine'),
      h('div', { class: 'grid three' }, state.drivers.map((d, i) => {
        const cls = S.classifyDriver(d);
        return h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: sel.has(d.id), onchange: () => toggle(d.id) }),
          h('span', {}, `D${i + 1} ${d.name || '(unnamed)'} `, cls === 'critical' ? badge('critical', 'bad') : null));
      })),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', onclick: () => { state.scenarioDrivers = S.suggestScenarioDrivers(state.drivers); save(); rerender(); } }, 'Use suggested drivers'),
        h('span', { class: 'small muted' }, `${n} driver(s) → ${S.matrixCount(n)} matrices → ${S.matrixCount(n) * 4} possible scenarios.`),
        n > 5 ? badge('That is a lot of matrices; 3 to 5 drivers is usually enough.', 'warn') : null)));

    const matrices = S.scenarioMatrices(state.drivers, state.scenarioDrivers);
    if (!matrices.length) {
      wrap.append(h('div', { class: 'empty' }, 'Select two or more drivers to generate the matrices.'));
      return wrap;
    }
    const dName = (d) => `D${state.drivers.indexOf(d) + 1} ${d.name}`;
    for (const mtx of matrices) {
      const grid = h('div', { class: 'matrix' },
        h('div', { class: 'y-axis' }, h('span', {}, mtx.y.low || 'low'), h('strong', {}, mtx.y.name), h('span', {}, mtx.y.high || 'high')),
        mtx.quadrants.map((q) => {
          const s = scenarioAt(q.key);
          return h('div', { class: `quad ${s.selected ? 'selected' : ''}` },
            h('div', { class: 'where' }, `${mtx.x[q.xEnd] || q.xEnd} + ${mtx.y[q.yEnd] || q.yEnd}`),
            field(s, 'title', { placeholder: 'Scenario name', label: 'Scenario name' }),
            field(s, 'story', { multi: true, rows: 3, placeholder: 'How could this world plausibly come about?', label: 'Story' }),
            h('div', { class: 'row' },
              h('span', {}, 'Plausibility'), choice(s, 'plausibility', [[0, '-'], ...scale5], { number: true, label: 'Plausibility' }),
              h('span', {}, 'Impact'), choice(s, 'impact', [[0, '-'], ...scale5], { number: true, label: 'Impact' }),
              h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: s.selected, onchange: (ev) => { s.selected = ev.target.checked; save(); rerender(); } }), 'Selected'),
              S.isWildcard(s) ? badge('wild card', 'lav') : null),
            quadrantToACH(s, `${mtx.x[q.xEnd] || q.xEnd} + ${mtx.y[q.yEnd] || q.yEnd}`));
        }),
        h('div', { class: 'x-axis' }, h('span', {}, `← ${mtx.x.low || 'low'}`), h('strong', {}, mtx.x.name), h('span', {}, `${mtx.x.high || 'high'} →`)));
      wrap.append(h('div', { class: 'card' }, h('h2', {}, `${dName(mtx.x)} × ${dName(mtx.y)}`), grid));
    }

    const list = S.scenarioList(state.scenarios, state.drivers, state.scenarioDrivers);
    if (list.length) {
      wrap.append(h('div', { class: 'card accent' }, h('h2', {}, 'Most deserving of attention'),
        h('p', { class: 'small muted' }, `Sorted by plausibility × impact. If you vote as a group, each participant gets ${S.votesPerParticipant(list.length)} vote(s) for ${list.length} scenarios.`),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Scenario', 'World', 'P', 'I', 'Attention', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, list.map((x) => h('tr', {},
            h('td', {}, x.title || '(untitled)', ' ', x.selected ? badge('selected', 'teal') : null, ' ', x.wildcard ? badge('wild card', 'lav') : null),
            h('td', { class: 'small' }, x.axes),
            h('td', { class: 'num' }, String(x.plausibility || '-')),
            h('td', { class: 'num' }, String(x.impact || '-')),
            h('td', { class: 'num mono' }, String(x.attention)),
            h('td', {}, h('input', { type: 'checkbox', checked: x.selected, 'aria-label': 'Selected', onchange: (ev) => { state.scenarios[x.key].selected = ev.target.checked; save(); rerender(); } }))))))),
        h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', onclick: () => go('indicators') }, 'Develop indicators for the selected scenarios →'))));
    }
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Indicators and Indicators Validator
  // -------------------------------------------------------------------------------------------
  const CRITERIA_SHORT = { observable: 'O', valid: 'V', reliable: 'R', stable: 'S', unique: 'U' };

  function renderIndicators() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Indicators and Indicators Validator'),
      h('p', { class: 'lede' }, 'Indicators are observable events you would expect if a scenario is unfolding or a hypothesis is true. The best ones are highly likely in their home scenario and highly unlikely in all the others. The validator scores exactly that.'),
      method('How to do it', [
        'Brainstorm indicators for each scenario or hypothesis.',
        'Merge duplicates, then test each against the five criteria: observable and collectible, valid, reliable, stable, unique.',
        'For each indicator, rate how likely it is to appear in every other scenario (HL, L, C, U, HU).',
        'Rank by diagnostic score. Rewrite or drop the low scorers; keep the most diagnostic ones for monitoring.',
        'Review regularly: set the status to emerging or observed as reporting comes in.',
      ], h('p', { class: 'small' }, 'Scoring (Beebe & Pherson): if the indicator is highly likely at home, the other scenarios score HL 0, L 1, C 2, U 4, HU 6. If it is likely at home: HL 0, L 0, C 1, U 3, HU 5.')));

    wrap.append(h('div', { class: 'toolbar' }, h('span', {}, 'Indicators point to:'),
      choice(state, 'indicatorFrame', [['scenarios', 'Selected scenarios'], ['hypotheses', 'ACH hypotheses']], { label: 'Indicator frame' })));

    const frame = S.indicatorFrame(state);
    if (frame.length < 2) {
      wrap.append(h('div', { class: 'empty' }, state.indicatorFrame === 'scenarios'
        ? 'Select at least two scenarios under Multiple scenarios first, or switch to the ACH hypotheses.'
        : 'Add at least two hypotheses under Competing Hypotheses first.'));
      return wrap;
    }
    const ids = frame.map((f) => f.id);
    const label = (id) => frame.find((f) => f.id === id)?.label;
    const inFrame = state.indicators.filter((i) => ids.includes(i.home));
    const orphans = state.indicators.length - inFrame.length;

    const mom = S.indicatorMomentum(state.indicators, ids);
    const maxMom = Math.max(...ids.map((id) => mom[id].score), 1);
    wrap.append(h('div', { class: 'card accent' }, h('h2', {}, 'Which way are things moving?'),
      h('p', { class: 'small muted' }, 'Observed (1) and emerging (0.5) indicators, weighted by how diagnostic they are.'),
      h('div', { class: 'bars' }, frame.map((f) => bar(S.truncate(f.label, 50), mom[f.id].score, maxMom, '', `${mom[f.id].observed} obs · ${mom[f.id].emerging} emerging / ${mom[f.id].total}`)))));

    let list = inFrame.map((ind) => ({ ind, v: S.validateIndicator(ind, ids) }));
    if (ui.indSort) list = list.sort((a, b) => b.v.ratio - a.v.ratio);
    const likOpts = [['', '·'], ...Object.keys(S.LIKELIHOOD).map((k) => [k, k])];
    const rows = list.map(({ ind, v }) => {
      ind.ratings = ind.ratings || {};
      ind.criteria = ind.criteria || {};
      return h('tr', {},
        h('td', {}, field(ind, 'text', { multi: true, placeholder: 'Observable event or condition' })),
        h('td', {}, choice(ind, 'home', frame.map((f) => [f.id, S.truncate(f.label, 40)]), { label: 'Home scenario' })),
        frame.map((f) => h('td', { class: 'num' }, f.id === ind.home
          ? h('div', {}, choice(ind, 'homeRating', [['HL', 'HL'], ['L', 'L']], { label: 'Likelihood at home' }), h('div', {}, badge('home', 'teal')))
          : choice(ind.ratings, f.id, likOpts, { label: `Likelihood in ${f.label}`, title: S.LIKELIHOOD[ind.ratings[f.id]] || 'Not rated' }))),
        h('td', { class: 'num mono' }, `${v.score}/${v.max}`),
        h('td', {}, badge(v.label, v.label === 'High' ? 'teal' : v.label === 'Medium' ? 'sand' : v.label === 'Non-diagnostic' ? 'bad' : '')),
        h('td', {}, h('div', { class: 'seg' }, Object.entries(S.INDICATOR_CRITERIA).map(([k, text]) => {
          const val = ind.criteria[k];
          return h('button', {
            type: 'button', class: val === true ? 'no' : val === false ? 'yes' : '',
            'aria-pressed': val === undefined ? 'false' : 'true',
            title: `${text}: ${val === true ? 'meets it' : val === false ? 'fails it' : 'not reviewed'} (click to change)`,
            onclick: () => { ind.criteria[k] = val === undefined ? true : val === true ? false : undefined; if (ind.criteria[k] === undefined) delete ind.criteria[k]; save(); rerender(); },
          }, CRITERIA_SHORT[k]);
        }))),
        h('td', {}, choice(ind, 'status', S.INDICATOR_STATUS, { label: 'Status' })),
        h('td', {}, removeBtn(() => { state.indicators = state.indicators.filter((x) => x !== ind); save(); rerender(); }, 'indicator')));
    });
    wrap.append(h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: ui.indSort ? 'primary small' : 'small', onclick: () => { ui.indSort = !ui.indSort; rerender(); } }, ui.indSort ? 'Sorted by diagnostic score' : 'Sort by diagnostic score')),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Indicator'), h('th', {}, 'Points to'), frame.map((f) => h('th', { class: 'num', title: f.label }, S.truncate(f.label, 22))), h('th', {}, 'Score'), h('th', {}, 'Diagnostic'), h('th', { title: 'Observable, Valid, Reliable, Stable, Unique' }, 'Criteria'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: frame.length + 7, class: 'muted' }, 'No indicators yet.'))))),
    h('p', { class: 'small muted' }, 'HL highly likely · L likely · C could appear · U unlikely · HU highly unlikely. Criteria: click O V R S U to mark met (green) or failed (red).'),
    h('div', { class: 'toolbar' }, frame.map((f) => h('button', {
      type: 'button',
      onclick: () => { state.indicators.push({ id: S.uid('i'), text: '', home: f.id, homeRating: 'HL', ratings: {}, status: 'none', criteria: {} }); save(); rerender(); },
    }, `+ Indicator for ${S.truncate(f.label, 30)}`))),
    orphans ? h('p', { class: 'small muted' }, `${orphans} indicator(s) belong to scenarios or hypotheses that are not in this view.`) : '');

    const weak = list.filter(({ v }) => v.label === 'Non-diagnostic' || v.label === 'Low' || v.failed.length);
    if (weak.length) {
      wrap.append(h('div', { class: 'card sand' }, h('h2', {}, 'Rewrite or drop'),
        notes(weak.map(({ ind, v }) => ({
          cls: 'warn',
          text: `${S.truncate(ind.text, 80) || '(empty)'} (${label(ind.home)}): ${[
            v.label === 'Non-diagnostic' ? 'would appear in every scenario' : v.label === 'Low' ? 'weakly diagnostic' : null,
            v.failed.length ? `fails: ${v.failed.map((c) => S.INDICATOR_CRITERIA[c].toLowerCase()).join(', ')}` : null,
          ].filter(Boolean).join('; ')}`,
        })))));
    }
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Contrarian techniques
  // -------------------------------------------------------------------------------------------
  function renderChallenge() {
    const c = state.challenge;
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Contrarian techniques'),
      h('p', { class: 'lede' }, 'Challenge the analytic line before a customer, an adversary or events do it for you.'));

    const risky = S.assumptionSummary(state.assumptions).risky;
    const sum = state.hypotheses.length && state.evidence.length ? S.achSummary(state.hypotheses, state.evidence, state.ratings) : null;
    const leadText = sum && sum.leaders.length === 1 ? state.hypotheses.find((x) => x.id === sum.leaders[0]).text : '';
    wrap.append(h('div', { class: 'card accent' }, h('h2', {}, 'Devil\'s Advocacy'),
      h('p', { class: 'small muted' }, 'Build the best possible case against a single, strongly held view. Label the result clearly as a Devil\'s Advocate product.'),
      h('div', { class: 'toolbar' },
        state.meta.analyticLine ? h('button', { type: 'button', class: 'small', onclick: () => { c.devil.judgment = state.meta.analyticLine; save(); rerender(); } }, 'Use the analytic line') : null,
        leadText ? h('button', { type: 'button', class: 'small', onclick: () => { c.devil.judgment = leadText; save(); rerender(); } }, 'Use the leading ACH hypothesis') : null),
      labelled('Mainline judgment', field(c.devil, 'judgment', { multi: true })),
      labelled('Assumption most open to challenge', field(c.devil, 'target', { multi: true }),
        risky.length ? `From the Key Assumptions Check: ${risky.map((a) => S.truncate(a.text, 70)).join(' · ')}` : null),
      labelled('The case against', field(c.devil, 'case', { multi: true, rows: 5, placeholder: 'Questionable evidence, possible deception, gaps, and the alternative explanation they support.' })),
      labelled('Outcome', field(c.devil, 'verdict', { multi: true, placeholder: 'Line holds / holds but needs work / needs to change or be caveated.' }))));

    wrap.append(h('div', { class: 'grid two' },
      h('div', { class: 'card sand' }, h('h2', {}, 'What If? analysis'),
        h('p', { class: 'small muted' }, 'Assume an event has happened and explain how it came about. This moves the argument from "whether" to "how".'),
        labelled('Assume this has happened', field(c.whatif, 'event', { multi: true })),
        labelled('Triggering events', field(c.whatif, 'triggers', { multi: true })),
        labelled('Pathway (think backwards)', field(c.whatif, 'pathway', { multi: true, rows: 3, placeholder: 'What must have happened at each stage?' })),
        labelled('Indicators', field(c.whatif, 'indicators', { multi: true })),
        labelled('Consequences', field(c.whatif, 'consequences', { multi: true }))),
      h('div', { class: 'card lav' }, h('h2', {}, 'High-Impact / Low-Probability'),
        h('p', { class: 'small muted' }, 'Take an event everyone considers unlikely and map how it could happen and what it would mean.'),
        labelled('High-impact outcome', field(c.hilp, 'outcome', { multi: true })),
        labelled('Plausible pathways', field(c.hilp, 'pathways', { multi: true, rows: 3 })),
        labelled('Triggers or shocks', field(c.hilp, 'triggers', { multi: true })),
        labelled('Observables for each pathway', field(c.hilp, 'indicators', { multi: true })),
        labelled('What would deflect it', field(c.hilp, 'deflectors', { multi: true })))));

    wrap.append(h('div', { class: 'card' }, h('h2', {}, 'Premortem Analysis'),
      h('p', { class: 'small muted' }, 'Imagine it is months later and an unimpeachable source shows the judgment was wrong. Work backwards: what went wrong? This is the creative half; the Structured Self-Critique below is the systematic half.'),
      labelled('How we turned out to be wrong', field(c.premortem, 'failure', { multi: true })),
      labelled('Possible causes', field(c.premortem, 'causes', { multi: true, rows: 3, placeholder: 'Anchoring, a planted artefact, a single source, an assumption that no longer holds…' })),
      labelled('Checks before publishing', field(c.premortem, 'checks', { multi: true }))));

    const sc = state.selfCritique;
    const concerns = S.SELF_CRITIQUE.filter(([id]) => sc[id]?.status === 'concern').length;
    wrap.append(h('div', { class: 'card sand' }, h('h2', {}, 'Structured Self-Critique'),
      h('p', { class: 'small muted' }, 'Go through the analysis element by element, as its harshest critic. Every concern becomes a key uncertainty to resolve before publishing.'),
      concerns ? h('p', {}, badge(`${concerns} concern(s)`, 'bad')) : null,
      S.SELF_CRITIQUE.map(([id, title, question]) => {
        const a = sc[id] || {};
        const set = (status) => { sc[id] = { ...a, status: a.status === status ? '' : status }; save(); rerender(); };
        return h('div', { class: 'q' },
          h('div', {}, h('strong', {}, title), h('div', { class: 'small' }, question),
            field(a, 'note', { placeholder: 'Notes', label: `${title} notes`, onInput: (v) => { sc[id] = { ...(sc[id] || {}), note: v }; } })),
          h('span', { class: 'seg', role: 'group', 'aria-label': title },
            h('button', { type: 'button', class: 'no', 'aria-pressed': a.status === 'ok' ? 'true' : 'false', onclick: () => set('ok') }, 'Holds up'),
            h('button', { type: 'button', class: 'yes', 'aria-pressed': a.status === 'concern' ? 'true' : 'false', onclick: () => set('concern') }, 'Concern')));
      })));

    wrap.append(h('div', { class: 'card lav' }, h('h2', {}, 'Red Hat Analysis'),
      h('p', { class: 'small muted' }, 'Avoid mirror-imaging: put yourself in the adversary\'s shoes, with their culture, organisation, pressures and information, and ask what they would actually do. Write it in the first person.'),
      labelled('Actor', field(c.redhat, 'actor', { placeholder: 'e.g. the persona\'s operators, or the state service behind it' })),
      labelled('Our situation, as we see it', field(c.redhat, 'situation', { multi: true, rows: 3, placeholder: 'Goals, pressures, what our superiors or community expect of us…' })),
      labelled('Questions we would ask ourselves', field(c.redhat, 'questions', { multi: true, rows: 3, placeholder: 'How would I see this information? Who do I answer to? What would I risk?' })),
      labelled('What we decide to do', field(c.redhat, 'decision', { multi: true, rows: 3 }))));
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Key uncertainties
  // -------------------------------------------------------------------------------------------
  // -------------------------------------------------------------------------------------------
  // Starbursting
  // -------------------------------------------------------------------------------------------
  function starSvg() {
    const pts = [];
    for (let i = 0; i < 12; i += 1) {
      const r = i % 2 ? 46 : 100;
      const a = (Math.PI / 6) * i - Math.PI / 2;
      pts.push(`${(130 + r * Math.cos(a)).toFixed(1)},${(130 + r * Math.sin(a)).toFixed(1)}`);
    }
    const labels = ['Who?', 'What?', 'How?', 'When?', 'Where?', 'Why?'];
    return h('svg', { viewBox: '-30 -20 320 300', class: 'star-svg', role: 'img', 'aria-label': 'Starburst: who, what, how, when, where, why' },
      h('polygon', { points: pts.join(' ') }),
      labels.map((l, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return h('text', { x: (130 + 122 * Math.cos(a)).toFixed(1), y: (135 + 118 * Math.sin(a)).toFixed(1), 'text-anchor': 'middle' }, l);
      }),
      h('text', { x: 130, y: 128, 'text-anchor': 'middle', class: 'center' }, 'Ask, don\'t'),
      h('text', { x: 130, y: 142, 'text-anchor': 'middle', class: 'center' }, 'answer yet'));
  }

  function renderStarburst() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Starbursting'),
      h('p', { class: 'lede' }, 'Before analysing, generate as many questions as possible from six angles. It works best when a mindset is already forming: an empty point on the star is a blind spot. Do not answer the questions yet. Afterwards, sort them by whether evidence answers them.'),
      method('How to do it', [
        'For each point of the star (who, what, how, when, where, why), write down questions about the topic.',
        'Generate at least two to four questions per point. Do not try to answer them yet.',
        'Then sort them: answered by evidence, only by indirect evidence or assumptions, or not answered at all.',
        'Questions with no evidence are gaps. They show up under Key uncertainties.',
      ]));
    const card = (p) => {
      const list = state.starburst[p];
      return h('div', { class: 'card' },
        h('h2', {}, `${p[0].toUpperCase()}${p.slice(1)}?`),
        list.map((q, i) => h('div', { class: 'qrow' },
          field(q, 'text', { multi: true, placeholder: 'Question', label: `${p} question` }),
          choice(q, 'support', S.STARBURST_SUPPORT, { blank: 'Answered by…', label: 'Answered by', cls: q.support === 'none' ? 'r-II' : '' }),
          removeBtn(() => { list.splice(i, 1); save(); rerender(); }, 'question'))),
        h('button', { type: 'button', class: 'small', onclick: () => { list.push({ id: S.uid('q'), text: '', support: '' }); save(); rerender(); } }, '+ Question'));
    };
    wrap.append(h('div', { class: 'star-wrap' }, starSvg(), S.STARBURST_POINTS.map(card)));
    const sum = S.starburstSummary(state.starburst);
    if (sum.total) {
      wrap.append(h('div', { class: 'card accent' }, h('h2', {}, 'What the questions show'),
        h('div', { class: 'bars' },
          bar('Answered by evidence', sum.counts.evidence, sum.total),
          bar('Only indirect evidence or assumptions', sum.counts.indirect, sum.total, 'sand'),
          bar('No evidence', sum.counts.none, sum.total, 'bad'),
          sum.counts.open ? bar('Not sorted yet', sum.counts.open, sum.total) : null),
        sum.counts.none + sum.counts.indirect > sum.counts.evidence
          ? h('p', {}, 'Most questions are not answered by evidence. Be careful about how confident the prevailing view is.') : null));
    }
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Chronologies and Timelines
  // -------------------------------------------------------------------------------------------
  function renderTimeline() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Chronology and timeline'),
      h('p', { class: 'lede' }, 'Put every relevant event in order. A timeline pulls you out of the detail and shows sequences, gaps, anomalies and correlations: what came first, what was a reaction, and when nothing was recorded at all.'),
      method('How to do it', [
        'List every key event with its date (and time when it matters), source and your confidence in it.',
        'Look at the order: does the sequence fit the leading hypothesis? Is anything out of place?',
        'Look at the gaps. Long quiet periods are flagged automatically; ask what happened there.',
        'Turn key events into evidence for the ACH matrix.',
      ]));
    const sorted = S.timelineSorted(state.timeline);
    const rows = sorted.map((e) => h('tr', {},
      h('td', {}, field(e, 'date', { type: 'date', label: 'Date' })),
      h('td', {}, h('input', { type: 'time', value: e.time || '', 'aria-label': 'Time', oninput: (ev) => { e.time = ev.target.value; save(); } })),
      h('td', {}, field(e, 'text', { multi: true, placeholder: 'What happened' })),
      h('td', {}, field(e, 'source', { placeholder: 'Source' })),
      h('td', {}, choice(e, 'confidence', levelOpts, { blank: '…', label: 'Confidence' })),
      h('td', {}, state.evidence.some((x) => x.timelineId === e.id) ? badge('evidence', 'good')
        : h('button', {
          type: 'button', class: 'small', title: 'Add this event to the evidence list for ACH',
          onclick: () => {
            const ev = newEvidence(e.text);
            Object.assign(ev, { source: e.source, date: e.date, credibility: e.confidence || 'M', timelineId: e.id, type: 'Telemetry / logs' });
            state.evidence.push(ev); save(); rerender();
          },
        }, '→ Evidence')),
      h('td', {}, removeBtn(() => { state.timeline = state.timeline.filter((x) => x !== e); save(); rerender(); }, 'event'))));
    wrap.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Date', 'Time', 'Event', 'Source', 'Confidence', '', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'No events yet.'))))),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'primary', onclick: () => { state.timeline.push({ id: S.uid('t'), date: '', time: '', text: '', source: '', confidence: '' }); save(); rerender(); } }, '+ Add event'),
      h('button', { type: 'button', onclick: rerender }, 'Re-sort')));

    if (sorted.length) {
      const gaps = S.timelineGaps(state.timeline);
      const gapAfter = new Map(gaps.map((g) => [g.after.id, g]));
      const items = [];
      for (const e of sorted) {
        items.push(h('li', {},
          h('div', { class: 'when' }, `${e.date || 'undated'}${e.time ? ` ${e.time}` : ''}`),
          h('div', {}, e.text || h('em', { class: 'muted' }, '(no description)')),
          h('div', { class: 'small muted' }, [e.source, e.confidence ? `${S.LEVELS[e.confidence]} confidence` : ''].filter(Boolean).join(' · '))));
        const g = gapAfter.get(e.id);
        if (g) items.push(h('li', { class: 'gap' }, `⚠ ${g.label} with no recorded events. What happened here?`));
      }
      wrap.append(h('div', { class: 'card accent' }, h('h2', {}, 'Timeline'), h('ul', { class: 'timeline' }, items),
        sorted.some((e) => !S.eventTime(e)) ? h('p', { class: 'small muted' }, 'Undated events are listed last. Give them a date, even an approximate one.') : null));
    }
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Decision support
  // -------------------------------------------------------------------------------------------
  function numField(obj, key, label) {
    return h('input', {
      type: 'number', class: 'num-in', value: obj[key] ?? '', 'aria-label': label, min: 0, step: 1,
      oninput: (ev) => { obj[key] = ev.target.value === '' ? '' : Number(ev.target.value); save(); },
      onchange: rerender,
    });
  }

  function linesField(obj, key, label, placeholder) {
    return labelled(label, field(obj, key, { multi: true, rows: 4, placeholder: placeholder || 'One item per line' }));
  }

  function renderDecision() {
    const d = state.decision;
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Decision support'),
      h('p', { class: 'lede' }, 'For the customer\'s side of the question: whether to attribute publicly, what to remediate first, whether to warn partners now. These techniques make the trade-offs explicit. The numbers inform the decision; they do not make it.'));

    // Force Field Analysis
    const ff = d.forceField;
    const ffs = S.forceFieldSummary(ff);
    const side = (s, title) => h('div', {},
      h('h3', {}, `${title} (${s === 'for' ? ffs.forTotal : ffs.againstTotal})`),
      ff.factors.map((f) => (f.side === s ? h('div', { class: 'ff-row' },
        field(f, 'text', { placeholder: 'Factor or argument', label: `${title} factor` }),
        choice(f, 'strength', scale5, { number: true, label: 'Strength 1-5', title: 'Strength: 1 weakest, 5 strongest' }),
        removeBtn(() => { ff.factors = ff.factors.filter((x) => x !== f); save(); rerender(); }, 'factor')) : null)),
      h('button', { type: 'button', class: 'small', onclick: () => { ff.factors.push({ id: S.uid('f'), side: s, text: '', strength: 3 }); save(); rerender(); } }, '+ Factor'));
    const maxFF = Math.max(ffs.forTotal, ffs.againstTotal, 1);
    wrap.append(h('div', { class: 'card accent' }, h('h2', {}, 'Force Field Analysis'),
      h('p', { class: 'small muted' }, 'List the forces for and against an outcome and rate each from 1 (weak) to 5 (strong). This keeps you from looking at only one side.'),
      labelled('Question or proposed change', field(ff, 'question', { placeholder: 'e.g. Should we publicly attribute the incident now?' })),
      h('div', { class: 'ff' }, side('for', 'For'), side('against', 'Against')),
      ffs.forCount + ffs.againstCount ? h('div', { class: 'bars' }, bar('For', ffs.forTotal, maxFF), bar('Against', ffs.againstTotal, maxFF, 'bad')) : null,
      notes(ffs.notes.map((t) => ({ text: t, cls: 'warn' })))));

    // SWOT
    const sw = d.swot;
    wrap.append(h('div', { class: 'card sand' }, h('h2', {}, 'SWOT'),
      h('p', { class: 'small muted' }, 'Strengths, weaknesses, opportunities and threats for an objective, then a strategy for each.'),
      labelled('Objective', field(sw, 'objective', { placeholder: 'What are we trying to achieve?' })),
      h('div', { class: 'swot' },
        linesField(sw, 'strengths', 'Strengths'), linesField(sw, 'weaknesses', 'Weaknesses'),
        linesField(sw, 'opportunities', 'Opportunities'), linesField(sw, 'threats', 'Threats')),
      h('h3', {}, 'Strategies'),
      h('div', { class: 'swot' },
        linesField(sw, 'useS', 'How can we use each strength?'), linesField(sw, 'improveW', 'How can we improve each weakness?'),
        linesField(sw, 'exploitO', 'How can we exploit each opportunity?'), linesField(sw, 'mitigateT', 'How can we mitigate each threat?'))));

    // Pros-Cons-Faults-and-Fixes
    const pc = d.pcff;
    const pcs = S.pcffSummary(pc);
    const pcList = (list, key, title, extra, extraLabel) => h('div', {},
      h('h3', {}, title),
      list.map((x) => h('div', { class: 'ff-row' },
        field(x, 'text', { multi: true, placeholder: title.slice(0, -1), label: title }),
        field(x, extra, { multi: true, placeholder: extraLabel, label: extraLabel }),
        removeBtn(() => { pc[key] = pc[key].filter((y) => y !== x); save(); rerender(); }, title.toLowerCase()))),
      h('button', { type: 'button', class: 'small', onclick: () => { pc[key].push({ id: S.uid(key[0]), text: '', [extra]: '' }); save(); rerender(); } }, `+ ${title.slice(0, -1)}`));
    wrap.append(h('div', { class: 'card lav' }, h('h2', {}, 'Pros-Cons-Faults-and-Fixes'),
      h('p', { class: 'small muted' }, 'A quick way to troubleshoot a decision under time pressure: list the pros and cons, then fault every pro (why might it not work?) and fix every con (what would neutralise it?).'),
      labelled('Proposed action', field(pc, 'action', { placeholder: 'e.g. Warn sector partners now' })),
      h('div', { class: 'ff' }, pcList(pc.pros, 'pros', 'Pros', 'fault', 'Fault: why might it not hold?'), pcList(pc.cons, 'cons', 'Cons', 'fix', 'Fix: how to neutralise it?')),
      pcs.pros + pcs.cons ? notes([
        pcs.unfaultedPros.length ? { cls: 'warn', text: `${pcs.unfaultedPros.length} pro(s) have not been faulted yet.` } : null,
        pcs.unfixedCons.length ? { cls: 'warn', text: `${pcs.unfixedCons.length} con(s) have no fix. Those are the real risks of the decision.` } : null,
      ].filter(Boolean)) : null));

    // Decision Matrix
    const m = d.matrix;
    const res = S.decisionMatrixScores(m);
    const best = res.ranked[0]?.total;
    wrap.append(h('div', { class: 'card' }, h('h2', {}, 'Decision Matrix'),
      h('p', { class: 'small muted' }, 'Weigh the options against criteria. Divide 100 points of weight across the criteria, then for each criterion divide 10 points across the options by how well they meet it. Score = weight × points.'),
      labelled('Decision', field(m, 'question', { placeholder: 'e.g. Which remediation should we do first?' })),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Criterion'), h('th', { class: 'num' }, 'Weight'),
          m.options.map((o) => h('th', {}, h('div', { class: 'toolbar' }, field(o, 'text', { placeholder: 'Option', label: 'Option' }),
            removeBtn(() => { m.options = m.options.filter((x) => x !== o); for (const r of Object.values(m.values)) delete r[o.id]; save(); rerender(); }, 'option')))),
          h('th', { class: 'num' }, 'Points'), h('th', {}, ''))),
        h('tbody', {},
          m.criteria.map((c) => {
            m.values[c.id] = m.values[c.id] || {};
            const rowSum = m.options.reduce((n, o) => n + (Number(m.values[c.id][o.id]) || 0), 0);
            return h('tr', {},
              h('td', {}, field(c, 'text', { placeholder: 'Criterion', label: 'Criterion' })),
              h('td', { class: 'num' }, numField(c, 'weight', 'Weight')),
              m.options.map((o) => h('td', { class: 'num' }, numField(m.values[c.id], o.id, `Points for ${o.text}`))),
              h('td', { class: 'num mono' }, rowSum === 10 ? `${rowSum}` : h('span', { class: 'badge warn' }, `${rowSum}/10`)),
              h('td', {}, removeBtn(() => { m.criteria = m.criteria.filter((x) => x !== c); delete m.values[c.id]; save(); rerender(); }, 'criterion')));
          }),
          m.criteria.length && m.options.length ? h('tr', { class: 'score' },
            h('td', {}, h('strong', {}, 'Total')), h('td', { class: 'num mono' }, res.weightSum === 100 ? '100' : h('span', { class: 'badge warn' }, `${res.weightSum}/100`)),
            m.options.map((o) => h('td', { class: 'num mono' }, res.totals[o.id] === best && best > 0 ? h('strong', {}, String(res.totals[o.id])) : String(res.totals[o.id]))),
            h('td', {}), h('td', {})) : null))),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'small', onclick: () => { m.criteria.push({ id: S.uid('k'), text: '', weight: 0 }); save(); rerender(); } }, '+ Criterion'),
        h('button', { type: 'button', class: 'small', onclick: () => { m.options.push({ id: S.uid('o'), text: '' }); save(); rerender(); } }, '+ Option')),
      notes(res.warnings.map((t) => ({ text: t, cls: 'warn' }))),
      res.ranked.length && best > 0 ? h('div', { class: 'bars' }, res.ranked.map((r, i) => bar(r.text || '(unnamed option)', r.total, best, i ? 'sand' : '', String(r.total)))) : null));
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Key judgments (ICD 203 estimative language)
  // -------------------------------------------------------------------------------------------
  function renderJudgments() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Key judgments'),
      h('p', { class: 'lede' }, 'State each judgment in estimative language so readers know both how likely you think it is and how much you trust the basis for that. Likelihood and confidence are different things: "likely, with low confidence" is a valid and useful statement.'));
    wrap.append(h('div', { class: 'card' }, h('h2', {}, 'Expressions of likelihood (ICD 203)'),
      h('div', { class: 'scale' }, S.ICD203.map((b) => h('div', {}, h('strong', {}, b.term), b.range, h('div', { class: 'small muted' }, b.alt)))),
      h('p', { class: 'small muted' }, 'Use one column of terms consistently. Confidence (low, moderate, high) reflects the quality of the sources, the evidence and the reasoning. A high-confidence judgment can still be wrong.')));

    state.judgments.forEach((j, i) => {
      const issues = S.judgmentChecks(j);
      const band = S.ICD203.findIndex((b) => b.key === j.likelihood);
      wrap.append(h('div', { class: 'card accent' },
        h('div', { class: 'section-head' }, h('h2', {}, `Judgment ${i + 1}`), removeBtn(() => { state.judgments.splice(i, 1); save(); rerender(); }, 'judgment')),
        labelled('Judgment', field(j, 'text', { multi: true, placeholder: 'e.g. The intrusion was carried out by the group that claimed it.' })),
        h('div', { class: 'grid two' },
          labelled('Likelihood', choice(j, 'likelihood', S.ICD203.map((b) => [b.key, `${b.term} (${b.range})`]), { blank: 'Choose…' })),
          labelled('Confidence', choice(j, 'confidence', S.CONFIDENCE, { blank: 'Choose…' }))),
        band >= 0 ? h('div', { class: 'scale', 'aria-hidden': 'true' }, S.ICD203.map((b, k) => h('div', { class: k === band ? 'on' : '' }, b.range))) : null,
        labelled('Basis', field(j, 'basis', { multi: true, placeholder: 'The key evidence and reasoning; link to the ACH result or key assumptions.' })),
        j.text ? h('div', { class: 'judgment-preview' }, S.judgmentSentence(j)) : null,
        notes(issues.map((t) => ({ text: t, cls: 'warn' })))));
    });
    const sum = state.hypotheses.length && state.evidence.length ? S.achSummary(state.hypotheses, state.evidence, state.ratings) : null;
    const lead = sum && sum.leaders.length === 1 ? state.hypotheses.find((x) => x.id === sum.leaders[0]) : null;
    wrap.append(h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'primary', onclick: () => { state.judgments.push({ id: S.uid('j'), text: '', likelihood: '', confidence: '', basis: '' }); save(); rerender(); } }, '+ Add judgment'),
      lead ? h('button', {
        type: 'button',
        onclick: () => {
          const conf = S.analyticConfidence(state).level.toLowerCase();
          state.judgments.push({ id: S.uid('j'), text: lead.text, likelihood: '', confidence: S.CONFIDENCE[conf] ? conf : '', basis: 'Least inconsistent hypothesis in the ACH matrix.' });
          save(); rerender();
        },
      }, 'Start from the leading ACH hypothesis') : null));
    return wrap;
  }

  function renderUncertainties() {
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Key uncertainties'),
      h('p', { class: 'lede' }, 'Everything the other techniques found that we do not know, with a collection requirement for each: unsupported assumptions, critical uncertainties among the drivers, evidence the ACH conclusion depends on, and expected-but-missing evidence.'));
    const ku = S.keyUncertainties(state).filter((k) => k.origin !== 'Intelligence gap');
    wrap.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Priority', 'Uncertainty', 'Found by', 'Collection requirement'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ku.length ? ku.map((k) => h('tr', {},
        h('td', {}, badge(S.LEVELS[k.impact], k.impact === 'H' ? 'bad' : k.impact === 'M' ? 'warn' : '')),
        h('td', {}, k.text), h('td', { class: 'small muted' }, k.origin), h('td', {}, k.requirement)))
        : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Nothing yet. Rate assumptions, drivers and the ACH matrix first.'))))));

    wrap.append(h('h2', {}, 'Other intelligence gaps'));
    const rows = state.gaps.map((g, i) => h('tr', {},
      h('td', {}, choice(g, 'impact', levelOpts, { label: 'Priority' })),
      h('td', {}, field(g, 'text', { multi: true, placeholder: 'What we do not know' })),
      h('td', {}, field(g, 'requirement', { multi: true, placeholder: 'How to find out' })),
      h('td', {}, removeBtn(() => { state.gaps.splice(i, 1); save(); rerender(); }, 'gap'))));
    wrap.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Priority', 'Gap', 'Collection requirement', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'No manual gaps.'))))),
    h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', onclick: () => { state.gaps.push({ id: S.uid('g'), text: '', impact: 'M', requirement: '' }); save(); rerender(); } }, '+ Add gap')));
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------------------------
  function renderReport() {
    const md = S.buildReport(state);
    const status = h('span', { class: 'small muted', 'aria-live': 'polite' });
    const wrap = h('div', {});
    wrap.append(h('h1', {}, 'Report'),
      h('p', { class: 'lede' }, 'A Markdown write-up of every technique, for a ticket, wiki, TIP note or finished intelligence product. Check the wording before you send it: the scores support your judgment, they do not replace it.'),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'primary', onclick: () => download(`${slug(state.meta.title)}.md`, md, 'text/markdown') }, 'Download Markdown'),
        h('button', {
          type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(md); status.textContent = 'Copied.'; } catch { status.textContent = 'Copy failed; select the text and copy it manually.'; }
          },
        }, 'Copy'),
        h('button', { type: 'button', onclick: exportProject }, 'Save project (JSON)'),
        h('button', { type: 'button', onclick: () => window.print() }, 'Print'),
        status),
      h('pre', { class: 'report' }, md));
    return wrap;
  }

  // -------------------------------------------------------------------------------------------
  // Top bar actions
  // -------------------------------------------------------------------------------------------
  function exportProject() {
    download(`${slug(state.meta.title)}.cti.json`, `${JSON.stringify(state, null, 2)}\n`, 'application/json');
  }

  $('#btn-export').addEventListener('click', exportProject);
  $('#btn-new').addEventListener('click', () => {
    if (isEmpty() || window.confirm('Start a new, empty project? Save the current one first if you want to keep it.')) replaceState(S.emptyState());
  });
  $('#btn-example').addEventListener('click', () => {
    if (isEmpty() || window.confirm('Replace the current project with the worked example?')) replaceState(window.EXAMPLE);
  });
  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT) { window.alert('That file is too large for a project file.'); return; }
    try {
      const data = JSON.parse(await file.text());
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('not a project');
      replaceState(data);
    } catch (err) {
      window.alert(`Could not open ${file.name}: it is not a Systematic Analyst Tool project file.`);
    }
  });

  window.addEventListener('storage', (ev) => {
    if (ev.key === STORE_KEY) { state = loadStored(); rerender(); }
  });

  // Theme toggle: an explicit choice is remembered; without one the system setting applies.
  const THEME_KEY = 'sat:theme';
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
  const ICONS = {
    sun: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  };
  function paintThemeButton() {
    const dark = effectiveTheme() === 'dark';
    const btn = $('#btn-theme');
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.replaceChildren(h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: dark ? ICONS.sun : ICONS.moon })));
  }
  $('#btn-theme').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* storage blocked: the choice lasts for this page */ }
    paintThemeButton();
  });
  darkQuery.addEventListener('change', paintThemeButton);
  paintThemeButton();

  $('#save-state').textContent = (localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY)) ? 'Saved in this browser' : '';
  rerender();
}());
