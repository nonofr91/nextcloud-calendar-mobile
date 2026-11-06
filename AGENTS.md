# Nextcloud Calendar Mobile — règles agent

## Design-first Penpot — obligatoire pour toute feature avec UI

Le fichier Penpot « Nextcloud Calendar Mobile » est le design system de
référence (workflow fork-only — voir `penpot/README.md`).

**Ordre imposé : design d'abord, code ensuite.**

1. Avant d'écrire du code UI : maquetter l'écran dans Penpot en réutilisant
   les composants/variantes existants (`Button`, `Item`, `Chip`, `TabBar`…) ;
   nommer les boards `Screen / <route>` ; ne créer un composant que pour un
   pattern réellement réutilisable.
2. Ne jamais inventer de valeur visuelle — utiliser/créer des tokens
   (`colors.*`, `core`, `palette.calendar`). Si un token change, réexporter
   `penpot/tokens.json` dans la même branche.
3. Câbler le parcours : flow nommé + interactions (règles API dans le skill
   `penpot-design-system`).
4. Coder en consommant `src/theme.ts` — jamais de couleur/spacing/fontSize en
   dur qui existe en token. `pluginData rn-component` sur les composants
   indique l'équivalent RN à utiliser.
5. `just theme-parity` doit rester vert (CI fork l'exige).

## Fork → upstream

- Les **features avec UI se développent sur le fork** (`nonofr91`), branche
  depuis `dev`. Les artefacts Penpot (`penpot/`, tokens.json) restent
  côté fork — le CI Penpot ne tourne que là.
- Commits Penpot dédiés (`chore(penpot): …`) séparés des commits de code, pour
  permettre un cherry-pick code-only vers upstream.
- Jamais de PR upstream contenant `penpot/` (adoption non décidée upstream).
- `fix/` bug fixes : directement upstream, sans Penpot sauf si la valeur
  touchée est un token.

## Détails

- `penpot/README.md` : contrat tokens ↔ code, procédure de synchro release.
- `.devin/skills/nextcloud-calendar-rules` : mode opératoire projet
  (arbitrage features, workflow Discussions→Issues→PRs).
