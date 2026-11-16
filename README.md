# Parahydox

Un puzzle-platformer où un seul monde se lit de trois façons : en 1D (un fil), en 2D (une
coupe verticale) ou en 3D (le volume entier). Rembobiner le temps laisse un clone qui
rejoue tes touches, pas tes déplacements.

64 niveaux au pas en 8 mondes de 8, et un neuvième monde de 12 niveaux en mouvement continu, présenté en premier :

| Monde | Idée |
| --- | --- |
| 1. Le fil | marcher, grimper, pousser des caisses, traverser en 1D |
| 2. Le volume | déplier la profondeur, changer de coupe |
| 3. La boucle | rembobiner : un clone tient une plaque, sert de marche |
| 4. Le croisement | le clone dans une dimension, toi dans une autre |
| 5. La divergence | deux clones, et les touches perdues qui deviennent vraies |
| 6. Le levier | un état qui reste, et que chaque passage rebascule |
| 7. Le reflet | des clones qui rejouent tes touches en miroir |
| 8. L'éphémère | des dalles qui s'effondrent derrière toi |
| 9. L'élan | le même monde en mouvement continu : courir, sauter, et son clone qui ne t'attend pas |

## Lancer

```bash
npm install
npm run dev        # serveur de développement
npm test           # règles, parseur, et les 64 niveaux
npm run build      # typecheck + build statique dans dist/
npm run check      # typecheck + tests + build : ce que lance le déploiement
```

## Commandes

| Touche | Action |
| --- | --- |
| ← → (ou A D / Q D) | marcher ; maintenir pour avancer en continu |
| ↑ (ou W / Z) | sauter en 2D ; en 3D, ↑ ↓ avancent dans la profondeur |
| E, Entrée | changer de dimension, sur une ancre ou un seuil |
| Espace | attendre un pas |
| R | rembobiner : la boucle jouée devient un clone |
| T | retenir les clones d'un pas (autant de fois qu'il faut) |
| U, Retour arrière, Ctrl/Cmd+Z | annuler (traverse aussi les rembobinages) |
| Maj+R | recommencer le niveau, sans clone |
| H | rappeler la consigne, puis la forme de la solution, puis l'indice |
| Échap | choix du niveau |
| G | basculer entre temps réel et pas à pas |
| M | couper ou remettre le son |
| N / P | niveau suivant / précédent, même verrouillé |

Deux façons de jouer avec les mêmes règles : pas à pas, une touche à la fois, pour
réfléchir ; ou en maintenant une direction et en tapant ↑ au bon moment, pour courir et
sauter. Le premier niveau se finit en maintenant → avec un seul saut, à condition de le
taper avant le bord. Les touches tapées en avance sont mises en file, pas perdues. Une
direction maintenue contre un mur s'arrête d'elle-même, et un saut est toujours une
frappe : maintenir ↑ ne le répète pas.

