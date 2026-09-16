/* The quest content. This is the JSON from the plan with one wrapper line on top —
   edit it exactly as you would the .json file. Nothing else reads content. */
window.QUEST = {
  "id": "axel-gig",
  "title": "Axel goes to a gig",
  "coach": "axel",
  "nativeLang": "en",
  "targetLang": "es",

  "session": {
    "turnBudget": 24,
    "masteryBar": 0.85,
    "canUseBar": 0.75,
    "mercyAfterFailedTurns": 4
  },


  /* Word-level glosses. Every Spanish word a child can see on screen is
     tappable, and this is what the tooltip shows. Keys are lowercase and
     stripped of punctuation. */
  "glossary": {
    "sí": "yes", "qué": "what", "quieres": "do you want", "te": "you",
    "pongo": "shall I get you", "hola": "hello", "mira": "look",
    "están": "they are", "tocando": "playing", "adiós": "bye",
    "voy": "I'm going", "a": "to", "un": "a", "una": "a", "concierto": "concert",
    "puedo": "can I", "entrar": "come in", "tengo": "I have", "entrada": "ticket",
    "refresco": "soft drink", "por": "for", "favor": "please",
    "por favor": "please", "gracias": "thank you",
    "lo": "it", "estoy": "I am", "pasando": "having", "bien": "well",
    "esto": "this", "mola": "is cool"
  },

  "scenes": [
    {
      "id": "s1-getting-ready",
      "title": "Getting ready",
      "background": "axel-bedroom",
      "onScreen": { "character": "axel", "role": "coach-and-speaker", "speaks": "native" },
      "opening": "Oh — you're here! Perfect timing.",
      "items": [
        {
          "id": "voy-a-un-concierto",
          "target": "Voy a un concierto",
          "native": "I am going to a concert",
          "coachLine": "There's a gig tonight and you're coming with me! Tell me —",
          "chips": ["Voy", "a", "un", "concierto"],
          "distractors": ["tengo", "bien", "puedo", "gracias"],
          "accept": ["voy a un concierto", "voy a un concierto esta noche", "yo voy a un concierto"]
        }
      ]
    },

    {
      "id": "s2-the-door",
      "title": "The door",
      "background": "venue-front-door",
      "onScreen": { "character": "bouncer", "role": "npc", "speaks": "target" },
      "coachWidget": true,
      "opening": "¿Sí? ¿Qué quieres?",
      "items": [
        {
          "id": "puedo-entrar",
          "target": "¿Puedo entrar?",
          "native": "Can I come inside?",
          "coachLine": "He wants to know what you're after. Ask him",
          "chips": ["¿Puedo", "entrar?"],
          "distractors": ["tengo", "una", "gracias", "voy"],
          "accept": ["puedo entrar", "¿puedo entrar?", "puedo pasar"]
        },
        {
          "id": "tengo-una-entrada",
          "target": "Tengo una entrada",
          "native": "I have a ticket",
          "coachLine": "He's asking for your ticket. Tell him",
          "chips": ["Tengo", "una", "entrada"],
          "distractors": ["puedo", "concierto", "por favor"],
          "accept": ["tengo una entrada", "tengo entrada", "sí, tengo una entrada"]
        }
      ]
    },

    {
      "id": "s3-the-bar",
      "title": "The bar",
      "background": "venue-inside-bar",
      "onScreen": { "character": "bartender", "role": "npc", "speaks": "target" },
      "coachWidget": true,
      "opening": "¡Hola! ¿Qué te pongo?",
      "items": [
        {
          "id": "un-refresco-por-favor",
          "target": "Un refresco, por favor",
          "native": "A soft drink, please",
          "coachLine": "She's asking what you want. Say",
          "chips": ["Un", "refresco,", "por favor"],
          "distractors": ["tengo", "entrada", "puedo", "gracias"],
          "accept": ["un refresco por favor", "un refresco", "quiero un refresco"]
        },
        {
          "id": "gracias",
          "target": "Gracias",
          "native": "Thank you",
          "coachLine": "She's handing it over. Don't forget to say",
          "chips": ["Gracias"],
          "distractors": ["por favor", "hola", "adiós"],
          "accept": ["gracias", "muchas gracias"]
        }
      ]
    },

    {
      "id": "s4-in-the-crowd",
      "title": "In the crowd",
      "background": "crowd-band-playing",
      "onScreen": { "character": "axel", "role": "speaker", "speaks": "target" },
      "coachWidget": "silent",
      "opening": "¡Mira! ¡Están tocando!",
      "items": [
        {
          "id": "lo-estoy-pasando-bien",
          "target": "Lo estoy pasando bien",
          "native": "I'm having a good time",
          "coachLine": "He's asking how it's going. Tell him",
          "chips": ["Lo", "estoy", "pasando", "bien"],
          "distractors": ["tengo", "puedo", "gracias", "voy"],
          "accept": ["lo estoy pasando bien", "me lo estoy pasando bien", "me lo estoy pasando muy bien"]
        },
        {
          "id": "esto-mola",
          "target": "¡Esto mola!",
          "native": "This is cool!",
          "coachLine": "Tell him what you think of the band —",
          "chips": ["¡Esto", "mola!"],
          "distractors": ["bien", "gracias", "puedo"],
          "accept": ["esto mola", "¡esto mola!", "mola", "qué guay"]
        }
      ]
    }
  ]
};
