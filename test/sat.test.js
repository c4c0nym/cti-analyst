const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sat.js');
const EXAMPLE = require('../js/example.js');

// ---------------------------------------------------------------------------------------------
// ACH: the Tradecraft Primer's Aum Shinrikyo matrix (p. 15), all weights MEDIUM.
// Published inconsistency scores: cult -1, terrorist -1, political -2, criminal -3.
// ---------------------------------------------------------------------------------------------
const aum = {
  hypotheses: [
    { id: 'cult', text: 'Kooky cult' }, { id: 'terror', text: 'Terrorist group' },
    { id: 'pol', text: 'Political movement' }, { id: 'crim', text: 'Criminal group' },
  ],
  evidence: ['e1', 'e2', 'e3', 'e4'].map((id) => ({ id, text: id, credibility: 'M', relevance: 'M' })),
  ratings: {
    e3: { cult: 'I', terror: 'N', pol: 'I', crim: 'I' }, // attacks on journalists
    e2: { cult: 'C', terror: 'I', pol: 'I', crim: 'I' }, // religious affiliation
    e4: { cult: 'N', terror: 'N', pol: 'C', crim: 'I' }, // established party
    e1: { cult: 'C', terror: 'C', pol: 'C', crim: 'C' }, // blind leader
  },
};

test('ACH reproduces the Primer\'s Aum Shinrikyo inconsistency scores', () => {
  const scores = Object.fromEntries(S.achScores(aum.hypotheses, aum.evidence, aum.ratings).map((s) => [s.id, s.inconsistency]));
  assert.deepEqual(scores, { cult: 1, terror: 1, pol: 2, crim: 3 });
});

test('ACH ranking gives ties the same rank', () => {
  const ranking = S.achRanking(aum.hypotheses, aum.evidence, aum.ratings);
  assert.deepEqual(ranking.map((r) => [r.id, r.rank]), [['cult', 1], ['terror', 1], ['pol', 3], ['crim', 4]]);
  const sum = S.achSummary(aum.hypotheses, aum.evidence, aum.ratings);
  assert.deepEqual(sum.leaders, ['cult', 'terror']);
  assert.equal(sum.margin, 0);
});

test('evidence consistent with every hypothesis is not diagnostic (Primer footnote 5)', () => {
  assert.equal(S.diagnosticity('e1', aum.ratings, aum.hypotheses).label, 'None');
  assert.equal(S.diagnosticity('e2', aum.ratings, aum.hypotheses).label, 'Medium');
  const sum = S.achSummary(aum.hypotheses, aum.evidence, aum.ratings);
  assert.deepEqual(sum.nonDiagnostic, ['e1']);
});

test('credibility and relevance weigh inconsistencies; II counts double', () => {
  const hyps = [{ id: 'a' }, { id: 'b' }];
  const ev = [
    { id: 'x', credibility: 'H', relevance: 'H' }, // weight 2.25
    { id: 'y', credibility: 'L', relevance: 'M' }, // weight 0.5
  ];
  const ratings = { x: { a: 'I', b: 'C' }, y: { a: 'C', b: 'II' } };
  const s = Object.fromEntries(S.achScores(hyps, ev, ratings).map((r) => [r.id, r.inconsistency]));
  assert.deepEqual(s, { a: 2.25, b: 1 });
});

test('NA and unrated cells are ignored', () => {
  const hyps = [{ id: 'a' }, { id: 'b' }];
  const ev = [{ id: 'x' }];
  assert.equal(S.diagnosticity('x', { x: { a: 'NA', b: 'II' } }, hyps).label, 'Unrated');
  assert.equal(S.achScores(hyps, ev, { x: { b: 'NA' } })[1].rated, 1);
  assert.equal(S.achScores(hyps, ev, { x: { a: 'bogus' } })[0].rated, 0);
});

