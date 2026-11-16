#!/usr/bin/env python3
"""Authoring sheet for the 64 step levels: the source of truth for src/levels.

    python3 tools/levels.py [-v]

Writes src/levels/NN-slug.txt and index.ts, then audits them with the solver. Levels left
without a solution get the solver's. Edit levels here, not in the generated files."""
import glob, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLDS = ['Le fil', 'Le volume', 'La boucle', 'Le croisement', 'La divergence', 'Le levier', 'Le reflet', "L'éphémère"]

L = []
def lv(slug, name, world, tip, hint, layers, clones=0, sol='', glyphs=(), mirror=False, note=''):
    L.append(dict(slug=slug, name=name, world=world, tip=tip, hint=hint, layers=layers.strip('\n'),
                  clones=clones, sol=sol.replace(' ', ''), glyphs=list(glyphs), mirror=mirror, note=note))

# ------------------------------------------------------------------ 1. Le fil
lv('premiers-pas', 'Premiers pas', 1,
   "← → pour avancer, ↑ pour sauter. Une marche d'une case se grimpe toute seule.",
   "Saute le trou (↑ puis deux fois →), grimpe les marches, et laisse-toi tomber de l'autre côté.", """
z=0
................
..........##....
#.......####....
#@...#######...X
###.############
###.############
""", note="Sauter un trou d'une case, grimper une marche, se laisser tomber.")

lv('le-fil', 'Le fil', 1,
   "Le losange est une ancre : E pour entrer dans le fil.",
   "Entre dans le fil sur le losange, traverse, puis E sur l'autre losange.", """
z=0
#...........
#@.*=====*.X
####.....###
####.....###
""", note="En 2D le vide est trop large. Le fil, lui, ignore la gravité.")

lv('a-la-verticale', 'À la verticale', 1,
   "Un fil ne tombe pas.",
   "Suis le fil vers le haut, puis vers la droite.", """
z=0
.............
...======*.X.
...=.....####
...=.....####
#..=.....####
#@.*.....####
#############
#############
""", note="Un fil ignore la gravité : il sert aussi d'ascenseur.")

lv('la-fosse', 'La fosse', 1,
   "Deux cases de large : trop pour un saut.",
   "Pousse la caisse dans la fosse, descends dessus, et saute de là.", """
z=0
.............
#............
#@.o........X
#####..######
#####..######
#############
""", note="Un saut franchit une case, pas deux. La caisse au fond sert de tremplin.")

lv('le-bouchon', 'Le bouchon', 1,
   "Une caisse posée sur un fil le bouche.",
   "On ne pousse rien depuis un fil. Rejoins la caisse à pied par le fil du bas, pousse-la, puis reviens prendre le fil du haut.", """
z=0
..............
@*=======%==*X
##......##..##
###*==*###..##
####..####..##
####..####..##
""", glyphs=['% = wire + crate'],
   note="Le fil du haut mène à la sortie mais une caisse le bouche. Les vides font deux cases : on ne les saute pas.")

lv('par-dessus', 'Par-dessus', 1,
   "Pour pousser, il faut être du bon côté.",
   "Le fil passe par-dessus la caisse : prends-le pour arriver derrière elle et la pousser dans le vide.", """
z=0
=====.......
=...=.......
*.o@*.......
#####.......
...........X
.......#####
.......#####
############
""", note="La caisse doit tomber en bas, où elle servira de marche ou de tremplin vers le mur.")

lv('deux-caisses', 'Deux caisses', 1,
   "Deux caisses, deux usages.",
   "La première sert de marche. La seconde bouche l'ancre : pousse-la dans le vide.", """
z=0
................
................
#.....##........
#@.o..##.%====*X
##########....##
""", glyphs=['% = anchor + crate'])

lv('le-va-et-vient', 'Le va-et-vient', 1,
   "Ce qui tombe d'en haut peut servir en bas.",
   "Traverse en bas, monte l'escalier, reviens par le fil du haut et pousse la caisse au pied du mur.", """
z=0
..................
....o.*==========*
...####..........#
................##
X..............###
##............####
##.@...*====*#####
########....######
########....######
""")

# --------------------------------------------------------------- 2. Le volume
lv('le-contour', 'Le contour', 2,
   "Le cube marque un seuil : E pour déplier la profondeur.",
   "En 3D, le mur ne va pas jusqu'au fond : contourne-le.", """
z=0
#.....#.....
#.....#.....
#@..^.#....X
############

z=1
#.....#.....
#.....#.....
#.....#.....
############

z=2
#...........
#...........
#...........
############
""", note="Le mur barre toute la coupe z=0, mais il ne fait que deux cases de profondeur.")

