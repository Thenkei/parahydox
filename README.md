# Parahydox

Un puzzle-platformer où un seul monde se lit de trois façons : en 1D (un fil), en 2D (une
coupe verticale) ou en 3D (le volume entier). Rembobiner le temps laisse un clone qui
rejoue tes touches, pas tes déplacements.

Tout le jeu se joue en mouvement continu : on court, on saute, et les clones ne t'attendent
pas. 64 niveaux en 8 mondes de 8 :

| Monde | Idée |
| --- | --- |
| 1. Le fil | courir, sauter, pousser des caisses, traverser le vide sur un fil |
| 2. Le volume | déplier la profondeur, changer de coupe, sauter de pierre en pierre |
| 3. La boucle | rembobiner : un clone tient une plaque, sert de marche, court au-dessus de toi |
| 4. Le croisement | le clone dans une dimension, toi dans une autre |
| 5. La divergence | des touches perdues contre une porte qui deviennent une vraie course |
| 6. Le levier | un état qui reste, et que chaque passage rebascule |
| 7. Le reflet | des clones qui rejouent tes touches en miroir |
| 8. L'éphémère | des dalles qui s'effondrent derrière toi |

## Lancer

```bash
npm install
npm run dev        # serveur de développement
npm test           # la physique, le parseur, et la course prévue de chaque niveau
npm run build      # typecheck + build statique dans dist/
npm run check      # typecheck + tests + build : ce que lance le déploiement
```

## Commandes

| Touche | Action |
| --- | --- |
| ← → (ou A D / Q D) | courir |
| ↑ (ou W / Z), Espace | sauter ; plus on appuie longtemps, plus le saut porte |
| ↑ ↓ en 3D | courir vers le fond et vers l'avant (Espace saute) |
| ← → ↑ ↓ sur un fil | suivre le fil, avec la flèche qui va dans son sens |
| E, Entrée | changer de dimension : sur une ancre (même en plein saut) ou sur un seuil |
| R | rembobiner : la course qu'on vient de faire devient un clone |
| U, Retour arrière | retenter la boucle en gardant les clones |
| Maj+R | recommencer le niveau, sans clone |
| H | rappeler la consigne, puis donner l'indice |
| Échap | choix du niveau |
| M | couper ou remettre le son |
| N / P | niveau suivant / précédent |

Une boucle part à ta première touche, et tes clones avec elle. Une chute dans le vide
relance la boucle, clones conservés. `?level=12` ouvre un niveau, `?unlock` les ouvre tous,
`?level=12&demo` fait jouer au jeu la course prévue du niveau.

## Règles

- **Corps** : on court à environ cinq cases par seconde. Un saut tenu monte d'un peu plus
  d'une case : une marche se saute, deux cases sont un mur. On garde un court instant pour
  sauter après avoir quitté un bord, et un saut demandé un rien trop tôt part à la réception.
- **Têtes** : une tête est une plateforme, celle d'un clone comme celle d'un voyageur sur
  un fil. Personne n'est porté : si celui du dessous s'en va, celui du dessus tombe.
- **Caisses** : on les pousse en marchant contre elles, à demi-vitesse, une à la fois et
  jamais en l'air. Elles tombent, tiennent une plaque, bouchent un fil, et font une marche
  de la hauteur d'une tête. En 3D on les pousse dans les quatre directions ; lâchée entre
  deux coupes, une caisse glisse dans la plus proche.
- **1D** : sur une ancre, E replie le corps en un point qui glisse le long du fil. Ni
  gravité ni inertie ; on n'en sort qu'à une ancre. Une barrière enfilée sur le fil
  n'arrête que celui qui est sur le fil. Sur un fil on ne pèse rien, sauf sur une plaque
  enfilée dessus.
- **3D** : sur un seuil, E déplie la profondeur ; s'y replier sur un autre seuil change de
  coupe. La profondeur s'arrête avec la grille, devant comme derrière.
- **Clones** : un clone rejoue les touches de sa course, image par image. Ce sont des
  touches, pas des déplacements ni des intentions : une porte ouverte là où elle était
  fermée, une marche là où il n'y en avait pas, et la même course mène ailleurs. ↑ saute
  en 2D, s'enfonce en 3D et monte sur un fil, pour lui comme pour toi.
