# Penpot — Nextcloud Calendar Mobile

Le fichier Penpot « Nextcloud Calendar Mobile » est le design system de
référence de l'app : tokens thémés (light/dark), composants+variantes,
icônes Lucide, flows nommés et overlays, en parité avec le code React Native.

> ⚠️ **Workflow fork-only** : Penpot n'est utilisé que sur le fork
> (`nonofr91`). Upstream n'a pas encore arrêté l'adoption de Penpot —
> ne pas ouvrir de PR Penpot vers `SoluceTechnologies/nextcloud-calendar-mobile`.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `penpot/tokens.json` | Export DTCG des tokens Penpot — **référence canonique committée** |
| `penpot/<file>.penpot` | Export binaire du fichier (backup versionnable, ignoré sauf *.penpot) |
| `penpot/*/ ` | Export dézippé — **regénérable, ignoré par git** |

## Workflow design-first (features avec UI)

Règle permanente (voir `AGENTS.md` racine) : **design d'abord, code ensuite.**

1. **Maquetter dans Penpot** — réutiliser composants+variantes, boards
   `Screen / <route>`, tokens pour toute valeur visuelle, flow nommé +
   interactions pour le parcours.
2. **Exporter `tokens.json`** si des tokens changent — même branche.
3. **Coder** en consommant `src/theme.ts` — zéro valeur en dur couverte par
   un token ; `pluginData rn-component` = le composant RN à utiliser.
4. **`just theme-parity` vert** — CI fork l'exige.

### Fork → upstream

- Features avec UI : branche depuis `dev` **sur le fork** — les artefacts
  Penpot ne quittent pas le fork (CI Penpot fork-only).
- Commits Penpot séparés (`chore(penpot): …`) → cherry-pick code-only pour
  les PR upstream.
- `fix/` : direct upstream, pas de Penpot sauf si un token est touché.

## Contrat design ↔ code

- Les noms de tokens Penpot correspondent **exactement** aux clés de
  `src/theme.ts` (`color.primary` → `theme.colors.primary`, `spacing.md`,
  `radius.pill`, `fontSize.*`, `fontWeight.*`, `calendar.*`).
- Les composants Penpot portent en pluginData `rn-component` (équivalent RN)
  et `a11y` (contraintes zone tactile / états).
- Les boards sont nommés comme les routes (`Screen / Settings · Accounts`…).
- Les icônes sont des instances de la lib **Lucide** (= `lucide-react-native`).

```bash
just theme-parity   # vérifie tokens.json ↔ src/theme.ts (aussi en CI)
```

## Procédure de synchro à chaque release upstream

À chaque merge d'une release upstream dans le fork :

```bash
git fetch origin dev        # upstream = SoluceTechnologies
git merge origin/dev        # ou rebase selon la branche
just theme-parity
```

1. **`theme.ts` inchangé** → rien à faire, la parité reste verte.
2. **`theme.ts` modifié upstream** → la parité échoue : le code fait foi.
   - Ouvrir le fichier Penpot, corriger les valeurs de tokens concernées
     (sets `colors.light`/`colors.dark`/`palette.calendar`), réexporter
     `tokens.json`, commiter — la parité repasse au vert.
   - En parallèle, si la release ajoute des écrans/composants : les dessiner
     dans Penpot en réutilisant composants+variantes (jamais de copies plates).
3. **Design modifié volontairement dans Penpot** → réexporter `tokens.json`,
   commiter, puis reporter les valeurs dans `src/theme.ts` (même PR de
   préférence) — jamais l'inverse sans sync.

## Maintenance du fichier Penpot

- **Thèmes** : `scheme/light` = core + colors.light + palette.calendar ;
  `scheme/dark` = core + colors.dark + palette.calendar. Bascule globale
  via l'activation du thème — vérifier par lecture (`shape.tokens`), pas
  par export PNG (qui fige le thème courant).
- **Composants** : variantes réelles (Button `variant×state`, Chip `state`,
  Toggle `state`, EventChip `type`, MonthDay `state`, EventBar `size`) ;
  les modifications se font sur les mains, les copies sont des instances.
- **Icônes** : toujours une instance Lucide + token `strokeColor`/`fill`
  sur tous les descendants — jamais de glyphe texte ni de couleur en dur
  (sinon invisible en dark).
- **Version** : `File → Save version` avant chaque refonte importante.