Par défaut le jeu est en **temps réel** : tant qu'un clone a encore des touches à jouer,
ou que le héros est en l'air, le monde avance d'un pas tout seul dès que tu ne presses
rien pendant 0,35 s (0,65 s pour un saut quand personne d'autre ne bouge). Une barre sous
le compteur montre ce battement. Les clones n'attendent pas, un saut ne plane pas. Tant
que rien n'est en mouvement (première boucle, ou avant ta première touche), le monde
t'attend, et il se remet en pause après chaque annulation : on réfléchit à l'arrêt, on
exécute en mouvement. **G** passe en **pas à pas** (le monde
n'avance que sur tes touches) et le choix est retenu ; `?steps` le force dans l'URL.

`?level=1&script=RURR` ouvre un niveau dans une situation donnée (`L R U D`
déplacements, `.` attendre, `E` changer de dimension, `T` retenir les clones, `|` rembobiner). `?unlock` ouvre
tous les niveaux.

## Le monde 9 : mouvement continu

Mêmes blocs, mêmes plaques, portes, leviers, dalles et seuils, mais on n'avance plus case
par case : le héros court (environ cinq cases par seconde), saute à hauteur variable (un
peu plus d'une case en maintenant la touche, bien moins d'une simple frappe), garde un
court instant pour sauter après avoir quitté un bord, et une frappe légèrement en avance
est retenue jusqu'à la réception. Une tête sert de plateforme. Un clone rejoue les touches
de la course précédente, image par image, et part à ta première touche : il ne t'attend
pas. Le premier niveau du monde 9 est ouvert dès le départ.

| Touche | Action |
| --- | --- |
| ← → | courir ; en 3D, ↑ ↓ courent vers le fond et vers l'avant |
| ↑ ou Espace | sauter (Espace seulement en 3D) |
| E | déplier ou replier la profondeur sur un seuil |
| R | rembobiner : la course devient un clone |
| U | retenter la boucle en gardant les clones |
| Maj+R | recommencer le niveau |

La simulation est une fonction pure à pas fixe (60 par seconde), dans `src/flow/` : une
course rejouée à partir de ses touches est toujours la même course. Chaque niveau porte
sa course prévue (`tape:`), que les tests rejouent.

```bash
npm run flow -- src/flow/levels/05-sous-ton-ombre.txt "RJ16 R260 | R330" 10   # essayer une bande
```

## Règles

- **2D** : gauche, droite, gravité. Une marche d'une case se grimpe (bloc, caisse coincée
  ou clone) ; deux cases arrêtent. Hors de la grille, il n'y a que du vide.
- **Saut** (2D seulement) : ↑ élève d'une case et laisse deux pas en l'air. Il franchit un
  trou d'une case, passe par-dessus une caisse, un clone ou un levier sans les toucher,
  mais ne passe ni deux cases de vide ni un mur de deux cases. On ne pousse ni ne grimpe
  en l'air, et porter quelqu'un sur la tête interrompt le saut.
- **1D** : sur un fil, on suit sa direction et rien ne se contourne. Ni gravité ni vide.
  On n'entre et on ne sort que par une ancre, depuis la 2D.
- **3D** : quatre directions au sol. On déplie et replie la profondeur sur un seuil ; se
  replier sur un autre seuil change de coupe.
- **Temps** : chaque touche coûte un pas, même si elle ne peut rien faire. Les clones
  agissent du plus ancien au plus récent, puis le joueur, et la gravité s'applique après
  chacun. Une touche devenue impossible est perdue, le clone continue.
- **Corps** : marcher contre un clone, c'est lui monter sur la tête (s'il y a la place).
  On ne voyage pas sur un clone qui marche : il avance, on retombe où l'on était. En
  revanche un clone peut avancer sous un saut et se trouver là à la réception.
- **Retenir** : T glisse une attente dans la bande de chaque clone, à l'instant présent.
  Rien de ce qui est déjà arrivé ne change ; ce que le clone allait faire arrive un pas
  plus tard. On enregistre donc un trajet d'une traite et on règle les délais après coup,
  au lieu de deviner combien de pas la boucle suivante demandera. Attendre ne coûte rien
  au score ; retenir coûte une action : les trois étoiles vont à la boucle bien prévue.
- **Plaque et porte** : la porte est ouverte tant que quelque chose pèse sur la plaque.
- **Levier** : il bascule à chaque fois qu'un personnage arrive dessus (y retomber après
  un saut sur place compte aussi), et reste dans cet état. Une grille (barreaux horizontaux) est une porte inversée : ouverte au repos.
- **Reflet** : dans le monde 7, un clone rejoue gauche pour droite et droite pour gauche.
- **Dalle fragile** : elle tient tant que quelqu'un s'y tient, et tombe quand il la quitte
  à pied. Une caisse ne la casse pas ; quitter la dalle par un fil non plus.

## À l'écran