lv('derriere-le-plan', 'Derrière le plan', 2,
   "Rien dans cette coupe. Et derrière ?",
   "Déplie la profondeur sur le cube et suis le chemin.", """
z=0
..........
@.^.......
####......

z=1
..........
..........
...#..###.

z=2
..........
..........
...#..#.#.

z=3
..........
........X.
...####.#.
""")

lv('le-fil-qui-s-enfonce', "Le fil qui s'enfonce", 2,
   "Un fil peut quitter ta coupe.",
   "Le fil t'emmène dans une autre coupe. Marche jusqu'au second fil et reviens par lui.", """
z=0
..........
@..*...*.X
####...###

z=1
..........
...=...=..
..........

z=2
..........
...*...*..
...#####..
""", note="Aucun seuil ici : seuls les fils changent de coupe.")

lv('changer-de-coupe', 'Changer de coupe', 2,
   "Chaque seuil replie le monde sur sa propre coupe.",
   "Va en 3D jusqu'au seuil du fond et replie-toi là : le fil ne se prend qu'en 2D.", """
z=0
...........
@^.........
###........

z=1
...........
...........
##.........

z=2
...........
..^*====*.X
####....###
""")

lv('l-escalier-cache', "L'escalier caché", 2,
   "Un mur de deux cases, vu de côté.",
   "Derrière le plan, une marche mène en haut du mur.", """
z=0
............
...........X
......######
@.^...######
############

z=1
............
............
......######
.....#######
############
""")

lv('la-bonne-coupe', 'La bonne coupe', 2,
   "On ne saute qu'en 2D. Reste à choisir la coupe.",
   "Deux coupes ont un trou. Celle du fond n'a qu'une case de vide : replie-toi là, saute, puis déplie de l'autre côté pour revenir vers l'avant.", """
z=0
............
@^.........X
###......###

z=1
............
..^......^..
####..######

z=2
............
..^......^..
####.#######
""", note="En 3D on ne saute pas. La coupe du milieu a un trou de deux cases : s'y replier est un piège.")

lv('le-demenagement', 'Le déménagement', 2,
   "Une caisse se pousse dans quatre directions.",
   "Pousse la caisse le long du fond, puis vers l'avant, au pied du mur.", """
z=0
.........
........X
......###
@^.#..###
#########

z=1
.........
......###
......###
..o...###
#########

z=2
.........
......###
......###
......###
#########
""", note="Le mur ne fait deux cases de haut que dans la coupe de devant ; un bloc barre le chemin direct de la caisse.")

lv('trois-coupes', 'Trois coupes', 2,
   "Trois coupes, deux fils.",
   "Replie-toi sur la coupe du fond, traverse par le fil, puis reviens vers l'avant par le second fil.", """
z=0
..............
@^.........*.X
####......####

z=1
..............
...........=..
###...........

z=2
..............
.^.*=====*.*..
####.....###..
""")

# --------------------------------------------------------------- 3. La boucle
lv('tenir-la-porte', 'Tenir la porte', 3,
   "R rembobine le temps : ta boucle précédente rejoue à tes côtés.",
   "Va sur la plaque, rembobine, puis passe la porte pendant que ton clone tient la plaque.", """
z=0
#.......#...
#.......A...
#@.a....A..X
############
""", clones=1, sol='RR|RRRRRRRRRR',
   note="La plaque n'ouvre la porte que tant qu'on reste dessus. La porte fait deux cases sous un linteau : monter sur le clone ne suffit pas.")

lv('la-courte-echelle', 'La courte échelle', 3,
   "Ce mur est trop haut pour toi seul. Marcher contre un clone, c'est lui monter dessus.",
   "Un clone immobile au pied du mur fait une bonne marche.", """
z=0
...........
#.........X
#.....#####
#@....#####
###########
""", clones=1, sol='RRRR|RRRRRRRRR')

lv('le-sacrifice', 'Le sacrifice', 3,
   "Qui descend dans ce trou n'en ressort pas.",
   "La plaque est au fond du trou. Envoie ta première boucle s'y poser, rembobine, et passe sur sa tête.", """
z=0
#.......#...
#.......A...
#@......A..X
####.#######
####a#######
############
""", clones=1, note="Un clone peut aller là d'où l'on ne revient pas : c'est lui qui reste, pas toi.")