test('sensitivity finds the evidence the conclusion hangs on', () => {
  const hyps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ev = ['x', 'y', 'z'].map((id) => ({ id }));
  const ratings = {
    x: { a: 'C', b: 'I', c: 'I' }, // the only item that separates a from b
    y: { a: 'C', b: 'C', c: 'II' },
    z: { a: 'C', b: 'C', c: 'C' },
  };
  const critical = S.achSensitivity(hyps, ev, ratings);
  assert.deepEqual(critical, [{ evidenceId: 'x', newLeaders: ['a', 'b'] }]);
});

test('ACH warnings ask for a deception hypothesis and enough alternatives', () => {
  const w = S.achWarnings([{ id: 'a' }, { id: 'b' }], [], {});
  assert.ok(w.some((t) => t.includes('at least three')));
  assert.ok(w.some((t) => t.includes('deception')));
  assert.ok(!S.achWarnings([{ id: 'a' }, { id: 'b' }, { id: 'c', deception: true }], [], {}).some((t) => t.includes('deception')));
});

// ---------------------------------------------------------------------------------------------
// Indicators Validator: Beebe & Pherson, FARC case, Table 12.7.
// ---------------------------------------------------------------------------------------------
const frame = ['A', 'B', 'C', 'D'];

test('Indicators Validator matches Beebe & Pherson Table 12.7', () => {
  const cases = [
    // [home, homeRating, ratings of the others, published score]
    ['A', 'HL', { B: 'HU', C: 'HU', D: 'C' }, 14], // A-1
    ['A', 'L', { B: 'HU', C: 'HU', D: 'L' }, 10], // A-2
    ['A', 'HL', { B: 'HL', C: 'HL', D: 'HL' }, 0], // A-6
    ['A', 'L', { B: 'U', C: 'U', D: 'L' }, 6], // A-8
    ['B', 'L', { A: 'C', C: 'C', D: 'L' }, 2], // B-1
    ['B', 'L', { A: 'HU', C: 'U', D: 'U' }, 11], // B-4
    ['C', 'HL', { A: 'U', B: 'U', D: 'U' }, 12], // C-6
    ['D', 'L', { A: 'C', B: 'U', C: 'U' }, 7], // D-2
  ];
  for (const [home, homeRating, ratings, expected] of cases) {
    assert.equal(S.validateIndicator({ home, homeRating, ratings }, frame).score, expected, `${home} ${JSON.stringify(ratings)}`);
  }
});

test('indicator labels: the ideal indicator is highly likely at home and highly unlikely elsewhere', () => {
  assert.equal(S.validateIndicator({ home: 'A', homeRating: 'HL', ratings: { B: 'HU', C: 'HU', D: 'HU' } }, frame).label, 'High');
  assert.equal(S.validateIndicator({ home: 'A', homeRating: 'HL', ratings: { B: 'HL', C: 'HL', D: 'HL' } }, frame).label, 'Non-diagnostic');
  assert.equal(S.validateIndicator({ home: 'A', homeRating: 'HL', ratings: {} }, frame).label, 'Unrated');
  const v = S.validateIndicator({ home: 'A', ratings: { B: 'U' }, criteria: { unique: false, valid: true } }, frame);
  assert.equal(v.complete, false);
  assert.deepEqual(v.failed, ['unique']);
});

test('indicator momentum counts observed and emerging indicators per home', () => {
  const inds = [
    { home: 'A', homeRating: 'HL', ratings: { B: 'HU', C: 'HU', D: 'HU' }, status: 'observed' },
    { home: 'A', homeRating: 'HL', ratings: {}, status: 'emerging' },
    { home: 'B', homeRating: 'HL', ratings: {}, status: 'none' },
    { home: 'gone', status: 'observed' },
  ];
  const m = S.indicatorMomentum(inds, frame);
  assert.equal(m.A.observed, 1);
  assert.equal(m.A.emerging, 1);
  assert.equal(m.A.score, 1.05); // 1 x 1.0 + 0.5 x 0.1 floor for an unrated indicator
  assert.equal(m.B.score, 0);
});

