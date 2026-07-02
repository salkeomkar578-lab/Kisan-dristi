Kisan-Drishti — Local development & sync testing

Quick setup

- Install deps: `npm install`
- Start dev server: `npm run dev` (app at http://localhost:5174/)
- Enable Auth providers in Firebase console (Email/Password and Google recommended)

Firebase Hosting & Rules

- `firebase.json` contains hosting config for SPA deploys.
- `firestore.rules` contains a basic rule that requires authentication. Review and tighten rules before production.

Testing offline → online sync (browser)

1. Open the app at `/debug/sync-test` (for example http://localhost:5174/debug/sync-test).
2. Click `Run offline→online sync test`. The page will:
   - initialize Firebase
   - disable Firestore network
   - write a local cattle record
   - re-enable network and run a full sync
   - report whether the record appeared in Firestore

Deployment

- GitHub: commit the repository and push it to a new GitHub repo on `main`.
- Netlify: connect the GitHub repo, keep the build command as `npm run build`, and publish the `dist` folder. The included `netlify.toml` already adds SPA redirects.
- Vercel: import the GitHub repo, keep the build command as `npm run build`, and use `dist` as the output folder. The included `vercel.json` already rewrites routes for the SPA.
- Firebase Hosting: install Firebase CLI and run `firebase init hosting` to connect your project, then deploy with `firebase deploy --only hosting` after building.

CI / CD

- A sample GitHub Actions workflow is provided at `.github/workflows/ci-cd.yml` that builds the app and deploys to Firebase when commits are pushed to `main`/`master`. Add `FIREBASE_TOKEN` as a repository secret (use `firebase login:ci` to generate a token).
- For Netlify or Vercel, the repository already includes the deploy config files needed for automatic SPA hosting.

Cloud Functions

- A lightweight Cloud Functions skeleton lives in the `functions/` folder. It includes:
   - `onCattleCreated` — Firestore trigger that marks new cattle as `serverVerified` and adds `serverProcessedAt` timestamp.
   - `verifyToken` — HTTP endpoint to verify client ID tokens.

To deploy functions:

```bash
# from the repo root
cd functions
npm ci
npm run deploy
```

Notes

- Cloud Functions require billing to be enabled for production-scale usage. Use service accounts and CI secrets for admin tasks; never commit service account JSON to the repo.
- Harden Firestore rules further to match your exact user model (the rules in `firestore.rules` assume custom claims `role` and optional `farmerId`).

Security & production checklist

- Enable proper Firestore rules scoped to collections and user roles.
- Add OAuth consent screen and authorized domains for Google sign-in.
- Enable billing if using phone auth or Cloud Functions.
- Use a service account stored in CI secrets for admin tasks (do NOT commit it to repo).
