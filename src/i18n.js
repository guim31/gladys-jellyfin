// -----------------------------------------------------------------------------
// Texts of the integration, in the four languages of the Gladys interface.
//
// The Gladys host does not tell a device integration its user's language, so
// the device and feature NAMES follow the `language` config field (they are
// fixed when the user adds a device). Widget contents receive the language of
// each request and are localized with the same table.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['fr', 'en', 'de', 'es'];

export const TEXTS = {
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
    player: 'Player',
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
    player: 'Lecteur',
    playerOffline: "Ce lecteur n'est pas connecté au serveur.",
  },
  de: {
    play: 'Abspielen',
    pause: 'Pause',
    stop: 'Stopp',
    previous: 'Zurück',
    next: 'Weiter',
    rewind: 'Zurückspulen',
    forward: 'Vorspulen',
    volume: 'Lautstärke',
    mute: 'Stumm',
    playbackState: 'Wiedergabestatus',
    nowPlaying: 'Aktuelle Wiedergabe',
    remaining: 'Restzeit',
    inIntro: 'Im Intro',
    inCredits: 'Im Abspann',
    activeStreams: 'Aktive Wiedergaben',
    transcodes: 'Laufende Transkodierungen',
    episodes: 'Episoden',
    tracks: 'Titel',
    idle: 'Keine Wiedergabe',
    playing: 'Wiedergabe',
    paused: 'Pausiert',
    transcoding: 'Transkodierung',
    streams: 'Wiedergaben',
    nothingPlaying: 'Gerade läuft nichts.',
    nothingNew: 'Nichts neu hinzugefügt.',
    newEpisodes: (n) => (n > 1 ? `${n} neue Episoden` : '1 neue Episode'),
    series: 'Serie',
    album: 'Album',
    on: 'auf',
    state: 'Status',
    user: 'Benutzer',
    player: 'Player',
    playerOffline: 'Dieser Player ist nicht mit dem Server verbunden.',
  },
  es: {
    play: 'Reproducir',
    pause: 'Pausa',
    stop: 'Detener',
    previous: 'Anterior',
    next: 'Siguiente',
    rewind: 'Retroceder',
    forward: 'Avanzar',
    volume: 'Volumen',
    mute: 'Silencio',
    playbackState: 'Estado de reproducción',
    nowPlaying: 'En reproducción',
    remaining: 'Tiempo restante',
    inIntro: 'Durante la intro',
    inCredits: 'Durante los créditos',
    activeStreams: 'Reproducciones en curso',
    transcodes: 'Transcodificaciones en curso',
    episodes: 'episodios',
    tracks: 'pistas',
    idle: 'Nada en reproducción',
    playing: 'Reproduciendo',
    paused: 'En pausa',
    transcoding: 'Transcodificando',
    streams: 'Reproducciones',
    nothingPlaying: 'No se está reproduciendo nada.',
    nothingNew: 'Ninguna novedad reciente.',
    newEpisodes: (n) => (n > 1 ? `${n} episodios nuevos` : '1 episodio nuevo'),
    series: 'Serie',
    album: 'Álbum',
    on: 'en',
    state: 'Estado',
    user: 'Usuario',
    player: 'Reproductor',
    playerOffline: 'Este reproductor no está conectado al servidor.',
  },
};

/**
 * Normalize a language code ('fr-FR', 'FR', undefined...) to a supported one.
 * @param {unknown} language
 * @returns {'fr'|'en'|'de'|'es'}
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

// Messages shown by Gladys as they are (connection status, results of the
// configuration buttons, widget links): one object per message, with every
// language, since Gladys picks the one of its user.
export const MESSAGES = {
  notConfigured: {
    en: 'Fill in the server URL and API key in the configuration.',
    fr: "Renseignez l'URL du serveur et la clé d'API dans la configuration.",
    de: 'Gib in der Konfiguration die Server-URL und den API-Schlüssel ein.',
    es: 'Introduzca la URL del servidor y la clave de API en la configuración.',
  },
  authRefused: {
    en: 'The server refused the API key. Create a new one (Dashboard > API Keys) and save it here.',
    fr: "Le serveur refuse la clé d'API. Créez-en une nouvelle (Tableau de bord > Clés API) et enregistrez-la ici.",
    de: 'Der Server lehnt den API-Schlüssel ab. Erstelle einen neuen (Dashboard > API-Schlüssel) und speichere ihn hier.',
    es: 'El servidor rechaza la clave de API. Cree una nueva (Panel de control > Claves API) y guárdela aquí.',
  },
  /** @param {{ name: string, label: string, version: string, libraries: number, players: number }} p */
  connected: ({ name, label, version, libraries, players }) => ({
    en: `Connected to "${name}" (${label} ${version}): ${libraries} libraries, ${players} players connected.`,
    fr: `Connecté à « ${name} » (${label} ${version}) : ${libraries} bibliothèques, ${players} lecteurs connectés.`,
    de: `Verbunden mit „${name}“ (${label} ${version}): ${libraries} Bibliotheken, ${players} Player verbunden.`,
    es: `Conectado a «${name}» (${label} ${version}): ${libraries} bibliotecas, ${players} reproductores conectados.`,
  }),
  /** @param {number} count */
  playersKnown: (count) => ({
    en: `${count} players known. New ones appear in the Discovery tab.`,
    fr: `${count} lecteurs connus. Les nouveaux apparaissent dans l'onglet Découverte.`,
    de: `${count} Player bekannt. Neue erscheinen im Tab „Entdecken“.`,
    es: `${count} reproductores conocidos. Los nuevos aparecen en la pestaña «Descubrir».`,
  }),
  /** @param {string} error */
  unreachable: (error) => ({
    en: `Cannot reach the server: ${error}`,
    fr: `Impossible de joindre le serveur : ${error}`,
    de: `Server nicht erreichbar: ${error}`,
    es: `No se puede contactar con el servidor: ${error}`,
  }),
  /** @param {string} error */
  contactLost: (error) => ({
    en: `Lost contact with the server: ${error}`,
    fr: `Contact perdu avec le serveur : ${error}`,
    de: `Verbindung zum Server verloren: ${error}`,
    es: `Se perdió el contacto con el servidor: ${error}`,
  }),
  /** @param {string} app - Jellyfin or Emby. */
  openIn: (app) => ({
    en: `Open in ${app}`,
    fr: `Ouvrir dans ${app}`,
    de: `In ${app} öffnen`,
    es: `Abrir en ${app}`,
  }),
};
