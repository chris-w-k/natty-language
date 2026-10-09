/* The scenario, in the shape the real build stores it.

   NJA-3139 / NJA-3152 put this in Directus as four collections. We have no
   Directus, so the same four collections live here as plain objects with the
   same field names. When the content moves, it moves as data — nothing in the
   engine knows where it came from.

     nlt_vocab_items     id, slot_tags, and bare / definite / indefinite
                         in every supported language
     nlt_vocab_patterns  id, and a template per language whose slots are typed:
                         "I want {item:indefinite} and {item#2:indefinite}"
     nlt_slot_tags       the tag vocabulary that joins the two
     activity            actor, coach, background, prompt, and the lists of
                         patterns and items this scenario draws on

   Vocabulary and phrases are NJA-3145's experiment scenario, verbatim apart
   from one spelling fix ("Cervesa" -> "Cerveza") noted back to the ticket. */

window.QUEST = (function () {

  /* ---------- languages ----------
     NJA-3145 writes every pattern and every vocab item with a slot per
     language: en, es, pt, tr, pl, ro. Which two are in play is a SESSION
     input (NJA-3204: startSession takes nativeLanguage and targetLanguage),
     not a constant — the same content teaches English to a Spanish speaker
     and Spanish to an English one.

     The four with no words yet are listed here anyway, because the picker
     shows what the content could support and greys out what it does not:
     filling them in is a content edit and nothing else. */
  const LANGUAGES = [
    { code: 'en', name: 'English',    flag: '🇬🇧' },
    { code: 'es', name: 'Español',    flag: '🇪🇸' },
    { code: 'pt', name: 'Português',  flag: '🇵🇹' },
    { code: 'tr', name: 'Türkçe',     flag: '🇹🇷' },
    { code: 'pl', name: 'Polski',     flag: '🇵🇱' },
    { code: 'ro', name: 'Română',     flag: '🇷🇴' },
  ];

  /* What each language calls the others. The intro copy names the language
     being learned and the child's own, and a child reading a Spanish screen
     should see "inglés", not "English" — so the name travels with the reader,
     not with the language. The form stored is the one the intro sentences
     need (Romanian "engleză", not the articulated "engleza"); a screen that
     needs another form adds its own table rather than bending this one. */
  const LANG_NAMES = {
    en: { en: 'English',    es: 'Spanish',     pt: 'Portuguese',  tr: 'Turkish',     pl: 'Polish',      ro: 'Romanian' },
    es: { en: 'inglés',     es: 'español',     pt: 'portugués',   tr: 'turco',       pl: 'polaco',      ro: 'rumano' },
    pt: { en: 'inglês',     es: 'espanhol',    pt: 'português',   tr: 'turco',       pl: 'polaco',      ro: 'romeno' },
    tr: { en: 'İngilizce',  es: 'İspanyolca',  pt: 'Portekizce',  tr: 'Türkçe',      pl: 'Lehçe',       ro: 'Romence' },
    pl: { en: 'angielski',  es: 'hiszpański',  pt: 'portugalski', tr: 'turecki',     pl: 'polski',      ro: 'rumuński' },
    ro: { en: 'engleză',    es: 'spaniolă',    pt: 'portugheză',  tr: 'turcă',       pl: 'poloneză',    ro: 'română' },
  };

  const slotTags = ['ticket', 'item', 'like'];

  /* NJA-3152's five forms, per language. `bare` is the spelling the schema
     ticket uses — NJA-3204's fixtures write `base` for the same field, and
     the schema wins.

     The plural pair is required by the schema and authored per item, not
     derived: a mass noun has no plural, so `water` and `beer` carry the mass
     form in the plural slots. That is what a content editor fills in, and it
     is why these are strings rather than something the code works out. */
  const vocabItems = {
    ticket:   { tags: ['ticket', 'item', 'like'],
                en: { bare: 'ticket',   definite: 'the ticket',   indefinite: 'a ticket',
                      plural_bare: 'tickets',   plural_definite: 'the tickets' },
                es: { bare: 'entrada',  definite: 'la entrada',   indefinite: 'una entrada',
                      plural_bare: 'entradas',  plural_definite: 'las entradas' },
                pt: { bare: 'bilhete',  definite: 'o bilhete',    indefinite: 'um bilhete',
                      plural_bare: 'bilhetes',  plural_definite: 'os bilhetes' },
                tr: { bare: 'bilet',    definite: 'bileti',       indefinite: 'bir bilet',
                      plural_bare: 'biletler',  plural_definite: 'biletleri' },
                pl: { bare: 'bilet',    definite: 'bilet',        indefinite: 'biletu',
                      plural_bare: 'bilety',    plural_definite: 'bilety' },
                ro: { bare: 'bilet',    definite: 'biletul',      indefinite: 'un bilet',
                      plural_bare: 'bilete',    plural_definite: 'biletele' } },
    water:    { tags: ['item', 'like'],
                en: { bare: 'water',    definite: 'water',        indefinite: 'water',
                      plural_bare: 'water',     plural_definite: 'the water' },
                es: { bare: 'agua',     definite: 'el agua',      indefinite: 'agua',
                      plural_bare: 'agua',      plural_definite: 'el agua' },
                pt: { bare: 'água',     definite: 'a água',       indefinite: 'água',
                      plural_bare: 'água',      plural_definite: 'a água' },
                tr: { bare: 'su',       definite: 'suyu',         indefinite: 'su',
                      plural_bare: 'su',        plural_definite: 'suyu' },
                pl: { bare: 'woda',     definite: 'wodę',         indefinite: 'wody',
                      plural_bare: 'woda',      plural_definite: 'wodę' },
                ro: { bare: 'apă',      definite: 'apa',          indefinite: 'apă',
                      plural_bare: 'apă',       plural_definite: 'apa' } },
    soda:     { tags: ['item', 'like'],
                en: { bare: 'soda',     definite: 'the soda',     indefinite: 'a soda',
                      plural_bare: 'sodas',     plural_definite: 'the sodas' },
                es: { bare: 'refresco', definite: 'el refresco',  indefinite: 'un refresco',
                      plural_bare: 'refrescos', plural_definite: 'los refrescos' },
                pt: { bare: 'refrigerante', definite: 'o refrigerante', indefinite: 'um refrigerante',
                      plural_bare: 'refrigerantes', plural_definite: 'os refrigerantes' },
                tr: { bare: 'gazoz',    definite: 'gazozu',       indefinite: 'bir gazoz',
                      plural_bare: 'gazozlar',  plural_definite: 'gazozları' },
                pl: { bare: 'oranżada', definite: 'oranżadę',     indefinite: 'oranżady',
                      plural_bare: 'oranżady',  plural_definite: 'oranżady' },
                ro: { bare: 'suc',      definite: 'sucul',        indefinite: 'un suc',
                      plural_bare: 'sucuri',    plural_definite: 'sucurile' } },
    beer:     { tags: ['item', 'like'],
                en: { bare: 'beer',     definite: 'the beer',     indefinite: 'a beer',
                      plural_bare: 'beer',      plural_definite: 'the beer' },
                es: { bare: 'cerveza',  definite: 'la cerveza',   indefinite: 'una cerveza',
                      plural_bare: 'cerveza',   plural_definite: 'la cerveza' },
                pt: { bare: 'cerveja',  definite: 'a cerveja',    indefinite: 'uma cerveja',
                      plural_bare: 'cerveja',   plural_definite: 'a cerveja' },
                tr: { bare: 'bira',     definite: 'birayı',       indefinite: 'bir bira',
                      plural_bare: 'bira',      plural_definite: 'birayı' },
                pl: { bare: 'piwo',     definite: 'piwo',         indefinite: 'piwa',
                      plural_bare: 'piwo',      plural_definite: 'piwo' },
                ro: { bare: 'bere',     definite: 'berea',        indefinite: 'o bere',
                      plural_bare: 'bere',      plural_definite: 'berea' } },
    sandwich: { tags: ['item', 'like'],
                en: { bare: 'sandwich', definite: 'the sandwich', indefinite: 'a sandwich',
                      plural_bare: 'sandwiches', plural_definite: 'the sandwiches' },
                es: { bare: 'bocadillo', definite: 'el bocadillo', indefinite: 'un bocadillo',
                      plural_bare: 'bocadillos', plural_definite: 'los bocadillos' },
                /* `sandes` does not change in the plural, which is correct and
                   is why the two plural slots repeat it. */
                pt: { bare: 'sandes',   definite: 'a sandes',     indefinite: 'uma sandes',
                      plural_bare: 'sandes',    plural_definite: 'as sandes' },
                tr: { bare: 'sandviç',  definite: 'sandviçi',     indefinite: 'bir sandviç',
                      plural_bare: 'sandviçler', plural_definite: 'sandviçleri' },
                pl: { bare: 'kanapka',  definite: 'kanapkę',      indefinite: 'kanapki',
                      plural_bare: 'kanapki',   plural_definite: 'kanapki' },
                ro: { bare: 'sandviș',  definite: 'sandvișul',    indefinite: 'un sandviș',
                      plural_bare: 'sandvișuri', plural_definite: 'sandvișurile' } },
    record:   { tags: ['item', 'like'],
                en: { bare: 'record',   definite: 'the record',   indefinite: 'a record',
                      plural_bare: 'records',   plural_definite: 'the records' },
                es: { bare: 'disco',    definite: 'el disco',     indefinite: 'un disco',
                      plural_bare: 'discos',    plural_definite: 'los discos' },
                pt: { bare: 'disco',    definite: 'o disco',      indefinite: 'um disco',
                      plural_bare: 'discos',    plural_definite: 'os discos' },
                tr: { bare: 'plak',     definite: 'plağı',        indefinite: 'bir plak',
                      plural_bare: 'plaklar',   plural_definite: 'plakları' },
                pl: { bare: 'płyta',    definite: 'płytę',        indefinite: 'płyty',
                      plural_bare: 'płyty',     plural_definite: 'płyty' },
                ro: { bare: 'disc',     definite: 'discul',       indefinite: 'un disc',
                      plural_bare: 'discuri',   plural_definite: 'discurile' } },
    tshirt:   { tags: ['item', 'like'],
                en: { bare: 't-shirt',  definite: 'the t-shirt',  indefinite: 'a t-shirt',
                      plural_bare: 't-shirts',  plural_definite: 'the t-shirts' },
                es: { bare: 'camiseta', definite: 'la camiseta',  indefinite: 'una camiseta',
                      plural_bare: 'camisetas', plural_definite: 'las camisetas' },
                pt: { bare: 't-shirt',  definite: 'a t-shirt',    indefinite: 'uma t-shirt',
                      plural_bare: 't-shirts',  plural_definite: 'as t-shirts' },
                tr: { bare: 'tişört',   definite: 'tişörtü',      indefinite: 'bir tişört',
                      plural_bare: 'tişörtler', plural_definite: 'tişörtleri' },
                pl: { bare: 'koszulka', definite: 'koszulkę',     indefinite: 'koszulki',
                      plural_bare: 'koszulki',  plural_definite: 'koszulki' },
                ro: { bare: 'tricou',   definite: 'tricoul',      indefinite: 'un tricou',
                      plural_bare: 'tricouri',  plural_definite: 'tricourile' } },
    /* A band is not something you can be handed across a counter, so it
       carries `like` only and the engine will never pair it with "Can I have
       ___". That tag check is the whole point of NJA-3152's slot_tags: adding
       a noun is a tag, not an edit to seven patterns. */
    band:     { tags: ['like'],
                en: { bare: 'band',     definite: 'the band',     indefinite: 'a band',
                      plural_bare: 'bands',     plural_definite: 'the bands' },
                es: { bare: 'grupo',    definite: 'el grupo',     indefinite: 'un grupo',
                      plural_bare: 'grupos',    plural_definite: 'los grupos' },
                pt: { bare: 'banda',    definite: 'a banda',      indefinite: 'uma banda',
                      plural_bare: 'bandas',    plural_definite: 'as bandas' },
                tr: { bare: 'grup',     definite: 'grubu',        indefinite: 'bir grup',
                      plural_bare: 'gruplar',   plural_definite: 'grupları' },
                pl: { bare: 'zespół',   definite: 'zespół',       indefinite: 'zespołu',
                      plural_bare: 'zespoły',   plural_definite: 'zespoły' },
                ro: { bare: 'trupă',    definite: 'trupa',        indefinite: 'o trupă',
                      plural_bare: 'trupe',     plural_definite: 'trupele' } },
    singer:   { tags: ['like'],
                en: { bare: 'singer',   definite: 'the singer',   indefinite: 'a singer',
                      plural_bare: 'singers',   plural_definite: 'the singers' },
                es: { bare: 'cantante', definite: 'el cantante',  indefinite: 'un cantante',
                      plural_bare: 'cantantes', plural_definite: 'los cantantes' },
                pt: { bare: 'cantor',   definite: 'o cantor',     indefinite: 'um cantor',
                      plural_bare: 'cantores',  plural_definite: 'os cantores' },
                tr: { bare: 'şarkıcı',  definite: 'şarkıcıyı',    indefinite: 'bir şarkıcı',
                      plural_bare: 'şarkıcılar', plural_definite: 'şarkıcıları' },
                /* Animate masculine, so the accusative is not the nominative
                   the way `bilet` and `zespół` are. */
                pl: { bare: 'piosenkarz', definite: 'piosenkarza', indefinite: 'piosenkarza',
                      plural_bare: 'piosenkarze', plural_definite: 'piosenkarzy' },
                ro: { bare: 'cântăreț', definite: 'cântărețul',   indefinite: 'un cântăreț',
                      plural_bare: 'cântăreți', plural_definite: 'cântăreții' } },
    /* ---------- the other two venues ----------
       Added for NJA-3207's venue choice. Every pattern is shared across the
       three nights; only the nouns change, which is the whole point — the
       child meets the same nine constructions with a new set of words in
       them. Drafted here and NOT yet proofread by localisation: the forms
       follow the same cases as the items above (Polish `definite` is the
       accusative and `indefinite` the genitive, because that is what the
       frames ask for), but a native reader should pass over them before any
       of this leaves prototype. */
    hotdog:   { tags: ['item', 'like'],
                en: { bare: 'hot dog',  definite: 'the hot dog',  indefinite: 'a hot dog',
                      plural_bare: 'hot dogs',  plural_definite: 'the hot dogs' },
                es: { bare: 'perrito caliente', definite: 'el perrito caliente', indefinite: 'un perrito caliente',
                      plural_bare: 'perritos calientes', plural_definite: 'los perritos calientes' },
                pt: { bare: 'cachorro-quente', definite: 'o cachorro-quente', indefinite: 'um cachorro-quente',
                      plural_bare: 'cachorros-quentes', plural_definite: 'os cachorros-quentes' },
                tr: { bare: 'sosisli',  definite: 'sosisliyi',    indefinite: 'bir sosisli',
                      plural_bare: 'sosisliler', plural_definite: 'sosislileri' },
                pl: { bare: 'hot dog',  definite: 'hot doga',     indefinite: 'hot doga',
                      plural_bare: 'hot dogi',  plural_definite: 'hot dogi' },
                ro: { bare: 'hot dog',  definite: 'hot dogul',    indefinite: 'un hot dog',
                      plural_bare: 'hot dogi',  plural_definite: 'hot dogii' } },
    /* A mass noun in English and Turkish, a plural in the romance languages —
       which the five forms carry without the frames having to know. */
    /* `item` but NOT `like`: the Spanish and Portuguese frames for liking a
       thing are a fixed singular ("¿Te gusta ...?", "Me gusta ..."), and both
       of these nouns are inherently plural in those languages — so a like-slot
       filled with one produced "Me gusta los nachos". They can be asked for
       and refused, which is every slot that matters at a snack counter, and
       the liking is left to the film, the poster and the t-shirt. */
    popcorn:  { tags: ['item'],
                en: { bare: 'popcorn',  definite: 'the popcorn',  indefinite: 'popcorn',
                      plural_bare: 'popcorn',   plural_definite: 'the popcorn' },
                es: { bare: 'palomitas', definite: 'las palomitas', indefinite: 'palomitas',
                      plural_bare: 'palomitas', plural_definite: 'las palomitas' },
                pt: { bare: 'pipocas',  definite: 'as pipocas',   indefinite: 'pipocas',
                      plural_bare: 'pipocas',   plural_definite: 'as pipocas' },
                tr: { bare: 'patlamış mısır', definite: 'patlamış mısırı', indefinite: 'patlamış mısır',
                      plural_bare: 'patlamış mısır', plural_definite: 'patlamış mısırı' },
                pl: { bare: 'popcorn',  definite: 'popcorn',      indefinite: 'popcornu',
                      plural_bare: 'popcorn',   plural_definite: 'popcorn' },
                ro: { bare: 'popcorn',  definite: 'popcornul',    indefinite: 'popcorn',
                      plural_bare: 'popcorn',   plural_definite: 'popcornul' } },
    nachos:   { tags: ['item'],
                en: { bare: 'nachos',   definite: 'the nachos',   indefinite: 'nachos',
                      plural_bare: 'nachos',    plural_definite: 'the nachos' },
                es: { bare: 'nachos',   definite: 'los nachos',   indefinite: 'nachos',
                      plural_bare: 'nachos',    plural_definite: 'los nachos' },
                pt: { bare: 'nachos',   definite: 'os nachos',    indefinite: 'nachos',
                      plural_bare: 'nachos',    plural_definite: 'os nachos' },
                tr: { bare: 'nacho',    definite: 'nachoyu',      indefinite: 'nacho',
                      plural_bare: 'nacholar',  plural_definite: 'nachoları' },
                pl: { bare: 'nachos',   definite: 'nachosy',      indefinite: 'nachosów',
                      plural_bare: 'nachosy',   plural_definite: 'nachosy' },
                ro: { bare: 'nachos',   definite: 'nachosul',     indefinite: 'nachos',
                      plural_bare: 'nachos',    plural_definite: 'nachosurile' } },
    scarf:    { tags: ['item', 'like'],
                en: { bare: 'scarf',    definite: 'the scarf',    indefinite: 'a scarf',
                      plural_bare: 'scarves',   plural_definite: 'the scarves' },
                es: { bare: 'bufanda',  definite: 'la bufanda',   indefinite: 'una bufanda',
                      plural_bare: 'bufandas',  plural_definite: 'las bufandas' },
                pt: { bare: 'cachecol', definite: 'o cachecol',   indefinite: 'um cachecol',
                      plural_bare: 'cachecóis', plural_definite: 'os cachecóis' },
                tr: { bare: 'atkı',     definite: 'atkıyı',       indefinite: 'bir atkı',
                      plural_bare: 'atkılar',   plural_definite: 'atkıları' },
                pl: { bare: 'szalik',   definite: 'szalik',       indefinite: 'szalika',
                      plural_bare: 'szaliki',   plural_definite: 'szaliki' },
                ro: { bare: 'fular',    definite: 'fularul',      indefinite: 'un fular',
                      plural_bare: 'fulare',    plural_definite: 'fularele' } },
    poster:   { tags: ['item', 'like'],
                en: { bare: 'poster',   definite: 'the poster',   indefinite: 'a poster',
                      plural_bare: 'posters',   plural_definite: 'the posters' },
                es: { bare: 'póster',   definite: 'el póster',    indefinite: 'un póster',
                      plural_bare: 'pósters',   plural_definite: 'los pósters' },
                pt: { bare: 'poster',   definite: 'o poster',     indefinite: 'um poster',
                      plural_bare: 'posters',   plural_definite: 'os posters' },
                tr: { bare: 'poster',   definite: 'posteri',      indefinite: 'bir poster',
                      plural_bare: 'posterler', plural_definite: 'posterleri' },
                pl: { bare: 'plakat',   definite: 'plakat',       indefinite: 'plakatu',
                      plural_bare: 'plakaty',   plural_definite: 'plakaty' },
                ro: { bare: 'poster',   definite: 'posterul',     indefinite: 'un poster',
                      plural_bare: 'postere',   plural_definite: 'posterele' } },
    team:     { tags: ['like'],
                en: { bare: 'team',     definite: 'the team',     indefinite: 'a team',
                      plural_bare: 'teams',     plural_definite: 'the teams' },
                es: { bare: 'equipo',   definite: 'el equipo',    indefinite: 'un equipo',
                      plural_bare: 'equipos',   plural_definite: 'los equipos' },
                pt: { bare: 'equipa',   definite: 'a equipa',     indefinite: 'uma equipa',
                      plural_bare: 'equipas',   plural_definite: 'as equipas' },
                tr: { bare: 'takım',    definite: 'takımı',       indefinite: 'bir takım',
                      plural_bare: 'takımlar',  plural_definite: 'takımları' },
                pl: { bare: 'drużyna',  definite: 'drużynę',      indefinite: 'drużyny',
                      plural_bare: 'drużyny',   plural_definite: 'drużyny' },
                ro: { bare: 'echipă',   definite: 'echipa',       indefinite: 'o echipă',
                      plural_bare: 'echipe',    plural_definite: 'echipele' } },
    /* Animate masculine in Polish, like `singer` above, so the accusative is
       not the nominative. */
    player:   { tags: ['like'],
                en: { bare: 'player',   definite: 'the player',   indefinite: 'a player',
                      plural_bare: 'players',   plural_definite: 'the players' },
                es: { bare: 'jugador',  definite: 'el jugador',   indefinite: 'un jugador',
                      plural_bare: 'jugadores', plural_definite: 'los jugadores' },
                pt: { bare: 'jogador',  definite: 'o jogador',    indefinite: 'um jogador',
                      plural_bare: 'jogadores', plural_definite: 'os jogadores' },
                tr: { bare: 'futbolcu', definite: 'futbolcuyu',   indefinite: 'bir futbolcu',
                      plural_bare: 'futbolcular', plural_definite: 'futbolcuları' },
                pl: { bare: 'piłkarz',  definite: 'piłkarza',     indefinite: 'piłkarza',
                      plural_bare: 'piłkarze',  plural_definite: 'piłkarzy' },
                ro: { bare: 'jucător',  definite: 'jucătorul',    indefinite: 'un jucător',
                      plural_bare: 'jucători',  plural_definite: 'jucătorii' } },
    film:     { tags: ['like'],
                en: { bare: 'film',     definite: 'the film',     indefinite: 'a film',
                      plural_bare: 'films',     plural_definite: 'the films' },
                es: { bare: 'película', definite: 'la película',  indefinite: 'una película',
                      plural_bare: 'películas', plural_definite: 'las películas' },
                pt: { bare: 'filme',    definite: 'o filme',      indefinite: 'um filme',
                      plural_bare: 'filmes',    plural_definite: 'os filmes' },
                tr: { bare: 'film',     definite: 'filmi',        indefinite: 'bir film',
                      plural_bare: 'filmler',   plural_definite: 'filmleri' },
                pl: { bare: 'film',     definite: 'film',         indefinite: 'filmu',
                      plural_bare: 'filmy',     plural_definite: 'filmy' },
                ro: { bare: 'film',     definite: 'filmul',       indefinite: 'un film',
                      plural_bare: 'filme',     plural_definite: 'filmele' } },
    /* Turkish `oyuncu` is both an actor and a player, so the stadium takes
       `futbolcu` above and the cinema takes `aktor` here — otherwise the two
       venues would teach the same word for two different people. */
    actor:    { tags: ['like'],
                en: { bare: 'actor',    definite: 'the actor',    indefinite: 'an actor',
                      plural_bare: 'actors',    plural_definite: 'the actors' },
                es: { bare: 'actor',    definite: 'el actor',     indefinite: 'un actor',
                      plural_bare: 'actores',   plural_definite: 'los actores' },
                pt: { bare: 'ator',     definite: 'o ator',       indefinite: 'um ator',
                      plural_bare: 'atores',    plural_definite: 'os atores' },
                tr: { bare: 'aktör',    definite: 'aktörü',       indefinite: 'bir aktör',
                      plural_bare: 'aktörler',  plural_definite: 'aktörleri' },
                pl: { bare: 'aktor',    definite: 'aktora',       indefinite: 'aktora',
                      plural_bare: 'aktorzy',   plural_definite: 'aktorów' },
                ro: { bare: 'actor',    definite: 'actorul',      indefinite: 'un actor',
                      plural_bare: 'actori',    plural_definite: 'actorii' } },
  };

  const FORMS = ['bare', 'definite', 'indefinite', 'plural_bare', 'plural_definite'];

  /* Slot syntax is NJA-3152's: {tag#number:article}. The number distinguishes
     two slots drawing on the same tag; the article names which form to fill
     it with. A pattern with no slot is said whole.

     `speaker` is ours, and NJA-3152's pattern collection has no field for it —
     which is a gap worth closing there, because without it the conversation
     goes wrong in a way that is hard to trace. The engine tells the actor
     which target-language words the child has met so he can use them; a
     construction the CHILD is learning to say to HIM then ends up in his
     mouth, and he opens with "Alright, perdona, what can I do for ya?" —
     saying the customer's own line back at them. "Excuse me", "Can I have"
     and "Thank you" belong to the person at the counter, not behind it.

       learner  only the child says this; the actor must never say it back
       actor    only the actor says it, so the child is never DRILLED on
                it. "There is no sandwich" is the person behind the counter
                telling you they are out; a child declining an offer with it
                is being taught to say the wrong thing. These are dropped from
                the pairs below rather than merely discouraged, because a
                pattern the engine can select is a pattern the coach will
                eventually tell the child to say.
       either   natural from either side

     A shared item word ("entrada") is never restricted by this — only the
     frame, which is what carries the pragmatic role. */
  const vocabPatterns = {
    'excuse-me':    { speaker: 'learner', opensOnly: true,
                      en: 'Excuse me.',   es: 'Perdona.',      pt: 'Desculpe.',
                      tr: 'Affedersiniz.', pl: 'Przepraszam.', ro: 'Scuzați-mă.' },
    'do-you-have':  { speaker: 'either',
                      en: 'Do you have {item:indefinite}?',
                      es: '¿Tienes {item:indefinite}?',
                      pt: 'Tens {item:indefinite}?',
                      /* Turkish puts the question particle at the end and does
                         not inflect the noun here, so the bare slot is right. */
                      tr: '{item:indefinite} var mı?',
                      pl: 'Masz {item:definite}?',
                      ro: 'Ai {item:indefinite}?' },
    /* Asking, and then asking politely, are two things to learn and so two
       stages. Taught as one, the child's first go at asking for anything is a
       five-word sentence with the courtesy welded on, and getting "por favor"
       wrong costs them the ask as well. */
    'can-i-have':   { speaker: 'learner',
                      en: 'Can I have {item:indefinite}?',
                      es: '¿Me das {item:indefinite}?',
                      pt: 'Dás-me {item:indefinite}?',
                      tr: '{item:indefinite} alabilir miyim?',
                      /* `prosić o` governs the accusative, which is what the
                         Polish `definite` slot holds. */
                      pl: 'Mogę prosić o {item:definite}?',
                      ro: 'Îmi dai {item:indefinite}?' },
    'can-i-have-please': { speaker: 'learner',
                      en: 'Can I have {item:indefinite}, please?',
                      es: '¿Me das {item:indefinite}, por favor?',
                      pt: 'Dás-me {item:indefinite}, por favor?',
                      tr: '{item:indefinite} alabilir miyim, lütfen?',
                      pl: 'Czy mogę prosić o {item:definite}, proszę?',
                      ro: 'Îmi dai {item:indefinite}, te rog?' },
    'i-have':       { speaker: 'either',  en: 'I have {item:indefinite}.',            es: 'Tengo {item:indefinite}.' },
    'i-dont-have':  { speaker: 'either',  en: "I don't have {item:bare}.",            es: 'No tengo {item:bare}.' },
    /* What you say to turn down what you have just been offered. The set had
       no way to decline at all, so the only near-miss the engine could reach
       for was the barman's own "there is no ___". */
    'i-dont-want':  { speaker: 'learner',
                      en: "I don't want {item:indefinite}.",
                      es: 'No quiero {item:indefinite}.',
                      pt: 'Não quero {item:indefinite}.',
                      tr: '{item:indefinite} istemiyorum.',
                      /* Polish negation takes the genitive, which is the one
                         thing the Polish `indefinite` slot is holding — see the
                         note on the Polish forms above. */
                      pl: 'Nie chcę {item:indefinite}.',
                      ro: 'Nu vreau {item:indefinite}.' },
    'there-is-no':  { speaker: 'actor',   en: 'There is no {item:bare}.',             es: 'No hay {item:bare}.' },
    'do-you-like':  { speaker: 'either',
                      en: 'Do you like {like:definite}?',
                      es: '¿Te gusta {like:definite}?',
                      /* Portuguese likes things WITH `de`, and `de` + article
                         contracts (de + a = da), which a slot cannot produce.
                         The bare plural after `de` is both correct and the way
                         this is actually said. */
                      pt: 'Gostas de {like:plural_bare}?',
                      tr: '{like:definite} seviyor musun?',
                      pl: 'Lubisz {like:definite}?',
                      ro: 'Îți place {like:definite}?' },
    /* The form differs between the languages, which is the point of NJA-3145's
       grammar context rather than an oversight: the ticket writes i-like-x as
       {like:bare} in English and {like:definite} in Spanish, because that is
       how the two languages say a generic liking. Bare singular is wrong in
       English for a countable noun ("I like ticket"), so the English takes the
       plural — which for a mass noun is authored as the mass form, so "I like
       water" and "I like beer" come out right too.

       Each word is rendered in ITS OWN language's form, so the Spanish noun
       keeps its article when it crosses into the English frame rather than
       arriving bare. */
    'i-like':       { speaker: 'either',
                      en: 'I like {like:plural_bare}.',
                      es: 'Me gusta {like:definite}.',
                      pt: 'Gosto de {like:plural_bare}.',
                      tr: '{like:plural_definite} seviyorum.',
                      pl: 'Lubię {like:plural_definite}.',
                      /* `plac` rather than `place`: Romanian agrees the verb
                         with the thing liked, and this slot is plural. */
                      ro: 'Îmi plac {like:plural_definite}.' },
    /* Two slots. NJA-3160's third unit test is a pattern of exactly this
       shape, and the engine used to refuse them outright — one slot per
       pattern, or it threw. The #1 / #2 numbering is what keeps the two
       apart; both draw on the same tag. */
    'i-like-two':   { speaker: 'either',
                      en: 'I like {like#1:definite} and {like#2:definite}.',
                      es: 'Me gustan {like#1:definite} y {like#2:definite}.',
                      pt: 'Gosto de {like#1:plural_bare} e de {like#2:plural_bare}.',
                      tr: '{like#1:definite} ve {like#2:definite} seviyorum.',
                      pl: 'Lubię {like#1:definite} i {like#2:definite}.',
                      ro: 'Îmi plac {like#1:definite} și {like#2:definite}.' },
    'thank-you':    { speaker: 'learner',
                      en: 'Thank you.',  es: 'Gracias.',      pt: 'Obrigado.',
                      tr: 'Teşekkürler.', pl: 'Dziękuję.',    ro: 'Mulțumesc.' },
  };

  /* ---------- the three venues ----------
     NJA-3207. One night out, three places to have it. Every venue runs the
     SAME nine constructions — that is the point of the choice: the child meets
     the grammar again with a different set of nouns in it, which is a second
     exposure that does not feel like a repeat.

     What changes per venue: the nouns, the room, who is behind the counter,
     and the copy. What never changes: the patterns, the coach, the engine and
     the pass mark, so two nights are directly comparable.

     Each venue is the shape the single `activity` used to be, plus a `name`
     for the picker and an actor whose name is written in the child's own
     language rather than in English at them. */

  /* Axel is the same pal wherever you take him, so the coach is defined once.
     His old prompt said "you have played a hundred gigs", which read oddly at
     a cinema. */
  const COACH = {
    id: 'axel', name: 'Coach',
    /* accent: the voice this character always speaks with, whichever language
       the line happens to be in. Without it Axel drifts into a Spanish accent
       the moment his line carries a Spanish word. */
    accent: 'native',
    prompt: 'You are Axel — a cheeky rockstar, and the child\'s own pal. You have been everywhere and you are showing them the ropes. You talk with attitude: quick, a bit cocky, never impressed by much, and funny about the world rather than about them. You are always on their side, you never talk down to them, and you are the only one here who explains anything.',
  };

  /* `there-is-no` is deliberately NOT in any venue. It is the actor's way of
     saying she is out of something, and she is never out of anything —
     leaving it in hands her the one line the rules forbid. `i-have` and
     `i-dont-have` are out for the same sort of reason: they were written for
     a door, and all three venues are a counter, where the actor sells and the
     child buys. All three stay defined for a scenario where they are the
     point. */
  const PATTERNS = ['excuse-me', 'do-you-have', 'can-i-have', 'can-i-have-please',
                    'i-dont-want', 'do-you-like', 'i-like', 'i-like-two',
                    'thank-you'];

  const VENUES = {
    /* The original night, unchanged but for the person behind the counter. */
    gig: {
      id: 'dev_nlt_activity_gig',
      venue: 'gig',
      title: 'Axel goes to a gig',
      background: 'venue-bar',
      /* NJA-3212. The room, heard. One looping bed per venue, faded in when
         the venue is chosen and laid under the whole night. The file is named
         for the venue rather than for a screen: this recording spent its life
         as `loading.mp3`, named for where it first played, which is how the
         club's room tone came to sound like a property of loading. */
      bed: 'audio/bed-gig.mp3',
      name: { en: 'A rock gig', es: 'Un concierto', pt: 'Um concerto',
              tr: 'Bir rock konseri', pl: 'Koncert rockowy', ro: 'Un concert rock' },
      /* accent: 'target' / 'native' rather than a language code, because the
         pair is chosen per session. The person behind the counter speaks the
         language you are here to learn; your pal speaks yours. Reverse the
         pair and the two accents swap with it. */
      actor: { id: 'bartender', speaks: 'target', accent: 'target',
               name: { en: 'Bartender', es: 'Camarera', pt: 'Empregada',
                       tr: 'Barmen', pl: 'Barmanka', ro: 'Barmaniță' } },
      prompt: 'You are the one woman behind the counter at a music venue. You sell the tickets, the drinks and the merchandise, and you have all of it in stock — whatever a customer asks you for, you have it and you hand it over. Personality: grumpy, seen it all, a queue always building.',
      objectives: ['get in', 'get something to drink', 'get some merch', 'talk about the band'],
      items: ['ticket', 'water', 'soda', 'beer', 'sandwich', 'record', 'tshirt', 'band', 'singer'],
      patterns: PATTERNS,
      intro: {
        en: {
          title: 'GOING TO A GIG',
          sub: 'Learn the {0} to get in, get a drink and tell someone you love the song.',
          tap: 'Tap to continue',
        },
        es: {
          title: 'VAMOS A UN CONCIERTO',
          sub: 'Aprende el {0} para entrar, pedir una bebida y decir que te encanta la canción.',
          tap: 'Toca para continuar',
        },
        pt: {
          title: 'VAMOS A UM CONCERTO',
          sub: 'Aprende o {0} para entrares, pedires uma bebida e dizeres que adoras a música.',
          tap: 'Toca para continuar',
        },
        tr: {
          title: 'KONSERE GİDİYORUZ',
          sub: 'İçeri girmek, bir şeyler içmek ve şarkıyı sevdiğini söylemek için {0} öğren.',
          tap: 'Devam etmek için dokun',
        },
        pl: {
          title: 'IDZIEMY NA KONCERT',
          sub: 'Poznaj {0} — wejdź do środka, zamów coś do picia i powiedz, że uwielbiasz tę piosenkę.',
          tap: 'Dotknij, aby kontynuować',
        },
        ro: {
          title: 'MERGEM LA UN CONCERT',
          sub: 'Învață să vorbești {0} ca să intri, să ceri ceva de băut și să spui că îți place melodia.',
          tap: 'Atinge pentru a continua',
        },
      },
    },

    football: {
      id: 'dev_nlt_activity_football',
      venue: 'football',
      title: 'Axel goes to the football',
      background: 'venue-stadium',
      bed: 'audio/bed-football.mp3',
      name: { en: 'A football game', es: 'Un partido de fútbol', pt: 'Um jogo de futebol',
              tr: 'Bir futbol maçı', pl: 'Mecz piłkarski', ro: 'Un meci de fotbal' },
      actor: { id: 'stadium_worker', speaks: 'target', accent: 'target',
               name: { en: 'Vendor', es: 'Vendedora', pt: 'Vendedora',
                       tr: 'Satıcı', pl: 'Sprzedawczyni', ro: 'Vânzătoare' } },
      prompt: 'You are the one woman behind the kiosk at a football stadium. You sell the tickets, the drinks, the food and the club merchandise, and you have all of it in stock — whatever a customer asks you for, you have it and you hand it over. Personality: brisk and cheerful, shouting over the crowd, half an eye on the pitch.',
      objectives: ['get in', 'get something to drink', 'get some food', 'talk about the team'],
      items: ['ticket', 'water', 'soda', 'hotdog', 'sandwich', 'scarf', 'tshirt', 'team', 'player'],
      patterns: PATTERNS,
      intro: {
        en: {
          title: 'GOING TO THE FOOTBALL',
          sub: 'Learn the {0} to get in, get something to eat and tell someone your team is winning.',
          tap: 'Tap to continue',
        },
        es: {
          title: 'VAMOS AL FÚTBOL',
          sub: 'Aprende el {0} para entrar, pedir algo de comer y decir que tu equipo va ganando.',
          tap: 'Toca para continuar',
        },
        pt: {
          title: 'VAMOS AO FUTEBOL',
          sub: 'Aprende o {0} para entrares, pedires algo para comer e dizeres que a tua equipa vai ganhar.',
          tap: 'Toca para continuar',
        },
        tr: {
          title: 'MAÇA GİDİYORUZ',
          sub: 'İçeri girmek, bir şeyler yemek ve takımının kazandığını söylemek için {0} öğren.',
          tap: 'Devam etmek için dokun',
        },
        pl: {
          title: 'IDZIEMY NA MECZ',
          sub: 'Poznaj {0} — wejdź na stadion, kup coś do jedzenia i powiedz, że twoja drużyna wygrywa.',
          tap: 'Dotknij, aby kontynuować',
        },
        ro: {
          title: 'MERGEM LA FOTBAL',
          sub: 'Învață să vorbești {0} ca să intri, să îți iei ceva de mâncare și să spui că echipa ta câștigă.',
          tap: 'Atinge pentru a continua',
        },
      },
    },

    cinema: {
      id: 'dev_nlt_activity_cinema',
      venue: 'cinema',
      title: 'Axel goes to the cinema',
      background: 'venue-cinema',
      bed: 'audio/bed-cinema.mp3',
      name: { en: 'The cinema', es: 'El cine', pt: 'O cinema',
              tr: 'Sinema', pl: 'Kino', ro: 'Cinema' },
      actor: { id: 'cinema_worker', speaks: 'target', accent: 'target',
               name: { en: 'Attendant', es: 'Empleada', pt: 'Funcionária',
                       tr: 'Görevli', pl: 'Bileterka', ro: 'Angajată' } },
      prompt: 'You are the one woman behind the counter at a cinema. You sell the tickets, the drinks, the snacks and the merchandise, and you have all of it in stock — whatever a customer asks you for, you have it and you hand it over. Personality: friendly but hurrying, the film starts in five minutes and there is a queue.',
      objectives: ['get in', 'get something to drink', 'get some snacks', 'talk about the film'],
      /* `nachos` sits after `poster` on purpose. The walk gives the fifth item
         to `do-you-like`, whose Spanish frame is a fixed singular "¿Te gusta
         ...?" — and `nachos` is inherently plural, so that slot produced
         "¿Te gusta los nachos?". Moving it one place along hands the slot a
         singular noun and keeps the agreement right. */
      items: ['ticket', 'water', 'soda', 'popcorn', 'poster', 'nachos', 'tshirt', 'film', 'actor'],
      patterns: PATTERNS,
      intro: {
        en: {
          title: 'GOING TO THE CINEMA',
          sub: 'Learn the {0} to get in, get some popcorn and tell someone the film was great.',
          tap: 'Tap to continue',
        },
        es: {
          title: 'VAMOS AL CINE',
          sub: 'Aprende el {0} para entrar, pedir palomitas y decir que la película te encantó.',
          tap: 'Toca para continuar',
        },
        pt: {
          title: 'VAMOS AO CINEMA',
          sub: 'Aprende o {0} para entrares, pedires pipocas e dizeres que adoraste o filme.',
          tap: 'Toca para continuar',
        },
        tr: {
          title: 'SİNEMAYA GİDİYORUZ',
          sub: 'İçeri girmek, patlamış mısır almak ve filmi sevdiğini söylemek için {0} öğren.',
          tap: 'Devam etmek için dokun',
        },
        pl: {
          title: 'IDZIEMY DO KINA',
          sub: 'Poznaj {0} — wejdź do sali, kup popcorn i powiedz, że film był świetny.',
          tap: 'Dotknij, aby kontynuować',
        },
        ro: {
          title: 'MERGEM LA CINEMA',
          sub: 'Învață să vorbești {0} ca să intri, să îți iei popcorn și să spui că ți-a plăcut filmul.',
          tap: 'Atinge pentru a continua',
        },
      },
    },
  };

  const VENUE_IDS = Object.keys(VENUES);
  const DEFAULT_VENUE = 'gig';
  /* An unknown venue is the gig rather than a crash: the id can arrive from a
     URL or from a half-written app config, and a night out is better than an
     error screen. */
  const venueOf = id => VENUES[id] || VENUES[DEFAULT_VENUE];

  /* ---------- the rules prompts ----------
     NJA-3150 AC 5.1 and NJA-3154 AC 2.1: a "rules prompt" per speaker, which
     is combined with the scenario prompt above into one prompt, and whose
     {{tags}} are evaluated at runtime. The three the tickets name are
     {{native_language}}, {{target_language}} and {{user_expected_answer}};
     the rest below are the same idea extended to everything else the engine
     has already decided. Every tag is filled by the server from the plan —
     the model is never asked to work one out.

     These sit in content because that is where they end up: the scenario and
     coach prompts are Directus fields already (NJA-3153), and a rules prompt
     that lives in server code cannot be tuned without a deploy. Editing the
     wording here is the whole of changing how either speaker behaves. */
  /* The character's reaction to what the child actually said — the beat the
     storyboard has between the answer and the next question. It is generated,
     because the whole point is that it answers what they said rather than what
     they were supposed to say; a written line cannot do that.

     It is deliberately NOT allowed to be funny at the child's expense. The
     design frame has the bouncer say "Are you already drunk?" to a 7-10 year
     old whose Spanish came out in the wrong order, which is a different thing
     from a bouncer being gruff. */
  const reactRules = `You write ONE very short line for the ACTOR in a
language game played by a 7-10 year old. The child has just spoken to you.
Write their reply and nothing else.

{{scenario_prompt}}

You are {{actor_name}}. One sentence, at most two — shorter than your last one.

The child tried to say: {{user_expected_answer}}
What actually came out of their mouth: {{child_said}}
Did they get it right: {{was_correct}}

If they got it right, react to WHAT THEY SAID as a person would — serve them,
answer them, agree, hand it over — and move on. Do not praise their language;
somebody else does that, and a barman who compliments a child's grammar is not
a barman.

If they got it wrong, you did not understand them, and there is a queue. Let the
faint annoyance show — a sigh, a blank look, leaning in, asking them to run that
by you again — but it is the hold-up you are annoyed at, never the child. You
are never unkind and never funny at their expense: no jokes about them being
drunk, slow or foreign. They are a child having a go in a language that is not
theirs, and you soften the moment they get it right.

Never tell them what to say, never name the words, never say the right answer
or any part of it. Somebody else does that too.

Write in {{native_language}}, except for these {{target_language}} words, which
you may use and which the child has met: {{actor_may_use}}
Use no other {{target_language}} word. These are the child's own words to you,
never yours to say back: {{learner_only}}

No stage directions, no emoji. Return JSON only.`;

  const prompts = {
    actorRules: `You write ONE short line of dialogue for the ACTOR in a
language game played by a 7-10 year old. The actor is the person the child is
talking to. You do not decide what is taught, how much of it is in which
language, or what the right answer is. All of that is given to you. Write the
line and nothing else.

{{scenario_prompt}}

You are {{actor_name}}. One or two short sentences.

React to what the child just said AND say the thing that makes their expected
answer the natural reply — both in the one line, the way a person behind a
counter does it. Not "Here's your water." and then, separately, "Do you want a
soda?", but one breath: "Here's your water — anything else, a soda?" The child
is trying to: {{objectives}}. If they have finished everything, close the
conversation warmly instead.

Never repeat something you have already said this conversation. Serving them and
asking the next thing is ONE sentence, not the same sentence twice.

You are NOT a teacher. Never tell the child what to say, never name the words to
use, never say "say X" or "try saying". Somebody else does that; when you do it
too, two voices are giving instructions and neither is worth listening to. You
serve, you answer, you move on.

YOU HAVE WHAT YOU SELL
You are never out of anything. When the child asks whether you have something,
you have it; when they ask for something, they get it. "No, I don't" ends the
exchange and teaches a child who has just learnt to ask for a thing that the
thing does not exist. Refusing is not a kind of grumpiness that is available
to you — be short with them, be unimpressed, and serve them anyway.

Never ask a question the child cannot answer with what they know. They have one
short list of words. "Which one would you like?", "what size?", "how many?" each
demand vocabulary they have not got, and the exchange dies there. If you ask
anything, their expected answer must be a complete reply to it.

LANGUAGE — the rule that matters most
Write in {{native_language}}, EXCEPT for these {{target_language}} words, which
the child has already met and which you must use in {{target_language}}, never
translated back: {{actor_may_use}}
You may not use a {{target_language}} word that is not on that list. Not one.
That list is the whole of what this child may hear from you, and reaching past
it teaches vocabulary nobody chose.

WHOSE LINE IS WHOSE
These are the CHILD'S words, said by a customer to you. Never say them back to
them, in either language, not even as filler: {{learner_only}}
You are the actor behind the counter. A server who greets a customer with the
customer's own opening line is not having a conversation with them.

Do not say the child's expected answer, or the substance of it, before they
have. Leave them something to say.

{{new_thing}}

The child is expected to reply: {{user_expected_answer}} (meaning:
{{user_expected_answer_native}}). Do not say it for them.

No stage directions, no emoji, no praise, no questions to an adult. Vary your
wording. Return JSON only.`,

    reactRules,
    coachRules: `You are the child's coach in a language game played by a 7-10
year old. You speak only to them, never to the actor. Write ONE short line.

{{coach_prompt}}

The setting: {{scenario_prompt}}

{{actor_name}} has just said: "{{actor_line}}"

Your job, in one short sentence in {{native_language}}: make sure they
understood what was just said, and tell them what to say back — without handing
over the whole answer. They are expected to reply: {{user_expected_answer}}
(meaning: {{user_expected_answer_native}}).

{{new_thing}}

Write in {{native_language}}. The only {{target_language}} you may write is a
word or construction you are told you are introducing. Never translate the
character's line word for word; say what they want.

NEVER put a sentence in quotes and tell them to say it unless it is exactly
{{user_expected_answer}}, word for word. In particular, never build a sentence
out of {{native_language}} grammar with a {{target_language}} word dropped into
it — "Di: «¿Me das water?»" is not a thing anyone says, and a child who copies
it has been taught something that is wrong in both languages. If you want to
remind them what they are aiming for, say it in {{native_language}} as a
MEANING, with no "say this" in front of it.

No stage directions, no emoji, no questions to an adult. Vary your wording.
Return JSON only.`,
  };

  /* NJA-3157 / NJA-3158's ui_strings collection. Copy the UI owns rather than
     the model, so it is identical every time and translatable as a unit. */
  /* Every string a child reads, in every hint language. The hint language is
     the native language (NJA-3204), so t() looks these up by it: a string that
     is the same everywhere stays a plain string, one that differs is a map,
     and a missing language falls back to English rather than to nothing. */
  const uiStrings = {
    'answer-pane-correct-text': {
      en: 'Nice Job!', es: '¡Muy bien!', pt: 'Boa!',
      tr: 'Harika!', pl: 'Świetnie!', ro: 'Bravo!',
    },
    'answer-pane-incorrect-text': {
      en: 'Not quite, try again',   es: 'Casi, inténtalo otra vez',
      pt: 'Quase, tenta outra vez', tr: 'Yaklaştın, tekrar dene',
      pl: 'Prawie, spróbuj jeszcze raz', ro: 'Aproape, mai încearcă',
    },
    'pause-title': {
      en: 'Paused', es: 'En pausa', pt: 'Em pausa',
      tr: 'Duraklatıldı', pl: 'Pauza', ro: 'Pauză',
    },
    'pause-menu-skip': {
      en: 'Skip', es: 'Saltar', pt: 'Saltar',
      tr: 'Atla', pl: 'Pomiń', ro: 'Sari',
    },
    'pause-menu-exit': {
      en: 'Exit', es: 'Salir', pt: 'Sair',
      tr: 'Çık', pl: 'Wyjdź', ro: 'Ieși',
    },
    /* NJA-3168. {0} is the number, and the marker is INSIDE the string on
       purpose: Turkish writes the percent before the figure with no space, so
       any code that appends "%" itself is wrong in Turkish and right nowhere
       it matters. */
    'mastery-display-string': {
      en: 'Mastery: {0}%',
      es: 'Maestría: {0}%',
      pt: 'Mestria: {0}%',
      tr: 'Ustalık: %{0}',
      pl: 'Opanowanie: {0}%',
      ro: 'Stăpânire: {0}%',
    },
    /* The end of a go. The pass mark is a number the child should be told, so
       the two headline strings carry it: which one shows says whether they
       cleared it, and the difference is the point of NJA-3196 Q2. */
    'end-passed-title': {
      en: 'You made it.', es: 'Lo lograste.', pt: 'Conseguiste.',
      tr: 'Başardın.', pl: 'Udało się.', ro: 'Ai reușit.',
    },
    'end-short-title': {
      en: "That's the night.", es: 'Se acabó la noche.', pt: 'A noite acabou.',
      tr: 'Gece bitti.', pl: 'Koniec wieczoru.', ro: 'Asta a fost seara.',
    },
    'end-passed-sub': {
      en: 'Cleared the {0}% mark.', es: 'Has pasado del {0}%.',
      pt: 'Passaste os {0}%.',     tr: '%{0} barajını geçtin.',
      pl: 'Przekroczone {0}%.',    ro: 'Ai trecut de {0}%.',
    },
    'end-short-sub': {
      en: 'Short of the {0}% mark — another go at what is left will get you there.',
      es: 'Te faltó para el {0}% — otra vuelta a lo que queda y lo tienes.',
      pt: 'Faltou para os {0}% — outra volta ao que falta e chegas lá.',
      tr: '%{0} barajına az kaldı — kalanları bir daha dene, varırsın.',
      pl: 'Zabrakło do {0}% — jeszcze jedno podejście do reszty i się uda.',
      ro: 'Ți-a lipsit până la {0}% — încă o tură cu ce a rămas și ajungi acolo.',
    },
    /* The engine's verdict is `stuck` meaning IT STUCK — the line stayed with
       them — and the row is green. The English word is ambiguous enough that
       it was read the other way when these were translated, so all five came
       out as the child being stuck: "Atascado", "Takıldın", "Zacięte". A child
       who had just mastered every line was being told they were jammed, in
       green. The English label goes too, rather than leave the next person the
       same trap. */
    'end-stuck-label': {
      en: 'Got it', es: 'Lo tienes', pt: 'Já sabes',
      tr: 'Öğrendin', pl: 'Umiesz', ro: 'O știi',
    },
    'end-shaky-label': {
      en: 'Shaky', es: 'Flojo', pt: 'Inseguro',
      tr: 'Sallantıda', pl: 'Niepewne', ro: 'Nesigur',
    },
    'end-missed-label': {
      en: 'Not yet', es: 'Todavía no', pt: 'Ainda não',
      tr: 'Henüz değil', pl: 'Jeszcze nie', ro: 'Încă nu',
    },
    'end-replay-some': {
      en: 'PRACTISE WHAT IS LEFT', es: 'PRACTICA LO QUE FALTA',
      pt: 'PRATICA O QUE FALTA',   tr: 'KALANLARI ÇALIŞ',
      pl: 'POĆWICZ RESZTĘ',        ro: 'EXERSEAZĂ CE A RĂMAS',
    },
    'end-replay-all': {
      en: 'PLAY AGAIN', es: 'JUGAR OTRA VEZ', pt: 'JOGAR OUTRA VEZ',
      tr: 'TEKRAR OYNA', pl: 'ZAGRAJ JESZCZE RAZ', ro: 'JOACĂ DIN NOU',
    },
    /* The coach's line after a wrong answer. Written, not generated: it is the
       same sentence every time by design, it must never be wrong, and it is
       the one beat in the loop where a child is waiting to try again. */
    'coach-retry': {
      en: "Let's try that again.", es: 'Venga, otra vez.', pt: 'Vá, outra vez.',
      tr: 'Hadi, bir daha.', pl: 'Dawaj, jeszcze raz.', ro: 'Hai, încă o dată.',
    },
    /* The answer tray. {0} is how many words are missing — the one-word case
       is its own string because several of these languages inflect the noun
       after a number, so "Tap the {0} missing words" cannot be built. */
    'slot-hint-all': {
      en: 'Build the whole sentence', es: 'Construye la frase entera',
      pt: 'Constrói a frase toda',    tr: 'Cümlenin tamamını kur',
      pl: 'Ułóż całe zdanie',         ro: 'Construiește toată propoziția',
    },
    'slot-hint-one': {
      en: 'Tap the missing word',  es: 'Toca la palabra que falta',
      pt: 'Toca na palavra que falta', tr: 'Eksik kelimeye dokun',
      pl: 'Dotknij brakującego słowa', ro: 'Atinge cuvântul care lipsește',
    },
    'slot-hint-many': {
      en: 'Tap the {0} missing words', es: 'Toca las {0} palabras que faltan',
      pt: 'Toca nas {0} palavras que faltam', tr: 'Eksik {0} kelimeye dokun',
      pl: 'Dotknij brakujących słów ({0})',   ro: 'Atinge cele {0} cuvinte care lipsesc',
    },
    /* The mercy line, after enough failed tries: {0} is the coach's name and
       {1} the phrase he says for them. */
    'coach-says-it': {
      en: '— {0} says it for you: {1}',   es: '— {0} lo dice por ti: {1}',
      pt: '— {0} di-lo por ti: {1}',      tr: '— {0} senin yerine söylüyor: {1}',
      pl: '— {0} mówi to za ciebie: {1}', ro: '— {0} o spune în locul tău: {1}',
    },
    /* Asking for the microphone, before the browser does. The privacy line is
       the one a parent reads over a shoulder, so it says what actually happens
       and nothing more: the clip goes to the server that works out the words,
       and the app keeps none of it. */
    'mic-ask-title': {
      en: 'Say it out loud?', es: '¿Lo dices en voz alta?', pt: 'Dizê-lo em voz alta?',
      tr: 'Sesli söyleyelim mi?', pl: 'Powiesz to na głos?', ro: 'Spui cu voce tare?',
    },
    'mic-ask-why': {
      en: 'Turn on the microphone and you can answer by speaking instead of tapping.',
      es: 'Activa el micrófono y podrás responder hablando en vez de tocando.',
      pt: 'Liga o microfone e podes responder a falar em vez de tocar.',
      tr: 'Mikrofonu açarsan dokunmak yerine konuşarak cevap verebilirsin.',
      pl: 'Włącz mikrofon, a będziesz odpowiadać głosem zamiast stukać.',
      ro: 'Pornește microfonul și poți răspunde vorbind, nu atingând.',
    },
    'mic-ask-privacy': {
      en: 'What you say is listened to once to work out the words. It is not saved.',
      es: 'Lo que dices se escucha una vez para saber qué palabras son. No se guarda.',
      pt: 'O que dizes é ouvido uma vez para perceber as palavras. Não é guardado.',
      tr: 'Söylediğin, kelimeleri anlamak için bir kez dinlenir. Kaydedilmez.',
      pl: 'To, co powiesz, jest słuchane raz, żeby rozpoznać słowa. Nie jest zapisywane.',
      ro: 'Ce spui este ascultat o dată ca să se afle cuvintele. Nu se salvează.',
    },
    'mic-ask-go': {
      en: 'TURN ON THE MIC', es: 'ACTIVAR EL MICRO', pt: 'LIGAR O MICRO',
      tr: 'MİKROFONU AÇ', pl: 'WŁĄCZ MIKROFON', ro: 'PORNEȘTE MICROFONUL',
    },
    'mic-ask-no': {
      en: "I'LL TAP INSTEAD", es: 'PREFIERO TOCAR', pt: 'PREFIRO TOCAR',
      tr: 'DOKUNARAK DEVAM', pl: 'WOLĘ STUKAĆ', ro: 'PREFER SĂ ATING',
    },
    /* After a refusal. Deliberately does not say WHERE to turn it back on:
       the place differs by phone and by whether this is the app or a browser,
       and a wrong instruction to a child is worse than none. The grown-up
       reading it knows where settings are. */
    'mic-ask-denied': {
      en: 'The microphone is switched off for this app. An adult can turn it on in the settings — until then, tapping works just as well.',
      es: 'El micrófono está desactivado para esta app. Un adulto puede activarlo en los ajustes — mientras tanto, tocar funciona igual de bien.',
      pt: 'O microfone está desligado para esta app. Um adulto pode ligá-lo nas definições — até lá, tocar funciona igualmente bem.',
      tr: 'Bu uygulama için mikrofon kapalı. Bir yetişkin ayarlardan açabilir — o zamana kadar dokunmak da aynı işi görür.',
      pl: 'Mikrofon jest wyłączony dla tej aplikacji. Dorosły może go włączyć w ustawieniach — do tego czasu stukanie działa tak samo dobrze.',
      ro: 'Microfonul este oprit pentru această aplicație. Un adult îl poate porni din setări — până atunci, atingerea merge la fel de bine.',
    },
    'mic-ask-ok': {
      en: 'GOT IT', es: 'VALE', pt: 'ENTENDIDO',
      tr: 'TAMAM', pl: 'JASNE', ro: 'AM ÎNȚELES',
    },
    /* The mic panel. "Words hidden" is the point of the screen: the child is
       speaking, not reading, so the sentence comes off the page while the mic
       is open and they cannot simply read it aloud. */
    'mic-open': {
      en: 'MIC OPEN — TAP TO STOP', es: 'MICRO ABIERTO — TOCA PARA PARAR',
      pt: 'MICRO ABERTO — TOCA PARA PARAR', tr: 'MİKROFON AÇIK — DURDURMAK İÇİN DOKUN',
      pl: 'MIKROFON WŁĄCZONY — DOTKNIJ, BY ZATRZYMAĆ', ro: 'MICROFON PORNIT — ATINGE PENTRU A OPRI',
    },
    'mic-hidden-words': {
      en: 'WORDS HIDDEN', es: 'PALABRAS OCULTAS', pt: 'PALAVRAS ESCONDIDAS',
      tr: 'KELİMELER GİZLİ', pl: 'SŁOWA UKRYTE', ro: 'CUVINTE ASCUNSE',
    },
    'mic-thinking': {
      en: 'Listening…', es: 'Escuchando…', pt: 'A ouvir…',
      tr: 'Dinliyorum…', pl: 'Słucham…', ro: 'Ascult…',
    },
    /* Said while a spoken answer is with the judge. An exact answer never
       shows it — that is settled on the device — so it appears only where
       there is a real wait to account for. */
    /* ---------- the night itself (NJA-3211) ----------
       One scenario, three places to have it. The title card is the SCENARIO's
       now, not the venue's: it is shown before the venue is picked, so it
       cannot name a place. The per-venue `intro.title` strings further up are
       no longer read by the intro — left in place rather than deleted,
       because they are the only written description each venue has. */
    'scenario-title': {
      en: 'A big night out!',
      es: '¡Una gran noche!',
      pt: 'Uma grande noite!',
      tr: 'Muhteşem bir gece!',
      pl: 'Wielki wieczór!',
      ro: 'O seară pe cinste!',
    },
    /* Deliberately says nothing about WHICH language or WHICH place: it is
       read before either is settled, and a sub that names the target language
       needs a different grammatical form in four of these six. */
    'scenario-sub': {
      en: 'One night, three places to go. Axel is coming with you.',
      es: 'Una noche, tres sitios. Axel va contigo.',
      pt: 'Uma noite, três sítios. O Axel vai contigo.',
      tr: 'Bir gece, üç mekân. Axel de seninle.',
      pl: 'Jeden wieczór, trzy miejsca. Axel idzie z tobą.',
      ro: 'O seară, trei locuri. Axel vine cu tine.',
    },
    /* Axel's opening line, and the question the venue buttons answer. Spoken
       in his voice, so it is written to be heard rather than read.

       "England" is hard-coded because `session.learning` is hard-coded to
       'en'. If this prototype ever teaches a second language, this is one of
       the strings that has to become a country rather than a constant. The
       welcome avoids a gendered adjective in every language here — the child's
       gender is not something this prototype knows. */
    'axel-open': {
      en: "Hey buddy, welcome to England! What do you wanna do tonight? Don't worry about knowing the language — I'll be by your side the whole time.",
      es: '¡Hola, colega! Ya estamos en Inglaterra. ¿Qué te apetece hacer esta noche? No te preocupes por el idioma: voy a estar contigo todo el rato.',
      pt: 'Olá! Já estamos em Inglaterra. O que queres fazer esta noite? Não te preocupes com a língua — vou estar contigo o tempo todo.',
      tr: "Selam dostum, İngiltere'ye hoş geldin! Bu gece ne yapmak istersin? Dili bilmiyorsan dert etme — baştan sona yanındayım.",
      pl: 'Hej, ziomek, witaj w Anglii! Na co masz dziś ochotę? Nie martw się językiem — cały czas będę przy tobie.',
      ro: 'Salut, amice, bine ai venit în Anglia! Ce vrei să facem în seara asta? Nu-ți face griji cu limba — sunt lângă tine tot timpul.',
    },
    /* ---------- the venue choice (NJA-3207) ----------
       Asked in the child's own language, after the hint language is settled
       and before the night starts, so every event of the session carries the
       venue. */
    'venue-pick-title': {
      en: 'WHERE ARE WE GOING?', es: '¿ADÓNDE VAMOS?', pt: 'ONDE VAMOS?',
      tr: 'NEREYE GİDİYORUZ?', pl: 'DOKĄD IDZIEMY?', ro: 'UNDE MERGEM?',
    },
    'venue-pick-sub': {
      en: 'Axel is up for anything. Pick the night you want.',
      es: 'Axel se apunta a todo. Elige el plan que quieras.',
      pt: 'O Axel alinha em tudo. Escolhe o programa que quiseres.',
      tr: 'Axel her şeye varım diyor. İstediğin geceyi seç.',
      pl: 'Axel jest na wszystko gotowy. Wybierz, co robimy.',
      ro: 'Axel e gata de orice. Alege unde mergem.',
    },
    /* The way out of choosing. It is a real option, not a dodge: some children
       want the night rather than the menu, and the one who takes this is told
       apart from the one who picked, so the split is not contaminated by
       people who did not care. */
    'venue-surprise': {
      en: 'Surprise me', es: 'Sorpréndeme', pt: 'Surpreende-me',
      tr: 'Sen seç', pl: 'Zaskocz mnie', ro: 'Surprinde-mă',
    },
    /* The end screen's offer, which is the whole of the replay experiment. */
    'end-another-ask': {
      en: 'Cool night out. Want to try another place?',
      es: 'Menuda noche. ¿Probamos otro sitio?',
      pt: 'Que noite. Queres experimentar outro sítio?',
      tr: 'İyi geceydi. Başka bir yere gidelim mi?',
      pl: 'Niezła noc. Chcesz sprawdzić inne miejsce?',
      ro: 'Ce seară. Vrei să încercăm în altă parte?',
    },
    /* {0} is the place, in the child's own language — "Go to the cinema"
       rather than a bare "Another place", because naming it is most of the
       offer. */
    'end-another-go': {
      en: 'Go to {0}', es: 'Ir a {0}', pt: 'Ir a {0}',
      tr: '{0} gidelim', pl: 'Idziemy na: {0}', ro: 'Mergem la {0}',
    },
    'checking': {
      en: 'Checking…', es: 'Comprobando…', pt: 'A verificar…',
      tr: 'Kontrol ediyorum…', pl: 'Sprawdzam…', ro: 'Verific…',
    },
    /* The microphone's mistake, said out loud rather than charged to them.
       {0} is the transcript, so they can see what was written down. */
    'misheard': {
      en: 'I heard “{0}”. That might be me — say it again?',
      es: 'He oído “{0}”. Igual soy yo — ¿lo dices otra vez?',
      pt: 'Ouvi “{0}”. Pode ter sido eu — dizes outra vez?',
      tr: '“{0}” duydum. Belki ben yanlış duydum — bir daha söyler misin?',
      pl: 'Usłyszałem „{0}”. Może to moja wina — powiesz jeszcze raz?',
      ro: 'Am auzit „{0}”. Poate am greșit eu — mai spui o dată?',
    },
    'mic-nothing': {
      en: 'Didn’t hear anything — have another go.',
      es: 'No he oído nada — prueba otra vez.',
      pt: 'Não ouvi nada — tenta outra vez.',
      tr: 'Bir şey duymadım — tekrar dene.',
      pl: 'Nic nie usłyszałem — spróbuj jeszcze raz.',
      ro: 'Nu am auzit nimic — mai încearcă.',
    },
    'mic-unavailable': {
      en: 'No speech recognition in this browser — keep tapping.',
      es: 'Este navegador no reconoce la voz — sigue tocando.',
      pt: 'Este navegador não reconhece a voz — continua a tocar.',
      tr: 'Bu tarayıcıda ses tanıma yok — dokunmaya devam et.',
      pl: 'Ta przeglądarka nie rozpoznaje mowy — stukaj dalej.',
      ro: 'Browserul nu recunoaște vocea — atinge mai departe.',
    },
    'mic-failed': {
      en: 'Didn’t catch that — try tapping instead.',
      es: 'No te he pillado — prueba a tocar.',
      pt: 'Não apanhei — experimenta tocar.',
      tr: 'Anlayamadım — dokunmayı dene.',
      pl: 'Nie dosłyszałem — spróbuj stuknąć.',
      ro: 'Nu am prins — încearcă să atingi.',
    },
    /* THE OPENING TURN, written rather than generated. It is the same every
       time — the night always starts with the bartender not having noticed
       them — so there is nothing for a model to decide, and two calls plus
       their retries were being spent on it at the one moment nothing is warm:
       cold instance, cold model, first clip. The slowest 10% of children waited
       133 seconds on this turn, and the single commonest place to stop playing
       is a question that was shown and never answered.

       The bartender brushing them off is also what makes "Excuse me" a thing
       worth saying, which a generated "¿Sí? ¿Qué necesitas?" quietly undid.

       The coach's line names the mechanic, because the mechanic is what the
       first turn is actually teaching. {0} is the phrase they are to build. */
    'open-actor': {
      en: 'Yeah yeah, in a minute.',
      es: 'Sí, sí, un momento.',
      pt: 'Sim, sim, um momento.',
      tr: 'Tamam tamam, bir dakika.',
      pl: 'Tak, tak, za chwilę.',
      ro: 'Da, da, un moment.',
    },
    /* "She", in the two languages that mark it: all three people behind the
       three counters are women. Spanish, Portuguese and Romanian carry no
       gender on the verb here, so only English and Polish needed changing. */
    'open-coach': {
      en: 'She has not seen you. Tap the words to say “{0}”.',
      es: 'No te ha visto. Toca las palabras para decir “{0}”.',
      pt: 'Não te viu. Toca nas palavras para dizer “{0}”.',
      tr: 'Seni görmedi. Kelimelere dokunup “{0}” de.',
      pl: 'Nie zauważyła cię. Dotknij słów, żeby powiedzieć “{0}”.',
      ro: 'Nu te-a văzut. Atinge cuvintele ca să spui “{0}”.',
    },
    /* The written fallbacks, for when the model is slow or unreachable. One
       list per speaker so the line is not the same every turn. */
    'fb-actor-ask': {
      en: ['What can I get you?', 'Yes? What do you need?', 'Right — what will it be?', 'Go on then.'],
      es: ['¿Qué te pongo?', '¿Sí? ¿Qué necesitas?', 'Venga — ¿qué va a ser?', 'Dime.'],
      pt: ['O que te sirvo?', 'Sim? Do que precisas?', 'Então — o que vai ser?', 'Diz lá.'],
      tr: ['Ne vereyim?', 'Evet? Ne lazım?', 'Hadi — ne olacak?', 'Söyle bakalım.'],
      pl: ['Co podać?', 'Tak? Czego potrzebujesz?', 'No dobra — co ma być?', 'Mów śmiało.'],
      ro: ['Ce îți dau?', 'Da? De ce ai nevoie?', 'Hai — ce să fie?', 'Zi.'],
    },
    'fb-actor-offer': {
      en: 'We have {0}. Do you want it?',  es: 'Tenemos {0}. ¿Lo quieres?',
      pt: 'Temos {0}. Queres?',            tr: '{0} var. İster misin?',
      pl: 'Mamy {0}. Chcesz?',             ro: 'Avem {0}. Vrei?',
    },
    /* {0} is what they want to SAY, written in their own language, and {1} is
       the name of the language they have to say it in. Both halves are load-
       bearing. The first version of these was a bare verb plus the native
       sentence — "Repítelo. «¿Tienes una entrada?»" — which to a Spanish child
       learning English is an instruction to repeat Spanish. Every line here
       names the language, so the quote can only be read as the meaning. */
    'fb-coach-ask': {
      en: ['You want to say: “{0}”. Now in {1}.',
           'What you mean is “{0}”. Say it in {1}.',
           'Your turn: “{0}” — in {1}.'],
      es: ['Quieres decir: “{0}”. Ahora en {1}.',
           'Lo que quieres decir es “{0}”. Dilo en {1}.',
           'Te toca: “{0}” — en {1}.'],
      pt: ['Queres dizer: “{0}”. Agora em {1}.',
           'O que queres dizer é “{0}”. Di-lo em {1}.',
           'É a tua vez: “{0}” — em {1}.'],
      tr: ['Şunu demek istiyorsun: “{0}”. Şimdi {1}.',
           'Demek istediğin “{0}”. Bunu {1} söyle.',
           'Sıra sende: “{0}” — {1}.'],
      pl: ['Chcesz powiedzieć: “{0}”. Teraz po angielsku.',
           'Chodzi ci o “{0}”. Powiedz to po angielsku.',
           'Twoja kolej: “{0}” — po angielsku.'],
      ro: ['Vrei să spui: “{0}”. Acum în {1}.',
           'Ce vrei să spui e “{0}”. Spune-o în {1}.',
           'E rândul tău: “{0}” — în {1}.'],
    },
    'fb-coach-new': {
      en: "Here's how you say it: “{0}”", es: 'Así se dice: “{0}”',
      pt: 'Diz-se assim: “{0}”',          tr: 'Şöyle deniyor: “{0}”',
      pl: 'Mówi się tak: “{0}”',          ro: 'Se spune așa: „{0}”',
    },
    'end-eyebrow': {
      en: 'Session over', es: 'Se acabó', pt: 'Acabou',
      tr: 'Oturum bitti', pl: 'Koniec sesji', ro: 'Sesiune încheiată',
    },
    'coach-sheet-eyebrow': {
      en: 'Coach', es: 'Entrenador', pt: 'Treinador',
      tr: 'Koç', pl: 'Trener', ro: 'Antrenor',
    },
    'coach-sheet-title': {
      en: 'Need a hand?', es: '¿Te echo un cable?', pt: 'Precisas de ajuda?',
      tr: 'Yardım ister misin?', pl: 'Potrzebujesz pomocy?', ro: 'Ai nevoie de ajutor?',
    },
    /* The in-app ending. FINISH is the only thing in the prototype that
       completes the quest, so it says what it does rather than "done". The
       note appears only if the app did not answer — see bridge.js. */
    'end-finish': {
      en: 'FINISH', es: 'TERMINAR', pt: 'TERMINAR',
      tr: 'BİTİR', pl: 'ZAKOŃCZ', ro: 'TERMINĂ',
    },
    'end-finish-wait': {
      en: 'Still here? Tap FINISH again.',
      es: '¿Sigues aquí? Toca TERMINAR otra vez.',
      pt: 'Ainda aqui? Toca em TERMINAR outra vez.',
      tr: 'Hâlâ burada mısın? BİTİR\u2019e tekrar dokun.',
      pl: 'Nadal tutaj? Dotknij ZAKOŃCZ jeszcze raz.',
      ro: 'Tot aici? Atinge TERMINĂ din nou.',
    },
    /* The pause sheet — the night so far, in the epic's PPP terms. Parent-
       facing as much as child-facing, and on screen in the same language as
       everything else. The pill's CSS class comes from the phase key, never
       from this text. */
    'prog-head-phrases': {
      en: 'Phrases', es: 'Frases', pt: 'Frases',
      tr: 'Kalıplar', pl: 'Zwroty', ro: 'Expresii',
    },
    'prog-head-words': {
      en: 'Words', es: 'Palabras', pt: 'Palavras',
      tr: 'Kelimeler', pl: 'Słowa', ro: 'Cuvinte',
    },
    'prog-phase-present': {
      en: 'new', es: 'nuevo', pt: 'novo',
      tr: 'yeni', pl: 'nowe', ro: 'nou',
    },
    'prog-phase-practice': {
      en: 'practising', es: 'practicando', pt: 'a praticar',
      tr: 'çalışıyor', pl: 'w treningu', ro: 'exersează',
    },
    'prog-phase-produce': {
      en: 'can use', es: 'ya la usa', pt: 'já usa',
      tr: 'kullanabiliyor', pl: 'umie', ro: 'o folosește',
    },
    'prog-counts': {
      en: 'seen {0}, right {1}, wrong {2}',
      es: 'vista {0}, bien {1}, mal {2}',
      pt: 'vista {0}, certas {1}, erradas {2}',
      tr: '{0} kez geldi, {1} doğru, {2} yanlış',
      pl: 'widziane {0}, dobrze {1}, źle {2}',
      ro: 'văzută {0}, corect {1}, greșit {2}',
    },
    'sound-on': {
      en: 'SOUND ON', es: 'SONIDO SÍ', pt: 'SOM LIGADO',
      tr: 'SES AÇIK', pl: 'DŹWIĘK WŁ.', ro: 'SUNET PORNIT',
    },
    'sound-off': {
      en: 'SOUND OFF', es: 'SONIDO NO', pt: 'SOM DESLIGADO',
      tr: 'SES KAPALI', pl: 'DŹWIĘK WYŁ.', ro: 'SUNET OPRIT',
    },
    /* The language picker. These stay English: the screen is shown BEFORE a
       language is chosen, so there is nothing yet to show them in — in the
       real build it follows the device locale. */
    /* "HINT LANGUAGE" was jargon, and a third of the children on a non-English
       phone read the screen as "which language do you want to learn" and
       picked English. The question is now asked as a question, and what they
       are getting is stated rather than implied. The direction strip under the
       flags carries it for anyone who cannot read this. */
    'lang-pick-title':   'WHICH LANGUAGE DO YOU SPEAK?',
    'lang-pick-sub':     'Axel will give you your hints in it. You will be learning English.',
    'lang-pick-go':      'START',
    'lang-pick-missing': 'No words yet for {0}.',
  };



  const session = {
    /* NJA-3136 ends a session on mastery, not on a clock. The cap is a
       backstop so a child who cannot get one item right still reaches an
       ending — without it, "repeat until they get it right" has no exit. */
    turnCap: 40,
    /* NJA-3196 Q2: "a total session mastery > threshold i.e. 85% - so the
       minimum they will get is always 85%." The go does not end when the list
       runs out; it ends when the score clears this, and short of it the
       weakest step comes round again. The turn cap above is what stops that
       being endless — Q1 ("is there any need to measure that they got it
       wrong more than 5 times?") is still open, and the cap is the placeholder
       until it is answered. */
    passMark: 0.85,
    /* What counts as stuck, and so as carried into a replay rather than
       drilled again. A clean answer: a hinted one is worth another go. */
    keepMark: 1,
    masteryBar: 0.8,       // correct / (correct + incorrect) to count as produced
    minExposures: 2,       // ...but not before this many tries, or 1/1 = mastered
    /* Three wrong answers and the line is handed over and the night moves on.
       It was four, and the data said four was already too many: the children
       who could not produce a line were answering it 1.8 times on the easy
       steps and 17 times on the hard ones. The point of a retry is a second
       chance, not a war of attrition with a seven-year-old. */
    mercyAfterFailedTurns: 3,
    /* ---------- which way round, by default ----------
       The learner picks ONE language: the one their hints are in, which is
       the one they already speak. What they are here to learn does not need
       picking — this scenario teaches `learning`, and the pair is the two
       together.

       The default hint language is Spanish because that is who plays it: the
       prototype runs inside the app, and the learners are Spanish, Portuguese,
       Turkish, Polish or Romanian speakers learning English. English is in the
       list so the direction can be reversed for a walkthrough, and when it is
       picked as the hint language the scenario teaches the first other
       language it has words for instead. */
    hintDefault: 'es',
    learning: 'en',
    /* 'walk' (default): each pattern of the syllabus takes the first noun
       nobody has had yet, so every stage has a new word to teach.
       'first': every pattern takes its first valid noun, which is the same
       noun for most of them. */
    stageItems: 'walk',
  };

  /* ---------- expansion ----------
     NJA-3136, Engine step 1: build the pattern x item pairs and validate them
     by slot tag. Step 2: keep them in the order the lists declare. */
  /* ---------- chunking (NJA-3197) ----------
     A pattern is parsed ONCE, into the shape the real session stores:

       nativeFrames: [{type:'text', text:'I like '}, {type:'slot', key:'like#1'},
                      {type:'text', text:' and '},  {type:'slot', key:'like#2'}]

     rather than a template re-scanned with a regex on every render. The slot
     KEY carries its number, so a pattern can mention the same tag twice and
     the two stay distinguishable — which is the whole reason the number is in
     the syntax and the whole reason the old single-slot version could not
     handle "I like X and Y". */
  const SLOT = /\{([a-z_]+)(?:#(\d+))?:([a-z_|]+)\}/gi;

  function chunk(template) {
    const out = [];
    let at = 0, m;
    SLOT.lastIndex = 0;
    while ((m = SLOT.exec(template)) !== null) {
      if (m.index > at) out.push({ type: 'text', text: template.slice(at, m.index) });
      out.push({
        type: 'slot',
        key: m[1] + '#' + (m[2] || '1'),
        tag: m[1],
        // "a|b" means either article is acceptable; the first is what we render
        forms: m[3].split('|'),
      });
      at = m.index + m[0].length;
    }
    if (at < template.length) out.push({ type: 'text', text: template.slice(at) });
    return out;
  }

  const slotsOf = frames => frames.filter(f => f.type === 'slot');

  /* Render a chunked pattern, choosing the language of each slot separately
     from the language of the frame. `fill` maps slot key to item id; `inTarget`
     is the set of slot keys whose word has crossed over. */
  /* A slot's FORM is a property of the language, not of the pattern. NJA-3145
     has `i-like-x` as {like:bare} in English and {like:definite} in Spanish,
     and NJA-3204's two-slot fixture does the same — so a Spanish word standing
     in an English frame still takes the Spanish form. Reading the form off
     whichever frame list is being rendered gets this wrong in exactly that
     case ("I like disco" for "I like el disco"), so `forms` is looked up per
     (slot key, language) from that language's own chunked pattern. */
  function render(frames, lang, fill, inTarget, forms) {
    const out = frames.map(f => {
      if (f.type === 'text') return f.text;
      const id = fill[f.key];
      if (!id) return '___';
      const wordLang = (inTarget && inTarget.has(f.key)) ? lang.target : lang.native;
      return vocabItems[id][wordLang][formOf(forms, f, wordLang)];
    }).join('');
    return openCap(out);
  }
  /* A pattern that OPENS with a slot starts its sentence with a stored word,
     and stored words are lowercase — so Turkish came out "bir bilet var mı?".
     Only character zero is touched, and only when it is a lowercase letter:
     "¿Me das" already starts with punctuation and is right, and a blanked
     frame starts with "___" and must not have its first real word
     capitalised. */
  function openCap(str) {
    const c = str.charAt(0);
    return c && c !== c.toUpperCase() ? c.toUpperCase() + str.slice(1) : str;
  }
  /* The form this language asks for in this slot, falling back to the form
     written in the frame we are rendering when the other language has nothing
     to say about that slot. */
  function formOf(forms, f, wordLang) {
    const byLang = forms && forms[f.key];
    return (byLang && byLang[wordLang]) || f.forms[0];
  }

  /* The intro block for one pair: the hint language's copy, with the two
     language names filled in. Falls back to English copy for a hint language
     that has none yet, so adding a language to LANGUAGES never blanks the
     first screen. */
  function resolveIntro(activity, nativeCode, targetCode) {
    const all = activity.intro || {};
    const copy = all[nativeCode] || all.en || {};
    const names = LANG_NAMES[nativeCode] || LANG_NAMES.en;
    const args = [names[targetCode] || targetCode, names[nativeCode] || nativeCode];
    const out = {};
    for (const k of Object.keys(copy)) {
      out[k] = args.reduce((acc, v, i) => acc.split('{' + i + '}').join(v), String(copy[k]));
    }
    return out;
  }

  /* Names are authored per hint language and flattened here, so everything
     downstream keeps reading activity.actor.name as the plain string it has
     always been. A Spanish child met an actor called "Bartender" before
     this. */
  const nameIn = (obj, nativeCode) =>
    (obj && (obj[nativeCode] || obj.en)) || '';

  function expand(nativeCode, targetCode, venueId) {
    const activity = venueOf(venueId);
    const LANGS = { native: nativeCode, target: targetCode };
    const q = {
      id: activity.id, title: activity.title,
      /* What this pair's two languages are CALLED, in the child's own
         language, so a written line can say "now in English" without a
         sentence per pair. */
      languageNames: {
        native: (LANG_NAMES[nativeCode] || LANG_NAMES.en)[nativeCode] || nativeCode,
        target: (LANG_NAMES[nativeCode] || LANG_NAMES.en)[targetCode] || targetCode,
      },
      /* The intro copy is resolved for THIS pair before anything reads it, so
         the UI keeps seeing a flat { title, sub, coach, loading, tap }. The
         shared `activity` is left alone — a second build() with another pair
         must not inherit the first one's screen. */
      venue: activity.venue,
      activity: Object.assign({}, activity, {
        intro: resolveIntro(activity, LANGS.native, LANGS.target),
        coach: COACH,
        actor: Object.assign({}, activity.actor, { name: nameIn(activity.actor.name, LANGS.native) }),
        name: nameIn(activity.name, LANGS.native),
      }),
      nativeLang: LANGS.native, targetLang: LANGS.target,
      languages: LANGUAGES, forms: FORMS,
      slotTags, vocabItems, vocabPatterns, session, prompts, uiStrings,
      groups: [], glossary: {}, chipGloss: {}, phrases: {},
    };

    /* NJA-3197's patternVocabGroups: the pattern, both chunkings, and which
       items are valid in each of its slots. */
    for (const pid of activity.patterns) {
      const pat = vocabPatterns[pid];
      if (!pat) throw new Error('unknown pattern: ' + pid);
      /* A pattern only the actor says is scenery, not curriculum: it is
         defined so the writing can lean on it, but the child is never asked
         to produce it. */
      if (pat.speaker === 'actor') continue;

      if (!pat[LANGS.native] || !pat[LANGS.target]) continue;
      const nativeFrames = chunk(pat[LANGS.native]);
      const targetFrames = chunk(pat[LANGS.target]);
      const nk = slotsOf(nativeFrames).map(s => s.key).join(',');
      const tk = slotsOf(targetFrames).map(s => s.key).join(',');
      if (nk !== tk) {
        throw new Error('pattern slots differ between languages: ' + pid + ' (' + nk + ' vs ' + tk + ')');
      }

      const slots = {};
      for (const sl of slotsOf(nativeFrames)) {
        const usable = activity.items.filter(id => (vocabItems[id].tags || []).includes(sl.tag));
        if (!usable.length) throw new Error('slot has no valid vocab items: ' + pid + ' / ' + sl.key);
        slots[sl.key] = usable;
      }

      /* {slot key: {language: form}} — every language this pattern is written
         in, so a word can be rendered in its own language's form wherever it
         stands. */
      const forms = {};
      for (const code of LANGUAGES.map(l => l.code)) {
        if (!pat[code]) continue;
        for (const sl of slotsOf(chunk(pat[code])))
          (forms[sl.key] = forms[sl.key] || {})[code] = sl.forms[0];
      }

      q.groups.push({
        id: pid, pattern: pat, opensOnly: !!pat.opensOnly,
        nativeFrames, targetFrames, forms, langs: LANGS,
        slotKeys: slotsOf(nativeFrames).map(s => s.key),
        slots,
      });
    }

    q.pairs = q.groups.map(g => makePair(g));

    /* ---------- what a highlighted run means (NJA-3149) ----------
       The ticket's fixtures carry a `translation` on every target fragment:
       {type:'target', text:'una entrada', translation:'an entry ticket'}. So
       the content has to be able to say what a RUN of target-language words
       means, not just a single word — and the two fixtures with neighbouring
       targets ("Tengo" then "una entrada") show that two runs stay separate
       fragments because they mean two different things.

       The table is built from the content three ways:

         - every vocab item, in every form
         - every pattern's blanked frame whole
         - and the text either side of a frame's slots, aligned index by index
           against the other language's. That alignment is real rather than a
           guess: both languages are chunked from the same slot list, so when
           the two chunk sequences have the same shape, text chunk i in one is
           text chunk i in the other. "Tengo ___." against "I have ___." gives
           "Tengo" -> "I have"; "¿Me das ___, por favor?" against "Can I have
           ___, please?" gives both halves. Where the shapes differ, nothing is
           claimed. */
    /* The native side is tidied at its edges: a frame chunk carries whatever
       punctuation sat around the slot, and ", please?" is not what ", por
       favor?" means — "please" is. Punctuation inside the phrase stays. */
    const tidy = s => String(s).replace(/^[\s,.;:¿¡?!]+|[\s,.;:?!]+$/g, '').trim();
    const addPhrase = (target, native) => {
      const k = phraseKey(target);
      const v = tidy(native || '');
      if (k && v && !q.phrases[k]) q.phrases[k] = v;
    };

    for (const [, item] of Object.entries(vocabItems)) {
      if (!item[LANGS.target] || !item[LANGS.native]) continue;
      for (const form of FORMS) addPhrase(item[LANGS.target][form], item[LANGS.native][form]);
    }

    for (const g of q.groups) {
      const T = g.targetFrames, N = g.nativeFrames;
      const sameShape = T.length === N.length && T.every((f, i) => f.type === N[i].type);
      if (sameShape) {
        for (let i = 0; i < T.length; i++) {
          if (T[i].type !== 'text') continue;
          addPhrase(T[i].text, N[i].text);
        }
      }
      addPhrase(render(T, LANGS, {}, null, g.forms).replace(/___/g, ' '),
                render(N, LANGS, {}, null, g.forms).replace(/___/g, ' '));
    }

    /* The engine builds its own pairs when it wants a particular word in a
       particular slot — the syllabus walks the vocabulary, so which noun a
       stage gets is its decision, not the content's. */
    q.pairFor = (groupId, fill) => {
      const g = q.groups.find(x => x.id === groupId);
      return g ? makePair(g, Object.assign({}, fill)) : null;
    };

    /* Every word the child can see, and what it means. Built from the content
       rather than hand-written, so a new item is glossed the moment it is
       added — the whitelist and the tap-to-translate modal both read this. */
    for (const [iid, item] of Object.entries(vocabItems)) {
      if (!item[LANGS.target] || !item[LANGS.native]) continue;
      for (const form of FORMS) {
        const t = item[LANGS.target][form], n = item[LANGS.native][form];
        if (!t || !n) continue;
        q.chipGloss[t.toLowerCase()] = n;
        for (const tok of t.split(/\s+/)) q.glossary[bare(tok)] = q.glossary[bare(tok)] || n;
      }
    }
    for (const g of q.groups) {
      const blankT = render(g.targetFrames, LANGS, {}, null, g.forms).trim();
      const blankN = render(g.nativeFrames, LANGS, {}, null, g.forms).trim();
      for (const seg of blankT.split(/\s+/)) {
        const k = bare(seg);
        if (k && k !== '___' && !q.glossary[k]) q.glossary[k] = '(part of "' + blankN + '")';
      }
      q.chipGloss[blankT.toLowerCase()] = blankN;
    }
    return q;
  }

  const bare = w => String(w).toLowerCase().replace(/[¿?¡!.,;:"“”]/g, '').trim();
  /* How a phrase is looked up: case, surrounding punctuation and runs of
     whitespace are noise, but the words and their order are not. */
  const phraseKey = s => String(s || '').toLowerCase()
    .replace(/[¿?¡!.,;:"“”]/g, ' ').replace(/\s+/g, ' ').trim();

  /* One playable pair: a group plus one item per slot. `fill` starts as the
     first valid item for each slot; the engine swaps it as the syllabus walks
     the vocabulary.

     The FRAME is the pattern with its slots blanked — the part the child learns
     as a construction — and each slot's ITEM drops into it. They are tracked
     separately because the engine crosses one of them at a time into the target
     language (NJA-3136, Engine step 4), and with two slots that is now three
     things to cross rather than two. */
  function makePair(group, fill) {
    const L = group.langs;
    const use = fill || {};
    /* Distinct by default. Two slots drawing on the same tag both take the
       first valid item unless you stop them, and "I like the ticket and the
       ticket" is not a sentence anyone wanted. */
    const taken = new Set(Object.values(use));
    for (const key of group.slotKeys) {
      if (use[key]) continue;
      use[key] = group.slots[key].find(id => !taken.has(id)) || group.slots[key][0];
      taken.add(use[key]);
    }

    const all = new Set(group.slotKeys);
    const none = new Set();
    const asTarget = keys => new Set(keys);

    return {
      id: group.id + (group.slotKeys.length
        ? '-' + group.slotKeys.map(k => use[k]).join('-') : ''),
      patternId: group.id,
      group,
      fill: use,
      slotKeys: group.slotKeys,
      // kept for everything that still thinks in terms of one word
      itemId: group.slotKeys.length ? use[group.slotKeys[0]] : null,
      opensOnly: group.opensOnly,
      hasSlot: group.slotKeys.length > 0,
      slotCount: group.slotKeys.length,

      // the frame with every slot blanked, for showing the construction alone
      frame: {
        native: render(group.nativeFrames, L, {}, null, group.forms),
        target: render(group.targetFrames, L, {}, null, group.forms),
      },
      /* What sits in each slot, in both languages — each in ITS OWN
         language's form, which is the whole of NJA-3145's grammar context. */
      items: group.slotKeys.map(key => ({
        key, id: use[key],
        native: vocabItems[use[key]][L.native][slotForm(group, key, L.native)],
        target: vocabItems[use[key]][L.target][slotForm(group, key, L.target)],
      })),
      get item() { return this.items[0] || null; },

      allNative: render(group.nativeFrames, L, use, none, group.forms),
      allTarget: render(group.targetFrames, L, use, all, group.forms),
      /* Any mix: the frame in one language, a named set of slots in the other.
         This is what replaces the old four fixed renderings — with two slots
         there are six combinations, not four, and with three there are
         sixteen, so they are computed rather than enumerated. */
      say(frameTarget, targetSlots) {
        const frames = frameTarget ? group.targetFrames : group.nativeFrames;
        return render(frames, L, use, asTarget(targetSlots || []), group.forms);
      },
    };
  }

  function slotForm(group, key, lang) {
    const byLang = group.forms && group.forms[key];
    if (byLang && byLang[lang]) return byLang[lang];
    const sl = slotsOf(group.nativeFrames).find(s => s.key === key);
    return sl ? sl.forms[0] : 'bare';
  }

  /* ---------- which pairs this content can actually teach ----------
     A language is usable when every pattern this scenario draws on, and every
     vocab item it uses, is written in it. NJA-3204 wants the unusable case to
     fail loudly rather than quietly produce half a session, so the picker
     greys them out and build() refuses them with the ticket's own message. */
  function covered() {
    const usable = (activity, code) =>
      activity.patterns.every(pid => {
        const pat = vocabPatterns[pid];
        return pat && (pat.speaker === 'actor' || !!pat[code]);
      }) &&
      activity.items.every(id => {
        const it = vocabItems[id];
        return it && it[code] && FORMS.every(f => !!it[code][f]);
      });
    return LANGUAGES
      .filter(l => VENUE_IDS.every(v => usable(VENUES[v], l.code)))
      .map(l => l.code);
  }

  const CONTENT = {
    languages: LANGUAGES,
    covered: covered(),
    name: code => (LANGUAGES.find(l => l.code === code) || {}).name || code,
    /* The languages a child can take HINTS in. Not the same list as `covered`:
       you cannot learn English out of English, so the language this scenario
       teaches is not among the ones it can teach from. That is the whole of
       why the picker used to offer a choice that inverted it — English sat in
       the list looking like an answer, and picking it quietly switched the
       scenario to teaching Spanish. */
    hintable: () => CONTENT.covered.filter(c => c !== session.learning),
    /* What this scenario teaches, which is one thing and does not depend on
       the hint language. It used to fall back to "the first other language we
       have" when the hint WAS the target — the only way English could ever be
       a hint — and that fallback is what produced a Spanish lesson nobody
       asked for. A pair that teaches out of its own language is now an error
       (build() refuses it) rather than something quietly rewritten. */
    learns() { return session.learning; },
    /* The pair a session starts on when nothing says otherwise. */
    defaultPair() {
      const hintable = CONTENT.hintable();
      const hint = hintable.includes(session.hintDefault) ? session.hintDefault : hintable[0];
      return { native: hint, target: CONTENT.learns() };
    },
    /* NJA-3204: the pair is an input, and a pair this content does not hold
       is an error with the languages it DOES hold named in it. */
    /* Which nights out there are, named in the child's own language, for the
       picker. The order is the order they are offered in. */
    venues: VENUE_IDS,
    defaultVenue: DEFAULT_VENUE,
    venueList: nativeCode => VENUE_IDS.map(id => ({
      id,
      name: nameIn(VENUES[id].name, nativeCode),
      background: VENUES[id].background,
    })),
    build(nativeCode, targetCode, venueId) {
      const have = CONTENT.covered;
      if (nativeCode === targetCode)
        throw new Error('Native and target language must differ');
      for (const code of [nativeCode, targetCode])
        if (!have.includes(code))
          throw new Error('This scenario only supports ' +
            have.map(CONTENT.name).join(' and '));
      return expand(nativeCode, targetCode, venueId);
    },
  };

  window.CONTENT = CONTENT;
  /* The default pair, so anything that reads window.QUEST at load still has
     one. The session replaces it the moment a pair is chosen. */
  const d = CONTENT.defaultPair();
  return CONTENT.build(d.native, d.target);
})();
