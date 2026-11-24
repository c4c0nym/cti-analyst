/*
 * cti-analyst core: the structured analytic techniques as pure functions (no DOM).
 *
 * Methods follow the CIA "Tradecraft Primer: Structured Analytic Techniques for Improving
 * Intelligence Analysis" (2009) and Beebe & Pherson, "Cases in Intelligence Analysis" (2nd ed.).
 * Loaded as a classic script in the browser (window.SAT) and with require() in Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------------------------------
  const LEVELS = { H: 'High', M: 'Medium', L: 'Low' };
  // Credibility x relevance weight; Medium/Medium = 1, as in the Primer's ACH example.
  const LEVEL_WEIGHT = { H: 1.5, M: 1, L: 0.5 };

  let counter = 0;
  function uid(prefix) {
    counter += 1;
    return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

  // ---------------------------------------------------------------------------------------------
  // Key Assumptions Check (Primer p. 7; Beebe & Pherson ch. 3)
  // ---------------------------------------------------------------------------------------------
  const ASSUMPTION_RATINGS = {
    solid: 'Basically supported',
    caveat: 'Correct with some caveats',
    unsupported: 'Unsupported or questionable',
  };

  const KAC_QUESTIONS = [
    'Why am I confident that this assumption is correct?',
    'In what circumstances might this assumption be untrue?',
    'Could it have been true in the past but no longer be true today?',
    'How much confidence do I have that this assumption is valid?',
    'If it turns out to be invalid, how much would that change the analytic line?',
    'Is this really a key assumption, or a key uncertainty or key factor?',
  ];

  // Phrases that usually mark an unchallenged assumption (Beebe & Pherson, Key Assumptions Check step 4).
  const ASSUMPTION_TELLS = /\b(will always|will never|would have to be|must be|based on|generally the case|obviously|clearly|certainly)\b/i;

  function assumptionSummary(assumptions) {
    const counts = { solid: 0, caveat: 0, unsupported: 0, unrated: 0 };
    for (const a of assumptions) counts[ASSUMPTION_RATINGS[a.rating] ? a.rating : 'unrated'] += 1;
    const risky = assumptions.filter(
      (a) => a.rating === 'unsupported' || (a.rating === 'caveat' && a.impact === 'H'),
    );
    return { counts, risky, total: assumptions.length };
  }

  // ---------------------------------------------------------------------------------------------
  // Quality of Information Check (Primer p. 10)
  // ---------------------------------------------------------------------------------------------
  const RELIABILITY = {
    A: 'Completely reliable', B: 'Usually reliable', C: 'Fairly reliable',
    D: 'Not usually reliable', E: 'Unreliable', F: 'Reliability cannot be judged',
  };
  const INFO_CREDIBILITY = {
    1: 'Confirmed by other sources', 2: 'Probably true', 3: 'Possibly true',
    4: 'Doubtful', 5: 'Improbable', 6: 'Truth cannot be judged',
  };
  const EVIDENCE_TYPES = [
    'Telemetry / logs', 'Forensics', 'Malware analysis', 'OSINT', 'Vendor report',
    'Government advisory', 'HUMINT', 'Dark web / closed source', 'Assumption', 'Argument / logic',
    'Absence of evidence', 'Other',
  ];

  /** Weight used by ACH for one item of evidence. */
  function evidenceWeight(e) {
    return (LEVEL_WEIGHT[e.credibility] ?? 1) * (LEVEL_WEIGHT[e.relevance] ?? 1);
  }

  function qualityChecks(evidence, ratings, hypotheses) {
    const issues = [];
    for (const e of evidence) {
      const d = diagnosticity(e.id, ratings, hypotheses);
      const label = e.text ? `"${truncate(e.text, 60)}"` : 'Untitled evidence';
      if (d.value >= 2 && e.credibility === 'L') {
        issues.push({ id: e.id, level: 'warn', text: `${label} is diagnostic but has low credibility. Corroborate it before it decides the outcome.` });
      }
      if (d.value >= 2 && !e.corroborated) {
        issues.push({ id: e.id, level: 'info', text: `${label} is diagnostic and not corroborated by an independent source.` });
      }
      if (e.reliability === 'E' || ['5'].includes(String(e.infoCredibility))) {
        issues.push({ id: e.id, level: 'warn', text: `${label} is graded ${e.reliability || ''}${e.infoCredibility || ''}: check whether it should stay in the analysis.` });
      }
      if (!e.source) issues.push({ id: e.id, level: 'info', text: `${label} has no source recorded.` });
    }
    const sources = new Map();
    for (const e of evidence) if (e.source) sources.set(e.source, (sources.get(e.source) || 0) + 1);
    for (const [src, n] of sources) {
      if (evidence.length >= 4 && n / evidence.length > 0.5) {
        issues.push({ id: null, level: 'warn', text: `More than half of the evidence comes from one source (${src}). Multiple items are not independent corroboration.` });
      }
    }
    return issues;
  }

  // ---------------------------------------------------------------------------------------------
  // Analysis of Competing Hypotheses (Primer p. 14; Heuer; Beebe & Pherson ch. 5, 7, 8, 9)
  // ---------------------------------------------------------------------------------------------
  const ACH_RATINGS = {
    CC: { label: 'Very consistent', value: 2, inconsistency: 0 },
    C: { label: 'Consistent', value: 1, inconsistency: 0 },
    N: { label: 'Neutral', value: 0, inconsistency: 0 },
    NA: { label: 'Not applicable', value: null, inconsistency: 0 },
    I: { label: 'Inconsistent', value: -1, inconsistency: 1 },
    II: { label: 'Very inconsistent', value: -2, inconsistency: 2 },
  };

  function rating(ratings, eid, hid) {
    const code = ratings?.[eid]?.[hid];
    return ACH_RATINGS[code] ? code : '';
  }

  /**
   * Weighted inconsistency per hypothesis. ACH works by disproving: the hypothesis with the LEAST
   * inconsistent evidence is tentatively the most likely. Consistent evidence is counted for
   * information only, because evidence consistent with everything proves nothing.
   */
  function achScores(hypotheses, evidence, ratings, exclude = new Set()) {
    return hypotheses.map((h) => {
      let weighted = 0;
      let inconsistent = 0;
      let consistent = 0;
      let rated = 0;
      for (const e of evidence) {
        if (exclude.has(e.id)) continue;
        const code = rating(ratings, e.id, h.id);
        if (!code) continue;
        rated += 1;
        const r = ACH_RATINGS[code];
        if (r.inconsistency) {
          inconsistent += 1;
          weighted += r.inconsistency * evidenceWeight(e);
        }
        if (r.value > 0) consistent += 1;
      }
      return { id: h.id, inconsistency: round(weighted), inconsistent, consistent, rated };
    });
  }

  /** Sort by weighted inconsistency (ascending) with competition ranking for ties. */
  function achRanking(hypotheses, evidence, ratings, exclude) {
    const scores = achScores(hypotheses, evidence, ratings, exclude)
      .sort((a, b) => a.inconsistency - b.inconsistency);
    let rank = 0;
    scores.forEach((s, i) => {
      if (i === 0 || s.inconsistency !== scores[i - 1].inconsistency) rank = i + 1;
      s.rank = rank;
    });
    return scores;
  }

  function leaders(ranking) {
    return ranking.filter((s) => s.rank === 1).map((s) => s.id).sort();
  }

  /**
   * How well an item of evidence discriminates between hypotheses: the spread between its most
   * and least consistent rating (0-4). Evidence rated the same everywhere has no diagnostic value
   * (Primer footnote 5).
   */
  function diagnosticity(eid, ratings, hypotheses) {
    const values = hypotheses
      .map((h) => rating(ratings, eid, h.id))
      .filter((c) => c && ACH_RATINGS[c].value !== null)
      .map((c) => ACH_RATINGS[c].value);
    if (values.length < 2) return { value: 0, label: 'Unrated' };
    const spread = Math.max(...values) - Math.min(...values);
    const label = spread >= 3 ? 'High' : spread === 2 ? 'Medium' : spread === 1 ? 'Low' : 'None';
    return { value: spread, label };
  }

  /**
   * Sensitivity analysis: which items of evidence would change the conclusion if they proved
   * wrong, misleading or deceptive? Each item is removed in turn and the leader recomputed.
   */
  function achSensitivity(hypotheses, evidence, ratings) {
    const base = achRanking(hypotheses, evidence, ratings);
    const baseLead = leaders(base).join(',');
    const critical = [];
    for (const e of evidence) {
      const without = achRanking(hypotheses, evidence, ratings, new Set([e.id]));
      const lead = leaders(without);
      if (lead.join(',') !== baseLead) critical.push({ evidenceId: e.id, newLeaders: lead });
    }
    return critical;
  }

  function achSummary(hypotheses, evidence, ratings) {
    const ranking = achRanking(hypotheses, evidence, ratings);
    const rated = ranking.some((s) => s.rated > 0);
    const lead = rated ? leaders(ranking) : [];
    const second = ranking.find((s) => s.rank > 1);
    const margin = lead.length === 1 && second ? round(second.inconsistency - ranking[0].inconsistency) : 0;
    const diag = evidence.map((e) => ({ id: e.id, ...diagnosticity(e.id, ratings, hypotheses) }));
    return {
      ranking,
      leaders: lead,
      margin,
      critical: rated ? achSensitivity(hypotheses, evidence, ratings) : [],
      nonDiagnostic: diag.filter((d) => d.label === 'None').map((d) => d.id),
      diagnosticity: Object.fromEntries(diag.map((d) => [d.id, d])),
    };
  }

  function achWarnings(hypotheses, evidence, ratings) {
    const w = [];
    if (hypotheses.length < 3) w.push('Use at least three hypotheses. ACH is about ruling alternatives out, and two hypotheses rarely cover the possibilities.');
    if (hypotheses.length && !hypotheses.some((h) => h.deception)) {
      w.push('No hypothesis covers deception or a false flag. In attribution, consider adding one (e.g. an actor posing as another).');
    }
    const empty = [];
    for (const e of evidence) {
      if (hypotheses.every((h) => !rating(ratings, e.id, h.id))) empty.push(e);
    }
    if (empty.length) w.push(`${empty.length} item(s) of evidence are not rated against any hypothesis yet.`);
    const nd = evidence.filter((e) => diagnosticity(e.id, ratings, hypotheses).label === 'None');
    if (evidence.length && nd.length / evidence.length > 0.5) {
      w.push('Most of the evidence is non-diagnostic (consistent with every hypothesis). Look for evidence that would disprove one of them.');
    }
    return w;
  }

  // ---------------------------------------------------------------------------------------------
  // Key drivers and key uncertainties (Outside-In Thinking, Primer p. 30; Alternative Futures p. 34)
  // ---------------------------------------------------------------------------------------------
  const DRIVER_CATEGORIES = {
    social: 'Social', technological: 'Technological', economic: 'Economic',
    environmental: 'Environmental', political: 'Political', adversary: 'Adversary / actor',
    defender: 'Our own posture',
  };

  const DRIVER_CLASSES = {
    critical: { label: 'Critical uncertainty', hint: 'High impact, high uncertainty: use it as a scenario axis.' },
    predetermined: { label: 'Key driver (predetermined)', hint: 'High impact, fairly predictable: build it into every scenario.' },
    watch: { label: 'Watch', hint: 'Uncertain but lower impact: monitor for change.' },
    background: { label: 'Background', hint: 'Low impact and fairly predictable.' },
  };

  function classifyDriver(d) {
    const impact = Number(d.impact) || 0;
    const uncertainty = Number(d.uncertainty) || 0;
    if (impact >= 4 && uncertainty >= 4) return 'critical';
    if (impact >= 4) return 'predetermined';
    if (uncertainty >= 4) return 'watch';
    return 'background';
  }

  /** Drivers proposed as scenario axes: critical uncertainties first, then impact x uncertainty. */
  function suggestScenarioDrivers(drivers, max = 4) {
    return [...drivers]
      .sort((a, b) => {
        const ca = classifyDriver(a) === 'critical' ? 1 : 0;
        const cb = classifyDriver(b) === 'critical' ? 1 : 0;
        return cb - ca || b.impact * b.uncertainty - a.impact * a.uncertainty;
      })
      .slice(0, Math.min(max, drivers.length))
      .map((d) => d.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Multiple Scenarios Generation (Beebe & Pherson ch. 12) / Alternative Futures (Primer p. 34)
  // ---------------------------------------------------------------------------------------------
  const ENDS = ['low', 'high'];

  function quadrantKey(xId, yId, xEnd, yEnd) {
    return `${xId}|${yId}|${xEnd}|${yEnd}`;
  }

  /** Every pair of drivers forms one 2x2 futures matrix: n drivers give n(n-1)/2 matrices. */
  function scenarioMatrices(drivers, selectedIds) {
    const chosen = selectedIds.map((id) => drivers.find((d) => d.id === id)).filter(Boolean);
    const matrices = [];
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) {
        const x = chosen[i];
        const y = chosen[j];
        const quadrants = [];
        for (const yEnd of ['high', 'low']) {
          for (const xEnd of ENDS) quadrants.push({ key: quadrantKey(x.id, y.id, xEnd, yEnd), xEnd, yEnd });
        }
        matrices.push({ id: `${x.id}|${y.id}`, x, y, quadrants });
      }
    }
    return matrices;
  }

  function matrixCount(n) {
    return n < 2 ? 0 : (n * (n - 1)) / 2;
  }

  /** "One vote for every three things being considered" (Beebe & Pherson, step 6). */
  function votesPerParticipant(nScenarios) {
    return Math.max(1, Math.floor(nScenarios / 3));
  }

  function isWildcard(s) {
    return Number(s.plausibility) > 0 && Number(s.plausibility) <= 2 && Number(s.impact) >= 4;
  }

  function scenarioAttention(s) {
    return (Number(s.plausibility) || 0) * (Number(s.impact) || 0);
  }

  function describeQuadrant(key, drivers) {
    const [xId, yId, xEnd, yEnd] = key.split('|');
    const x = drivers.find((d) => d.id === xId);
    const y = drivers.find((d) => d.id === yId);
    if (!x || !y) return key;
    return `${x[xEnd] || `${xEnd} ${x.name}`} + ${y[yEnd] || `${yEnd} ${y.name}`}`;
  }

  /** Scenarios that have content, ordered by attention (plausibility x impact). */
  function scenarioList(scenarios, drivers, selectedIds) {
    const live = new Set(scenarioMatrices(drivers, selectedIds).flatMap((m) => m.quadrants.map((q) => q.key)));
    return Object.entries(scenarios || {})
      .filter(([key, s]) => live.has(key) && (s.title || s.story))
      .map(([key, s]) => ({
        key, ...s, axes: describeQuadrant(key, drivers),
        attention: scenarioAttention(s), wildcard: isWildcard(s),
      }))
      .sort((a, b) => b.attention - a.attention);
  }

  // ---------------------------------------------------------------------------------------------
  // Indicators and the Indicators Validator (Primer p. 12; Beebe & Pherson ch. 12, 14)
  // ---------------------------------------------------------------------------------------------
  const LIKELIHOOD = {
    HL: 'Highly likely to appear', L: 'Likely to appear', C: 'Could appear',
    U: 'Unlikely to appear', HU: 'Highly unlikely to appear',
  };

  // Points an alternative scenario earns, by the indicator's likelihood in its home scenario.
  const VALIDATOR_POINTS = {
    HL: { HL: 0, L: 1, C: 2, U: 4, HU: 6 },
    L: { HL: 0, L: 0, C: 1, U: 3, HU: 5 },
  };

  const INDICATOR_CRITERIA = {
    observable: 'Observable and collectible',
    valid: 'Valid',
    reliable: 'Reliable',
    stable: 'Stable',
    unique: 'Unique',
  };

  const INDICATOR_STATUS = { none: 'Not observed', emerging: 'Emerging', observed: 'Observed' };

  /** Diagnostic power of an indicator: high when likely at home and unlikely everywhere else. */
  function validateIndicator(ind, frameIds) {
    const home = ind.homeRating === 'L' ? 'L' : 'HL';
    const others = frameIds.filter((id) => id !== ind.home);
    let score = 0;
    let rated = 0;
    for (const id of others) {
      const r = ind.ratings?.[id];
      if (VALIDATOR_POINTS[home][r] === undefined) continue;
      score += VALIDATOR_POINTS[home][r];
      rated += 1;
    }
    const max = VALIDATOR_POINTS[home].HU * others.length;
    const ratio = max ? score / max : 0;
    let label = 'Non-diagnostic';
    if (rated === 0 && others.length) label = 'Unrated';
    else if (ratio >= 0.6) label = 'High';
    else if (ratio >= 0.3) label = 'Medium';
    else if (ratio > 0) label = 'Low';
    const failed = Object.keys(INDICATOR_CRITERIA).filter((c) => ind.criteria && ind.criteria[c] === false);
    return { score, max, ratio: round(ratio), label, complete: rated === others.length, failed };
  }

  /** Which scenario or hypothesis do the observed indicators point to? */
  function indicatorMomentum(indicators, frameIds) {
    const weight = { observed: 1, emerging: 0.5 };
    const out = Object.fromEntries(frameIds.map((id) => [id, { observed: 0, emerging: 0, total: 0, score: 0 }]));
    for (const ind of indicators) {
      if (!out[ind.home]) continue;
      const m = out[ind.home];
      m.total += 1;
      const w = weight[ind.status] || 0;
      if (ind.status === 'observed') m.observed += 1;
      if (ind.status === 'emerging') m.emerging += 1;
      // Non-diagnostic indicators still count a little: they show activity, not direction.
      m.score += w * Math.max(validateIndicator(ind, frameIds).ratio, 0.1);
    }
    for (const id of frameIds) out[id].score = round(out[id].score);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Deception Detection: MOM, POP, MOSES, EVE (Beebe & Pherson ch. 4, 5)
  // Every question is phrased so that "yes" points TOWARDS deception.
  // ---------------------------------------------------------------------------------------------
  const DECEPTION_CHECKLIST = [
    {
      id: 'when', title: 'When to worry', hint: 'Is there a case for running Deception Detection at all?',
      questions: [
        ['w1', 'Does the potential deceiver have a history of deception, false flags or persona use?'],
        ['w2', 'Did key information arrive at a critical moment, when someone has much to gain or lose?'],
        ['w3', 'Does information come from a source whose bona fides are questionable?'],
        ['w4', 'Does the analysis hinge on a single critical item of information?'],
        ['w5', 'Would accepting the information require changing a key assumption or judgment?'],
        ['w6', 'Would accepting it make us spend or divert significant resources?'],
        ['w7', 'Could the deceiver see how we react (a feedback channel, public reporting, vendor blogs)?'],
      ],
    },
    {
      id: 'mom', title: 'MOM: Motive, Opportunity and Means', hint: 'Could they deceive us, and would it pay?',
      questions: [
        ['m1', 'Does the potential deceiver have a motive to mislead us (e.g. hide attribution, blame another actor)?'],
        ['m2', 'Do they have channels to feed us information (leak sites, personas, planted artefacts, sock puppets)?'],
        ['m3', 'Would being caught cost them little?'],
        ['m4', 'Could they establish credibility without giving up anything sensitive?'],
        ['m5', 'Do they have a way to monitor whether the deception is working?'],
      ],
    },
    {
      id: 'pop', title: 'POP: Past Opposition Practices', hint: 'Does this fit how they have deceived before?',
      questions: [
        ['p1', 'Has this adversary (or its sponsor) used deception or false flags before?'],
        ['p2', 'Does the current situation fit the pattern of earlier deceptions?'],
        ['p3', 'Are there historical precedents of similar actors doing this?'],
        ['p4', 'Have circumstances changed in a way that makes deception more attractive now?'],
      ],
    },
    {
      id: 'moses', title: 'MOSES: Manipulability of Sources', hint: 'Could our sources be controlled?',
      questions: [
        ['s1', 'Is the source vulnerable to control or manipulation by the potential deceiver (e.g. an actor-run channel)?'],
        ['s2', 'Is the basis for judging the source reliable weak or unclear?'],
        ['s3', 'Does the source have only indirect access to the information?'],
        ['s4', 'Is the source\'s track record poor, short or unknown?'],
        ['s5', 'Could the source have its own reasons to report faulty information (attention, sales, an agenda)?'],
      ],
    },
    {
      id: 'eve', title: 'EVE: Evaluation of Evidence', hint: 'Does the evidence itself hold up?',
      questions: [
        ['e1', 'Is the full chain of evidence (collection, parsing, translation, enrichment) unchecked?'],
        ['e2', 'Does the critical evidence fail to check out, or has it not been checked?'],
        ['e3', 'Does evidence from one type of collection conflict with another (e.g. telemetry vs. claims)?'],
        ['e4', 'Is evidence you would expect to see notable by its absence?'],
        ['e5', 'Is independent corroboration missing?'],
        ['e6', 'Are attribution artefacts (language settings, time zones, strings, reused tools) easy to plant?'],
      ],
    },
  ];

  function deceptionAssessment(answers = {}) {
    const groups = DECEPTION_CHECKLIST.map((g) => {
      const tally = { yes: 0, no: 0, unknown: 0, open: 0 };
      for (const [qid] of g.questions) {
        const a = answers[qid];
        if (a === 'yes' || a === 'no' || a === 'unknown') tally[a] += 1;
        else tally.open += 1;
      }
      return { id: g.id, title: g.title, ...tally, total: g.questions.length };
    });
    const sum = (k) => groups.reduce((n, g) => n + g[k], 0);
    const yes = sum('yes');
    const no = sum('no');
    const unknown = sum('unknown');
    const total = sum('total');
    const answered = yes + no + unknown;
    const share = yes + no ? yes / (yes + no) : 0;
    let level = 'Insufficient';
    if (answered >= total * 0.3 && yes + no > 0) level = share >= 0.6 ? 'High' : share >= 0.3 ? 'Moderate' : 'Low';
    return { groups, yes, no, unknown, answered, total, share: round(share), level };
  }

  // ---------------------------------------------------------------------------------------------
  // Key uncertainties and collection requirements
  // ---------------------------------------------------------------------------------------------
  function keyUncertainties(state) {
    const out = [];
    for (const a of state.assumptions) {
      if (a.rating === 'unsupported' && a.text) {
        out.push({ origin: 'Key Assumptions Check', text: a.text, impact: a.impact || 'M',
          requirement: `Collect information that confirms or refutes: ${a.text}` });
      }
    }
    for (const d of state.drivers) {
      if (classifyDriver(d) === 'critical' && d.name) {
        out.push({ origin: 'Key drivers', text: `${d.name} (${d.low || 'low'} ↔ ${d.high || 'high'})`, impact: 'H',
          requirement: `Monitor which way "${d.name}" is moving. Use the scenario indicators.` });
      }
    }
    if (state.hypotheses.length && state.evidence.length) {
      const s = achSummary(state.hypotheses, state.evidence, state.ratings);
      for (const c of s.critical) {
        const e = state.evidence.find((x) => x.id === c.evidenceId);
        if (e) {
          out.push({ origin: 'ACH sensitivity', text: e.text, impact: 'H',
            requirement: `Corroborate or re-verify; the conclusion changes if this item is wrong: ${e.text}` });
        }
      }
      for (const h of state.hypotheses) {
        if (h.missing) {
          out.push({ origin: 'ACH: expected but not seen', text: `${h.text}: ${h.missing}`, impact: 'M',
            requirement: `Search for the missing evidence: ${h.missing}` });
        }
      }
    }
    for (const g of state.gaps || []) {
      if (g.text) out.push({ origin: 'Intelligence gap', text: g.text, impact: g.impact || 'M', requirement: g.requirement || `Task collection: ${g.text}` });
    }
    const order = { H: 0, M: 1, L: 2 };
    return out.sort((a, b) => order[a.impact] - order[b.impact]);
  }

  // ---------------------------------------------------------------------------------------------
  // Analytic confidence: a transparent heuristic the analyst can overrule.
  // ---------------------------------------------------------------------------------------------
  function analyticConfidence(state) {
    const reasons = [];
    let score = 0;
    const { hypotheses, evidence, ratings } = state;
    if (!hypotheses.length || !evidence.length) {
      return { level: 'Not assessed', score: 0, reasons: ['Add hypotheses and evidence and rate the ACH matrix first.'] };
    }
    const s = achSummary(hypotheses, evidence, ratings);
    if (s.leaders.length !== 1) {
      score -= 2;
      reasons.push({ sign: -1, text: `${s.leaders.length || 'No'} hypotheses share the lowest inconsistency score; the evidence does not separate them.` });
    } else if (s.margin >= 2) {
      score += 2;
      reasons.push({ sign: 1, text: `The leading hypothesis is clearly ahead (margin ${s.margin}).` });
    } else if (s.margin >= 1) {
      score += 1;
      reasons.push({ sign: 1, text: `The leading hypothesis is ahead, but narrowly (margin ${s.margin}).` });
    } else {
      reasons.push({ sign: -1, text: `The leading hypothesis is barely ahead (margin ${s.margin}).` });
      score -= 1;
    }
    if (s.critical.length) {
      score -= 1;
      reasons.push({ sign: -1, text: `${s.critical.length} item(s) of evidence would change the conclusion on their own if they were wrong or planted.` });
    }
    const diag = evidence.filter((e) => s.diagnosticity[e.id].value >= 2);
    if (diag.length) {
      const strong = diag.filter((e) => e.credibility === 'H').length / diag.length;
      if (strong >= 0.5) { score += 1; reasons.push({ sign: 1, text: 'Most diagnostic evidence has high credibility.' }); }
      else if (diag.some((e) => e.credibility === 'L')) { score -= 1; reasons.push({ sign: -1, text: 'Some diagnostic evidence has low credibility.' }); }
    } else {
      score -= 1;
      reasons.push({ sign: -1, text: 'There is little diagnostic evidence.' });
    }
    const risky = state.assumptions.filter((a) => a.rating === 'unsupported' && a.impact === 'H');
    if (risky.length) {
      score -= 1;
      reasons.push({ sign: -1, text: `${risky.length} high-impact assumption(s) are unsupported.` });
    }
    const dec = deceptionAssessment(state.deception?.answers);
    if (dec.level === 'High') { score -= 1; reasons.push({ sign: -1, text: 'Deception Detection shows a high concern.' }); }
    const level = score >= 2 ? 'High' : score >= 0 ? 'Moderate' : 'Low';
    return { level, score, reasons };
  }

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------
  const TLP = ['TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED'];

  function emptyState() {
    return {
      version: 1,
      meta: { title: '', question: '', analyticLine: '', horizon: '', analyst: '', tlp: 'TLP:AMBER', updated: '' },
      assumptions: [],
      evidence: [],
      hypotheses: [],
      ratings: {},
      drivers: [],
      scenarioDrivers: [],
      scenarios: {},
      indicatorFrame: 'scenarios',
      indicators: [],
      deception: { answers: {}, notes: '' },
      challenge: {
        devil: { judgment: '', target: '', case: '', verdict: '' },
        whatif: { event: '', triggers: '', pathway: '', indicators: '', consequences: '' },
        hilp: { outcome: '', pathways: '', triggers: '', indicators: '', deflectors: '' },
        premortem: { failure: '', causes: '', checks: '' },
      },
      gaps: [],
    };
  }

  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

  /** Accept anything that looks like a saved project and fill in what is missing. */
  function normalize(input) {
    const base = emptyState();
    const s = obj(input);
    const meta = { ...base.meta };
    for (const k of Object.keys(meta)) if (s.meta && s.meta[k] != null) meta[k] = str(s.meta[k]);
    const withId = (prefix) => (x) => ({ ...obj(x), id: str(obj(x).id) || uid(prefix) });
    const challenge = {};
    for (const [k, v] of Object.entries(base.challenge)) {
      challenge[k] = { ...v };
      for (const f of Object.keys(v)) if (s.challenge?.[k]?.[f] != null) challenge[k][f] = str(s.challenge[k][f]);
    }
    return {
      ...base,
      meta,
      assumptions: arr(s.assumptions).map(withId('a')),
      evidence: arr(s.evidence).map(withId('e')),
      hypotheses: arr(s.hypotheses).map(withId('h')),
      ratings: obj(s.ratings),
      drivers: arr(s.drivers).map(withId('d')),
      scenarioDrivers: arr(s.scenarioDrivers).map(str),
      scenarios: obj(s.scenarios),
      indicatorFrame: s.indicatorFrame === 'hypotheses' ? 'hypotheses' : 'scenarios',
      indicators: arr(s.indicators).map(withId('i')),
      deception: { answers: obj(s.deception?.answers), notes: str(s.deception?.notes) },
      challenge,
      gaps: arr(s.gaps).map(withId('g')),
    };
  }

  /** The things indicators can point to: selected scenarios, or the ACH hypotheses. */
  function indicatorFrame(state) {
    if (state.indicatorFrame === 'hypotheses') {
      return state.hypotheses.map((h, i) => ({ id: h.id, label: h.text || `Hypothesis ${i + 1}` }));
    }
    return scenarioList(state.scenarios, state.drivers, state.scenarioDrivers)
      .filter((s) => s.selected)
      .map((s) => ({ id: s.key, label: s.title || s.axes }));
  }

  // ---------------------------------------------------------------------------------------------
  // Markdown report
  // ---------------------------------------------------------------------------------------------
  function truncate(text, n) {
    const t = str(text).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  }

  function cell(text) {
    return str(text).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>') || ' ';
  }

  function table(headers, rows) {
    const lines = [`| ${headers.map(cell).join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
    for (const r of rows) lines.push(`| ${r.map(cell).join(' | ')} |`);
    return lines.join('\n');
  }

  function buildReport(state) {
    const s = normalize(state);
    const m = s.meta;
    const out = [];
    const hName = (id) => {
      const i = s.hypotheses.findIndex((h) => h.id === id);
      return i < 0 ? id : `H${i + 1}: ${s.hypotheses[i].text}`;
    };
    out.push(`# ${m.title || 'Untitled analysis'}`);
    out.push('');
    out.push(`**${m.tlp}**${m.analyst ? ` · Analyst: ${m.analyst}` : ''}${m.updated ? ` · Updated: ${m.updated.slice(0, 10)}` : ''}`);
    out.push('');
    if (m.question) out.push(`**Focal question:** ${m.question}`, '');
    if (m.horizon) out.push(`**Time horizon:** ${m.horizon}`, '');

    // Bottom line up front
    out.push('## Bottom line');
    out.push('');
    if (s.hypotheses.length && s.evidence.length) {
      const sum = achSummary(s.hypotheses, s.evidence, s.ratings);
      const conf = analyticConfidence(s);
      if (sum.leaders.length === 1) {
        out.push(`The hypothesis with the least inconsistent evidence is **${hName(sum.leaders[0])}** (analytic confidence: **${conf.level}**).`);
      } else if (sum.leaders.length > 1) {
        out.push(`The evidence does not separate ${sum.leaders.map(hName).join(' and ')} (analytic confidence: **${conf.level}**).`);
      }
      out.push('');
      for (const r of conf.reasons) if (r.text) out.push(`- ${r.sign > 0 ? '▲' : '▼'} ${r.text}`);
      out.push('');
    } else if (m.analyticLine) {
      out.push(m.analyticLine, '');
    } else {
      out.push('_No ACH conclusion yet._', '');
    }
    if (m.analyticLine) out.push(`**Prevailing analytic line going in:** ${m.analyticLine}`, '');

    if (s.assumptions.length) {
      out.push('## Key Assumptions Check', '');
      out.push(table(['Assumption', 'Assessment', 'Impact if wrong', 'Commentary', 'What would change it'],
        s.assumptions.map((a) => [a.text, ASSUMPTION_RATINGS[a.rating] || 'Unrated', LEVELS[a.impact] || '', a.commentary, a.whatWouldChange])));
      out.push('');
    }

    if (s.hypotheses.length) {
      const sum = achSummary(s.hypotheses, s.evidence, s.ratings);
      out.push('## Analysis of Competing Hypotheses', '');
      out.push('Ranked by weighted inconsistency (lower is more likely). ACH works by ruling hypotheses out, so consistent evidence is shown for information only.', '');
      out.push(table(['Rank', 'Hypothesis', 'Weighted inconsistency', 'Inconsistent items', 'Consistent items'],
        sum.ranking.map((r) => [r.rank, hName(r.id), r.inconsistency, r.inconsistent, r.consistent])));
      out.push('');
      if (s.evidence.length) {
        const ordered = [...s.evidence].sort((a, b) => sum.diagnosticity[b.id].value - sum.diagnosticity[a.id].value);
        out.push('### Matrix', '');
        out.push(table(['Evidence', 'Cred.', 'Rel.', 'Diagnostic', ...s.hypotheses.map((_, i) => `H${i + 1}`)],
          ordered.map((e) => [e.text, e.credibility || 'M', e.relevance || 'M', sum.diagnosticity[e.id].label,
            ...s.hypotheses.map((h) => rating(s.ratings, e.id, h.id) || '·')])));
        out.push('');
        out.push('CC very consistent · C consistent · N neutral · NA not applicable · I inconsistent · II very inconsistent', '');
      }
      if (sum.critical.length) {
        out.push('### Sensitivity', '');
        out.push('If one of these items proved wrong, misleading or planted, the leading hypothesis would change:', '');
        for (const c of sum.critical) {
          const e = s.evidence.find((x) => x.id === c.evidenceId);
          out.push(`- ${e ? e.text : c.evidenceId} → ${c.newLeaders.map(hName).join(' / ')}`);
        }
        out.push('');
      }
      const missing = s.hypotheses.filter((h) => h.missing);
      if (missing.length) {
        out.push('### Expected but not seen', '');
        for (const h of missing) out.push(`- ${hName(h.id)}: ${h.missing}`);
        out.push('');
      }
    }

    if (s.evidence.length) {
      out.push('## Quality of information', '');
      out.push(table(['Evidence', 'Source', 'Type', 'Date', 'Grade', 'Corroborated'],
        s.evidence.map((e) => [e.text, e.source, e.type, e.date, `${e.reliability || ''}${e.infoCredibility || ''}`, e.corroborated ? 'yes' : 'no'])));
      out.push('');
      const issues = qualityChecks(s.evidence, s.ratings, s.hypotheses);
      for (const i of issues) out.push(`- ${i.level === 'warn' ? '⚠' : 'ℹ'} ${i.text}`);
      if (issues.length) out.push('');
    }

    if (s.drivers.length) {
      out.push('## Key drivers and key uncertainties', '');
      out.push(table(['Driver', 'Category', 'Range', 'Impact', 'Uncertainty', 'Class'],
        [...s.drivers].sort((a, b) => b.impact * b.uncertainty - a.impact * a.uncertainty)
          .map((d) => [d.name, DRIVER_CATEGORIES[d.category] || '', `${d.low || '?'} ↔ ${d.high || '?'}`, d.impact, d.uncertainty, DRIVER_CLASSES[classifyDriver(d)].label])));
      out.push('');
    }

    const scen = scenarioList(s.scenarios, s.drivers, s.scenarioDrivers);
    if (scen.length) {
      out.push('## Scenarios', '');
      out.push(`${scen.length} scenarios were generated from ${matrixCount(s.scenarioDrivers.length)} driver pairings. The ones selected as most deserving of attention:`, '');
      const sel = scen.filter((x) => x.selected);
      for (const x of sel.length ? sel : scen.slice(0, 4)) {
        out.push(`### ${x.title || x.axes}${x.wildcard ? ' (wild card)' : ''}`, '');
        out.push(`_${x.axes}_ · plausibility ${x.plausibility || '?'}/5 · impact ${x.impact || '?'}/5`, '');
        if (x.story) out.push(x.story, '');
      }
    }

    const frame = indicatorFrame(s);
    if (s.indicators.length && frame.length) {
      const ids = frame.map((f) => f.id);
      const label = (id) => frame.find((f) => f.id === id)?.label || '(removed)';
      out.push('## Indicators', '');
      out.push(table(['Indicator', 'Points to', 'Diagnostic', 'Score', 'Status'],
        s.indicators.filter((i) => ids.includes(i.home))
          .map((i) => ({ i, v: validateIndicator(i, ids) }))
          .sort((a, b) => b.v.ratio - a.v.ratio)
          .map(({ i, v }) => [i.text, label(i.home), v.label, `${v.score}/${v.max}`, INDICATOR_STATUS[i.status] || INDICATOR_STATUS.none])));
      out.push('');
      const mom = indicatorMomentum(s.indicators, ids);
      const moving = frame.filter((f) => mom[f.id].score > 0).sort((a, b) => mom[b.id].score - mom[a.id].score);
      if (moving.length) out.push(`**What the indicators say:** ${moving.map((f) => `${f.label} (${mom[f.id].observed} observed, ${mom[f.id].emerging} emerging)`).join('; ')}.`, '');
    }

    const dec = deceptionAssessment(s.deception.answers);
    if (dec.answered) {
      out.push('## Deception Detection', '');
      out.push(`Concern: **${dec.level}** (${dec.yes} of ${dec.yes + dec.no} answered questions point to deception; ${dec.unknown} unknown).`, '');
      if (s.deception.notes) out.push(s.deception.notes, '');
    }

    const ch = s.challenge;
    const block = (title, fields) => {
      const rows = fields.filter(([, v]) => v);
      if (!rows.length) return;
      out.push(`## ${title}`, '');
      for (const [k, v] of rows) out.push(`**${k}:** ${v}`, '');
    };
    block("Devil's Advocacy", [['Mainline judgment', ch.devil.judgment], ['Challenged assumption', ch.devil.target], ['Case against', ch.devil.case], ['Outcome', ch.devil.verdict]]);
    block('What If? analysis', [['Assume this happened', ch.whatif.event], ['Triggers', ch.whatif.triggers], ['Pathway (thinking backwards)', ch.whatif.pathway], ['Indicators', ch.whatif.indicators], ['Consequences', ch.whatif.consequences]]);
    block('High-Impact/Low-Probability', [['Outcome', ch.hilp.outcome], ['Pathways', ch.hilp.pathways], ['Triggers', ch.hilp.triggers], ['Indicators', ch.hilp.indicators], ['What would deflect it', ch.hilp.deflectors]]);
    block('Premortem', [['We were wrong because', ch.premortem.failure], ['Possible causes', ch.premortem.causes], ['Checks we will do', ch.premortem.checks]]);

    const ku = keyUncertainties(s);
    if (ku.length) {
      out.push('## Key uncertainties and collection requirements', '');
      out.push(table(['Priority', 'Uncertainty', 'From', 'Requirement'], ku.map((k) => [LEVELS[k.impact], k.text, k.origin, k.requirement])));
      out.push('');
    }

    out.push('---', '', '_Structured analytic techniques based on the US Government\'s "A Tradecraft Primer" (2009) and Beebe & Pherson, "Cases in Intelligence Analysis". Scores support the analyst\'s judgment; they do not replace it._');
    return `${out.join('\n')}\n`;
  }

  return {
    LEVELS, LEVEL_WEIGHT, uid, truncate,
    ASSUMPTION_RATINGS, KAC_QUESTIONS, ASSUMPTION_TELLS, assumptionSummary,
    RELIABILITY, INFO_CREDIBILITY, EVIDENCE_TYPES, evidenceWeight, qualityChecks,
    ACH_RATINGS, rating, achScores, achRanking, diagnosticity, achSensitivity, achSummary, achWarnings,
    DRIVER_CATEGORIES, DRIVER_CLASSES, classifyDriver, suggestScenarioDrivers,
    quadrantKey, scenarioMatrices, matrixCount, votesPerParticipant, isWildcard, scenarioAttention, describeQuadrant, scenarioList,
    LIKELIHOOD, VALIDATOR_POINTS, INDICATOR_CRITERIA, INDICATOR_STATUS, validateIndicator, indicatorMomentum, indicatorFrame,
    DECEPTION_CHECKLIST, deceptionAssessment,
    keyUncertainties, analyticConfidence,
    TLP, emptyState, normalize, buildReport,
  };
});
