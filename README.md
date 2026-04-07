# Spa Maintenance

Application web de maintenance de spa/jacuzzi avec analyse de bandelettes par IA (Claude).

## Fonctionnalités

- **Analyse de bandelettes** : prenez en photo une bandelette d'analyse, l'IA détecte pH, alcalinité, dureté, brome/chlore et recommande les actions correctives
- **Dashboard** : vue d'ensemble avec le dernier relevé et les rappels d'entretien
- **Historique** : tableau chronologique et graphiques d'évolution par paramètre
- **Rappels d'entretien** : nettoyage filtre, trempage dégraissant, remplacement filtre, vidange complète

## Installation

```bash
npm install
```

## Configuration

Créez un fichier `.env` à la racine :

```
OPENROUTER_API_KEY=votre_clé_openrouter
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free
PORT=3000
```

Modèles vision recommandés (du moins cher au plus cher) :
- `google/gemini-2.5-flash` — très peu cher
- `meta-llama/llama-4-scout:free` — gratuit

## Lancement

```bash
npm start
```

Ouvrez `http://localhost:3000` sur votre smartphone.

## Tech

- **Backend** : Node.js + Express + SQLite (better-sqlite3)
- **Frontend** : HTML/CSS/JS vanilla, mobile-first
- **IA** : OpenRouter (Gemini Flash gratuit par défaut) pour l'analyse d'image
- Pas d'authentification (usage personnel local)