lv('apres-toi', 'Après toi', 3,
   "Dans ce couloir, on ne se double pas. T retient ton clone d'un pas (et coûte une action).",
   "Ton clone doit arriver après toi. En boucle 2, retiens-le avec T (plusieurs fois s'il le faut) et passe devant.", """
z=0
..........#..
....#####.#..
....#####.A..
@.......a.A.X
#############
""", clones=1, note="La plaque est au bout d'un couloir bas : un clone posé dessus bouche le passage. Le toit est épais : même depuis la tête du clone, on ne saute pas dessus.")

lv('le-relais', 'Le relais', 3,
   "Espace : tu attends un pas, gratuitement. T : c'est ton clone qui attend, pour une action.",
   "Le clone doit tenir la première plaque assez longtemps, puis aller sur la seconde. Enregistre son trajet d'une traite et retiens-le avec T tant que tu n'es pas passé, ou enregistre directement ses attentes.", """
z=0
#.......#..#...
#.......A..B...
#@.a.b..A..B..X
###############
""", clones=1, sol='RR.....RR|RRRRRRRRRRRRR')

lv('les-mains-libres', 'Les mains libres', 3,
   "Une caisse aussi sait tenir une plaque.",
   "Pousse la caisse sur la première plaque, passe par-dessus, et tiens toi-même la seconde.", """
z=0
.........#..#..
.........A..B..
@.o.a#b..A..B.X
###############
""", clones=1)

lv('l-escabeau', "L'escabeau", 3,
   "Trois cases de haut. Une caisse, un clone, et toi.",
   "La caisse contre le bloc fait la première marche ; ton clone, debout sur le bloc, la seconde.", """
z=0
............
...........X
........####
........####
@..o...#####
############
""", clones=1)

lv('le-coup-de-main', 'Le coup de main', 3,
   "Un clone peut faire deux choses, l'une après l'autre.",
   "Ton clone te fait la courte échelle, attend un pas, puis retourne tenir la plaque.", """
z=0
.........#...
.........A...
.........A..X
......#######
..a.@.#######
#############
""", clones=1, sol='R.LLL|RRRRRRRR')

# ----------------------------------------------------------- 4. Le croisement
lv('le-croisement', 'Le croisement', 4,
   "Une plaque, quelque part, ouvre la barrière.",
   "Le clone agit dans une dimension, toi dans une autre.", """
z=0
...........
@^*==!==*.X
###.....###
###.....###

z=1
...........
...........
###........
###........

z=2
...........
.....a.....
######.....
######.....
""", clones=1, sol='REUURRRR|RRERR..RRRRERR', glyphs=['! = wire + door a'],
   note="Le fil traverse le vide mais une barrière le bouche. Sa plaque est en z=2, hors de la coupe.")

lv('deux-fils', 'Deux fils', 4,
   "Une plaque peut se trouver sur un fil.",
   "Ton clone s'arrête sur la plaque du fil de gauche ; toi, tu prends le fil de droite.", """
z=0
...............
*=_==*@*==!==*X
#....###.....##
""", clones=1, glyphs=['! = wire + door a', '_ = wire + plate a'])

lv('le-croisement-inverse', 'Le croisement inverse', 4,
   "La sortie n'est pas dans cette coupe.",
   "Échangez vos rôles : le clone prend le fil, toi la profondeur.", """
z=0
............
............
@^.*====*.a.
####....###.
####....###.

z=1
............
............
............
####........
####........

z=2
......#.....
......A.....
......A....X
############
############
""", clones=1, sol='RRRERRRRRERR|REUURRRR...RRRRRR')

lv('l-ile-du-fond', "L'île du fond", 4,
   "Ce fil mène ailleurs.",
   "Envoie ton clone au fond par le fil : sa plaque ouvre ta porte.", """
z=0
.......#...
.......A...
@.*....A..X
###########

z=1
...........
...........
..=........
...........

z=2
...........
...........
..*.a......
..###......
""", clones=1)

lv('le-funambule', 'Le funambule', 4,
   "Sur un fil, on tient aussi une plaque.",
   "Ton clone s'arrête sur la plaque du fil ; toi, tu passes la porte par la profondeur.", """
z=0
............
............
@^*=_=*....X
###...#..###
###...#..###

z=1
............
............
............
###......###
###......###

z=2
....#.......
....A.......
....A.......
############
############
""", clones=1, glyphs=['_ = wire + plate a'])

lv('la-caisse-du-clone', 'La caisse du clone', 4,
   "Qui descend sur la corniche n'en remonte pas.",
   "Ton clone descend sur la corniche de devant, pousse la caisse sur une plaque et tient l'autre.", """
z=0
...........
...........
...........
...........
...........
...........
...o.a#b...
.#######...

z=1
...#.#.....
...A.B.....
@^.A.B....X
###########
###########
###########
###########
###########
""", clones=1, note="Les mains libres, hors de la coupe. La corniche est devant, quatre cases plus bas : ni le bloc ni la tête du clone ne permettent d'en remonter. Les portes sont près du départ pour qu'on ne puisse descendre qu'au début de la corniche.")

