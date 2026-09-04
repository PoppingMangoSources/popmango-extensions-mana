/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import { FilterID, PreferenceID } from "./model.ts";

/**
 * Kagane publishes its tags as one flat list of several hundred names and says nothing
 * about how they relate, so the grouping here is read off the names themselves. Each
 * group claims the names its patterns match, in the order listed, and whatever no group
 * claims goes to the last one — which is why that one exists rather than being an
 * admission of failure. Adding a pattern is the whole of adding a tag to a group.
 */
export type TagGroup = {
  id: string;
  title: string;
  /** Tested against the lowercased tag name. The last group has none and takes the rest. */
  match?: RegExp;
};

const OTHER_TAGS: TagGroup = { id: "other", title: "Other Tags" };

export const TAG_GROUPS: readonly TagGroup[] = [
  {
    id: "sexual-content",
    title: "Sexual Content",
    match:
      /\b(sex|sexual|smut|erotic|nudity|nude|intercourse|orgasm|masturbat|fellatio|blowjob|handjob|paizuri|titjob|anal|anilingus|cunnilingus|creampie|deepthroat|bondage|bdsm|fetish|kink|kinky|threesome|orgy|voyeur|exhibition|incest|netorare|ntr|rape|non-?con|dubcon|prostitut|brothel|harem sex|foreplay|climax|ecchi|hentai|lewd|aphrodisiac|sex toy|dildo|vibrator|spanking|choking|breeding|impregnat|pregnancy fetish|lactation|nipple|penis|vagina|genital|cum|semen|virgin)/,
  },
  {
    id: "relationships",
    title: "Relationships",
    match:
      /\b(romance|romantic|love|lover|couple|marriage|married|wedding|engagement|fianc|divorce|dating|courtship|arranged|contract(ual)? relationship|polyamory|harem|reverse harem|love triangle|unrequited|childhood friend|first love|crush|jealous|possessive|yaoi|yuri|bl\b|gl\b|shounen ai|shoujo ai|boys.? love|girls.? love|omegaverse|alpha|beta|omega|seme|uke|family|sibling|brother|sister|father|mother|parent|daughter|son\b|cousin|twin|adopt|orphan|friendship|rival|enemies to lovers|slow burn|age gap|forbidden love)/,
  },
  {
    id: "character-types",
    title: "Character Types",
    match:
      /\b(protagonist|male lead|female lead|antagonist|villain|villainess|heroine|hero\b|anti-?hero|(main|side|supporting|multiple) character|ensemble cast|narrator|strong female|strong male|weak to strong|overpowered|underdog|genius|prodigy|chosen one|reincarnat|transmigrat|regressor|returnee|isekai)/,
  },
  {
    id: "character-traits",
    title: "Character Traits",
    match:
      /\b(tsundere|yandere|kuudere|dandere|deredere|shy|cold|stoic|cheerful|cynic|arrogant|kind|cruel|ruthless|naive|clever|cunning|lazy|hardworking|stubborn|loyal|selfish|selfless|blind|deaf|mute|disab|illness|ill\b|sick|scar|trauma|amnesia|glasses|beautiful|handsome|ugly|short|tall|muscular|petite|hair|eyed|eyes|freckle|tattoo|piercing|beauty mark|birthmark|mole\b|dimple|heterochromia|personality|introvert|extrovert|mature|childish|immortal)/,
  },
  {
    id: "occupations",
    title: "Occupations & Roles",
    match:
      /\b(student|teacher|professor|doctor|nurse|surgeon|lawyer|judge|police|detective|soldier|knight|samurai|ninja|mercenary|assassin|guard|hunter|adventurer|merchant|trader|farmer|chef|cook|baker|barista|waiter|maid|butler|servant|slave|noble|aristocrat|royal|king|queen|prince|princess|emperor|empress|duke|duchess|lord|lady|priest|nun|monk|shaman|witch|wizard|mage|sorcer|alchemist|blacksmith|artist|painter|writer|author|novelist|journalist|reporter|photographer|musician|singer|idol|actor|actress|model\b|dancer|athlete|gamer|streamer|programmer|engineer|scientist|researcher|pilot|driver|sailor|pirate|thief|gangster|mafia|yakuza|criminal|office|salaryman|ceo|boss|secretary|employee|worker|job\b|career|profession)/,
  },
  {
    id: "species",
    title: "Species & Creatures",
    match:
      /\b(demon|devil|angel|god\b|goddess|deity|spirit|ghost|undead|zombie|vampire|werewolf|beast|beastman|kemonomimi|catgirl|foxgirl|dragon|elf|dwarf|orc|goblin|fairy|mermaid|siren|monster|kaiju|slime|golem|robot|android|cyborg|ai\b|alien|youkai|yokai|kitsune|oni|familiar|animal|cat\b|dog\b|wolf|fox\b|bird|dinosaur|insect|human|non-?human|hybrid|shapeshift|transformation)/,
  },
  {
    id: "setting",
    title: "Setting & World",
    match:
      /\b(school|academy|university|college|classroom|dorm|workplace|hospital|prison|island|village|town|city|capital|kingdom|empire|palace|castle|mansion|dungeon|tower|forest|desert|mountain|ocean|sea\b|space|planet|station|underground|another world|other world|parallel|virtual|game world|apocalyp|post-?apocalyp|dystopia|utopia|wasteland|medieval|victorian|edo|feudal|ancient|modern|contemporary|futur|historical|steampunk|cyberpunk|magic world|world building|setting|location|countryside|urban|rural)/,
  },
  {
    id: "themes",
    title: "Themes & Genres",
    match:
      /\b(action|adventure|comedy|drama|tragedy|horror|thriller|mystery|suspense|fantasy|sci-?fi|science fiction|slice of life|psychological|philosoph|political|military|war\b|crime|sports|music|cooking|food|medical|educational|historical fiction|supernatural|magic|superpower|martial arts|mecha|survival|revenge|redemption|coming of age|growth|healing|wholesome|dark|gore|violence|death|grief|loss|betrayal|friendship theme|justice|freedom|identity|memory|time travel|time loop|reincarnation theme|religion|mythology|folklore)/,
  },
  {
    id: "narrative",
    title: "Narrative & Tropes",
    match:
      /\b(plot|story|narrative|trope|cliffhanger|flashback|foreshadow|twist|open ending|happy ending|sad ending|bittersweet|tragic ending|episodic|serial|anthology|one-?shot|multiple (endings|timelines|perspectives)|nonlinear|non-?linear|unreliable|misunderstanding|secret identity|hidden|disguise|mistaken identity|love at first sight|found family|training|tournament|competition|quest|journey|escape|rescue|conspiracy|deception|betray|level|system|status window|skill|class change|guild|party|raid|boss battle)/,
  },
  {
    id: "content-warnings",
    title: "Content Warnings",
    match:
      /\b(abuse|abusive|assault|torture|murder|suicide|self-?harm|bully|harass|discriminat|racism|slavery|addiction|drug|alcohol|smoking|animal cruelty|child abuse|domestic violence|kidnap|human trafficking|cannibal|body horror|graphic|disturbing|trigger|warning|sensitive|mental (health|illness)|depression|anxiety|ptsd|eating disorder)/,
  },
  {
    id: "presentation",
    title: "Format & Presentation",
    match:
      /\b(full colou?r|black and white|colou?red|webtoon|webcomic|four-?koma|4-?koma|yonkoma|long ?strip|manhwa|manhua|manga|novel|light novel|adapt|adaptation|based on|original work|anthology format|art style|artwork|illustration|censor|uncensor|official|fan ?made|doujin|remake|reboot|sequel|prequel|spin-?off|crossover|ongoing|completed|hiatus|oneshot|short|serialis|serializ)/,
  },
  {
    id: "audience",
    title: "Audience",
    match:
      /\b(shounen|shonen|shoujo|shojo|seinen|josei|kodomo|all ages|adult|mature|teen|young adult|demographic|audience|children)/,
  },
  // Everything the patterns above did not claim. It is a real group, not a leftover: a
  // tag that fits nowhere is still one a reader may want to pick or hide.
  OTHER_TAGS,
];

