/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import { FilterID, PreferenceID } from "./model.ts";

/**
 * Kagane publishes about eight thousand tags as one flat list, with no grouping, no usage
 * counts, and several spellings of the same idea — `Actor`, `Actor/S` and `Actors` are
 * three entries with three ids. What arrives here is therefore cleaned before it is shown:
 * the uploader scribbles are dropped, spellings of one tag are folded together, and what
 * is left is sorted into groups read off the names themselves.
 *
 * Nothing about a tag says which group it belongs to, so the patterns below are a reading
 * of the site's vocabulary rather than anything it states. A name no pattern claims is
 * offered under Other Tags, which is a real group rather than a failure: in a list this
 * long, a tag nobody thought to describe is still one somebody wants.
 */
export type TagGroup = {
  id: string;
  title: string;
  /** Tested against the lowercased tag name. The last group has none and takes the rest. */
  match?: RegExp;
};

/** How the site names who a descriptor is about: `Cold Female Lead`, `Shy Uke`, `Capable ML`. */
const WHO = String.raw`(lead|protagonist|uke|seme|characters?|cast|mc|ml|fl)`;

const OTHER_TAGS: TagGroup = { id: "other", title: "Other Tags" };

export const TAG_GROUPS: readonly TagGroup[] = [
  {
    id: "time-period",
    title: "Time Period",
    match:
      /\b\d{1,2}(st|nd|rd|th) century\b|^\d{2,4}s$|\b(medieval|victorian|edo|meiji|taisho|showa|heisei|reiwa|renaissance|feudal|prehistor|stone age|bronze age|iron age|ancient|antiquity|colonial|world war|wwi|wwii|cold war|regency|georgian|elizabethan|joseon|dynasty|era\b|period piece|time period|contemporary|near future|far future)/,
  },
  {
    id: "derivative",
    title: "Derivative Work",
    match:
      /\b(based on|adapted (from|into|to)|adaptation|original work|spin-?off|sequel|prequel|remake|reboot|retelling|crossover|parody|fan ?(work|fiction|comic)|doujin|derivative|source material|tie-?in)/,
  },
  {
    id: "spoilers",
    title: "Spoilers",
    match:
      /\b(burned alive|buried alive|eaten alive|character death|dies\b|dead spouse|fake death|presumed dead|comes back to life|revived|resurrect|true identity revealed|secret revealed|twist ending|betrayal revealed)\b/,
  },
  {
    id: "content-warnings",
    title: "Content Warnings",
    match:
      /\b(rape|non-?con|dubcon|dub\/non|molest|assault|abuse|abusive|torture|murder|suicide|self-?harm|bull(y|ies|ying)|harass|slavery|human trafficking|kidnap|abduction|cannibal|gore|graphic violence|body horror|mutilat|animal cruelty|child (abuse|neglect)|domestic violence|incest|drug (use|abuse)|addiction|alcoholism|eating disorder|grooming|stalking|discriminat|racism|homophobia|transphobia|ableism|antisemitism|misogyn|sexism|genocide|war crime|abortion|miscarriage|major character death|dead dove|trigger|warning|rapist|brutality|coercion|degradation|punishment|matricide|parricide|patricide|fratricide|infanticide|shoplifting|fraud|plagiarism|extortion|blackmail|wiretapping|arson|corruption|lawlessness|biological warfare|cuckold|forced|assassination|attempted|adultery|bank robbery|familicide|fascism|nazi|treason|sabotage|victim blaming|pedophile|lolicon|shotacon|csa\b|humiliat|groping|netori|masochism|femdom|psychopath|sociopath|machiavellian|manipulative|trusting wrong person|broken promise|cheater|exile|probation|undercover)/,
  },
  {
    id: "sexual-content",
    title: "Sexual Content",
    match:
      /\b(sex|sexual|intercourse|smut|erotic|nudity|nude|orgasm|masturbat|fellatio|blowjob|handjob|paizuri|titjob|anal|anilingus|cunnilingus|creampie|deepthroat|ahegao|bondage|bdsm|fetish|kink|threesome|foursome|orgy|gangbang|voyeur|exhibition|netorare|ntr|prostitut|brothel|foreplay|ecchi|hentai|lewd|aphrodisia|sex toy|dildo|vibrator|spanking|squirting|breeding|impregnat|lactation|nipple|penis|vagina|genital|cum\b|semen|virgin|seduc|striptease|lingerie|underwear|swimsuit|position\b|69\b|doggy|cowgirl|missionary|mating|heat cycle|knotting|omegaverse|pheromone|oral play|dirty talk|sensitive body|horny|alpha x|omega x|beta x|recessive|dominant alpha|cakeverse|futanari|scissoring|fisting|enema|sounding|vore|chastity|garter|collar\b|handcuff|tail plug|male pregnancy|mpreg|big tits|large breast|realistic breast|body paint|nipple|shimaidon|ashikoki|pederasty|penile|prostate|sexuality|bisexuality|smalldom|female dominance|hardcore|nsfw|gag\b|frigid|double penetration|footjob|feet\b|areola|bodysuit|leggings|stocking|shaving|tentacle|urethral|wet dream|mouth fingering|okama|otokonoko|kuro gyaru|vanilla|fwb\b|ntl\b|pomegaverse|omega\b|beta\b|bottom\b|top\b|suggestive|erotica|chocolate|panchira|golden shower|guro|spitroast|suppository|lust mark|gigolo|asphyxiation|high heels|bikini|nakadashi|irrumatio|gokkun|rimjob|oculolinctus|scat\b|wax play|peeping|biting|choking|musclebottom|devotedtop|shota|fudanshi|gyaru|steamy|redlight|bukkake|dacryphilia|frottage|fingering|shibari|somnophilia|macrophilia|dominatrix|pet play|public use|urination|stripping|facial\b|firsttime|fxckbuddy|dubious consent|hermaphrodite|transvestite|nudist|fundoshi|sadism|physical intimacy|hyper-?sensitiv|special body|gynecomastia|buttock|sweating|strangling|confinement|dirty jokes|bareback|ball (sucking|licking)|bara\b|bestial|big ass|body worship|boobjob|penetration|licking|massage|dom ?x ?sub|dom becomes sub|dom\/sub|domsub)/,
  },
  {
    id: "appearance",
    title: "Appearance",
    match:
      /-(haired|eyed|skinned)\b|\b(hair|eyes|eyebrow|freckle|dimple|beauty mark|birthmark|mole\b|scar|tattoo|piercing|glasses|monocle|eyepatch|beard|moustache|mustache|sideburn|afro|ahoge|braid|ponytail|bald|albino|heterochromia|androgynous|petite|chubby|plump|slim|slender|skinny|obese|muscular|buff|tall|short|tiny|beautiful|handsome|pretty|cute|ugly|attractive|good-?looking|physical deformity|body type|appearance|outfit|uniform|cross-?dress|makeup|accent colou?rs?|chibi|hakama|kimono|apron|special suit|nail-?art|facial expression|tail\b|horns?\b|wings?\b|breast|tits\b|figure|muscles|heart shaped|ribbon|kitsuke|visual kei|body modification|younger than they look|tough girl|hardcover)/,
  },
  {
    id: "character-traits",
    title: "Character Traits",
    match: new RegExp(
      String.raw`\b(tsundere|yandere|kuudere|dandere|deredere|shy|timid|cold|cool|calm|stoic|cheerful|happy|sad|gloomy|cynic|arrogant|proud|humble|kind|gentle|cruel|ruthless|violent|aggressive|passive|naive|innocent|clever|smart|intelligent|dumb|stupid|foolish|cunning|lazy|hardworking|diligent|studious|stubborn|loyal|devoted|selfish|selfless|jealous|possessive|protective|clumsy|serious|playful|mischievous|funny|silly|awkward|blunt|straightforward|honest|liar|manipulat|obsessive|insecure|confident|fearless|brave|coward|rude|polite|bossy|domineering|submissive|assertive|perceptive|capable|competent|incompetent|righteous|immoral|amoral|apathetic|emotionless|expressive|introvert|extrovert|optimist|pessimist|crybaby|crazy|eccentric|weird|mysterious|secretive|annoying|helpful|caring|nurturing|sadis|masochis|delinquent|rebellious|obedient|airhead|forgetful|absent-?minded|workaholic|glutton|perfectionist|hot-?blooded|short-?tempered|patient|impatient|charismatic|hot\b|anti-?social|friendly|unfriendly|flirt|pure|chaste|pervert|otaku|nerd|geek|tomboy|girly|childish|mature|responsible|carefree|reckless|cautious|greedy|generous|vengeful|forgiving|ambitious|determined|good|evil|villainous|heroic|strong|weak|powerful|helpless|lonely|broken|dense|oblivious)\b.*\b` +
        WHO +
        String.raw`\b|\b(tsundere|yandere|kuudere|dandere|deredere|tomboy|otaku|pervert|airhead|workaholic|perfectionist|coward|liar|glutton|crybaby|delinquent|masochist|sadist|introvert|extrovert|personality|temperament|character trait|attitude|emotion|feelings|red flag|boy next door|girl next door|chaebol|camboy|camgirl|troubled-?past|naughty|scheming|averageguy|jock|hardboiled|misanthrop|bad luck|trust issues|pining|bodybuilder|gary stu|genki|hikikomori|haraguro)`,
    ),
  },
  {
    id: "character-types",
    title: "Character Types",
    match: new RegExp(
      String.raw`\b` +
        WHO +
        String.raw`\b|\b(antagonist|villain|villainess|heroine|hero\b|anti-?hero|rival\b|sidekick|mentor|apprentice|disciple|underdog|prodigy|genius|chosen one|reincarnat|transmigrat|regressor|returnee|isekai|overpowered|weak to strong|multiple protagonists|ensemble|narrator|orphan|twin|triplet|quadruplet|sextuplet|only child|eldest|youngest|heir\b|successor|clone|doppelganger|alter ego|split personality|body swap|gender ?bend|possessed|amnesiac|immortal|mortal)`,
    ),
  },
  {
    id: "relationships",
    title: "Relationships",
    match:
      /\b(relationship|romance|romantic|love|lover|beloved|crush|couple|marriage|married|wedding|bride|groom|engagement|fianc|divorce|widow|dating|courtship|arranged|polyamor|harem|love triangle|unrequited|childhood friend|first love|friend|friendship|companion|partner|family|families|sibling|brother|sister|father|mother|parent|dad\b|mom\b|daughter|son\b|child\b|children|baby|babies|grandparent|grandmother|grandfather|uncle|aunt|cousin|nephew|niece|in-?law|adopt|foster|step-?(mother|father|sister|brother|family)|yaoi|yuri|shounen ai|shoujo ai|boys.? love|girls.? love|bl\b|gl\b|gay|lesbian|bisexual|asexual|queer|lgbt|enemies to lovers|slow burn|age gap|forbidden|affair|cheating|infidelity|breakup|reunion|long distance|fake dating|soulmate|fated|second chance|roommate|multiple couple|lovey|longing|nieces|fatherhood|motherhood|older men|old man|oyaji|mistrust|lack of communication|savior complex|drunken confession|girlcrush|class s\b|yamato nadeshiko|banding together|eavesdrop|sweet talker|classmate|neighbo|sempai|kouhai|senpai|matchmaking|first kiss|jealousy|obsession|rejection|dependency|co-?dependan|deliberate loner|girl next door|older female|younger male|manipulative ex|grandson|granddaughter|ancestor|childhood\b|birthday|kiss|bromance|womance|girlfriend|boyfriend|spouse|wife|husband|remarriage|separation|living together|same age|height difference|size difference|flirting|mutual attraction|cohabitation|benchmate|newlywed|pen pal|situationship|opposites attract|hard to get|unusual first meeting|living with strangers|contractlover|stepdaughter|violent ex|enemies become allies|grandma complex|femme fatale)/,
  },
  {
    id: "health",
    title: "Health & Conditions",
    match:
      /phobia\b|\b(illness|ill\b|sick|disease|disorder|syndrome|cancer|tumou?r|anemia|asthma|diabetes|epilepsy|alzheimer|dementia|amnesia|insomnia|allerg|infection|virus|plague|pandemic|epidemic|injur|wound|coma|paralys|disab|handicap|blind|deaf|mute|wheelchair|prosthe|amputee|amputation|chronic|terminal|surgery|medicine|medical|therapy|therapist|psychiatr|psycholog|mental health|schizophren|bipolar|autis|adhd|dyslexia|anorexia|bulimia|pregnan|childbirth|menstrua|puberty|aging|death|dying|near-?death|resurrect|transplant|acupuncture|aphonia|paraplegia|deafness|sleepwalk|necrophilia|coronavirus|bacteria|lifespan|psychoanalysis|sign language|disability|anxiety|angst|hypochondria|obesity|malnutrition|starvation|euthanasia|impotency|infertility|panic attack|mental breakdown|speech impediment|stage fright|synesthesia|illiterate|std\b|recovery|diets?\b|skin care|hypnotis|hypnosis|brainwash|restraint)/,
  },
  {
    id: "occupations",
    title: "Occupations",
    match:
      /\b(student|teacher|professor|principal|tutor|doctor|nurse|surgeon|dentist|urologist|pharmacist|veterinar|lawyer|attorney|judge|prosecutor|police|officer|detective|investigator|spy|agent|soldier|general|commander|knight|samurai|ninja|shinobi|mercenary|assassin|bodyguard|guard|hunter|adventurer|explorer|merchant|trader|shopkeeper|salesman|farmer|fisher|miner|chef|cook|baker|barista|bartender|waiter|waitress|maid|butler|servant|slave\b|noble|aristocrat|royal|king\b|queen\b|prince|princess|emperor|empress|duke|duchess|baron|marquis|lord\b|lady\b|sheikh|pope|priest|nun\b|monk\b|shaman|witch|wizard|mage\b|sorcer|necromancer|summoner|alchemist|blacksmith|carpenter|tailor|artisan|craftsman|artist|painter|sculptor|writer|author|novelist|editor|publisher|journalist|reporter|photographer|director|producer|musician|composer|singer|idol\b|actor|actress|model\b|dancer|comedian|athlete|coach|referee|gamer|streamer|youtuber|influencer|programmer|hacker|engineer|architect|scientist|researcher|inventor|astronaut|pilot|driver|mechanic|sailor|captain|pirate|thief|burglar|gangster|mafia|yakuza|triad|criminal|salaryman|businessman|entrepreneur|ceo\b|boss\b|manager|secretary|accountant|banker|clerk|employee|worker|intern|freelance|unemployed|neet\b|housewife|househusband|babysitter|librarian|curator|archaeolog|historian|translator|interpreter|diplomat|politician|senator|president|minister|mayor|firefighter|paramedic|undertaker|administrator|announcer|courier|delivery|barber|hairdresser|florist|apothecary|herbalist|fortune ?teller|psychic|exorcist|priestess|miko|profession|occupation|job\b|career|workplace|part-?time|bard|butcher|dj\b|djs\b|fighter|gunslinger|jeweler|jockey|loan shark|master\b|masters\b|metalsmith|weaponsmith|swordsm|miser|mortician|porn star|polyglot|grave robber|information broker|con-?man|consort|duke|headmaster|headmistress|subordinate|veteran|follower|impostor|assistant|attendant|archer|artificer|awakener|salesperson|maid\b|host\b|hosts\b|army|armies|guild master|leader|management|manager|retirement|unemploy|truancy|graduation|senior\b|staff|biologist|bookworm|concierge|conqueror|courtesan|escort|gymnast|hostess|landlord|landlady|lifeguard|marchioness|maharaja|pharaoh|prophet|porter|ranger|saint|seamstress|sommelier|strategist|thief|thieves|watchmaker|weaver|womanizer|game developer|talent agency|salaryman|salarymen|cinephile|crooked cop|gang\b|gangs\b|ex-gang|rebel|tyrant|invader|fugitive|captive|substitute|team\b|missions?\b|business|economics|finance|mining|smuggling|nightlife|celebrit|clown|jester|cosplayer|executioner|nutritionist|scholar|vigilante|warlord|childcare|real estate|diplomacy|government|robbery|banks?\b|infirmary|laboratory|konbini|slums|healer|governess|steward|patissier|matchmaker|livestreamer|freeter|oiran|concubine|call boys|playboy|bandit|gladiator|hitman|janitor|locksmith|masseur|negotiator|pediatrician|shoemaker|stylist|terrorist|robber|grave keeper|chiropractor|lecturer|designer|counsel|caretaker|mistress|regent|sultan|mudang|commoner|elite|homeless|gold digger|creatives|broadcasting|modeling|colleague|fbi\b|squad|organization)/,
  },
  {
    id: "species",
    title: "Species & Creatures",
    match:
      /\b(demon|devil|angel|god\b|goddess|deity|divine|spirit|ghost|phantom|undead|zombie|skeleton|vampire|werewolf|lycan|beast|beastman|beastkin|kemonomimi|nekomimi|catgirl|foxgirl|bunnygirl|dragon|wyvern|elf\b|dwarf|orc\b|goblin|troll|ogre|giant|titan|fairy|fae\b|pixie|nymph|mermaid|merman|siren|harpy|centaur|minotaur|golem|gargoyle|slime|monster|kaiju|chimera|griffin|phoenix|unicorn|kitsune|tanuki|oni\b|yokai|youkai|tengu|kappa|komainu|zashiki|shikigami|familiar|summon|robot|android|cyborg|automaton|artificial intelligence|alien|extraterrestrial|mutant|hybrid|half-?(human|demon|elf|blood)|shapeshift|anthropomorph|animal|cat\b|cats\b|dog\b|dogs\b|wolf|fox\b|bird|cattle|horse|dinosaur|reptile|insect|ants?\b|spider|snake|fish\b|whale|dolphin|bear\b|lion|tiger|panda|rabbit|mouse|mice|apes?\b|monkey|alligator|crocodile|parasite|magical creature|mythical|creature|species|race\b|non-?human|humanoid|human\b|bunny girl|squirrel girl|goth girl|cow\b|cows\b|goat|horse|leopard|falcon|pigeon|crow|raven|mummy|mummies|valkyrie|weredog|yuki-?onna|enma|kemono|incubus|succubus|arachne|ayakashi|shapeshift|mimicry|invisibility|hybrid|bakeneko|bunny|bunnies|cyclops|ferret|lizardman|lizardmen|medusa|pig\b|pigs\b|raccoon|shinigami|grim reaper|zoomorphism|wildlife|pointy ear|headless|pureblood|special blood|super sense|regeneration|nanotech|bees?\b|butterfly|butterflies|mosquito|deer|hamster|manticore|dryad|werecat|therianthrope|lizard girl|sheep girl|bat girl|metamorphosis|mutation|telepathy|psychokinesis|precognition|teleportation|elves|elf\b|dwarves|homunculus|dokkaebi|obake|tsukumogami|gorilla|koala|elephant|bull\b|bulls\b|corpse|miniature person|baku\b|kobold|satyr|esper|shape-?shifter|panther|parrot|turtle|swan|wolves|hedgehog|caterpillar|cockroach|seals?\b|mushroom|hades|look-?alike|body double|bones?\b|barbarian|warrior)/,
  },
  {
    id: "locations",
    title: "Locations",
    match:
      /\b(japan|china|korea|taiwan|thailand|vietnam|indonesia|malaysia|philippines|india|pakistan|russia|mongolia|turkey|arabia|egypt|africa|america|canada|mexico|brazil|argentina|europe|england|britain|scotland|ireland|france|germany|italy|spain|portugal|greece|netherlands|belgium|sweden|norway|denmark|finland|poland|austria|switzerland|australia|new zealand|antarctica|asia|middle east|south america|north america|country|countries|nation|city|cities|town|village|capital|island|continent|kingdom|empire|realm|province|district|neighbou?rhood|street|apartment|house|home\b|mansion|palace|castle|fortress|tower|temple|shrine|church|cathedral|monastery|school|academy|university|college|classroom|dormitory|dorm\b|library|hospital|clinic|prison|jail|dungeon|labyrinth|maze|cave|forest|jungle|woods|desert|mountain|valley|river|lake|ocean|sea\b|beach|coast|space|planet|moon\b|galaxy|station|airport|airplane|train|subway|restaurant|cafe|bars?\b|pub\b|club\b|shop|store|market|mall|office|factory|farm|ranch|garden|park\b|zoo\b|museum|theat(er|re)|stadium|arena|gym\b|bathhouse|onsen|hot spring|hotel|inn\b|orphanage|graveyard|cemetery|ruins|battlefield|location|place|amish|arabian|caucasian|chinese|japanese|korean|fukushima|hokkaido|himalaya|tokyo|kyoto|osaka|mars\b|venus|jupiter|peru|vietnamese|thai\b|indian\b|tribal|detention|hideout|workshop|atelier|wall\b|walls\b|aquarium|arcade|gallery|opera|kabuki|shrine|hot ?spring|outdoor|beauty salon|cafe|café|izakaya|hometown|hiroshima|nagasaki|singapore|scandinavia|french|british|german|italian|spanish|tropic|interstellar|lava|seasons?\b|real life|convention|talent agency|holland|iceland|soviet|czechoslovakia|shibuya|london|nepal|vatican|uyghur|far ?east|foreign|kindergarten|volcano|wilderness|stranded|vacation|seaside|lighthouse|nightclub|tavern|ryokan|courtroom|pharmacy|redlight|throne|slum|okinawa|kanagawa|manchuria|tibet|louvre|laundromat|salon|bathroom|cruise ship|underwater|wild west|western|rural|oncampus|mount olympus|snow|typhoon|miasma)/,
  },
  {
    id: "activities",
    title: "Activities & Hobbies",
    match:
      /\b(sport|football|soccer|baseball|basketball|volleyball|tennis|badminton|golf|rugby|cricket|hockey|skating|skiing|snowboard|surfing|swimming|diving|running|marathon|track and field|cycling|climbing|boxing|wrestling|judo|karate|aikido|kendo|taekwondo|kung ?fu|martial arts|fencing|archery|airsoft|racing|motorsport|gymnastics|acrobat|cheerlead|dance|dancing|ballet|singing|music|instrument|piano|guitar|violin|drum|band\b|orchestra|choir|concert|painting|drawing|calligraphy|pottery|sculpt|photography|acting|writing|poetry|reading|cooking|baking|cuisine|food|eating|drinking|tea ceremony|flower arranging|ikebana|gardening|farming|fishing|hunting|camping|hiking|road trip|shopping|chess|shogi|mahjong|poker|card game|board game|video game|gaming|esports|puzzle|gambling|casino|magic trick|juggling|knitting|sewing|crafting|collecting|training|exercise|workout|meditation|yoga|study|studying|exam|competition|tournament|contest|festival|celebration|party|ceremony|ritual|hobby|hobbies|club activit|blacksmithing|brewing|embroidery|driving|snowboarding|salvaging|quiz|game show|memes|cards\b|bets\b|gambling|opera|heavy metal|visual art|arts & crafts|aviation|astronomy|astrology|archaeolog|anthropolog|agriculture|tea\b|sushi|bento|cooking|exorcism|summoning|parkour|jiujitsu|pachinko|mmorpg|haiku|noh\b|gekiga|handicraft|collections?\b|duels?\b|pranks?\b|gourmet|dessert|wagashi|sweet tooth|midnight snack|drinking|drunk|k-?pop|go\b|voodoo|fortune telling|sutras?\b|elections?\b|softball|rowing|tai chi|mma\b|kickboxing|origami|makeover|recipe|jazz|performing arts|rakugo|chambara|tokusatsu|olympics|games?\b|first date|group date|education|edutainment|cleaning|embalming|movies|auditions|tests?\b|strategy|tactics|beer|sake|cocktail|ice cream|futsal|handball|kabaddi|jousting|athletics|bodybuilding|mathematics|horticulture|mapmaking|cartography|cheering|dice\b|fights?\b|combat|trials?\b|experiment|autopsy|injection|purification|counselling|reality show|livestream|video recording|christmas|new year|fashion|dresses|travel|trips?\b)/,
  },
  {
    id: "objects",
    title: "Objects & Technology",
    match:
      /\b(sword|katana|blade|dagger|knife|spear|lance|axe\b|hammer|bow\b|arrow|guns?\b|pistol|rifle|firearm|weapon|armou?r|shield|helmet|potion|elixir|scroll|grimoire|books?\b|letter|diary|journal|map\b|key\b|ring\b|necklace|jewel|gem\b|crown|amulet|talisman|charm|doll|puppet|toys?\b|mask|mirror|clock|watch\b|camera|phone|smartphone|computer|laptop|internet|website|apps?\b|social media|machine|engine|vehicle|cars?\b|motorcycle|moped|bicycle|bike\b|truck|bus\b|boat|submarine|airship|spaceship|rocket|mecha|technology|invention|gadget|device|treasure|artifact|relic|object|item\b|tool\b|equipment|umbrella|flower|plant|tree|photograph|money|currency|knives|knife|battleship|asteroid|stationery|aura|illusion|elemental|special suit|coronet|banner|chains?\b|scooter|tank\b|tanks\b|transportation|augmented reality|nanotechnology|stationery|leggings)/,
  },
  {
    id: "world",
    title: "Setting & World Building",
    match:
      /\b(another world|other world|parallel|virtual|game world|dream world|underworld|afterlife|heaven|hell\b|purgatory|world hopping|world building|magic system|magic\b|magical|mana\b|spell|curse|blessing|prophecy|divination|supernatural|paranormal|occult|mythology|folklore|legend|religion|faith|cultivation|murim|wuxia|xianxia|apocalyp|dystopia|utopia|wasteland|steampunk|cyberpunk|space opera|futuristic|advanced technology|survival|guild|clan\b|sect\b|faction|territory|politics|political|monarchy|democracy|revolution|rebellion|war\b|battle|conflict|society|civilization|culture|tradition|custom|ambience|atmosphere|system\b|status window|levels?\b|skills?\b|class change|powers?\b|ability|abilities|superpower|element|dimension|portal|gateway|summoned|time travel|time loop|time skip|alternate (history|reality|universe|timeline)|multiverse|world\b|back to the past|another chance at life|modern knowledge|sudden strength|gender transformation|age (regression|progression|transformation)|bodyswap|transmigration|reincarnat|summoning|otome game)/,
  },
  {
    id: "themes",
    title: "Themes",
    match:
      /\b(action|adventure|comedy|humou?r|drama|tragedy|horror|thriller|mystery|suspense|fantasy|sci-?fi|science fiction|slice of life|psychological|philosoph|military|crime|noir|educational|historical|revenge|redemption|forgiveness|betrayal|loyalty|justice|freedom|identity|memory|growth|coming of age|self-?discovery|accepting oneself|healing|wholesome|heartwarming|bittersweet|melancholy|nostalgia|loneliness|isolation|grief|loss|hope|despair|sacrifice|duty|honou?r|ambition|greed|power struggle|found family|belonging|prejudice|inequality|poverty|wealth|class (difference|struggle)|social commentary|environmental|nature|spirituality|morality|good versus evil|coexistence|destiny|fate|free will|absurd|surreal|abstract|dark\b|light-?hearted|uneasy|feel-?good|tear-?jerker|abandonment|hypocrisy|stereotype|social hierarchy|societal|different culture|christianity|buddhis|shinto|islam|judais|agnostic|atheis|religious|mythology|rags to riches|rich to poor|pursuing|search for oneself|self-?abandonment|living for another|tragic past|traumatic past|past lives|previous life|bad reputation|intrigue|strategic|natural disaster|coup|nobility|aristocracy|social|good vs evil|seven deadly sins|guilt|persistence|rumors?\b|scandal|heretic|ascetic|comfy|funny\b|bad choices|bargain|deals?\b|dispute|succession|black sheep|embarrassing|disaster|cataclysm|man-?made disaster|kansai dialect|strong multi-?cultural|worrywart|optimist|pessimist|drifting|massacre|invasion|warfare|siblicide|patriarch|matriarch|feminism|empowerment|oppression|outcast|banishment|starting a new life|saving lives|overcoming|rehabilitation|lies\b|impersonat|fight for the throne|epic\b|shakespear|constellation|zodiac|anachronism|moral dilemma|inheritance|unification|solitude|suffering|sadness|misfortune|secrets?\b|promises?\b|willpower|self-?improvement|slow life|spanning generations|grudge|hatred|pride|irony|melodrama|superstition|imperialism|pollution|taboo|scapegoat|traitor|light and darkness|variations on a theme|searching for|ownership|popularity|realistic|fluff|exclusive|cult\b|alliance|ambitious goal|breaking the rules|corrupt|revival|rejuvenation)/,
  },
  {
    id: "narrative",
    title: "Narrative & Structure",
    match:
      /\b(plot|story|storyline|narrative|trope|cliffhanger|flashback|foreshadow|twist|ending|conclusive|inconclusive|episodic|serial|anthology|one-?shot|chapter|arc\b|prologue|epilogue|omake|extra chapter|side story|nonlinear|non-?linear|achronological|alternating pov|multiple (pov|perspectives|timelines|narrators)|first person|third person|unreliable narrator|fourth wall|meta\b|self-?aware|misunderstanding|secret identity|hidden identity|mistaken identity|disguise|deception|conspiracy|investigation|quest|escape|rescue|chase|time skip|slow start|fast paced|slow paced|character development|reveal|genre shift|art shift|art evolution|textless|second person|closure|whodunit|time limit|premise|ulterior motive|foreshadow|non-?fiction|autobiograph|anecdote|biograph|satire|facade|coincidental|high stakes|play or die|multiple lives|time progression|hidden past|past plays a big role|living double life|unpopular to popular|overcoming adversity|romeo and juliet|little red riding hood|bluebeard|one thousand and one nights|genji|scenario|tale\b|folktale|flipped|english version|oel\b|sekai-?kei|mono no aware|cosmicism)/,
  },
  {
    id: "presentation",
    title: "Format & Presentation",
    match:
      /\b(full colou?r|black and white|colou?red|monochrome|achromatic|greyscale|grayscale|webtoon|webcomic|long ?strip|four-?koma|4-?koma|1-?koma|yonkoma|1p comic|art style|artwork|illustration|line ?art|screen ?tone|censored|uncensored|official|fan ?made|scanlation|digital|animation|animated|panel|layout|typography|lettering|sound effect|onomatopoeia|ongoing|completed|hiatus|cancelled|discontinued|serialis|serializ|magazine|webnovel|light novel|novel\b|manga\b|manhwa|manhua|comics?\b|censorship|heta-?uma|little\/no dialogue|one volume|one shot|long timespan|sketchy|manfra|baihe|xuanhuan|romantasy|dieselpunk|ruined by translation|cgi|colorized|pov\b|resumed after cancellation|denpa|tanbi|sci ?fi|rpg\b|vrmmorpg|x-?ray|sensitive content|r ?18)/,
  },
  {
    id: "audience",
    title: "Audience",
    match:
      /\b(shounen|shonen|shoujo|shojo|seinen|josei|kodomo|all ages|adult\b|mature\b|teen|young adult|demographic|audience|male-?oriented|female-?oriented|for (men|women|kids|children))/,
  },
  {
    id: "identity",
    title: "Sexuality & Gender",
    match:
      /\b(agender|aromantic|genderless|non-?binary|transgender|intersex|cuntboy|bishounen|bishoujo|coming out|closet|pansexual|demisexual|polygamy|polyandry|polyamory|genderswap|gender (identity|role|norm|bender))\b/,
  },
  {
    id: "business",
    title: "Business & Industry",
    match:
      /\b(company|companies|corporate|corporation|conglomerate|industry|business|startup|enterprise|takeover|espionage|merger|marketing|advertis|economics|finance|banking|investment|stock market|negotiation|award|nominated|scholarship|publishing|studio|agency|overwork|illegal transaction)\b/,
  },
  {
    id: "mind",
    title: "Mind & Emotions",
    match:
      /\b(mind (break|control|games|reading)|self-?esteem|self-?confidence|self-?loathing|inner (voice|conflict)|heartbreak|guilt|regret|longing|jealousy|envy|shame|humiliation|insanity|intuition|willpower|uncertainty|enigma|dream(er|ing)?\b|nightmare|hallucination|delusion|obsession|denial|acceptance|body dysmorphia|insecurity|intimidation|gaslighting|avoidance|hidden motive|mysterious past|painful past|bad experience|hiding true self|premonition|out-?of-?body|prosopagnosia|narcolepsy|menhera|jirai kei|recluse|egoist|clean freak|neat freak|nightmare|self-?conscious|afraid of)\b/,
  },
  // Everything the patterns above did not claim.
  OTHER_TAGS,
];