lv('le-double-croisement', 'Le double croisement', 4,
   "Deux barrières, un seul clone.",
   "Ton clone passe sur la première plaque puis s'arrête sur la seconde : cale ton passage sur le sien.", """
z=0
.............
@^*=!==?==*.X
###.......###
###.......###

z=1
.............
.............
###..........
###..........

z=2
.............
...a..b......
#######......
#######......
""", clones=1, glyphs=['! = wire + door a', '? = wire + door b'])

lv('le-trio', 'Le trio', 4,
   "Deux clones, trois endroits où être.",
   "Un clone descend sur la plaque du fond et n'en ressortira pas. L'autre traverse le fil jusqu'à la seconde plaque. Toi, tu passes sur la tête du premier, puis la porte.", """
z=0
............
............
@^*==!==*.b.
###.....####
###.....####
###.....####

z=1
............
............
............
###.........
###.........
###.........

z=2
......#.....
......B.....
......BX....
#####.##....
#####a##....
########....
""", clones=2, sol='REUURRRR|RRERR..RRRRERR|..............REUURRRRRR', glyphs=['! = wire + door a'],
   note="La plaque du fond est dans un trou de deux cases : qui la tient y reste. Il faut donc bien trois personnes, et l'île de droite ne se rejoint que par le fil.")

# ----------------------------------------------------------- 5. La divergence
lv('les-trois-postes', 'Les trois postes', 5,
   "Deux plaques, deux portes, et toi en haut.",
   "Un clone à gauche, un clone à droite, et toi par le fil.", """
z=0
........#.#..
........A.B..
.....=*.A.B.X
.....=#######
.....=.......
.a...*@....b.
#############
""", clones=2, sol='LLLLL|RRRRR|LEUUURERRRRRR')

lv('le-mime', 'Le mime', 5,
   "Deux portes, un seul clone, et tu ne peux pas être partout.",
   "Un clone rejoue tes touches, pas tes déplacements : marche contre la porte fermée.", """
z=0
.#......#....
.B......A....
XB.@.a..A..bb
#############
""", clones=1, sol='RRRRRRRR|RR...LLLLL',
   note="Marcher contre une porte fermée en boucle 1, c'est la franchir en boucle 2 si quelqu'un la tient ouverte.")

lv('le-mime-croise', 'Le mime croisé', 5,
   "Une seule plaque à tenir, deux endroits où être.",
   "Le clone mime la traversée du fil pendant que tu tiens la barrière ouverte depuis la profondeur.", """
z=0
............
............
@^*==!==*.b.
###.....####
###.....####

z=1
............
............
............
###.........
###.........

z=2
......#.....
......B.....
.....aBX....
########....
########....
""", clones=1, sol='...RRERRRRRRERR|RERUURRR......RR', glyphs=['! = wire + door a'],
   note="Le lieu du trio, avec un seul clone : il faut mimer.")

lv('renvoyer-l-ascenseur', "Renvoyer l'ascenseur", 5,
   "Tiens-lui la porte, il te la tiendra.",
   "Ton clone tient la première plaque pendant que tu passes ; puis tiens la seconde pour lui. Ses pas contre la porte fermée deviendront vrais.", """
z=0
..............
......#......X
......A....###
.@.a..A.a..###
##############
""", clones=1, sol='RR...RRRRRRR|RRRRRRR....RRRRR')

lv('le-marchepied', 'Le marchepied', 5,
   "Ton clone part toujours en même temps que toi.",
   "Enregistre des pas contre le mur. En boucle 2, tiens-toi au pied du mur : le clone te grimpera dessus.", """
z=0
..........
.#......bb
.B.....###
XB.@...###
##########
""", clones=1, sol='.RRURRR|RR.LLLLL',
   note="La courte échelle à l'envers : c'est le clone qui doit monter, et le joueur qui lui sert de marche.")

lv('le-saut-de-la-foi', 'Le saut de la foi', 5,
   "Un saut que tu ne peux pas réussir seul.",
   "Descends dans la fosse et enregistre un saut vers l'autre bord, même s'il échoue. En boucle 2, sois au fond avant ton clone : de ta tête, son saut portera.", """
z=0
.............
.............
...@......bb.
######..#####
X.B.....#####
#############
""", clones=1, sol='.RRRURRRR|RRR..LLLLLL')