export type GroupedTags = { group: TagGroup; options: Option[] };

/** Splits the site's flat tag list across the groups above, dropping the empty ones. */
export function groupTags(options: Option[]): GroupedTags[] {
  const buckets = new Map<string, Option[]>(TAG_GROUPS.map((group) => [group.id, []]));

  for (const option of options) {
    const name = option.title.toLowerCase();
    const group = TAG_GROUPS.find((candidate) => candidate.match?.test(name) === true);
    buckets.get(group?.id ?? OTHER_TAGS.id)?.push(option);
  }

  return TAG_GROUPS.flatMap((group) => {
    const bucket = buckets.get(group.id) ?? [];
    return bucket.length > 0 ? [{ group, options: bucket }] : [];
  });
}

/** The search filter a group's picker answers to. */
export function tagFilterId(groupId: string): string {
  return `${FilterID.Tags}:${groupId}`;
}

/** The setting a group's hide-list is stored under. */
export function excludedTagsKey(groupId: string): string {
  return `${PreferenceID.ExcludedTags}:${groupId}`;
}

/** Every key a hidden tag may live under, the ungrouped one this replaced included. */
export const EXCLUDED_TAG_KEYS: readonly string[] = [
  PreferenceID.ExcludedTags,
  ...TAG_GROUPS.map((group) => excludedTagsKey(group.id)),
];