- **Reflet** : dans le monde 7, un clone rejoue gauche pour droite et droite pour gauche.
  Le haut, le bas et la profondeur ne sont pas inversés.
- **Plaque et porte** : la porte est ouverte tant que quelque chose pèse sur la plaque, et
  ne se referme jamais sur quelqu'un.
- **Levier** : il bascule chaque fois qu'un personnage y pose le pied, et reste dans cet
  état ; le survoler ne fait rien. Une grille (barreaux horizontaux) est une porte
  inversée : ouverte au repos.
- **Dalle fragile** : elle tient tant que quelqu'un s'y tient, et tombe quand le dernier
  l'a quittée à pied. La quitter par un fil ne la casse pas.
- **Hors de la grille** il n'y a que du vide, et on n'en revient pas.

## À l'écran

- En haut à gauche le niveau, au centre la dimension courante, à droite le nombre de
  clones en course et le chrono.
- L'**éclair** ⚡ récompense une victoire dans le temps affiché : la course prévue du
  niveau, plus une marge pour une main humaine. Le chrono compte toutes les tentatives
  depuis l'ouverture du niveau ; Maj+R le remet à zéro.
- La barre du bas dit ce que font les touches ici et maintenant : elle change avec la
  dimension, et E s'allume quand il y a quelque chose à faire là où l'on se tient.

## Architecture

- `src/core/` — le niveau, sans DOM : la grille, ses types, et le parseur du format texte
  (décrit en tête de `src/core/level-parser.ts`).
- `src/flow/physics.ts` — les règles. `stepFlow(world, inputs)` est une fonction pure à
  pas fixe (60 par seconde) : une course rejouée à partir de ses touches est toujours la
  même course. `tape.ts` écrit et rejoue des courses (`R40 RJ14 _20 E1 | R90`).
- `src/flow/search.ts` — outil de conception : cherche une course qui atteint un but, en
  essayant toutes les façons de tenir les touches. Il trouve les courses prévues et
  vérifie qu'un niveau à clones ne se finit pas sans clone.
- `src/levels/` — un fichier texte par niveau, une couche ASCII par valeur de z, avec sa
  course prévue (`tape:`), que les tests rejouent.
- `src/ui/` — `game.ts` lit les touches, fait avancer la physique et dessine ; `app.ts`
  tient les écrans et la progression ; `render/` est le dessin en Canvas 2D : une seule
  projection oblique dont la profondeur se replie, si bien que changer de dimension
  déplace la caméra au lieu de changer d'écran.
- `src/ui/audio.ts` — tout le son est synthétisé (Web Audio).
- `src/assets/` — ciels et textures de pierre, d'herbe et de caisse générés avec l'outil
  d'image de Codex ; personnages, portes, leviers, fils et effets sont dessinés en code.

## Outils de conception

```bash
npm run flow -- src/levels/20-sous-ton-ombre.txt "RJ16 R260 | R330" 10   # jouer une bande et voir où chacun se trouve
npm run explore -- src/levels/05-la-fosse.txt                            # chercher une course jusqu'à la sortie
npm run explore -- src/levels/17-*.txt --with "R44 _10" --goal 12,1      # chercher la boucle suivante, jusqu'à une case
npm run audit                                                            # tous les niveaux : course prévue, et pas de raccourci sans clone
npm run audit -- --write src/levels/33-*.txt                             # compléter une bande laissée ouverte avec "?"
node tools/drive.mjs "unlock&level=6&demo" wait:3000 shot:essai          # le vrai jeu dans Chrome headless (serveur preview sur 4317)
```

Dans un fichier de niveau, une boucle peut rester ouverte pendant la conception :
`tape: R44 _10 | ?` demande à l'audit de trouver la seconde boucle, `?@8,1` de trouver une
course qui s'arrête sur cette case, `?flat` de ne pas déplier la profondeur. La recherche
arrondit positions et vitesses : « rien trouvé » est un bon indice, pas une preuve.

## Déploiement

Chaque push sur `main` lance `.github/workflows/deploy.yml` : `npm run check`, puis
publication de `dist/` sur GitHub Pages. Le build utilise une base relative, il tourne donc
tel quel sous `/parahydox/`.
