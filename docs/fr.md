# Jellyfin & Emby

Pilotez les lecteurs de votre serveur **Jellyfin** ou **Emby** depuis Gladys,
suivez ce qui se regarde dans la maison et déclenchez des scènes quand une
lecture démarre, se met en pause ou s'arrête — le classique « lumières
tamisées quand le film commence ».

Fonctionne avec Jellyfin 10.9 et suivants (vérifié sur 10.11 et 12.1) et
avec Emby (vérifié sur 4.10). L'intégration détecte seule le type de
serveur.

## Configuration

1. **Créez une clé d'API** pour Gladys sur votre serveur :
   - Jellyfin : **Tableau de bord > Clés API > +**, nommez-la « Gladys » ;
   - Emby : **Paramètres > Avancé > Clés API > Nouvelle clé d'API**.
2. Dans l'onglet **Configuration** de l'intégration, renseignez :
   - l'**URL du serveur**, port inclus (par exemple
     `http://192.168.1.20:8096`). Une adresse https derrière un reverse
     proxy fonctionne aussi ; vous pouvez coller l'adresse de votre
     navigateur, `/web/...` est retiré automatiquement ;
   - la **clé d'API** créée à l'étape 1.
3. Enregistrez, puis cliquez sur **Tester la connexion**.
4. Les appareils apparaissent dans l'onglet **Découverte**.

Un lecteur (application TV, téléphone, navigateur) n'apparaît que lorsqu'il
est **connecté** au serveur : ouvrez l'application sur la TV, puis cliquez
sur **Rechercher les lecteurs**. Un lecteur ajouté reste dans Gladys même
quand il est éteint.

## Ce que vous obtenez

**Le serveur** : nombre de lectures en cours, nombre de lectures
transcodées (celles qui chargent le processeur), un résumé « qui regarde
quoi, où », et un compteur par bibliothèque (plus les épisodes des séries et
les morceaux de musique). Les compteurs se désactivent dans la
configuration.

**Chaque lecteur** : lecture, pause, stop, précédent, suivant, retour
arrière, avance rapide, volume, muet, état de lecture, titre en cours, temps
restant, et deux indicateurs **« pendant l'intro »** et **« pendant le
générique »**. Les boutons sont compatibles avec le widget **Musique** du
tableau de bord.

Les indicateurs d'intro et de générique ont besoin que le serveur connaisse
ces passages :

- Jellyfin (10.10 et suivants) : installez un fournisseur de segments, par exemple le plugin
  officiel **Chapter Segments Provider** (il lit les chapitres nommés
  « Intro », « Credits »…) ou le plugin **Intro Skipper** ;
- Emby : la détection des intros et génériques d'Emby.

Sans eux, les deux indicateurs restent à 0.

## Scènes

Quatre déclencheurs : **Lecture démarrée**, **Lecture en pause**, **Lecture
reprise**, **Lecture arrêtée**. Chacun peut être limité à un lecteur et à
des types de média (film, épisode, musique, TV en direct…). Les variables
`title`, `name`, `series_name`, `media_type`, `user` et `player_name` sont
utilisables dans les actions qui suivent.

Exemple : _Lecture démarrée, lecteur « TV du salon », type Film_ → tamiser
le salon ; _Lecture en pause_ sur le même lecteur → rallumer.

Deux actions de scène :

- **Afficher un message sur un lecteur** — par exemple « On sonne à la
  porte » par-dessus le film ;
- **Lire un média sur un lecteur** — cherche un titre dans la bibliothèque
  (film, série, album, artiste, liste de lecture…) et le lance, en lecture
  aléatoire si besoin. Le titre lu est disponible pour la suite de la scène.

Le lecteur doit être connecté au serveur pour recevoir un message ou une
lecture.

## Widgets du tableau de bord

- **En cours de lecture** : qui regarde quoi, où, avec les affiches.
- **Lecteur** : la lecture en cours en télécommande — la jaquette (ou
  l'image de fond du film), le titre, l'état, le temps restant et les boutons
  lecture/pause, stop et suivant. Laissez le réglage « Lecteur » vide pour
  suivre automatiquement ce qui est en cours de lecture, ou choisissez un
  lecteur pour le suivre lui seul.
- **Derniers ajouts** : les affiches des films, séries ou albums ajoutés
  récemment, les nouveaux épisodes regroupés par série.

## Dépannage

- **« Le serveur refuse la clé d'API »** : la clé a été supprimée ou mal
  copiée. Créez-en une nouvelle et enregistrez-la. L'intégration cesse
  volontairement d'interroger le serveur tant que la clé est refusée : un
  reverse proxy équipé de fail2ban pourrait sinon bannir votre adresse.
- **Un bouton ne fait rien** : toutes les applications n'acceptent pas le
  contrôle à distance. Les applications TV et le client web l'acceptent ;
  certaines applications mobiles non.
- **La mise à jour est lente** : l'intégration suit les lectures en temps
  réel par WebSocket. Si votre reverse proxy ne relaie pas les WebSockets,
  elle se replie sur une interrogation toutes les 15 secondes.
- Les journaux de l'intégration sont consultables depuis l'interface Gladys.
