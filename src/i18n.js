// -----------------------------------------------------------------------------
// Every text a user reads (status, button answers, errors), in English and
// French, with {placeholders}. Never a URL, a key or a token in any of them.
// -----------------------------------------------------------------------------

export const TEXTS = {
  ready: {
    en: 'Ready: the default space is set. Nothing is sent until a scene, a Gladys message or the Test button asks.',
    fr: 'Prêt : l’espace par défaut est renseigné. Rien n’est envoyé sans une scène, un message de Gladys ou le bouton Tester.',
  },
  readyNoDefault: {
    en: 'Ready, without a default space: each user pastes the webhook URL of their space in “My account”. The scene action and the Test button need the default space.',
    fr: 'Prêt, sans espace par défaut : chaque utilisateur colle l’URL du webhook de son espace dans « Mon compte ». L’action de scène et le bouton Tester demandent l’espace par défaut.',
  },
  lastPosted: {
    en: 'Ready: the last message to the default space was posted.',
    fr: 'Prêt : le dernier message vers l’espace par défaut a été publié.',
  },
  configUnreadable: {
    en: 'The configuration could not be read from Gladys: read again in a moment.',
    fr: 'La configuration n’a pas pu être lue depuis Gladys : nouvelle lecture dans un moment.',
  },
  defaultInvalid: {
    en: 'Default space: {reason}',
    fr: 'Espace par défaut : {reason}',
  },
  defaultRefused: {
    en: 'Default space: Google Chat refused the webhook URL (HTTP {status}). Nothing is sent to it until a new URL is saved or the Test button succeeds.',
    fr: 'Espace par défaut : Google Chat a refusé l’URL du webhook (HTTP {status}). Rien ne lui est envoyé avant qu’une nouvelle URL soit enregistrée ou que le bouton Tester réussisse.',
  },
  defaultPaused: {
    en: 'Default space: Google Chat asked to slow down; nothing is sent to it for {minutes} min.',
    fr: 'Espace par défaut : Google Chat a demandé de ralentir ; rien ne lui est envoyé pendant {minutes} min.',
  },

  // Why a message was not sent (nothing left for Google).
  emptyUrl: {
    en: 'no webhook URL.',
    fr: 'aucune URL de webhook.',
  },
  badUrl: {
    en: 'the webhook URL is not a valid URL.',
    fr: 'l’URL du webhook n’est pas une URL valide.',
  },
  notGoogleChat: {
    en: 'the webhook URL must start with https://chat.googleapis.com/v1/spaces/ and end with /messages (copy it again from the space: Apps & integrations → Webhooks).',
    fr: 'l’URL du webhook doit commencer par https://chat.googleapis.com/v1/spaces/ et finir par /messages (recopiez-la depuis l’espace : Applications et intégrations → Webhooks).',
  },
  badUrlParams: {
    en: 'the webhook URL must carry exactly its key and token parameters (copy it again, whole, from the space).',
    fr: 'l’URL du webhook doit porter exactement ses paramètres key et token (recopiez-la en entier depuis l’espace).',
  },
  emptyText: {
    en: 'the message is empty: nothing sent.',
    fr: 'le message est vide : rien n’a été envoyé.',
  },
  refusedEarlier: {
    en: 'Google Chat refused this webhook URL earlier (HTTP {status}): nothing sent. Save a new URL, or click Test for the default space.',
    fr: 'Google Chat a déjà refusé cette URL de webhook (HTTP {status}) : rien n’a été envoyé. Enregistrez une nouvelle URL, ou cliquez sur Tester pour l’espace par défaut.',
  },
  paused: {
    en: 'Google Chat asked to slow down for this space: nothing sent for {minutes} more min.',
    fr: 'Google Chat a demandé de ralentir pour cet espace : rien n’est envoyé pendant encore {minutes} min.',
  },
  capReached: {
    en: 'the cap of {max} messages per hour is reached: nothing sent (the cap is in the configuration).',
    fr: 'le plafond de {max} messages par heure est atteint : rien n’a été envoyé (le plafond se règle dans la configuration).',
  },
  spaceBusy: {
    en: 'too many messages at once for this space (Google Chat takes one a second): nothing sent.',
    fr: 'trop de messages à la fois pour cet espace (Google Chat en prend un par seconde) : rien n’a été envoyé.',
  },
  stopped: {
    en: 'the integration is stopping: nothing sent.',
    fr: 'l’intégration s’arrête : rien n’a été envoyé.',
  },
  noDefault: {
    en: 'no default space in the configuration: nothing sent.',
    fr: 'aucun espace par défaut dans la configuration : rien n’a été envoyé.',
  },

  // What Google answered.
  posted: {
    en: 'Message posted in the space.',
    fr: 'Message publié dans l’espace.',
  },
  duplicate: {
    en: 'The same message was posted in this space less than 15 s ago: not posted twice.',
    fr: 'Le même message a été publié dans cet espace il y a moins de 15 s : pas publié deux fois.',
  },
  rateLimited: {
    en: 'Google Chat refused the message for now (too many requests): nothing posted, nothing sent to this space for {minutes} min.',
    fr: 'Google Chat a refusé le message pour l’instant (trop de requêtes) : rien n’a été publié, rien n’est envoyé à cet espace pendant {minutes} min.',
  },
  refused: {
    en: 'Google Chat refused the webhook URL (HTTP {status}: webhook deleted, token revoked, or webhooks turned off by the Workspace administrator): nothing posted.',
    fr: 'Google Chat a refusé l’URL du webhook (HTTP {status} : webhook supprimé, jeton révoqué, ou webhooks désactivés par l’administrateur Workspace) : rien n’a été publié.',
  },
  rejected: {
    en: 'Google Chat rejected the message (HTTP {status}): nothing posted.',
    fr: 'Google Chat a rejeté le message (HTTP {status}) : rien n’a été publié.',
  },
  serverError: {
    en: 'Google Chat answered with an error (HTTP {status}): the message may or may not be posted; it is not sent again.',
    fr: 'Google Chat a répondu par une erreur (HTTP {status}) : le message est peut-être publié, peut-être pas ; il n’est pas renvoyé.',
  },
  unconfirmed: {
    en: 'Sent, without an answer from Google Chat: the message may be posted; it is not sent again.',
    fr: 'Envoyé, sans réponse de Google Chat : le message est peut-être publié ; il n’est pas renvoyé.',
  },
  notSent: {
    en: 'Google Chat could not be reached (network, name resolution or certificate): nothing sent.',
    fr: 'Google Chat est injoignable (réseau, résolution de nom ou certificat) : rien n’a été envoyé.',
  },

  testText: {
    en: 'Gladys test message: this space receives the messages of Gladys.',
    fr: 'Message de test de Gladys : cet espace reçoit les messages de Gladys.',
  },
};

/** `{ en, fr }` of a text, placeholders filled. */
export function t(key, values = {}) {
  const entry = TEXTS[key];
  const fill = (text) => text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  return { en: fill(entry.en), fr: fill(entry.fr) };
}

/** The English text (logs, errors). */
export const en = (key, values) => t(key, values).en;