lv('le-mime-sur-le-fil', 'Le mime sur le fil', 5,
   "Le fil est bouché. Ton clone ne le sait pas.",
   "Enregistre la traversée du fil bouché après une longue attente. En boucle 2, va pousser la caisse avant que ton clone n'arrive.", """
z=0
..................
..................
.@.*========%==*bb
####.......##..###
####......###..###
##XB.*==*####..###
######..#####..###
""", clones=1, sol='......RRERRRRRRRRRRRRER|RRRRERRRERRRRLLLLELLLELLL', glyphs=['% = wire + crate'])

lv('le-pont-de-singes', 'Le pont de singes', 5,
   "Ce fil donne sur le vide, mais il peut porter quelqu'un. Deux clones suffisent. Un seul aussi, s'il avance au bon moment.",
   "Avec deux clones : ils s'arrêtent sur le fil (le second laisse partir le premier), tu sautes sur une tête, puis encore depuis une tête. Avec un seul : il s'arrête au milieu, puis avance de deux cases pendant que tu es en l'air au-dessus de lui.", """
z=0
............
............
.@.*===*...X
####....####
""", clones=2, sol='RRER.RR|.RRRURRURRRRR',
   note="Quatre cases de vide. Un saut porte deux cases plus loin, à condition d'y trouver un appui. Deux têtes immobiles font l'affaire (23 actions) ; une seule tête qui avance sous le saut aussi (18 actions) : c'est la solution trois étoiles, trouvée par la recherche exhaustive.")

# -------------------------------------------------------------- 6. Le levier
lv('le-levier', 'Le levier', 6,
   "Un levier reste basculé.",
   "Marche sur le levier : la porte reste ouverte derrière toi.", """
z=0
.......#...
.......E...
@..e...E..X
###########
""")

lv('pair-impair', 'Pair, impair', 6,
   "Chaque passage bascule le levier.",
   "Deux leviers pour une porte : n'en touche qu'un. Un saut passe par-dessus.", """
z=0
...........#...
...........E...
@..e...e...E..X
###############
""")

lv('sens-unique', 'Sens unique', 6,
   "Ici, on ne remonte pas.",
   "En marchant, tu tombes sur les deux leviers. Évites-en un : par le fil, ou d'un saut.", """
z=0
...........
@*===......
###.=......
...e=......
...#=......
...#*......
...##......
...##e..#..
...###..E..
...###..E.X
###########
""", note="Chaque palier est deux cases plus bas que le précédent : chaque levier ne se touche qu'une fois.")

lv('l-un-ou-l-autre', "L'un ou l'autre", 6,
   "Ce levier ouvre une porte et ferme une grille.",
   "Bascule le levier, puis reviens par le fil : la grille s'est refermée derrière toi.", """
z=0
...............
...............
..=====*.......
..=..%.#...E...
.e*..%..@..E..X
###############
""", glyphs=['% = gate e'], note="Le fil arrive sur une corniche : il ne se prend que dans le sens du retour.")

lv('deux-fois', 'Deux fois', 6,
   "Ton clone bascule le levier. Toi aussi.",
   "Laisse ton clone passer la porte, puis marche deux fois sur le levier.", """
z=0
......#....#..
...#..E....A..
@..e..E.a..A.X
##############
""", clones=1, note="Un plafond bas au-dessus du levier : impossible de le franchir sur la tête de l'autre.")

lv('saute-mouton', 'Saute-mouton', 6,
   "Ce levier ne se prend qu'en tombant dessus.",
   "Fais attendre ton clone sur le levier et passe sur sa tête : un seul de vous deux doit le toucher.", """
z=0
...............
...............
@..............
###............
###e...#....#..
####...E....A..
####...E.a..A.X
###############
""", clones=1, sol='RRR.RRRRRR|RRRRRRRRRRRRRR')

lv('l-aide-memoire', "L'aide-mémoire", 6,
   "Le levier est au fond d'un trou.",
   "Enregistre ta marche contre la porte fermée. En boucle 2, saute sur le levier : ton clone passera.", """
z=0
.......#.....
.......E.....
....@..E..bb.
##.##########
XBe##########
#############
""", clones=1, sol='RRRRRR|LL....LL')

