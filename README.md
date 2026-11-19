# Parahydox

Un puzzle-platformer où un seul monde se lit de trois façons : en 1D (un fil), en 2D (une
coupe verticale) ou en 3D (le volume entier). Rembobiner le temps laisse un clone qui
rejoue tes touches, pas tes déplacements.

Tout le jeu se joue en mouvement continu : on court, on saute, et les clones ne t'attendent
pas. Six campagnes : la principale, trois campagnes annexes, Hardcore et le chapitre final dans l’Hyperspace.

**Parahydox**, 64 niveaux en 8 mondes de 8 :

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

Trois campagnes annexes de 16 niveaux (2 mondes de 8), qui s'ouvrent au fil de la campagne
principale, au nombre de niveaux terminés, quels qu'ils soient :

| Campagne | S'ouvre à | Règle | Mondes |
| --- | --- | --- | --- |
| **Le givre** | 24 niveaux | la glace : on n'y démarre ni n'y freine, et une caisse poussée y glisse | G1. La glissade (seul) · G2. Le verglas (avec des clones) |
| **Le tore** | 40 niveaux | les bords sont recousus : ce qui sort d'un côté revient de l'autre | T1. Le ruban (gauche et droite) · T2. La chute sans fin (bas et haut) |
| **L'envers** | 56 niveaux | les clones sont des antipodes : ils tombent vers le haut | E1. Les antipodes · E2. Semelle contre semelle |

**Hardcore**, 32 niveaux d'élite en 4 mondes de 8, qui s'ouvre quand les 64 premiers sont
tous terminés. Les mêmes règles, sans rien de neuf à apprendre : ce sont les idées des huit
mondes qui se croisent. Le décor change : basalte, braises et ciels brûlés.

| Monde | Idée |
| --- | --- |
| H1. Le vertige | seul : caisses, fils, profondeur, leviers et dalles, dans un ordre qui ne pardonne pas |
| H2. Le chœur | deux ou trois clones : têtes empilées, relais, clones dans une autre dimension |
| H3. Le contre-jour | des reflets partout : terrains asymétriques, leviers, fils et profondeur |
| H4. La ruine | le sol cède : des dalles fragiles mêlées à tout le reste, jusqu'au dernier niveau |

**L’Hyperspace** s’ouvre après les 32 niveaux de Hardcore. Huit salles forment le dernier
chapitre (X1-1 à X1-8). Le champ attire vers le plafond et, dans les salles à marée,
inverse son sens toutes les deux secondes de simulation. **B** équipe ou retire les bottes :
équipées, elles ramènent au sol. Les clones rejouent aussi cette commande.
Le losange mémorise la boucle en cours, y compris la position des clones, les portes et la phase du champ.
Une chute ou **U** reprend à cette balise. **R** repart du début avec le nouvel enregistrement.
La balise dure jusqu’au changement de boucle ou de niveau. Au dernier seuil, le portail de jour ouvre le générique.

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
| B | chausser ou retirer les bottes dans l’Hyperspace |
| R | rembobiner : la course qu'on vient de faire devient un clone |
| U, Retour arrière | retenter la boucle en gardant les clones |
| Maj+R | recommencer le niveau, sans clone |
| H | revoir la démonstration disponible, ou rappeler la consigne puis l’indice |
| Maj+H | afficher ou masquer directement l’indice du niveau |
| Échap | choix du niveau |
| Tab | dans le choix du niveau : changer de campagne |
| M | couper ou remettre le son |
| N / P | niveau suivant / précédent |

La première rencontre avec la profondeur, le rembobinage d’un clone ou les bottes ouvre
une courte démonstration dans une salle dédiée. Échap, Entrée ou Espace rend la main.
Le chrono, les clones et la balise du niveau restent en pause. Avec la préférence système
de réduction des animations, les démonstrations s’ouvrent uniquement sur demande avec H.

Une boucle part à ta première touche, et tes clones avec elle. Une chute dans le vide
relance la boucle, clones conservés. `?level=12` ouvre le douzième niveau dans l'ordre de jeu,
toutes campagnes comptées ; `?level=H2-5` (ou `G1-4`, `T2-1`, `E1-8`, `3-2`) le nomme par son
étiquette, qui ne bouge pas quand une campagne s'ajoute. `?unlock` ouvre tout,
`?level=12&demo` fait jouer au jeu la course prévue du niveau.

