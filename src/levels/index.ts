import { formatLevelErrors, parseLevel } from '../core/level-parser';
import type { Level } from '../core/types';
import l01 from './01-premiers-pas.txt?raw';
import l02 from './02-le-fil.txt?raw';
import l03 from './03-a-la-verticale.txt?raw';
import l04 from './04-la-fosse.txt?raw';
import l05 from './05-le-bouchon.txt?raw';
import l06 from './06-par-dessus.txt?raw';
import l07 from './07-deux-caisses.txt?raw';
import l08 from './08-le-va-et-vient.txt?raw';
import l09 from './09-le-contour.txt?raw';
import l10 from './10-derriere-le-plan.txt?raw';
import l11 from './11-le-fil-qui-s-enfonce.txt?raw';
import l12 from './12-changer-de-coupe.txt?raw';
import l13 from './13-l-escalier-cache.txt?raw';
import l14 from './14-la-bonne-coupe.txt?raw';
import l15 from './15-le-demenagement.txt?raw';
import l16 from './16-trois-coupes.txt?raw';
import l17 from './17-tenir-la-porte.txt?raw';
import l18 from './18-la-courte-echelle.txt?raw';
import l19 from './19-le-sacrifice.txt?raw';
import l20 from './20-apres-toi.txt?raw';
import l21 from './21-le-relais.txt?raw';
import l22 from './22-les-mains-libres.txt?raw';
import l23 from './23-l-escabeau.txt?raw';
import l24 from './24-le-coup-de-main.txt?raw';
import l25 from './25-le-croisement.txt?raw';
import l26 from './26-deux-fils.txt?raw';
import l27 from './27-le-croisement-inverse.txt?raw';
import l28 from './28-l-ile-du-fond.txt?raw';
import l29 from './29-le-funambule.txt?raw';
import l30 from './30-la-caisse-du-clone.txt?raw';
import l31 from './31-le-double-croisement.txt?raw';
import l32 from './32-le-trio.txt?raw';
import l33 from './33-les-trois-postes.txt?raw';
import l34 from './34-le-mime.txt?raw';
import l35 from './35-le-mime-croise.txt?raw';
import l36 from './36-renvoyer-l-ascenseur.txt?raw';
import l37 from './37-le-marchepied.txt?raw';
import l38 from './38-le-saut-de-la-foi.txt?raw';
import l39 from './39-le-mime-sur-le-fil.txt?raw';
import l40 from './40-le-pont-de-singes.txt?raw';
import l41 from './41-le-levier.txt?raw';
import l42 from './42-pair-impair.txt?raw';
import l43 from './43-sens-unique.txt?raw';
import l44 from './44-l-un-ou-l-autre.txt?raw';
import l45 from './45-deux-fois.txt?raw';
import l46 from './46-saute-mouton.txt?raw';
import l47 from './47-l-aide-memoire.txt?raw';
import l48 from './48-chacun-son-tour.txt?raw';
import l49 from './49-le-reflet.txt?raw';
import l50 from './50-dos-au-mur.txt?raw';
import l51 from './51-le-reflet-grimpe.txt?raw';
import l52 from './52-le-fil-du-reflet.txt?raw';
import l53 from './53-le-grand-saut.txt?raw';
import l54 from './54-le-miroir-profond.txt?raw';
import l55 from './55-deux-reflets.txt?raw';
import l56 from './56-la-telecommande.txt?raw';
import l57 from './57-la-dalle.txt?raw';
import l58 from './58-aller-simple.txt?raw';
import l59 from './59-par-le-plancher.txt?raw';
import l60 from './60-le-passeur.txt?raw';
import l61 from './61-l-ancre-fragile.txt?raw';
import l62 from './62-la-caravane.txt?raw';
import l63 from './63-le-damier.txt?raw';
import l64 from './64-parahydox.txt?raw';

