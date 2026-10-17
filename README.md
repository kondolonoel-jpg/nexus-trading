# NEXUS TRADING — Command

Dashboard de trading (Flask + interface sans build) : risque, playbook, journal, news temps réel, **Macro Intelligence**
(COT CFTC, titres des banques, régimes Risk-On, alertes), **verdict par marché** et analyse technique de **35 marchés**
(13 classiques + 22 indices synthétiques Deriv). Connexion par compte.

## Déployer sur Render depuis GitHub (pas à pas)
1. Créez un dépôt GitHub (privé conseillé) et envoyez-y **le contenu de ce dossier** (`git init`, `git add .`, `git commit`, `git push`).
   Le fichier `.gitignore` empêche déjà de publier les données locales (`data/`, clés, bases).
2. Sur [render.com](https://render.com) : **New + → Blueprint** → choisissez le dépôt. Render lit `render.yaml` et crée le service.
   (Sinon : **New + → Web Service**, Runtime *Python*, Build `pip install -r requirements.txt`,
   Start `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 90 server:app`, Health check `/api/health`.)
3. Attendez la fin du déploiement, ouvrez l'URL `https://….onrender.com`, **créez votre compte**.
4. Section **Macro → « ✔ Tester les sources »** : vérifie CFTC, Yahoo, FRED, Google News, Deriv et Telegram.

### Variables d'environnement (Render → Environment)
| Variable | Rôle |
|---|---|
| `NEXUS_SECRET` | clé de signature des sessions (le blueprint la génère). Gardez-la stable. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | alertes Telegram (optionnel) : bot créé avec @BotFather ; l'identifiant de chat s'obtient en écrivant au bot puis en ouvrant `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `DERIV_APP_ID` | identifiant d'application Deriv (par défaut `1089`, public) |
| `NEXUS_STATIC` | `react-version/static` pour servir la version React à la place de l'interface par défaut |
| `NEXUS_DATA_DIR` | dossier des données (comptes, cache) si vous montez un disque ailleurs |

### ⚠️ Comptes et plan gratuit Render
Sur le plan gratuit, le disque est **éphémère** : la base des comptes est **effacée à chaque redéploiement et à chaque réveil**
du service (il s'endort après ~15 min sans visite). Vous devrez alors recréer votre compte.
Pour conserver les comptes : plan payant + disque persistant (décommentez le bloc `disk:` dans `render.yaml`).
Le journal et les réglages restent, eux, dans le navigateur (exportez-les avec ⬇ dans l'en-tête).

## Structure
```
server.py        API Flask : comptes, news, calendrier, analyse D1/W1 (Yahoo + Deriv), service du frontend
macro.py         Macro Intelligence : COT, banques, régimes, verdict, alertes, calibration, test des sources
static/          interface par défaut (HTML + css/ + js/ + assets/)
react-version/   interface React + Vite : frontend/ (sources) et static/ (version compilée)
render.yaml      blueprint Render        Dockerfile / Procfile : autres modes de déploiement
```

## Lancer en local
```
pip install -r requirements.txt
python server.py                                  # http://localhost:8000
NEXUS_STATIC=react-version/static python server.py   # même chose avec l'interface React
```
Modifier la version React : `cd react-version/frontend && npm install && npm run dev` (relaye /api vers le port 8000),
puis `npm run build` et copiez `dist/*` dans `react-version/static/`.

## Notes
- Données réelles uniquement : une source injoignable s'affiche « n/d ». Informatif, pas un conseil financier.
- Un seul worker gunicorn, volontairement (les boucles de fond ne doivent pas tourner en double).
- Les routes `/api/login` et `/api/register` sont limitées (10 / 6 appels par 10 min et par IP).
