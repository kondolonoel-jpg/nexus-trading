# Version React + Vite
- `frontend/` : sources (menu, sélecteur de marché, news, Macro, Analyse IA, alertes, connexion en composants React).
- `static/` : version compilée, servie par `server.py` avec `NEXUS_STATIC=react-version/static`.

Les sections Accueil, Command, Risque, Protocole, Playbook, Journal, Captures, Revues, Comptes et Système restent en
JavaScript d'origine (`frontend/src/legacy/`), injectées telles quelles dans React : migration progressive.

```
cd frontend && npm install && npm run build && cp -r dist/* ../static/
```