Dans le choix du niveau, Tab passe d'une campagne à l'autre (↑ et ↓ aussi, au bout de la
liste). Une campagne fermée se regarde mais on n'y entre pas : ni N, ni `?level=` n'y
mènent, seul `?unlock` l'ouvre sans l'avoir gagnée.

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
- **Hors de la grille** il n'y a que du vide, et on n'en revient pas (sauf dans Le tore).
- **Glace** (Le givre) : les pieds sur la glace, on ne démarre ni ne freine vite, et on reste
  glissant, saut compris, tant qu'on n'a pas reposé le pied sur ce qui accroche : la pierre,
  une caisse, une tête. Un mur arrête net. Une caisse poussée sur la glace garde son élan
  jusqu'à ce que quelque chose l'arrête : un obstacle, la pierre, quelqu'un, ou un bord,
  d'où elle tombe tout droit.
- **Bords recousus** (Le tore) : selon le niveau, la gauche et la droite sont le même
  endroit, ou le bas et le haut, ou les deux. Ce qui tombe par le bas revient par le haut,
  et plus rien ne se perd dans le vide : tomber est une façon de monter. La profondeur ne
  se recoud pas, et un fil ne passe pas la couture.
- **Antipodes** (L'envers) : les clones tombent vers le haut. Ils se tiennent sous les
  plafonds, y courent, et leur saut va vers le bas ; sans plafond, ils sortent par le haut.
  Une tête reste une plateforme, dans le sens où chacun tombe : toi et ton antipode pouvez
  donc vous tenir semelle contre semelle au-dessus du vide, chacun retenant l'autre, et
  courir ensemble. Les caisses, elles, tombent toujours vers le bas.

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
  course prévue (`tape:`), que les tests rejouent. Chaque campagne a son dossier
  (`givre/`, `tore/`, `envers/`, `hardcore/`, `hyperspace/`). `index.ts` décrit les campagnes : leurs mondes
  (le numéro `world:` d'un niveau est unique d'une campagne à l'autre : 1 à 8, Hardcore 9 à
  12, les annexes 13 à 18, l’Hyperspace 19) et combien de niveaux de quelle campagne il faut avoir terminés pour
  les ouvrir.
- `src/ui/` — `game.ts` lit les touches, fait avancer la physique et dessine ; `app.ts`
  tient les écrans et la progression ; `progress.ts` sauvegarde les temps et dit ce qui est
  ouvert (une campagne, un niveau) ; `render/` est le dessin en Canvas 2D : une seule
  projection oblique dont la profondeur se replie, si bien que changer de dimension
  déplace la caméra au lieu de changer d'écran.
- `src/ui/themes.ts` — un décor par monde. Un thème appartient à un biome (un par
  campagne) qui choisit ses textures et ses détails dessinés (herbe et fleurs, croûte et
  braises, neige et glaçons…), et donne la tonalité de la musique.
- `src/ui/audio.ts` — tout le son est synthétisé (Web Audio).
- `src/assets/` — ciels et textures (pierre, herbe et caisse de bois ; basalte, braise et
  caisse de fer pour Hardcore) générés avec l'outil d'image de Codex ; personnages, portes,
  leviers, fils et effets sont dessinés en code.

## Outils de conception

```bash
npm run flow -- src/levels/20-sous-ton-ombre.txt "RJ16 R260 | R330" 10   # jouer une bande et voir où chacun se trouve
npm run explore -- src/levels/05-la-fosse.txt                            # chercher une course jusqu'à la sortie
npm run explore -- src/levels/17-*.txt --with "R44 _10" --goal 12,1      # chercher la boucle suivante, jusqu'à une case
npm run audit                                                            # tous les niveaux des campagnes : course prévue, et pas de raccourci sans clone
npm run audit -- --write src/levels/33-*.txt                             # compléter une bande laissée ouverte avec "?"
npm run audit -- --fewer src/levels/hardcore/16-*.txt                    # une course à plusieurs clones : chercher à s'en passer d'un
node tools/drive.mjs "unlock&level=6&demo" wait:3000 shot:essai          # le vrai jeu dans Chrome headless (serveur preview sur 4317)
```

Dans un fichier de niveau, une boucle peut rester ouverte pendant la conception :
`tape: R44 _10 | ?` demande à l'audit de trouver la seconde boucle, `?@8,1` de trouver une
course qui s'arrête sur cette case, `?flat` de ne pas déplier la profondeur. La recherche
arrondit positions et vitesses : « rien trouvé » est un bon indice, pas une preuve. Dès
qu'il y a des clones, le temps fait partie de l'état et elle s'y noie vite : les boucles à
clones s'écrivent à la main et se vérifient avec `npm run flow`.

## Déploiement

Chaque push sur `main` lance `.github/workflows/deploy.yml` : `npm run check`, puis
publication de `dist/` sur GitHub Pages. Le build utilise une base relative, il tourne donc
tel quel sous `/parahydox/`.
