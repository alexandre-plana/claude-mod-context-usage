# claude-mod-context-usage

Un mod pour Claude Code qui affiche en permanence l'utilisation du contexte de la session active, juste au-dessus de la barre de chat.

## Fonctionnalités

- **Mode condensé (par défaut)** : une seule ligne avec le pourcentage utilisé, une barre fine colorée par catégorie (messages, outils système, fichiers mémoire, outils MCP, etc.), le compteur `tokens / fenêtre`, et les boutons **Compacter** et **Étendre**.
- **Bouton Compacter** : lance le compactage de la conversation, comme `/compact`.
- **Mode étendu** : détail par catégorie avec graphiques en barres, plus gros serveurs MCP, fichiers mémoire et skills, seuil d'auto-compactage, éléments différés, limites d'utilisation (session 5 h, semaine) et coût de la session.
- **Icône d'état** entre le compteur et le bouton Compacter, avec les couleurs du thème Claude Code (la forme change aussi, pour rester lisible sans la couleur) :

  | Contexte utilisé | Icône |
  |---|---|
  | moins de 300k tokens | ● vert (`success`) |
  | 300k et plus | ▲ jaune (`warning`) |
  | 500k et plus | ◆ orange (`claude`) |
  | 650k et plus | ■ rouge (`error`) |

- Le texte et les couleurs suivent le thème de l'application : même typographie que Claude Code.
- Raccourcis : `c` compacte, `e` étend ou réduit, quand la bande a le focus.

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

- Sur le bureau, la barre est un SVG de 4 px. Dans un terminal, elle devient une barre d'une cellule.
- Si le moteur refuse un rendu, il en dessine un autre à la place. Pendant le développement, la conversation affiche alors une ligne `context-band … refused: …` avec la raison.

## Licence

[MIT](LICENSE) © 2026 Alexandre Plana