// ---------------------------------------------------------------------------------------------
// Drivers and scenarios
// ---------------------------------------------------------------------------------------------
test('drivers are classified by impact and uncertainty', () => {
  assert.equal(S.classifyDriver({ impact: 5, uncertainty: 4 }), 'critical');
  assert.equal(S.classifyDriver({ impact: 4, uncertainty: 2 }), 'predetermined');
  assert.equal(S.classifyDriver({ impact: 2, uncertainty: 5 }), 'watch');
  assert.equal(S.classifyDriver({ impact: 3, uncertainty: 3 }), 'background');
});

test('Multiple Scenarios Generation pairs every driver: 4 drivers -> 6 matrices, 5 -> 10', () => {
  const drivers = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, low: `${id}-lo`, high: `${id}-hi` }));
  assert.equal(S.scenarioMatrices(drivers, ['a', 'b', 'c', 'd']).length, 6);
  assert.equal(S.scenarioMatrices(drivers, ['a', 'b', 'c', 'd', 'e']).length, 10);
  assert.equal(S.matrixCount(4), 6);
  const m = S.scenarioMatrices(drivers, ['a', 'b'])[0];
  assert.equal(m.quadrants.length, 4);
  assert.equal(new Set(m.quadrants.map((q) => q.key)).size, 4);
  assert.equal(S.describeQuadrant('a|b|high|low', drivers), 'a-hi + b-lo');
  assert.equal(S.scenarioMatrices(drivers, ['a', 'missing']).length, 0);
});

test('suggested scenario drivers put critical uncertainties first', () => {
  const drivers = [
    { id: 'bg', impact: 2, uncertainty: 2 },
    { id: 'crit', impact: 4, uncertainty: 4 },
    { id: 'pre', impact: 5, uncertainty: 3 },
  ];
  assert.deepEqual(S.suggestScenarioDrivers(drivers, 2), ['crit', 'pre']);
});

test('scenario selection helpers', () => {
  assert.equal(S.votesPerParticipant(24), 8); // Beebe & Pherson: 24 scenarios -> 8 votes
  assert.equal(S.votesPerParticipant(2), 1);
  assert.ok(S.isWildcard({ plausibility: 2, impact: 5 }));
  assert.ok(!S.isWildcard({ plausibility: 0, impact: 5 }));
  const drivers = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const list = S.scenarioList({
    'a|b|low|low': { title: 'Low', plausibility: 2, impact: 2 },
    'a|b|high|high': { title: 'High', plausibility: 3, impact: 5 },
    'a|b|high|low': { title: '', story: '' }, // empty quadrant is left out
    'x|y|low|low': { title: 'Stale' }, // drivers no longer selected
  }, drivers, ['a', 'b']);
  assert.deepEqual(list.map((s) => s.title), ['High', 'Low']);
});

// ---------------------------------------------------------------------------------------------
// Assumptions, deception, quality
// ---------------------------------------------------------------------------------------------
test('Key Assumptions Check summary flags unsupported and high-impact caveated assumptions', () => {
  const sum = S.assumptionSummary([
    { rating: 'solid', impact: 'H' }, { rating: 'caveat', impact: 'H' },
    { rating: 'caveat', impact: 'L' }, { rating: 'unsupported', impact: 'L' }, { rating: '' },
  ]);
  assert.deepEqual(sum.counts, { solid: 1, caveat: 2, unsupported: 1, unrated: 1 });
  assert.equal(sum.risky.length, 2);
  assert.ok(S.ASSUMPTION_TELLS.test('The actor will always reuse infrastructure'));
});

test('deception assessment needs enough answers before it gives a level', () => {
  assert.equal(S.deceptionAssessment({}).level, 'Insufficient');
  assert.equal(S.deceptionAssessment({ w1: 'yes' }).level, 'Insufficient');
  const all = {};
  S.DECEPTION_CHECKLIST.forEach((g) => g.questions.forEach(([id], i) => { all[id] = i % 2 ? 'no' : 'yes'; }));
  const res = S.deceptionAssessment(all);
  assert.equal(res.answered, res.total);
  assert.equal(res.level, 'Moderate');
  for (const k of Object.keys(all)) all[k] = 'no';
  assert.equal(S.deceptionAssessment(all).level, 'Low');
});

