FRESHWAY WATER POS & CUSTOMER LEDGER — DEPLOYMENT GUIDE

IMPORTANT: This app has a React frontend and an Express + SQLite backend.
CONFIG NOTE: netlify.toml now includes a default VITE_API_BASE_URL of
https://freshway-water-pos-api.onrender.com based on the service name in render.yaml.
You MUST deploy the Render backend first and verify /api/health. If Render gives
you a different URL, replace the default with the actual URL in Netlify Site
configuration → Environment variables, then trigger a fresh deploy. This ZIP
cannot create/deploy a Render service inside your account automatically.
Netlify hosts only the frontend. The backend must be deployed separately to Render.
Do not upload only the ZIP directly to Netlify and expect login/database to work.

A. DEPLOY BACKEND FIRST
1. Extract this ZIP.
2. Upload the project to a GitHub repository.
3. In Render, create a new Web Service and connect that repository.
4. Use:
   Runtime: Node
   Build command: npm install && npm run build
   Start command: npm run start
   Node version: 22
5. Add a persistent disk:
   Mount path: /opt/render/project/src/data
   Size: 1 GB (or an available plan equivalent).
6. Deploy. Copy the service URL, for example:
   https://your-service.onrender.com
7. Open https://your-service.onrender.com/api/health
   It should return JSON containing "status":"ok".
   If it does not, login will not work yet. Check Render deploy logs.

B. DEPLOY FRONTEND TO NETLIFY
1. In Netlify, import the same GitHub repository.
2. Build command: npm run build
3. Publish directory: dist
4. In Site configuration → Environment variables, add:
   Key: VITE_API_BASE_URL
   Value: https://your-service.onrender.com
   Replace this example with your actual Render URL. Do not add /api to the end.
5. Trigger a fresh deploy after adding the variable.

C. CONNECT CORS
1. Copy your final Netlify URL, e.g. https://your-site.netlify.app
2. In Render → Environment, set:
   FRONTEND_URL = https://your-site.netlify.app
   Use the exact URL (including https and any www/custom domain).
3. Redeploy the Render service after changing this variable.

D. FIRST LOGIN
There is no default username or password. The database starts empty by design.
When the app opens, use the First-Time Setup screen to create the administrator:
- Business name
- Full name
- Username
- Email
- Password (at least 6 characters)
Then log in using the username/email and password you created.

E. IF YOU STILL SEE AN ERROR
- Test Render URL + /api/health first.
- If health does not return JSON with status ok, fix the Render service before changing login credentials.
- If health works but login fails, check VITE_API_BASE_URL spelling/value in Netlify and redeploy Netlify.
- If browser reports CORS, set FRONTEND_URL to the exact Netlify domain and redeploy Render.
- Keep the Render persistent disk mounted at /opt/render/project/src/data or database data may not persist.
- A free/sleeping backend may take time to wake. First request can be delayed.
- Do not use a Netlify URL as VITE_API_BASE_URL; it must be the Render backend URL.

F. LOCAL DEVELOPMENT
Install Node.js 22 or newer, then from the project directory:
  npm install
  npm run dev
Open the local URL printed in the terminal.

A deployment cannot be verified until the project is deployed in your own GitHub/Render/Netlify accounts. This ZIP contains configuration and a fix so list/filter API requests also respect VITE_API_BASE_URL, but live login still depends on completing the hosting steps above.
