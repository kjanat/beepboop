// @ts-check

import { findMatches, reasonsFrom } from './matchers.mjs';
import { technicalRules } from './technical-prose.mjs';

/** @typedef {import('./matchers.mjs').Rule} Rule */
/** @typedef {import('./matchers.mjs').WordingMatch} WordingMatch */

const CONTRAST_GUIDANCE =
	'Check whether the comparison explains a real constraint. If it does, keep it; otherwise describe the chosen behavior directly.';
const NON_EFFECT =
	'(?:un(?:changed|affected|altered|modified|touched|interrupted|disturbed|impacted)|intact|as[- ]is|the same)';
const EFFECT_VERB = '(?:affect|alter|change|touch|modify|interrupt|restart|disrupt|break|disturb|impact)';
const CONTRAST = new RegExp(
	[
		',\\s+not\\s+\\S',
		`\\b(?:remain(?:s|ed|ing)?|stay(?:s|ed|ing)?|is|are|was|were|be|been|being)\\s+(?:(?:otherwise|completely|entirely|fully|still)\\s+)?${NON_EFFECT}\\b`,
		`\\b(?:leave|leaves|leaving|left|keep|keeps|keeping|kept)\\s+(?:[^.;!?\\n]{1,100}?\\s+)?(?:${NON_EFFECT}|alone)\\b`,
		'\\bwithout\\s+(?:affecting|altering|changing|touching|modifying|interrupting|restarting|disrupting|breaking|disturbing|impacting)\\b',
		'\\b(?:without|with no)\\s+(?:any\\s+)?(?:changes?|interruptions?|disruptions?|side[- ]effects?|impact)\\b',
		`\\b(?:(?:does|do|did|will|would|can)\\s+not|doesn't|don't|didn't|won't|wouldn't|can't)\\s+${EFFECT_VERB}\\b`,
		`\\bcontinu(?:e|es|ed|ing)\\s+(?:to\\s+(?:run|work|operate)\\s+)?(?:${NON_EFFECT}|normally|as before|as usual)\\b`,
	].join('|'),
	'i',
);
const VERIFICATION_DISCLAIMER = new RegExp(
	[
		'\\b(?:unverified|untested|unvalidated|unconfirmed)\\b',
		"\\b(?:not|never|hasn't|haven't|wasn't|weren't|isn't|aren't)\\s+(?:(?:yet|been|independently|locally|fully|manually|actually|explicitly|directly|end[- ]to[- ]end)\\s+){0,4}(?:verified|tested|validated|confirmed|checked|proven|established)\\b",
		"\\b(?:cannot|can't|could not|couldn't|unable to)\\s+(?:(?:be|independently|locally|fully|directly)\\s+){0,3}(?:confirm(?:ed)?|verif(?:y|ied)|validat(?:e|ed)|prov(?:e|en)|establish(?:ed)?)\\b",
		"\\b(?:does not|doesn't|do not|don't)\\s+(?:prove|confirm|verify|establish)\\b",
		'\\b(?:verification|validation|testing|tests?|checks?)\\s+(?:(?:is|are|was|were|has|have)\\s+)?(?:not\\s+(?:been\\s+)?(?:performed|run|done)|pending)\\b',
	].join('|'),
	'i',
);

const DETERMINER = '(?:the|a|an|its|their|this|that|these|those|each|every|any)';
const INNER_DETERMINER = '(?:the|a|an|its|their|this|these|those|each|every|any)';
const AUXILIARY =
	'(?:is|are|was|were|be|been|being|has|have|had|will|can|could|should|would|may|might|must|do|does|did|not|and|or)';
const ING_ADJECTIVE =
	'(?!(?:following|remaining|existing|missing|pending|underlying|corresponding|resulting|during|string|setting|thing|something|nothing|anything|everything|warning|morning|evening|building|meaning|beginning|ending|listing|according)\\b)';
const OBJECT_OR_PREPOSITION =
	'(?:it|them|its|their|the|a|an|this|that|these|those|to|from|with|on|in|at|by|for|under|behind|over)';
