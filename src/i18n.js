// -----------------------------------------------------------------------------
// Texts of the integration, in the two languages the manifest offers.
//
// The Gladys host does not tell a device integration its user's language, so
// the device and feature NAMES follow the `language` config field (they are
// fixed when the user adds a device). Widget contents receive the language of
// each request and are localized with the same table.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['fr', 'en'];

const TEXTS = {
  en: {
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Previous',
    next: 'Next',
    rewind: 'Rewind',
    forward: 'Forward',
    volume: 'Volume',
    mute: 'Mute',
    playbackState: 'Playback state',
    nowPlaying: 'Now playing',
    remaining: 'Remaining time',
    inIntro: 'In intro',
    inCredits: 'In credits',
    activeStreams: 'Active streams',
    transcodes: 'Transcoding streams',
    episodes: 'episodes',
    tracks: 'tracks',
    idle: 'Nothing playing',
    playing: 'Playing',
    paused: 'Paused',
    transcoding: 'Transcoding',
    streams: 'Streams',
    nothingPlaying: 'Nothing is playing right now.',
    nothingNew: 'Nothing added recently.',
    newEpisodes: (n) => (n > 1 ? `${n} new episodes` : '1 new episode'),
    series: 'Series',
    album: 'Album',
    on: 'on',
    state: 'State',
    user: 'User',
    playerOffline: 'This player is not connected to the server.',
  },
  fr: {
    play: 'Lecture',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Précédent',
    next: 'Suivant',
    rewind: 'Retour arrière',
    forward: 'Avance rapide',
    volume: 'Volume',
    mute: 'Muet',
    playbackState: 'État de lecture',
    nowPlaying: 'En cours de lecture',
    remaining: 'Temps restant',
    inIntro: "Pendant l'intro",
    inCredits: 'Pendant le générique',
    activeStreams: 'Lectures en cours',
    transcodes: 'Transcodages en cours',
    episodes: 'épisodes',
    tracks: 'morceaux',
    idle: 'Rien en lecture',
    playing: 'Lecture',
    paused: 'Pause',
    transcoding: 'Transcodage',
    streams: 'Lectures',
    nothingPlaying: "Rien n'est en cours de lecture.",
    nothingNew: 'Aucun ajout récent.',
    newEpisodes: (n) => (n > 1 ? `${n} nouveaux épisodes` : '1 nouvel épisode'),
    series: 'Série',
    album: 'Album',
    on: 'sur',
    state: 'État',
    user: 'Utilisateur',
    playerOffline: "Ce lecteur n'est pas connecté au serveur.",
  },
};

/**
 * Normalize a language code ('fr-FR', 'FR', undefined...) to a supported one.
 * @param {unknown} language
 * @returns {'fr'|'en'}
 */
export function normalizeLanguage(language) {
  const code = String(language ?? '')
    .slice(0, 2)
    .toLowerCase();
  return LANGUAGES.includes(code) ? code : 'en';
}

/**
 * Text table of a language.
 * @param {unknown} language
 */
export function texts(language) {
  return TEXTS[normalizeLanguage(language)];
}