lv('chacun-son-tour', 'Chacun son tour', 6,
   "Un levier pour deux portes et deux grilles. Et quelqu'un doit encore tenir la plaque.",
   "Tombe sur le levier le premier et passe la porte. Ton premier clone tombe ensuite : les grilles s'ouvrent, et il va tenir la plaque. Le second tombe en dernier, quand tu as passé la seconde grille, pour rouvrir la dernière porte.", """
z=0
..................
@.................
###...............
###e..............
####...#.#.#.#.#..
####...E.%.A.%.E..
####.a.E.%.A.%.E.X
##################
""", clones=2, sol='.....RRRRR|...........RRR|RRRRRRRRRRRRRRRRR', glyphs=['% = gate e'],
   note="Porte, grille, plaque, grille, porte : trois bascules dans l'ordre. Sauter sur place sur le levier le rebascule, mais celui qui tient la plaque a quitté le socle, et on n'y remonte pas : il faut un troisième. La seconde grille, juste après la porte à plaque, interdit de rebasculer avant d'aller tenir la plaque.")

# -------------------------------------------------------------- 7. Le reflet
lv('le-reflet', 'Le reflet', 7,
   "Ton reflet inverse la gauche et la droite.",
   "Pour envoyer ton reflet à gauche, marche à droite.", """
z=0
........#..
........A..
..a..@..A.X
###########
""", clones=1, mirror=True, sol='RRR|RRRRR')

lv('dos-au-mur', 'Dos au mur', 7,
   "Un mur derrière toi.",
   "Appuyer contre le mur ne te déplace pas, mais ton reflet, lui, avance.", """
z=0
...........
..........X
...#...####
...#@..####
###########
""", clones=1, mirror=True, sol='LL|RRRRRR')

lv('le-reflet-grimpe', 'Le reflet grimpe', 7,
   "Un miroir n'inverse pas le haut et le bas.",
   "Sur le fil, les pas de côté s'inversent, mais monter reste monter.", """
z=0
............
a*=.........
##=......#..
..=......A..
..==*.@..A.X
############
""", clones=1, mirror=True, sol='RRERRUUURER|RR........RRR')

lv('le-fil-du-reflet', 'Le fil du reflet', 7,
   "Ton reflet aussi prend les fils.",
   "Deux pas, E, trois pas : pour toi des pas contre la porte, pour ton reflet un trajet sur le fil.", """
z=0
.........#...
.........A...
*_==*.@..A..X
#...#########
""", clones=1, mirror=True, sol='RRERRR|RR....RRRR', glyphs=['_ = wire + plate a'])

lv('le-grand-saut', 'Le grand saut', 7,
   "Parfois, il faut tomber.",
   "Ton reflet a besoin de deux pas à gauche. Fais-en deux à droite, même si le sol s'arrête.", """
z=0
.#......
.A......
XA.a.@..
#######.
""", clones=1, mirror=True, sol='RR|LLLLL')

lv('le-miroir-profond', 'Le miroir profond', 7,
   "Un miroir a-t-il une profondeur ?",
   "Déplie, avance au fond, puis deux pas à droite : ton reflet en fera deux à gauche, sur la plaque.", """
z=0
.........
.........
....$....
...###...

z=1
.........
.........
.........
...###...

z=2
.......#.
.......A.
..a....AX
#########
""", clones=1, mirror=True, sol='EUURR|EUURRRR', glyphs=['$ = start + threshold'])

lv('deux-reflets', 'Deux reflets', 7,
   "Deux plaques. La première est au fond d'un trou, et le plafond est bas.",
   "Le premier reflet tombe dans le trou et y reste, sur sa plaque. Le second lui marche sur la tête pour atteindre l'autre plaque, mais il part gêné : sous ce plafond, il ne peut pas monter sur le premier et sa première touche est perdue. Fais-le attendre un pas avant de partir.", """
z=0
.......#.#...
.......#.#...
.####..A.B...
.b...@.A.B.X.
###.#########
###a#########
#############
""", clones=2, mirror=True, sol='RR|.RRRR|RRR.RRR',
   note="Un seul reflet ne peut pas tenir les deux plaques : celui qui descend sur la première n'en ressort pas. Les deux reflets partent du même point : sous le plafond, le second ne peut pas monter sur le premier et perd sa première touche.")

lv('la-telecommande', 'La télécommande', 7,
   "Pour ton reflet, le chemin commence par un saut. Pour toi, ce saut finit dans le vide.",
   "Au fond du trou, tes touches ne te déplacent plus, mais ton reflet les entend toujours. Descends-y d'abord, puis joue son trajet : un pas pour revenir, le saut, et la marche jusqu'à la plaque.", """
z=0
..........#...
..........A...
.a...@....A.X.
####.##.######
####.##.######
#######.######
""", clones=1, mirror=True, sol='LRURRRR|RURRR.RRR',
   note="Dos au mur, en grand : le trou de gauche sert de cabine de pilotage. Toute touche vers la droite t'approche du vide ; tout pas vers la droite jette ton reflet dans le trou.")

