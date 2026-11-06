# Contribuer — Nextcloud Calendar Mobile (fork)

Ce fork sert de terrain de développement pour les features ; `upstream`
(SoluceTechnologies) reçoit les fixes validés et, une fois arbitrées, les
features **code-only**.

## Workflow

1. **Branches** : `main` suit upstream ; `dev` = base de dev du fork
   (upstream main + commits fork). Nouvelles branches depuis `dev`.
2. **Features avec UI → design d'abord** : maquetter dans le fichier Penpot
   (« Nextcloud Calendar Mobile ») avant de coder — voir
   [`penpot/README.md`](penpot/README.md) et `AGENTS.md`. Composants/
   variantes existants, tokens pour toute valeur visuelle, flow nommé.
3. **Code** : consommer `src/theme.ts` — aucune couleur/spacing/fontSize en
   dur couverte par un token.
4. **Commits** : séparer les artefacts Penpot (`chore(penpot): …`) des
   commits de code → les PR upstream peuvent cherry-pick le code seul.
5. **CI** : `just theme-parity` (tokens.json ↔ theme.ts) tourne sur le fork
   — doit rester vert. Les artefacts `penpot/` ne partent jamais upstream.
6. **PR upstream** : fixes `fix/` directs ; features quand arbitrées —
   jamais de chemins `penpot/`.

## Références

- `AGENTS.md` — règles agent (toujours appliquées)
- `penpot/README.md` — contrat tokens ↔ code, synchro release
- `.devin/skills/` — skills projet (CalDAV, epic, PR, workflow)