export type GroupedTags = { group: TagGroup; options: Option[] };

/**
 * The ids of every spelling of one tag, joined. A picker offers one option per tag while
 * the search has to ask for all of that tag's ids, and they travel together inside the
 * option's own id — looking them up at search time would mean fetching the whole list
 * again to do it.
 */
const ID_SEPARATOR = "+";

export function tagIdsOf(value: string): string[] {
  return value.split(ID_SEPARATOR).filter(Boolean);
}

/** Uploader scribbles: hashtags, decorations, and names too short to mean anything. */
function isJunk(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length <= 1 ||
    trimmed.startsWith("#") ||
    /^score\s*:/i.test(trimmed) ||
    !/^[\p{L}\p{N}]/u.test(trimmed)
  );
}

/**
 * The site writes one tag several ways — `Actor`, `Actor/S`, `Actors`, `Alzheimer'S
 * Disease`. This reduces a name to what it is actually saying, so those fold together.
 */
function fold(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]s\b/g, "s")
    .replace(/\/\s*(s|es|ies|ren)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(\w+?)ies\b/g, "$1y")
    .replace(/\b(\w{3,}?)(?:es|s)\b/g, "$1");
}

/**
 * What two spellings have to share to be the same tag. Spaces are dropped as well as
 * plurals, because uploaders write the same idea both ways — `Age Gap` and `Agegap`,
 * `Dark Romance` and `DarkRomance`, `Body Swap/S` and `Bodyswap`.
 */
