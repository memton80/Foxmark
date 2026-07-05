# 🦊 Foxmark

**Foxmark** est un éditeur Markdown natif pour Linux (cible principale :
Fedora), écrit en **Rust + Tauri v2**, avec une esthétique inspirée de
**Firefox** (design Proton) : onglets arrondis, palette sobre, animations
douces, thème clair/sombre synchronisé avec le système.

Il combine : édition Markdown avancée avec autocomplétion, lecture de PDF
native (PDFium), export Markdown → PDF fidèle au CSS choisi (Chrome
headless), et une CI GitHub Actions qui produit un paquet `.rpm`.

---

## Fonctionnalités

### Éditeur Markdown
- **Vue scindée** : édition à gauche, aperçu live à droite — l'aperçu est
  rendu par la *même* fonction Rust que l'export PDF, avec la *même*
  feuille de style : ce que vous voyez est ce qui sera exporté.
- **Mode focus** (F11) : masque tout sauf le texte.
- Coloration syntaxique Markdown complète (titres, gras, italique, code,
  citations, listes, tableaux) + coloration des blocs de code par langage.
- Pliage de sections, numéros de ligne, recherche (Ctrl+F).
- Glisser-déposer d'images : copie automatique dans `assets/` relatif au
  fichier `.md`, insertion du lien à la position du dépôt.
- Sauvegarde automatique (30 s + perte de focus) et fichiers récents.

