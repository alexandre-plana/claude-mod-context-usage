# claude-mod-context-usage

Un mod pour Claude Code qui affiche en permanence l'utilisation du contexte de la session active, juste au-dessus de la barre de chat.

## Fonctionnalités

- **Une seule ligne** : pourcentage utilisé, barre fine colorée par catégorie (messages, outils système, fichiers mémoire, outils MCP, etc.) qui occupe la largeur disponible, compteur `tokens / fenêtre`, menu **Auto** et bouton **Compacter**.
- **Bouton Compacter** : lance le compactage de la conversation, comme `/compact`. Raccourci `c` quand la bande a le focus.
- **Compactage automatique** : le menu déroulant **Auto** fixe un seuil (Désactivé, 300k, 400k… jusqu'à 1M). Quand le contexte atteint ce seuil, à la fin d'un tour, le mod lance le compactage (au plus une fois par minute). Le seuil est mémorisé d'une session à l'autre.
- **Détail au survol** : en passant la souris sur la barre, une carte affiche le détail par catégorie (tokens et pourcentage), comme `/context`. Elle s'ouvre au-dessus de la catégorie survolée.
- **État de chargement** : pendant un compactage, la barre est atténuée avec un reflet animé et le texte devient « Compactage… ». Pendant le compactage, le menu et le bouton sont désactivés.
- Le texte et les couleurs suivent le thème de l'application : même typographie que Claude Code.

Le détail par catégorie reste disponible dans Claude Code (`/context`).

Les chiffres viennent de `$.session.usage({ breakdown: 'summary' })`, la même source que `/context` (estimation locale, aucune requête supplémentaire). Ils sont rafraîchis au début et à la fin de chaque tour, après chaque appel d'outil, après un compactage, et toutes les 5 secondes.

## Installation

Prérequis : une version de Claude Code qui prend en charge les mods (hooks `ui.render`, `$.session.usage`).

1. Clone le dépôt à un emplacement stable :

   ```bash
   git clone https://github.com/alexandre-plana/claude-mod-context-usage.git
   ```

2. Charge le mod dans toutes tes sessions en définissant la variable d'environnement `CLAUDE_CODE_PLUGIN_DIRS` avec le chemin du dossier cloné.

   Windows (PowerShell) :

   ```powershell
   [Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'C:\chemin\vers\claude-mod-context-usage', 'User')
   ```

   macOS / Linux (à ajouter à `~/.zshrc` ou `~/.bashrc`) :

   ```bash
   export CLAUDE_CODE_PLUGIN_DIRS="$HOME/chemin/vers/claude-mod-context-usage"
   ```

3. Redémarre Claude Code (et l'application desktop si besoin). Les sessions déjà ouvertes ne chargent pas le mod : il faut les relancer.

Alternative, pour une seule session en ligne de commande :

```bash
claude --plugin-dir /chemin/vers/claude-mod-context-usage
```

### Vérifier

```bash
claude plugin validate /chemin/vers/claude-mod-context-usage
```

## Structure

```
.claude-plugin/plugin.json   manifeste du mod
hooks/hooks.json             déclare le module de hooks
hooks/register.tsx           le mod : relevé du contexte et rendu de la bande
types/index.d.ts             types de l'état partagé du mod
```

## Notes

- Le compactage utilise `$.session.compact()` et, quand il n'est pas disponible (app desktop, SDK), la commande `/compact` via `$.command.run`.
- Sur le bureau, la barre est un SVG de 4 px. Dans un terminal, elle devient une barre d'une cellule.
- Si le moteur refuse un rendu, il en dessine un autre à la place. Pendant le développement, la conversation affiche alors une ligne `context-band … refused: …` avec la raison.

## Licence

[MIT](LICENSE) © 2026 Alexandre Plana