const POST_MODIFIER = new RegExp(
	`\\b${DETERMINER}\\s+\\w+\\s+${INNER_DETERMINER}\\s+\\w+\\s+\\w+(?:s|ed)\\b`
		+ `|\\b${DETERMINER}\\s+\\w+\\s+that\\s+(?!\\w+s\\b)\\w+\\s+\\w+(?:s|ed)\\b`
		+ `|\\b${DETERMINER}\\s+(?:(?!${AUXILIARY}\\b)\\w+\\s+){1,2}?${ING_ADJECTIVE}\\w+ing\\s+${OBJECT_OR_PREPOSITION}\\b`
		+ `|\\b${DETERMINER}\\s+(?:(?!${AUXILIARY}\\b)\\w+\\s+){1,3}?\\w+ed\\s+by\\b`,
	'i',
);

/** @type {Array<[string, RegExp, string]>} */
const TELLS = [
	[
		'em dash',
		/[—–]/,
		'For ordinary prose, consider a comma, colon, parentheses, or separate sentence. Preserve punctuation that is part of quoted material.',
	],
	['"X, not Y"', CONTRAST, CONTRAST_GUIDANCE],
	['"X rather than Y"', /\brather than\b/i, CONTRAST_GUIDANCE],
	['"X instead of Y"', /\b(?:instead of|as opposed to)\b/i, CONTRAST_GUIDANCE],
	[
		'"X, no longer Y"',
		/\b(?:no longer|in place of|and not)\b|(?<!\b(?:leaves?|left)\b(?:\s+\w+){0,8}\s)\balone\b/i,
		CONTRAST_GUIDANCE,
	],
	[
		'narrated history',
		/(?:^|[.;:]\s+)(?:before|previously|until now|so far),\s|\bused to\b/im,
		'Describe the behavior as it is now. The diff already shows what it replaced.',
	],
	['"not just X but Y"', /\bnot (?:just|merely|only|because)\b[^.]{0,80}?\bbut\b/i, CONTRAST_GUIDANCE],
	[
		'emphatic cleft',
		/\b(?:which|that) is (?:what|why|how)\b|\bexactly (?:what|why|how|the)\b/i,
		'Consider stating the behavior or reason directly. Keep the emphasis if it carries a meaningful distinction.',
	],
	[
		'filler phrase',
		/\b(?:in other words|it(?:'s| is) (?:worth noting|important to note)|that said|under the hood|at its core|(?:simply put|put simply)|in short|in essence|bottom line|needless to say|when it comes to|at the end of the day|think of (?:it|this) as|no more,? no less|(?:that|which) is to say|here(?:'s| is) (?:why|the thing)|the (?:whole|entire) point|the key (?:insight|takeaway))\b/i,
		'Check whether the introductory phrase adds meaning. If the explanation reads clearly without it, omit the phrase.',
	],
	[
		'inflated diction',
		/\b(?:leverag(?:e|es|ing)|utiliz(?:e|es|ing)|seamless(?:ly)?|delv(?:e|es|ing)|myriad|plethora|robust|comprehensive(?:ly)?|crucial(?:ly)?|vital(?:ly)?|elegant(?:ly)?|powerful(?:ly)?|intuitive(?:ly)?|nuanced|holistic|granular|meticulous|facilitat(?:e|es|ing)|streamlin(?:e|es|ing)|empower(?:s|ing)?|cutting[-\s]edge|state[-\s]of[-\s]the[-\s]art|arguably|essentially|fundamentally|a wealth of)\b/i,
		'Consider a plain, precise term. Keep the existing word if it has a specific technical meaning here.',
	],
	[
		'connective glue',
		/\b(?:moreover|furthermore|conversely|as such|it turns out|notably|importantly)\b/i,
		'Check whether the transition helps connect the surrounding points. It can be omitted when that connection is already clear.',
	],
	[
		'counterfactual justification',
		/\bso\b[^.]{0,60}\b(?:cannot|can't|could not|never|would)\b|\bwithout\b[^.]{0,70}\bwould\b|\bwould otherwise\b|\botherwise\b[^.]{0,70}\bwould\b|\bso that\b|\b(?:which|that) (?:prevents|keeps|stops)\b/i,
		'An explanation of a consequence or failure mode can be useful. Keep it when it documents a non-obvious constraint; otherwise state the behavior directly.',
	],
	[
		'verification disclaimer',
		VERIFICATION_DISCLAIMER,
		'Describe the implemented check and its scope. If a verification limit matters, identify the unchecked behavior and the check needed to resolve it.',
	],
	[
		'hedge',
		/\b(?:not (?:yet )?verified|unverified|may (?:be|have|not|still|already)|might|possibly|probably|likely|appears? to|seems? to|cannot (?:be )?(?:confirm|verif|prov|establish)\w*|does not prove|remains? unknown|not (?:been )?(?:checked|proven|confirmed|established))\b/i,
		'State the fact the code establishes. A qualifier such as "may" or "not verified" leaves the reader to guess what was checked.',
	],
	[
		'participial post-modifier',
		POST_MODIFIER,
		'Write a possessive or a plain relative clause: "its origin", "the marker that the daemon writes".',
	],
	[
		'paste artifact',
		/[“”‘’]|[\u00A0\u00AD\u200B-\u200D\uFEFF]/,
		'Check typographic quotes and nonstandard whitespace for accidental pasted characters. Preserve intentional examples and quotations.',
	],
];

const BASELINE_IDS = new Map([
	['em dash', 'em-dash'],
	['"X, not Y"', 'contrast-not'],
	['"X rather than Y"', 'contrast-rather-than'],
	['"X instead of Y"', 'contrast-instead-of'],
	['"X, no longer Y"', 'contrast-no-longer'],
	['narrated history', 'narrated-history'],
	['"not just X but Y"', 'contrast-not-just'],
	['emphatic cleft', 'emphatic-cleft'],
	['filler phrase', 'filler-phrase'],
	['inflated diction', 'inflated-diction'],
	['connective glue', 'connective-glue'],
	['counterfactual justification', 'counterfactual-justification'],
	['verification disclaimer', 'verification-disclaimer'],
	['hedge', 'hedge'],
	['participial post-modifier', 'participial-post-modifier'],
	['paste artifact', 'paste-artifact'],
]);

/** @type {Rule[]} */
export const wordingRules = [
	...TELLS.map(([label, pattern, guidance]) => ({ id: BASELINE_IDS.get(label) ?? label, label, pattern, guidance })),
	...technicalRules,
];

/** @param {string} text @param {string} [searchText] */
export const wordingMatches = (text, searchText) => findMatches(text, wordingRules, searchText);

/** @typedef {{kind: 'commit' | 'description', label: string, text: string, reasons: string[], matches?: WordingMatch[]}} ProseFinding */

/** @param {string} label @param {string} text @returns {ProseFinding[]} */
export function proseFindings(label, text) {
	const matches = wordingMatches(text);
	const reasons = reasonsFrom(matches);
	return reasons.length === 0 ? [] : [{ kind: 'description', label, text, reasons, matches }];
}

const SUBJECT_LIMIT = 50;
const LONG_SUBJECT = `subject longer than ${SUBJECT_LIMIT} characters`;

/** @param {string} label @param {string} message @returns {ProseFinding[]} */
export function commitFindings(label, message) {
	const matches = wordingMatches(message);
	const subject = message.split('\n', 1)[0];
	if (subject.length > SUBJECT_LIMIT) {
		matches.unshift({ ruleId: 'subject-length', label: LONG_SUBJECT, text: subject, start: 0, end: subject.length });
	}
	const reasons = reasonsFrom(matches);
	return reasons.length === 0 ? [] : [{ kind: 'commit', label, text: message, reasons, matches }];
}