function clusterKey(name: string): string {
  return fold(name).replace(/ /g, "");
}

/** The tidiest spelling of a tag: the site's `/S` and `'S` forms are not it. */
function displayName(name: string): string {
  return name
    .replace(/\/\s*[Ss]\b/g, "s")
    .replace(/\/\s*[Ii]es\b/g, "ies")
    .replace(/\/\s*[Ee]s\b/g, "es")
    .replace(/\/\s*[Rr]en\b/g, "ren")
    .replace(/([A-Za-z])'S\b/g, "$1's")
    .trim();
}

/**
 * Turns the site's raw list into one option per tag, each carrying the ids of every
 * spelling it stands for. The clearest spelling wins the label — the one that reads as
 * written rather than as `Character/S`.
 */
export function canonicalTags(options: Option[]): Option[] {
  const clusters = new Map<string, { title: string; ids: string[] }>();

  for (const option of options) {
    if (isJunk(option.title)) continue;

    const key = clusterKey(option.title);
    if (!key) continue;

    const title = displayName(option.title);
    const cluster = clusters.get(key);

    if (!cluster) {
      clusters.set(key, { title, ids: [option.id] });
      continue;
    }

    cluster.ids.push(option.id);
    // Between spellings, prefer the one that reads: written out over `Character/S`, and
    // spaced over run together.
    const tidier =
      title === option.title && (cluster.title.includes("/") || cluster.title.includes("'S"));
    const spaced = title.includes(" ") && !cluster.title.includes(" ");
    if (tidier || spaced) cluster.title = title;
  }

  return [...clusters.values()]
    .map((cluster) => ({ id: cluster.ids.join(ID_SEPARATOR), title: cluster.title }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

/** Splits the site's tag list across the groups above, dropping the empty ones. */
export function groupTags(options: Option[]): GroupedTags[] {
  const buckets = new Map<string, Option[]>(TAG_GROUPS.map((group) => [group.id, []]));

  for (const option of canonicalTags(options)) {
    // Matched against the name as written and against its folded form, so a pattern
    // written for `accountant` also claims `Accountants` without spelling both out.
    const name = option.title.toLowerCase();
    const folded = fold(option.title);
    const group = TAG_GROUPS.find(
      (candidate) => candidate.match?.test(name) === true || candidate.match?.test(folded) === true,
    );
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