- En haut à droite, la **frise des touches** : une ligne par clone, puis la tienne, toutes
  sur les mêmes pas, si bien qu'une colonne est un instant. La règle du haut numérote les
  pas de cinq en cinq et marque le présent. Pour chaque clone : la prochaine touche en
  surbrillance, les touches perdues en rouge, les attentes ajoutées avec T (‖), et
  la dimension où il se trouve, même hors de ta coupe.
- Le compteur affiche les **actions** de toutes les boucles et le seuil des trois étoiles
  (la solution prévue) ; attendre ne coûte rien.
- Sous le compteur, le **chrono** de la tentative et le temps à battre pour l'éclair ⚡ :
  la solution prévue jouée sans hésiter, à peu près deux fois le temps qu'il faut au héros
  pour l'exécuter. Les étoiles récompensent la réflexion, l'éclair l'exécution.
- La barre du bas dit ce que font les touches ici et maintenant : elle change avec la
  dimension, et sur un fil chaque sens porte la flèche qui le suit.
- Un clone retenu avec T porte un signe de pause tant que son attente n'est pas jouée.
- Depuis un fil, le monde reste visible en transparence, et les clones aussi. En l'air, un
  personnage flotte au-dessus de sa case, son ombre restée au sol.

## Architecture

- `src/core/` — le modèle, sans DOM. `step(world, inputs)` est une fonction pure ; une
  session n'est que des logs d'inputs et le monde se déduit en les rejouant.
- `src/flow/` — le moteur à mouvement continu du monde 9 (`physics.ts`, pur et à pas fixe),
  la notation des courses (`tape.ts`) et ses niveaux. `src/ui/flow.ts` le joue à l'écran
  avec la même scène que le jeu au pas.
- `src/core/solver.ts` — recherches pour la conception : plus courte solution sans clone,
  solution à un clone qui fait une simple course, et recherche exhaustive à un clone
  (touches perdues et attentes comprises). Les tests s'en servent pour prouver qu'aucun
  niveau solo n'a de raccourci et qu'aucun niveau à clones ne se finit seul.
- `src/levels/` — un fichier texte par niveau, une couche ASCII par valeur de z, avec sa
  solution prévue (`solution:`). Le format est décrit en tête de `src/core/level-parser.ts`.
- `src/ui/render/` — Canvas 2D. Une seule projection oblique dont la profondeur se replie :
  à plat c'est la coupe 2D, dépliée c'est le volume. Changer de dimension déplace la
  caméra au lieu de changer d'écran.
- `src/ui/audio.ts` — tout le son est synthétisé (Web Audio).
- `src/assets/` — ciels et textures de pierre, d'herbe et de caisse générés avec l'outil
  d'image de Codex ; personnages, portes, leviers, fils et effets sont dessinés en code.

## Outils de conception

```bash
python3 tools/levels.py -v                       # feuille des 64 niveaux au pas : régénère src/levels et les audite
python3 tools/playall.py                         # rejoue chaque solution aux vraies touches (serveur preview sur 4317)
npm run play -- 37 "RR|.RR" [hint]              # joue un niveau en mode texte, coupe par coupe
npm run solve -- --clone src/levels/37-*.txt    # audite un niveau : solution prévue, raccourcis
npm run solve -- --exact src/levels/56-*.txt    # recherche exhaustive à un clone (lente en 3D)
npm run solve -- --cheapest src/levels/56-*.txt # meilleur score possible à un clone
npm run solve -- --pair src/levels/62-*.txt     # deux clones en simple course : meilleur score
node tools/drive.mjs "unlock&level=37" play:RR shot:essai   # vraies touches dans Chrome headless
```

## Déploiement

Chaque push sur `main` lance `.github/workflows/deploy.yml` : `npm run check`, puis
publication de `dist/` sur GitHub Pages. Le build utilise une base relative, il tourne donc
tel quel sous `/parahydox/`.
