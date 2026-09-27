# Template de démonstration

Ceci est la documentation utilisateur de l'intégration. Gladys ré-héberge ce
fichier et affiche un lien **Documentation** permanent vers lui dans l'écran
de configuration (dans la langue de l'utilisateur, avec l'anglais en repli) —
c'est au moment de configurer que l'utilisateur en a le plus besoin. Gardez
les courtes indications d'accueil dans les blocs `section` du `config_schema`
du manifest ; mettez ici le pas-à-pas détaillé (captures d'écran, dépannage…).

## Ce que vous obtenez

Six appareils de démonstration apparaissent après l'installation : une
station météo (vraies données Open-Meteo), un interrupteur, une lampe
variable, une prise connectée avec mesure de puissance, un détecteur de
mouvement et une caméra.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Renseignez la **latitude** et la **longitude** que la station météo de
   démonstration doit observer (Paris par défaut), et choisissez votre unité
   de température.
3. Enregistrez : les appareils apparaissent dans l'onglet **Découverte**,
   prêts à être ajoutés.

Le réglage **Préférer la connexion locale** pilote la prise de
démonstration : elle affiche en badge le canal réellement utilisé (local ou
cloud), avec un point orange quand elle fonctionne en mode dégradé (local
refusé, bascule cloud).

## Actions

- **Tester le fournisseur météo** — effectue une requête en direct vers
  Open-Meteo et affiche la température et l'humidité actuelles sous le
  bouton.
- **Identifier un appareil** — choisissez un de vos appareils dans la liste
  et il se signale (la lampe de démonstration « clignote » dans les logs).

## Dépannage

L'intégration journalise tout ce qu'elle fait : consultez les logs de
l'intégration depuis l'interface Gladys (ou `docker logs` sur l'hôte) avec
`LOG_LEVEL=debug` pour le détail complet.