# ------------------------------------------------------------- 8. L'éphémère
lv('la-dalle', 'La dalle', 8,
   "Cette dalle ne tient qu'une fois.",
   "Traverse sans t'arrêter : chaque dalle tombe derrière toi.", """
z=0
..........
@.......X.
##~~~~~###
""")

lv('aller-simple', 'Aller simple', 8,
   "Le pont ne servira qu'une fois.",
   "À l'aller, saute une dalle sur deux : celles que tu n'as pas touchées tiendront pour le retour. Ou reviens par le fil.", """
z=0
.#...........
.#.*======...
.#.#.....=...
.E.......=...
XE.@.....*.e.
#####~~~~####
""")

lv('par-le-plancher', 'Par le plancher', 8,
   "Une dalle fragile ne disparaît que derrière toi.",
   "Passe sur la dalle, continue d'un pas, puis reviens tomber dans le trou.", """
z=0
...........
@..........
####~##~###
####.##..##
####.##.X##
####.######
""")

lv('le-passeur', 'Le passeur', 8,
   "Tant que quelqu'un s'y tient, la dalle tient.",
   "Ton clone s'arrête sur la seconde dalle et t'attend : saute sur sa tête. Ensuite seulement, il te rejoint au pied du mur.", """
z=0
............
...........X
.........###
.@.......###
####~~######
""", clones=1, sol='RRR.RRRR|RRRR.RRRRRR')

lv('l-ancre-fragile', "L'ancre fragile", 8,
   "Sur un fil, tu ne pèses rien.",
   "Ne traverse pas à pied : entre dans le fil depuis la dalle, elle sera encore là à ton retour.", """
z=0
.#..........
.E..........
XE.@*====*.e
####~~~~~###
""", note="Le pont se traverse à pied, mais alors la dalle de l'ancre tombe et le retour par le fil finit dans le vide.")

lv('la-caravane', 'La caravane', 8,
   "Deux dalles, trois voyageurs. Et là-bas, on ne remonte pas.",
   "Une dalle tient tant que quelqu'un s'y tient. Personne ne quitte la sienne avant que les suivants ne lui soient passés sur la tête. Le premier arrivé en bas tient la plaque du bas ; le dernier à quitter le pont tient celle du haut.", """
z=0
.................
.............#.#.
.@......a....#.#.
####~~####...#.#.
####..####...B.A.
####..####.b.B.AX
####..###########
""", clones=2, sol='RRR.....RRRR|...RRRRRRRRRR|.RRRR.....RRRRRRRRRRR',
   note="La porte du bas vient avant celle du haut, mais sa plaque est après la descente : un seul clone ne peut pas tenir la plaque du haut après celle du bas. Il faut donc trois voyageurs sur deux dalles. (L'ancienne version se finissait avec un seul clone qui marchait sans s'arrêter.)")

lv('le-damier', 'Le damier', 8,
   "Tout le sol est fragile.",
   "Passe par le levier sans jamais revenir sur tes pas.", """
z=0
.......
.......
$......
#~~~~~#

z=1
......#
......E
......E
..~.~~#

z=2
.......
.....#.
..e..#X
.~~~~##
""", glyphs=['$ = start + threshold'])

lv('parahydox', 'Parahydox', 8,
   "Tout ce que tu sais. Et ton reflet.",
   "Le levier doit être basculé une fois pour ton reflet et pour le fil : saute par-dessus l'un des deux. Ton reflet tient la plaque le temps que tu descendes le fil, puis fait un dernier pas sur son propre levier : c'est lui qui t'ouvre la grille.", """
z=0
................
................
..............%.
.......$.....*%X
......###....###
......###....###

z=1
................
................
.............A..
.............!..
......###.......
......###.......

z=2
................
................
.............E..
.............?..
......###.......
......###.......

z=3
................
.....#..........
.....E..........
..#eaE..^.e.e*..
..#######~#~#~..
..#######.#.#...
""", clones=1, mirror=True, sol='EUUU....RRR.....R|EUUURERRRURREDDDERR',
   glyphs=['$ = start + threshold', '! = wire + door a', '? = wire + door e', '% = gate e'],
   note="Reflet, profondeur, fil, levier, dalle, saut. Deux leviers sur ta route : en toucher deux referme tout, et les dalles interdisent de revenir en arrière. Le dernier pas du reflet referme le fil derrière toi et ouvre la grille.")