test('quality checks flag diagnostic but weak evidence and one-source dependence', () => {
  const hyps = [{ id: 'a' }, { id: 'b' }];
  const ev = [
    { id: 'x', text: 'claim', source: 'channel', credibility: 'L' },
    { id: 'y', text: 'y', source: 'channel' }, { id: 'z', text: 'z', source: 'channel' }, { id: 'w', text: 'w' },
  ];
  const issues = S.qualityChecks(ev, { x: { a: 'CC', b: 'II' } }, hyps);
  assert.ok(issues.some((i) => i.id === 'x' && i.text.includes('low credibility')));
  assert.ok(issues.some((i) => i.id === null && i.text.includes('channel')));
  assert.ok(issues.some((i) => i.id === 'w' && i.text.includes('no source')));
});

// ---------------------------------------------------------------------------------------------
// State, example and report
// ---------------------------------------------------------------------------------------------
test('normalize repairs partial or hostile input', () => {
  const s = S.normalize({ meta: { title: 42 }, evidence: [{ text: 'x' }], hypotheses: 'nope', indicatorFrame: 'evil', challenge: { devil: { case: 'c' } } });
  assert.equal(s.meta.title, '42');
  assert.ok(s.evidence[0].id);
  assert.deepEqual(s.hypotheses, []);
  assert.equal(s.indicatorFrame, 'scenarios');
  assert.equal(s.challenge.devil.case, 'c');
  assert.equal(s.challenge.whatif.event, '');
  assert.deepEqual(S.normalize(null), S.emptyState());
});

test('the worked example is internally consistent', () => {
  const s = S.normalize(EXAMPLE);
  const hids = new Set(s.hypotheses.map((h) => h.id));
  for (const e of s.evidence) {
    assert.ok(s.ratings[e.id], `ratings for ${e.id}`);
    for (const hid of Object.keys(s.ratings[e.id])) assert.ok(hids.has(hid));
    for (const code of Object.values(s.ratings[e.id])) assert.ok(S.ACH_RATINGS[code]);
  }
  const frameIds = S.indicatorFrame(s).map((f) => f.id);
  assert.ok(frameIds.length >= 3);
  for (const ind of s.indicators) {
    assert.ok(frameIds.includes(ind.home), ind.id);
    assert.ok(S.validateIndicator(ind, frameIds).complete, ind.id);
  }
  const sum = S.achSummary(s.hypotheses, s.evidence, s.ratings);
  assert.equal(sum.leaders.length, 1);
  assert.ok(sum.critical.length > 0, 'the example should demonstrate sensitivity analysis');
  assert.equal(S.analyticConfidence(s).level, 'Low');
});

test('the report covers every technique and escapes table cells', () => {
  const s = S.normalize(EXAMPLE);
  s.evidence[0].text = 'pipe | in\ntext';
  const md = S.buildReport(s);
  for (const heading of ['## Bottom line', '## Key Assumptions Check', '## Analysis of Competing Hypotheses', '### Sensitivity',
    '## Quality of information', '## Key drivers and key uncertainties', '## Scenarios', '## Indicators',
    '## Deception Detection', "## Devil's Advocacy", '## Premortem', '## Key uncertainties and collection requirements']) {
    assert.ok(md.includes(heading), heading);
  }
  assert.ok(md.includes('pipe \\| in<br>text'));
  assert.ok(md.startsWith('# Setpoint change'));
  assert.ok(S.buildReport(S.emptyState()).includes('Untitled analysis'));
});

test('key uncertainties collect from every technique', () => {
  const origins = new Set(S.keyUncertainties(S.normalize(EXAMPLE)).map((k) => k.origin));
  for (const o of ['Key Assumptions Check', 'Key drivers', 'ACH sensitivity', 'ACH: expected but not seen', 'Intelligence gap']) {
    assert.ok(origins.has(o), o);
  }
});

