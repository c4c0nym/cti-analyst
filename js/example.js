/*
 * Worked example: a fictional OT incident at a fictional water utility.
 * All organisations, groups and events are invented for demonstration.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EXAMPLE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r = (row) => row; // readability helper for the ratings table

  return {
    version: 1,
    meta: {
      title: 'Setpoint change at Harbor County Water (fictional case)',
      question: 'Who changed the chemical dosing setpoint on the Harbor County Water HMI on 3 March, and why?',
      analyticLine: 'A hacktivist group compromised the internet-exposed HMI and changed the setpoint, as it claimed on its Telegram channel.',
      horizon: 'Attribution now; threat outlook for the next 12 months',
      analyst: 'CTI team',
      tlp: 'TLP:AMBER',
      updated: '',
    },
    assumptions: [
      { id: 'a1', text: 'The HMI event log and session records are complete and have not been altered.', commentary: 'Logs are stored locally on the HMI. An intruder with admin rights could edit them; there is no off-box log copy.', rating: 'caveat', impact: 'H', whatWouldChange: 'Gaps in sequence numbers, or a mismatch with the firewall logs.' },
      { id: 'a2', text: 'The screenshot posted on Telegram shows our HMI during this incident.', commentary: 'Tag names match; the clock in the screenshot is cropped, so the time cannot be confirmed.', rating: 'caveat', impact: 'H', whatWouldChange: 'Evidence that the screenshot predates 3 March or comes from a similar plant.' },
      { id: 'a3', text: 'The former contractor\'s credentials were not shared, reused or sold.', commentary: 'Nobody has checked. The account was never disabled after the contract ended in 2024.', rating: 'unsupported', impact: 'H', whatWouldChange: 'The credentials appearing in a stealer log or on a forum.' },
      { id: 'a4', text: 'A state actor would avoid noisy, physical-effect actions in peacetime.', commentary: 'Generally true for pre-positioning, but some states have used hacktivist personas for exactly this kind of signalling.', rating: 'caveat', impact: 'H', whatWouldChange: 'Advisories that link the persona to a state service.' },
      { id: 'a5', text: 'The known firmware bug cannot create remote-session log entries.', commentary: 'Confirmed by the vendor in writing.', rating: 'solid', impact: 'M', whatWouldChange: '' },
      { id: 'a6', text: 'Only an outsider would connect through a commercial VPN.', commentary: 'Insiders and contractors use commercial VPNs too.', rating: 'unsupported', impact: 'M', whatWouldChange: '' },
    ],
    evidence: [
      { id: 'e1', text: 'HMI log: setpoint raised to maximum during a remote VNC session at 03:12', source: 'HMI event log', type: 'Telemetry / logs', date: '2026-03-03', reliability: 'B', infoCredibility: '2', credibility: 'H', relevance: 'H', corroborated: true },
      { id: 'e2', text: 'VNC was reachable from the internet with a weak shared password', source: 'External attack surface scan', type: 'Forensics', date: '2026-03-03', reliability: 'A', infoCredibility: '1', credibility: 'H', relevance: 'M', corroborated: true },
      { id: 'e3', text: 'Self-described hacktivist channel posted an HMI screenshot two hours later and claimed the attack', source: 'Telegram channel', type: 'OSINT', date: '2026-03-03', reliability: 'D', infoCredibility: '3', credibility: 'M', relevance: 'H', corroborated: false },
      { id: 'e4', text: 'Screenshot metadata shows a time-zone offset far from the group\'s claimed home region', source: 'Telegram channel', type: 'OSINT', date: '2026-03-03', reliability: 'D', infoCredibility: '4', credibility: 'L', relevance: 'M', corroborated: false },
      { id: 'e5', text: 'Session came from a commercial VPN exit node', source: 'Firewall log', type: 'Telemetry / logs', date: '2026-03-03', reliability: 'B', infoCredibility: '2', credibility: 'H', relevance: 'L', corroborated: true },
      { id: 'e6', text: 'No ransom note, encryption or data exfiltration observed', source: 'IR team', type: 'Forensics', date: '2026-03-05', reliability: 'B', infoCredibility: '2', credibility: 'H', relevance: 'M', corroborated: true },
      { id: 'e7', text: 'The account used belonged to a former contractor and was never disabled', source: 'HMI event log', type: 'Telemetry / logs', date: '2026-03-04', reliability: 'B', infoCredibility: '2', credibility: 'H', relevance: 'H', corroborated: true },
      { id: 'e8', text: 'Vendor advisory: a firmware bug can cause spurious setpoint changes', source: 'Vendor advisory', type: 'Vendor report', date: '2025-11-20', reliability: 'B', infoCredibility: '2', credibility: 'M', relevance: 'L', corroborated: false },
      { id: 'e9', text: 'Two of the channel\'s earlier claims against other utilities were shown to be fabricated', source: 'Sector ISAC', type: 'Government advisory', date: '2026-02-10', reliability: 'B', infoCredibility: '2', credibility: 'M', relevance: 'M', corroborated: true },
      { id: 'e10', text: 'The change was crude (setpoint to maximum) and the operator reverted it within 20 minutes', source: 'Operator statement', type: 'HUMINT', date: '2026-03-03', reliability: 'A', infoCredibility: '2', credibility: 'H', relevance: 'M', corroborated: true },
      { id: 'e11', text: 'No living-off-the-land activity or persistence found on the IT/OT boundary', source: 'IR team', type: 'Absence of evidence', date: '2026-03-06', reliability: 'B', infoCredibility: '3', credibility: 'M', relevance: 'H', corroborated: false },
    ],
    hypotheses: [
      { id: 'h1', text: 'A state-sponsored group pre-positioning in the water sector', deception: false, missing: 'Persistence, credential theft or reconnaissance of other OT assets.' },
      { id: 'h2', text: 'The hacktivist group that claimed it, acting opportunistically', deception: false, missing: 'Earlier scanning of our range by infrastructure linked to the group.' },
      { id: 'h3', text: 'A financially motivated (ransomware) actor', deception: false, missing: 'Ransom demand, extortion contact or data theft.' },
      { id: 'h4', text: 'An insider or former contractor', deception: false, missing: 'Motive, or use of the account from a known personal IP.' },
      { id: 'h5', text: 'Equipment or software malfunction (no intrusion)', deception: false, missing: '' },
      { id: 'h6', text: 'Another actor posing as hacktivists (false flag)', deception: true, missing: 'Infrastructure overlap between the persona and a known actor.' },
    ],
    ratings: {
      e1: r({ h1: 'C', h2: 'C', h3: 'C', h4: 'C', h5: 'II', h6: 'C' }),
      e2: r({ h1: 'N', h2: 'CC', h3: 'C', h4: 'N', h5: 'N', h6: 'C' }),
      e3: r({ h1: 'I', h2: 'CC', h3: 'I', h4: 'I', h5: 'II', h6: 'C' }),
      e4: r({ h1: 'C', h2: 'I', h3: 'N', h4: 'N', h5: 'NA', h6: 'CC' }),
      e5: r({ h1: 'C', h2: 'C', h3: 'C', h4: 'C', h5: 'NA', h6: 'C' }),
      e6: r({ h1: 'C', h2: 'C', h3: 'II', h4: 'C', h5: 'C', h6: 'C' }),
      e7: r({ h1: 'C', h2: 'C', h3: 'C', h4: 'CC', h5: 'I', h6: 'C' }),
      e8: r({ h1: 'N', h2: 'N', h3: 'N', h4: 'N', h5: 'C', h6: 'N' }),
      e9: r({ h1: 'N', h2: 'N', h3: 'N', h4: 'N', h5: 'N', h6: 'C' }),
      e10: r({ h1: 'I', h2: 'CC', h3: 'I', h4: 'C', h5: 'C', h6: 'N' }),
      e11: r({ h1: 'I', h2: 'C', h3: 'N', h4: 'C', h5: 'C', h6: 'N' }),
    },
    drivers: [
      { id: 'd1', name: 'Adversary intent towards the water sector', category: 'adversary', low: 'Opportunistic disruption', high: 'Strategic pre-positioning', impact: 5, uncertainty: 4, notes: '' },
      { id: 'd2', name: 'Exposure of OT remote access', category: 'defender', low: 'Locked down (VPN + MFA)', high: 'Still internet-exposed', impact: 5, uncertainty: 4, notes: 'Depends on the remediation budget and on other utilities in the region.' },
      { id: 'd3', name: 'Regional geopolitical tension', category: 'political', low: 'De-escalating', high: 'Escalating', impact: 4, uncertainty: 5, notes: '' },
      { id: 'd4', name: 'Availability of OT-capable tooling', category: 'technological', low: 'Bespoke and scarce', high: 'Commodity', impact: 4, uncertainty: 2, notes: 'Already commodity for exposed HMIs.' },
      { id: 'd5', name: 'Hacktivist group cohesion', category: 'social', low: 'Fragmenting', high: 'Growing', impact: 3, uncertainty: 4, notes: '' },
      { id: 'd6', name: 'Media and regulator attention', category: 'political', low: 'Low', high: 'High', impact: 2, uncertainty: 3, notes: '' },
    ],
    scenarioDrivers: ['d1', 'd2', 'd3'],
    scenarios: {
      'd1|d2|low|low': { title: 'Noise at the gate', story: 'Hacktivist personas keep scanning and posting claims, but remote access is behind VPN and MFA. Most claims are recycled screenshots; the real effect is reputational.', plausibility: 4, impact: 2, selected: false },
      'd1|d2|low|high': { title: 'Repeat defacement', story: 'Copycat groups find exposed HMIs at smaller utilities and make crude setpoint changes for screenshots. Operators catch most of them, but one gets through at night.', plausibility: 4, impact: 3, selected: true },
      'd1|d2|high|low': { title: 'Quiet persistence', story: 'A state actor gets in through IT or a supplier, lives off the land and maps OT networks without any visible effect, waiting for a political trigger.', plausibility: 3, impact: 5, selected: true },
      'd1|d2|high|high': { title: 'Coordinated disruption', story: 'Under a hacktivist persona, a state actor causes simultaneous disruptions at several exposed utilities during a regional crisis, overwhelming incident response.', plausibility: 2, impact: 5, selected: true },
      'd1|d3|high|high': { title: 'Crisis-triggered sabotage', story: 'Pre-positioned access is used for physical effect once tension escalates. Hacktivist claims provide cover and slow attribution.', plausibility: 2, impact: 5, selected: false },
      'd2|d3|high|low': { title: 'Steady drip', story: 'With tension low and exposure unchanged, opportunistic incidents keep happening at a low rate. Nobody funds the fix until a bad one.', plausibility: 4, impact: 3, selected: false },
    },
    indicatorFrame: 'scenarios',
    indicators: [
      { id: 'i1', text: 'New HMI screenshots from utilities in the region appear on hacktivist channels', home: 'd1|d2|low|high', homeRating: 'HL', ratings: { 'd1|d2|high|low': 'U', 'd1|d2|high|high': 'L' }, status: 'emerging', criteria: { observable: true, valid: true, reliable: true, stable: true, unique: false } },
      { id: 'i2', text: 'Scanning of VNC/5900 against sector IP ranges increases', home: 'd1|d2|low|high', homeRating: 'L', ratings: { 'd1|d2|high|low': 'C', 'd1|d2|high|high': 'L' }, status: 'observed', criteria: { observable: true, valid: true, reliable: true, stable: true, unique: false } },
      { id: 'i3', text: 'Credential dumping or unusual admin tooling found on the IT/OT boundary', home: 'd1|d2|high|low', homeRating: 'HL', ratings: { 'd1|d2|low|high': 'HU', 'd1|d2|high|high': 'L' }, status: 'none', criteria: { observable: true, valid: true, reliable: true, stable: true, unique: true } },
      { id: 'i4', text: 'Government advisory names the water sector as a pre-positioning target', home: 'd1|d2|high|low', homeRating: 'L', ratings: { 'd1|d2|low|high': 'U', 'd1|d2|high|high': 'HL' }, status: 'none', criteria: { observable: true, valid: true, reliable: true, stable: true, unique: false } },
      { id: 'i5', text: 'Incidents at several utilities within 24 hours', home: 'd1|d2|high|high', homeRating: 'HL', ratings: { 'd1|d2|low|high': 'U', 'd1|d2|high|low': 'HU' }, status: 'none', criteria: { observable: true, valid: true, reliable: true, stable: true, unique: true } },
      { id: 'i6', text: 'A persona with no history suddenly claims capable OT attacks', home: 'd1|d2|high|high', homeRating: 'L', ratings: { 'd1|d2|low|high': 'C', 'd1|d2|high|low': 'U' }, status: 'emerging', criteria: { observable: true, valid: true, reliable: false, stable: true, unique: true } },
    ],
    deception: {
      answers: { w1: 'yes', w2: 'unknown', w3: 'yes', w4: 'no', w5: 'yes', w7: 'yes', m1: 'yes', m2: 'yes', m3: 'yes', m4: 'yes', m5: 'yes', p1: 'unknown', p2: 'unknown', s1: 'yes', s2: 'yes', s4: 'yes', e3: 'no', e4: 'yes', e5: 'yes', e6: 'yes' },
      notes: 'The only attribution evidence is a channel the actor controls. Treat the claim as a hypothesis, not a fact.',
    },
    challenge: {
      devil: {
        judgment: 'A hacktivist group compromised the HMI, as it claimed.',
        target: 'The screenshot shows our HMI during this incident.',
        case: 'The claim is the only thing that ties a hacktivist group to the incident, and the group has fabricated claims before. A former contractor\'s account was used, which no opportunist would know about without stolen credentials. The time-zone artefact points away from the persona. An insider or a false flag fits the evidence at least as well.',
        verdict: 'Keep the hacktivist hypothesis as the lead, caveat it heavily, and check the contractor account before publishing.',
      },
      whatif: { event: '', triggers: '', pathway: '', indicators: '', consequences: '' },
      hilp: {
        outcome: 'Simultaneous dosing manipulation at several utilities causes a public health incident.',
        pathways: 'Pre-positioned access (Quiet persistence) is activated during a crisis; a hacktivist persona claims it.',
        triggers: 'Sharp regional escalation; sanctions; an attack on the sponsor state\'s infrastructure.',
        indicators: 'See i3, i4 and i5. Also an unusual interest in dosing PLC models on forums.',
        deflectors: 'Off-box logging, MFA on all remote access, manual dosing limits, and sector information sharing.',
      },
      premortem: {
        failure: 'Six months later, forensics show the setpoint change came from the former contractor.',
        causes: 'We anchored on the public claim; nobody checked the dormant account; the claim was opportunistic.',
        checks: 'Interview the contractor; check the credentials against stealer-log feeds; compare the firewall and HMI logs.',
      },
    },
    gaps: [
      { id: 'g1', text: 'Whether the former contractor\'s credentials have leaked', impact: 'H', requirement: 'Search stealer-log and breach data for the account; ask the contractor\'s employer.' },
    ],
    start: {
      prompt: 'An operator alarm at 03:15 on 3 March, followed two hours later by a public claim on a hacktivist Telegram channel.',
      customer: 'The utility\'s CISO (containment and disclosure) and the regional sector ISAC (warning other utilities).',
      importance: 'It would be the first confirmed manipulation of a dosing setpoint in the region. Other utilities with exposed HMIs need to know whether to act now.',
      known: 'HMI and firewall logs, the operator\'s statement, the Telegram post, the ISAC\'s notes on the channel. An IR team is on site.',
      deadline: 'Initial assessment to the CISO and ISAC within 48 hours.',
    },
    starburst: {
      who: [
        { id: 'q1', text: 'Who knew the former contractor\'s account still worked?', support: 'none' },
        { id: 'q2', text: 'Who runs the Telegram channel, and since when?', support: 'indirect' },
      ],
      what: [
        { id: 'q3', text: 'What else did the session touch besides the setpoint?', support: 'evidence' },
      ],
      how: [
        { id: 'q4', text: 'How did the attacker get the VNC password: guessing, reuse or a leak?', support: 'none' },
        { id: 'q5', text: 'How was the HMI found: mass scanning or targeting?', support: 'indirect' },
      ],
      when: [
        { id: 'q6', text: 'When was the account first used after the contract ended?', support: 'none' },
      ],
      where: [
        { id: 'q7', text: 'Where was the screenshot taken: our HMI, or a similar one elsewhere?', support: 'indirect' },
      ],
      why: [
        { id: 'q8', text: 'Why change the setpoint to maximum, which an operator would notice at once?', support: 'indirect' },
        { id: 'q9', text: 'Why post the claim two hours later rather than immediately?', support: 'none' },
      ],
    },
    timeline: [
      { id: 't1', date: '2024-09-30', time: '', text: 'Contractor\'s engagement ends; HMI account not disabled', source: 'HR records', confidence: 'H' },
      { id: 't2', date: '2026-02-10', time: '', text: 'ISAC reports two of the channel\'s claims as fabricated', source: 'Sector ISAC', confidence: 'M' },
      { id: 't3', date: '2026-02-27', time: '14:00', text: 'First connections to VNC from commercial VPN ranges', source: 'Firewall log', confidence: 'H' },
      { id: 't4', date: '2026-03-03', time: '03:08', text: 'VNC login with the former contractor\'s account', source: 'HMI event log', confidence: 'H' },
      { id: 't5', date: '2026-03-03', time: '03:12', text: 'Dosing setpoint raised to maximum', source: 'HMI event log', confidence: 'H' },
      { id: 't6', date: '2026-03-03', time: '03:32', text: 'Operator reverts the setpoint and disconnects VNC', source: 'Operator statement', confidence: 'H' },
      { id: 't7', date: '2026-03-03', time: '05:10', text: 'Telegram channel posts HMI screenshot and claims the attack', source: 'Telegram channel', confidence: 'M' },
      { id: 't8', date: '2026-03-06', time: '', text: 'IR team finds no persistence on the IT/OT boundary', source: 'IR team', confidence: 'M' },
    ],
    mhg: {
      components: {
        who: { lead: 'The hacktivist group that claimed it', alts: 'A state-sponsored group\nThe former contractor\nA criminal access broker' },
        what: { lead: 'changed the dosing setpoint', alts: '' },
        how: { lead: 'the internet-exposed VNC password', alts: 'the dormant contractor account' },
        when: { lead: '', alts: '' },
        where: { lead: '', alts: '' },
        why: { lead: 'publicity', alts: 'signalling and intimidation\ntesting access for later use\na personal grievance' },
      },
      scores: {
        'who=The hacktivist group that claimed it|how=the internet-exposed VNC password|why=publicity': 3,
        'who=The hacktivist group that claimed it|how=the dormant contractor account|why=publicity': 3,
        'who=A state-sponsored group|how=the dormant contractor account|why=testing access for later use': 3,
        'who=A state-sponsored group|how=the dormant contractor account|why=signalling and intimidation': 2,
        'who=The former contractor|how=the dormant contractor account|why=a personal grievance': 4,
        'who=A criminal access broker|how=the dormant contractor account|why=testing access for later use': 3,
        'who=The former contractor|how=the internet-exposed VNC password|why=publicity': 1,
      },
    },
    crossImpact: {
      d1: { d2: 0, d3: 0, d4: 1, d5: 1, d6: 1 },
      d2: { d1: 1, d6: 1 },
      d3: { d1: 2, d4: 1, d5: 2, d6: 2 },
      d4: { d1: 1, d5: 1 },
      d5: { d6: 1 },
      d6: { d2: -1 },
    },
    decision: {
      forceField: {
        question: 'Should we publicly attribute the incident to the hacktivist group now?',
        factors: [
          { id: 'f1', side: 'for', text: 'The group has publicly claimed it, and the screenshot shows our HMI tags', strength: 3 },
          { id: 'f2', side: 'for', text: 'Other utilities need a clear warning quickly', strength: 4 },
          { id: 'f3', side: 'for', text: 'Media are already reporting the claim', strength: 2 },
          { id: 'f4', side: 'against', text: 'The channel has fabricated claims before', strength: 4 },
          { id: 'f5', side: 'against', text: 'The session used a dormant insider account nobody has explained', strength: 5 },
          { id: 'f6', side: 'against', text: 'A wrong attribution would amplify a possible false flag', strength: 4 },
        ],
      },
      swot: {
        objective: 'Join the regional OT information-sharing pilot run by the sector ISAC.',
        strengths: 'Good HMI and firewall logging\nAn operator who caught the change within 20 minutes',
        weaknesses: 'No off-box log copy\nNo account lifecycle process for contractors',
        opportunities: 'Early warning from other utilities\nShared indicator lists and analyst time',
        threats: 'Sensitive details could leak from the pilot\nPersonas monitor public reporting as a feedback channel',
        useS: 'Share our logs and timeline as a case study',
        improveW: 'Ship HMI logs to the SIEM; review all OT accounts',
        exploitO: 'Subscribe to the pilot\'s exposed-HMI alerts',
        mitigateT: 'Share at TLP:AMBER; keep attribution assessments out of public channels',
      },
      pcff: {
        action: 'Warn sector partners now that the claimed group targets exposed HMIs.',
        pros: [
          { id: 'p1', text: 'Partners can check their own exposure before a repeat', fault: 'The warning helps whoever the actor is; it does not need the attribution' },
          { id: 'p2', text: 'Shows the ISAC is responsive', fault: '' },
        ],
        cons: [
          { id: 'c1', text: 'If it was a false flag, we amplify the deception', fix: 'Warn about the technique (exposed VNC, dormant accounts), not the group' },
          { id: 'c2', text: 'Could reveal that our logs are incomplete', fix: 'Share at TLP:AMBER with partners only' },
        ],
      },
      matrix: {
        question: 'Which remediation should we do first?',
        criteria: [
          { id: 'k1', text: 'Reduces the chance of a repeat', weight: 40 },
          { id: 'k2', text: 'Speed to implement', weight: 30 },
          { id: 'k3', text: 'Improves attribution next time', weight: 20 },
          { id: 'k4', text: 'Low cost', weight: 10 },
        ],
        options: [
          { id: 'o1', text: 'Remove VNC from the internet' },
          { id: 'o2', text: 'Disable dormant accounts + MFA' },
          { id: 'o3', text: 'Off-box logging' },
        ],
        values: {
          k1: { o1: 5, o2: 4, o3: 1 },
          k2: { o1: 5, o2: 3, o3: 2 },
          k3: { o1: 1, o2: 2, o3: 7 },
          k4: { o1: 5, o2: 3, o3: 2 },
        },
      },
    },
    judgments: [
      { id: 'j1', text: 'The setpoint change was a deliberate human action through a remote session, not a malfunction.', likelihood: 'almost_certain', confidence: 'high', basis: 'HMI session log, vendor confirmation that the firmware bug cannot create session entries, and the operator\'s statement.' },
      { id: 'j2', text: 'The group that claimed the attack carried it out.', likelihood: 'even', confidence: 'low', basis: 'The only link is the group\'s own claim; the dormant contractor account and the time-zone artefact are unexplained.' },
      { id: 'j3', text: 'Another utility in the region will see a similar intrusion through exposed remote access within 12 months.', likelihood: 'likely', confidence: 'moderate', basis: 'Rising VNC scanning and the number of exposed HMIs in the sector.' },
    ],
    selfCritique: {
      sc1: { status: 'ok', note: 'Six hypotheses, including insider, malfunction and false flag.' },
      sc2: { status: 'concern', note: 'Nobody has checked whether the contractor credentials leaked.' },
      sc3: { status: 'concern', note: 'The ranking hinges on the time-zone artefact in an actor-controlled screenshot.' },
      sc5: { status: 'concern', note: 'High deception concern: the attribution evidence comes from the actor\'s own channel.' },
      sc6: { status: 'ok', note: 'No persistence found; consistent with an opportunistic or insider action.' },
      sc7: { status: 'concern', note: 'Risk of anchoring on the public claim.' },
    },
  };
});