def write_files():
    for f in glob.glob(f'{ROOT}/src/levels/*.txt'):
        os.remove(f)
    names = []
    for i, l in enumerate(L):
        fname = f"{i + 1:02d}-{l['slug']}"
        names.append(fname)
        head = []
        if l['note']:
            head.append(f"; {l['note']}")
        head += [f"name: {l['name']}", f"world: {l['world']}", f"tip: {l['tip']}", f"hint: {l['hint']}", f"clones: {l['clones']}"]
        if l['mirror']:
            head.append('mirror: true')
        head += [f'glyph: {g}' for g in l['glyphs']]
        if l['sol']:
            head.append(f"solution: {l['sol']}")
        open(f'{ROOT}/src/levels/{fname}.txt', 'w').write('\n'.join(head) + '\n\n' + l['layers'] + '\n')
    imports = '\n'.join(f"import l{i + 1:02d} from './{n}.txt?raw';" for i, n in enumerate(names))
    entries = '\n'.join(f"  {{ id: '{n}', source: l{i + 1:02d} }}," for i, n in enumerate(names))
    worlds = ', '.join(json.dumps(w, ensure_ascii=False).replace('"', "'") if "'" not in w else json.dumps(w, ensure_ascii=False) for w in WORLDS)
    open(f'{ROOT}/src/levels/index.ts', 'w').write(f"""import {{ formatLevelErrors, parseLevel }} from '../core/level-parser';
import type {{ Level }} from '../core/types';
{imports}

export const LEVEL_SOURCES: readonly {{ readonly id: string; readonly source: string }}[] = [
{entries}
];

/** Chapter titles, indexed by `level.world - 1`. One new idea per chapter. */
export const WORLD_NAMES: readonly string[] = [{worlds}];

/** Levels ship with the build, so a malformed one is a programming error: fail at boot. */
export function loadLevels(): Level[] {{
  return LEVEL_SOURCES.map(({{ id, source }}) => {{
    const parsed = parseLevel(source);
    if (!parsed.ok) throw new Error(formatLevelErrors(id, parsed.error));
    return parsed.value;
  }});
}}
""")
    return names


def audit(names):
    files = [f'{ROOT}/src/levels/{n}.txt' for n in names]
    out = subprocess.run(['node', f'{ROOT}/.tools/solve.js', '--json', '--clone', *files], capture_output=True, text=True)
    if out.returncode != 0:
        print(out.stderr[-2000:])
        sys.exit(1)
    return [json.loads(line) for line in out.stdout.strip().split('\n')]


if __name__ == '__main__':
    subprocess.run(['npx', 'vite', 'build', '--ssr', 'tools/solve.ts', '--outDir', '.tools', '--emptyOutDir', 'false', '--logLevel', 'error'], cwd=ROOT, check=True)
    names = write_files()
    results = audit(names)
    changed = False
    for l, r in zip(L, results):
        if 'error' in r or l['sol']:
            continue
        found = r['solo'] if r['solo'] else (r['clone']['script'] if r['clone'] else None)
        if found:
            l['sol'] = found
            changed = True
    if changed:
        names = write_files()
        results = audit(names)
    bad = 0
    for i, (l, r) in enumerate(zip(L, results)):
        if 'error' in r:
            print(f"{i + 1:2d} {l['slug']}: PARSE ERROR\n{r['error']}")
            bad += 1
            continue
        intended = r['intended']
        flags = []
        if not intended:
            flags.append('NO SOLUTION')
        elif intended['outcome'] != 'won':
            flags.append(f"INTENDED {intended['outcome']} at {intended['at']} after {intended['steps']}")
        if l['clones'] == 0 and intended and r['solo'] and len(r['solo']) != intended['steps']:
            flags.append(f"SHORTER SOLO {len(r['solo'])}: {r['solo']}")
        if l['clones'] > 0 and r['solo']:
            flags.append(f"SOLVABLE ALONE: {r['solo']}")
        if l['clones'] > 0 and r['clone'] and intended and r['clone']['steps'] < intended['steps']:
            flags.append(f"PLAIN CLONE SHORTER {r['clone']['steps']}: {r['clone']['script']}")
        if l['clones'] > 1 and r['clone']:
            flags.append(f"ONE CLONE ENOUGH {r['clone']['steps']}: {r['clone']['script']}")
        bad += 1 if flags else 0
        steps = intended['steps'] if intended else '-'
        plain = r['clone']['steps'] if r['clone'] else '-'
        print(f"{i + 1:2d} w{l['world']} {l['slug']:<24} par {steps:>3}  plain-clone {plain:>3}  {l['sol'] if '-v' in sys.argv else ''}  {' | '.join(flags)}")
    print(f"\n{len(L)} levels, {bad} flagged")