// ---------------------------------------------------------------------------------------------
// Techniques added in 1.1
// ---------------------------------------------------------------------------------------------
test('Multiple Hypotheses Generator permutes only the components that vary', () => {
  const mhg = {
    components: {
      who: { lead: 'Group A', alts: 'Group B\nInsider\n\nGroup B' }, // blank and duplicate lines ignored
      what: { lead: 'changed the setpoint', alts: '' }, // a given
      why: { lead: 'publicity', alts: 'sabotage' },
    },
    scores: { 'who=Insider|why=sabotage': 4 },
  };
  const g = S.mhgPermutations(mhg);
  assert.equal(g.total, 6);
  assert.deepEqual(g.givens.map(([c]) => c), ['what']);
  assert.equal(g.permutations.filter((p) => p.isLead).length, 1);
  assert.equal(g.permutations.find((p) => p.isLead).text, 'Who: Group A · Why: publicity');
  const insider = g.permutations.find((p) => p.key === 'who=Insider|why=sabotage');
  assert.equal(insider.score, 4);
  assert.equal(S.mhgSentence(insider, g.givens), 'Insider changed the setpoint for sabotage');
  assert.equal(S.mhgPermutations({}).total, 0);
});

test('Multiple Hypotheses Generator caps very large sets', () => {
  const many = Array.from({ length: 30 }, (_, i) => `x${i}`).join('\n');
  const g = S.mhgPermutations({ components: { who: { lead: 'a', alts: many }, why: { lead: 'b', alts: many } } });
  assert.equal(g.total, 31 * 31);
  assert.equal(g.permutations.length, S.MHG_LIMIT);
  assert.ok(g.truncated);
});

test('timeline sorts by date and time and flags unusually long gaps', () => {
  const ev = [
    { id: 'c', date: '2026-03-03', time: '05:10', text: 'claim' },
    { id: 'a', date: '2024-09-30', text: 'account left active' },
    { id: 'u', date: '', text: 'undated' },
    { id: 'b', date: '2026-03-03', time: '03:12', text: 'setpoint' },
    { id: 'd', date: '2026-03-03', time: '06:00', text: 'report' },
  ];
  assert.deepEqual(S.timelineSorted(ev).map((e) => e.id), ['a', 'b', 'c', 'd', 'u']);
  const gaps = S.timelineGaps(ev);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].after.id, 'a');
  assert.match(gaps[0].label, /months/);
  assert.deepEqual(S.timelineGaps(ev.slice(0, 3)), []); // too few events to judge
});

test('cross-impact sums separate levers from reactive drivers', () => {
  const drivers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ci = S.crossImpactSummary(drivers, { a: { b: 2, c: -2 }, b: { c: 1 } });
  assert.deepEqual(ci.active, { a: 4, b: 1, c: 0 });
  assert.deepEqual(ci.passive, { a: 0, b: 2, c: 3 });
  assert.equal(ci.roles.a, 'lever');
  assert.equal(ci.roles.c, 'reactive');
  assert.equal(S.crossImpactSummary(drivers, {}).roles.a, 'unrated');
});

test('Force Field Analysis totals and balance warnings', () => {
  const ff = S.forceFieldSummary({ factors: [
    { side: 'for', text: 'a', strength: 3 }, { side: 'for', text: 'b', strength: 2 }, { side: 'for', text: 'c', strength: 1 },
    { side: 'against', text: 'd', strength: 5 }, { side: 'against', text: '', strength: 5 },
  ] });
  assert.equal(ff.forTotal, 6);
  assert.equal(ff.againstTotal, 5); // the empty factor is ignored
  assert.equal(ff.balance, 'for');
  assert.equal(ff.notes.length, 2); // 3 vs 1 factors, and a strength-5 factor
});