### Autocomplétion
| Déclencheur | Effet |
|---|---|
| `[[` | Liens wiki vers les autres `.md` du dossier ouvert (chemins relatifs) |
| `![` | Sélecteur d'image (fichiers d'`assets/` + « Parcourir… ») |
| ` ``` ` | Liste des langages de bloc de code, avec coloration |
| `Tab` sur `\| a \| b \|` | Génère la ligne séparatrice `\|---\|---\|` + une ligne vide |
| `](#` | Ancres des titres du document (sommaire) |
| `#` + saisie | Suggestions de titres basées sur le sommaire existant |
| `**`, `` ` ``, `_`, `[]`, `()` | Fermeture automatique des paires |

### Lecture de PDF
- Onglet dédié (PDFium natif, aucun navigateur embarqué).
- Navigation par page, zoom, recherche de texte plein document.
- Panneau « texte de la page » : sélectionnez un passage puis
  **Citer la sélection** → insertion en citation Markdown (`> …`) dans
  l'éditeur actif.

### Export Markdown → PDF
- **CSS GitHub par défaut** (`src/styles/export/github-default.css`) :
  reproduction fidèle du rendu GitHub (typographie, tableaux, code, badges).
- **CSS personnalisé** : votre `.css` en *remplacement* ou en *surcouche*
  du thème GitHub.
- Sauts de page via `@media print` (`page-break-*`, classes utilitaires
  `.page-break` / `.page-break-before`).
- En-têtes/pieds de page configurables : titre, date, numéros de page.
- Aperçu avant export : le panneau d'aperçu utilise exactement le CSS et le
  pipeline de l'export.

### Interface (style Firefox Proton)
- Barre d'onglets arrondie, sidebar rétractable (arborescence du dossier),
  palette de commandes (Ctrl+L, façon barre d'adresse Firefox), toasts.
- Palette Proton : accent `#0060df`, sombre `#2b2a33` — le tout défini en
  variables CSS dans `src/styles/theme.css`, jamais en dur.

---

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Ctrl+B` / `Ctrl+I` | Gras / Italique |
| `Ctrl+K` | Insérer un lien |
| `Ctrl+Shift+K` | Bloc de code |
| `Ctrl+L` ou `Ctrl+Shift+P` | Palette de commandes |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+Shift+O` | Nouveau / Ouvrir un fichier / Ouvrir un dossier |
| `Ctrl+S` / `Ctrl+Shift+S` | Enregistrer / Enregistrer sous |
| `Ctrl+Shift+E` | Exporter en PDF |
| `Ctrl+E` | Afficher/masquer l'aperçu |
| `F9` | Afficher/masquer la sidebar |
| `F11` | Mode focus |
| `Ctrl+W` | Fermer l'onglet |
| `Ctrl+PageUp/PageDown` | Onglet précédent/suivant |

> Note : `Ctrl+K` étant réservé au lien Markdown (convention des éditeurs),
> la palette utilise `Ctrl+L` — le raccourci de la barre d'adresse Firefox.

---

## Architecture du projet

```
Foxmark/
├── index.html                     # Coque HTML minimale — AUCUN style inline
├── package.json                   # Frontend Vite + TypeScript + CodeMirror 6
├── vite.config.ts
├── tsconfig.json
│
├── src/                           # ---------- FRONTEND ----------
│   ├── main.ts                    # Point d'entrée : App, onglets, raccourcis,
│   │                              # drag & drop, autosave
│   ├── components/
│   │   ├── TabBar.ts              # Onglets arrondis façon Firefox
│   │   ├── Sidebar.ts             # Arborescence du dossier de travail
│   │   ├── DocumentView.ts        # Vue scindée éditeur + aperçu (iframe)
│   │   ├── PdfViewer.ts           # Visionneuse PDF (pages rendues par Rust)
│   │   ├── CommandPalette.ts      # Palette Ctrl+L façon barre d'adresse
│   │   ├── ExportDialog.ts        # Dialogue d'export PDF (CSS, en-têtes)
│   │   ├── Welcome.ts             # Onglet d'accueil + fichiers récents
│   │   ├── Toast.ts               # Notifications (erreurs Rust lisibles)
│   │   └── icons.ts               # Icônes SVG traits fins (style Proton)
│   ├── editor/
│   │   ├── setup.ts               # Instance CodeMirror 6 (classHighlighter :
│   │   │                          # coloration par classes CSS statiques)
│   │   ├── autocomplete.ts        # [[, ![, ```, ](#, # → sources CM6
│   │   └── markdown-commands.ts   # Ctrl+B/I/K, tableaux via Tab, citation
│   ├── lib/
│   │   ├── ipc.ts                 # Appels typés vers les commands Rust
│   │   ├── state.ts               # Store observable (onglets, workspace)
│   │   └── paths.ts               # Utilitaires de chemins (affichage)
│   └── styles/                    # ---------- TOUT LE CSS DU PROJET ----------
│       ├── theme.css              # Variables Proton (couleurs, espacements,
│       │                          # rayons) + thème sombre synchronisé système
│       ├── firefox-proton.css     # Interface app (layout, boutons, champs)
│       ├── tabs.css / sidebar.css / editor.css / preview.css
│       ├── pdf-viewer.css / command-palette.css / dialogs.css
│       ├── toasts.css / welcome.css
│       └── export/
│           └── github-default.css # Thème d'export « GitHub » — partagé par
│                                  # l'aperçu ET l'export PDF (via ressources)
│
├── src-tauri/                     # ---------- BACKEND RUST ----------
│   ├── Cargo.toml
│   ├── tauri.conf.json            # Bundle rpm/deb, ressources embarquées
│   ├── capabilities/default.json  # Permissions Tauri v2
│   ├── icons/                     # Générées par scripts/generate-icons.mjs
│   ├── resources/pdfium/          # libpdfium.so (scripts/fetch-pdfium.sh)
│   └── src/
│       ├── main.rs / lib.rs       # Enregistrement des commands
│       ├── error.rs               # Erreurs sérialisables lisibles (toasts)
│       ├── markdown.rs            # ★ render_document : LA fonction de rendu
│       │                          #   commune aperçu/export (pulldown-cmark,
│       │                          #   GFM, ancres de titres, URLs relatives)
│       ├── export.rs              # Export PDF via headless_chrome (CDP)
│       ├── pdf.rs                 # PDFium : infos, rendu de page PNG,
│       │                          #   extraction de texte, recherche
│       └── files.rs               # Ouverture/sauvegarde, arborescence,
│                                  #   import d'images, fichiers récents
│
├── scripts/
│   ├── generate-icons.mjs         # Icônes PNG sans dépendance externe
│   └── fetch-pdfium.sh            # Télécharge libpdfium.so (bblanchon)
│
└── .github/workflows/build.yml    # fmt + clippy + tests + bundle rpm/deb
                                   # + release GitHub sur tag v*
```

### Règle non négociable : séparation CSS / HTML

Aucun style ne vit dans le HTML : pas d'attribut `style=""`, pas de balise
`<style>`, pas de styles générés en JS. Tout le style est dans
`src/styles/*.css`. Deux cas limites, traités explicitement :

1. **CodeMirror** : nous n'utilisons ni `EditorView.theme()` ni
   `HighlightStyle` (qui injectent des styles). La coloration passe par
   `classHighlighter` (classes statiques `tok-*`) stylée dans `editor.css`.
   Seuls les styles *internes de base* de la bibliothèque restent gérés par
   elle-même.
2. **En-têtes/pieds de page d'impression Chrome** : le protocole DevTools
   exige des templates HTML autonomes (les CSS externes n'y sont pas
   appliquées — limitation documentée de Chrome). Ces fragments,
   générés côté Rust dans `export.rs`, sont l'unique exception ; ils ne
   font partie ni du HTML de l'app ni du document exporté.

### Fidélité aperçu ↔ PDF

`src-tauri/src/markdown.rs::render_document` est l'unique fonction de rendu
Markdown → HTML. L'aperçu (iframe) et l'export (Chrome headless) l'appellent
tous deux, avec les mêmes feuilles de style — seule change la résolution
des chemins relatifs d'images (`asset://` pour la webview, `file://` pour
Chrome).

---

## Build local sur Fedora (testé pour Fedora 44 KDE)

### 1. Dépendances système

```bash
# Toolchain Rust (via rustup) et Node.js ≥ 20
sudo dnf install rustup nodejs npm
rustup-init -y && source ~/.cargo/env

# Dépendances Tauri v2
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel patchelf

# Outils de build C
sudo dnf group install "c-development"

# Pour l'export PDF (pilotage headless) :
sudo dnf install chromium
```

### 2. Dépendances du projet

```bash
git clone https://github.com/memton80/Foxmark.git && cd Foxmark
npm install

# Bibliothèque PDFium (visionneuse PDF) — embarquée ensuite dans le bundle
./scripts/fetch-pdfium.sh x64
```

### 3. Lancer en développement

```bash
npm run tauri dev
```

### 4. Tests et qualité

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

### 5. Construire le paquet .rpm

```bash
npm run tauri build -- --bundles rpm
# → src-tauri/target/release/bundle/rpm/Foxmark-0.1.0-1.x86_64.rpm
sudo dnf install ./src-tauri/target/release/bundle/rpm/*.rpm
```

> **PDFium** : si `libpdfium.so` n'est ni embarquée ni installée, la
> visionneuse PDF affiche une erreur explicite. Vous pouvez pointer un
> emplacement personnalisé avec `FOXMARK_PDFIUM_PATH=/chemin/vers/dossier`.

> **Export PDF** : nécessite Chrome ou Chromium installé (détection
> automatique). Sur Fedora : `sudo dnf install chromium`.

---

## CI/CD (GitHub Actions)

`.github/workflows/build.yml` :

- **Pull request** : build de vérification complet — `cargo fmt --check`,
  `cargo clippy -D warnings`, `cargo test`, puis
  `npm run tauri build -- --bundles rpm,deb` ; les paquets sont attachés en
  artefacts.
- **Tag `v*`** : même pipeline, puis publication automatique du `.rpm`
  (et `.deb`) en release GitHub.
- Caches Cargo (`Swatinem/rust-cache`) et npm (`setup-node`) activés.
- Le `.rpm` est produit depuis `ubuntu-24.04` : le bundler Tauri s'appuie
  sur `cargo-generate-rpm`, indépendant de la distribution hôte.

Publier une release :

```bash
git tag v0.1.0 && git push origin v0.1.0
```

---

## Limitations connues / pistes

- Les blocs de code de l'export PDF ne sont pas colorés (style GitHub
  appliqué, mais pas de coloration lexicale côté `pulldown-cmark`) ;
  piste : `syntect` dans `render_document`.
- La recherche PDF renvoie page + extrait (pas de surlignage dans le rendu
  de page).
- Le zoom PDF re-rend la page côté Rust (net à tous les niveaux, mais pas
  de zoom fluide pincé).

## Licence

MIT.