export const LEVEL_SOURCES: readonly { readonly id: string; readonly source: string }[] = [
  { id: '01-premiers-pas', source: l01 },
  { id: '02-le-fil', source: l02 },
  { id: '03-a-la-verticale', source: l03 },
  { id: '04-la-fosse', source: l04 },
  { id: '05-le-bouchon', source: l05 },
  { id: '06-par-dessus', source: l06 },
  { id: '07-deux-caisses', source: l07 },
  { id: '08-le-va-et-vient', source: l08 },
  { id: '09-le-contour', source: l09 },
  { id: '10-derriere-le-plan', source: l10 },
  { id: '11-le-fil-qui-s-enfonce', source: l11 },
  { id: '12-changer-de-coupe', source: l12 },
  { id: '13-l-escalier-cache', source: l13 },
  { id: '14-la-bonne-coupe', source: l14 },
  { id: '15-le-demenagement', source: l15 },
  { id: '16-trois-coupes', source: l16 },
  { id: '17-tenir-la-porte', source: l17 },
  { id: '18-la-courte-echelle', source: l18 },
  { id: '19-le-sacrifice', source: l19 },
  { id: '20-apres-toi', source: l20 },
  { id: '21-le-relais', source: l21 },
  { id: '22-les-mains-libres', source: l22 },
  { id: '23-l-escabeau', source: l23 },
  { id: '24-le-coup-de-main', source: l24 },
  { id: '25-le-croisement', source: l25 },
  { id: '26-deux-fils', source: l26 },
  { id: '27-le-croisement-inverse', source: l27 },
  { id: '28-l-ile-du-fond', source: l28 },
  { id: '29-le-funambule', source: l29 },
  { id: '30-la-caisse-du-clone', source: l30 },
  { id: '31-le-double-croisement', source: l31 },
  { id: '32-le-trio', source: l32 },
  { id: '33-les-trois-postes', source: l33 },
  { id: '34-le-mime', source: l34 },
  { id: '35-le-mime-croise', source: l35 },
  { id: '36-renvoyer-l-ascenseur', source: l36 },
  { id: '37-le-marchepied', source: l37 },
  { id: '38-le-saut-de-la-foi', source: l38 },
  { id: '39-le-mime-sur-le-fil', source: l39 },
  { id: '40-le-pont-de-singes', source: l40 },
  { id: '41-le-levier', source: l41 },
  { id: '42-pair-impair', source: l42 },
  { id: '43-sens-unique', source: l43 },
  { id: '44-l-un-ou-l-autre', source: l44 },
  { id: '45-deux-fois', source: l45 },
  { id: '46-saute-mouton', source: l46 },
  { id: '47-l-aide-memoire', source: l47 },
  { id: '48-chacun-son-tour', source: l48 },
  { id: '49-le-reflet', source: l49 },
  { id: '50-dos-au-mur', source: l50 },
  { id: '51-le-reflet-grimpe', source: l51 },
  { id: '52-le-fil-du-reflet', source: l52 },
  { id: '53-le-grand-saut', source: l53 },
  { id: '54-le-miroir-profond', source: l54 },
  { id: '55-deux-reflets', source: l55 },
  { id: '56-la-telecommande', source: l56 },
  { id: '57-la-dalle', source: l57 },
  { id: '58-aller-simple', source: l58 },
  { id: '59-par-le-plancher', source: l59 },
  { id: '60-le-passeur', source: l60 },
  { id: '61-l-ancre-fragile', source: l61 },
  { id: '62-la-caravane', source: l62 },
  { id: '63-le-damier', source: l63 },
  { id: '64-parahydox', source: l64 },
];

/** Chapter titles, indexed by `level.world - 1`. One new idea per chapter. */
export const WORLD_NAMES: readonly string[] = ['Le fil', 'Le volume', 'La boucle', 'Le croisement', 'La divergence', 'Le levier', 'Le reflet', "L'éphémère"];

/** Levels ship with the build, so a malformed one is a programming error: fail at boot. */
export function loadLevels(): Level[] {
  return LEVEL_SOURCES.map(({ id, source }) => {
    const parsed = parseLevel(source);
    if (!parsed.ok) throw new Error(formatLevelErrors(id, parsed.error));
    return parsed.value;
  });
}