test('Decision Matrix multiplies weights by points and checks the totals', () => {
  // Beebe & Pherson: weights sum to 100, each criterion divides 10 points across the options.
  const m = {
    criteria: [{ id: 'k1', text: 'Protect people', weight: 60 }, { id: 'k2', text: 'Cost', weight: 40 }],
    options: [{ id: 'o1', text: 'Evacuate' }, { id: 'o2', text: 'Stay' }],
    values: { k1: { o1: 8, o2: 2 }, k2: { o1: 3, o2: 7 } },
  };
  const r = S.decisionMatrixScores(m);
  assert.deepEqual(r.totals, { o1: 600, o2: 400 });
  assert.equal(r.ranked[0].id, 'o1');
  assert.deepEqual(r.warnings, []);
  m.values.k2.o2 = 5;
  m.criteria[1].weight = 30;
  assert.equal(S.decisionMatrixScores(m).warnings.length, 2);
});

test('PCFF finds unfixed cons and unfaulted pros', () => {
  const r = S.pcffSummary({ pros: [{ text: 'p', fault: '' }, { text: 'q', fault: 'f' }], cons: [{ text: 'c', fix: ' ' }, { text: '' }] });
  assert.equal(r.unfaultedPros.length, 1);
  assert.equal(r.unfixedCons.length, 1);
  assert.equal(r.cons, 1);
});

test('key judgments use ICD 203 terms and flag weak wording', () => {
  assert.equal(S.ICD203.length, 7);
  assert.deepEqual(S.ICD203.map((b) => b.range), ['1-5%', '5-20%', '20-45%', '45-55%', '55-80%', '80-95%', '95-99%']);
  const j = { text: 'The group carried it out.', likelihood: 'likely', confidence: 'moderate' };
  assert.equal(S.judgmentSentence(j), 'Likely (55-80%), moderate confidence: The group carried it out.');
  assert.deepEqual(S.judgmentChecks(j), []);
  assert.ok(S.judgmentChecks({ text: 'The group may have done it.', likelihood: 'likely', confidence: 'low' }).some((t) => t.includes('Hedge')));
  assert.ok(S.judgmentChecks({ text: 'x', likelihood: 'likely', confidence: 'high' }).some((t) => t.includes('basis')));
  assert.equal(S.judgmentChecks({ text: 'x' }).length, 2);
});

test('Starbursting and Self-Critique feed the key uncertainties', () => {
  const s = S.normalize({
    starburst: { who: [{ text: 'Who knew the password?', support: 'none' }, { text: 'Who claimed it?', support: 'evidence' }] },
    selfCritique: { sc3: { status: 'concern', note: 'One screenshot carries the ranking' } },
  });
  const sum = S.starburstSummary(s.starburst);
  assert.equal(sum.total, 2);
  assert.equal(sum.gaps.length, 1);
  const ku = S.keyUncertainties(s);
  assert.ok(ku.some((k) => k.origin === 'Starbursting' && k.text.includes('password')));
  assert.ok(ku.some((k) => k.origin === 'Structured Self-Critique' && k.impact === 'H'));
});

test('the report includes the new techniques for the worked example', () => {
  const md = S.buildReport(S.normalize(EXAMPLE));
  for (const heading of ['## Key judgments', '## Getting started', '## Starbursting', '## Chronology', '### Multiple Hypotheses Generator',
    '### Cross-impact', '## Structured Self-Critique', '## Force Field Analysis', '## SWOT', '## Pros-Cons-Faults-and-Fixes', '## Decision Matrix']) {
    assert.ok(md.includes(heading), heading);
  }
  assert.ok(md.includes('**Almost certain (95-99%), high confidence:**'));
});

test('normalize keeps new sections safe when they are missing or malformed', () => {
  const s = S.normalize({ starburst: 'x', mhg: { components: { who: { lead: 5 } } }, decision: { matrix: { criteria: 'bad' } }, timeline: [{}] });
  assert.equal(s.mhg.components.who.lead, '5');
  assert.deepEqual(s.starburst.who, []);
  assert.deepEqual(s.decision.matrix.criteria, []);
  assert.ok(s.timeline[0].id);
  assert.equal(s.challenge.redhat.actor, '');
});
