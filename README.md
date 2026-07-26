# Marginalia — a bookshop for people who write in the margins

A complete, ready-to-run bookstore catalog: browse a bookshelf, search and filter
a full catalog, and open a details panel for each title. Built with **zero
external dependencies** — just Node.js core modules — so there's nothing to
`npm install` and nothing that can fail to compile.

## Run it

Requires Node.js 18+ (nothing else).

```bash
node server.js
```

Then open **http://localhost:3000**.

To use a different port: `PORT=4000 node server.js`.

## What's inside

```
bookcatalog/
├── server.js          Backend: HTTP server + REST API + static file server
├── data/
│   └── books.json      The "database" — categories + 26 seeded books
├── public/
│   ├── index.html       Markup
│   ├── styles.css       All styling (dark ink theme, warm parchment detail panel)
│   └── app.js            Frontend logic (fetches the API, renders shelf/grid/panel)
└── README.md
```

**The datastore is a JSON file, not SQLite/Postgres**, on purpose — it needs no
native build step and works anywhere Node runs. `server.js` reads it into
memory and rewrites it on every create/update/delete, so changes persist
across restarts. If you outgrow it, swapping `loadData()`/`saveData()` in
`server.js` for a real database call is the only place that needs to change —
the API surface stays identical.

## API

All routes are under `/api`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/categories` | List all categories |
| GET | `/api/books` | List books. Query params: `q` (search title/author), `category`, `sort` (`title`, `newest`, `rating`, `price_asc`, `price_desc`), `minPrice`, `maxPrice`, `featured=true` |
| GET | `/api/books/:id` | Get one book |
| POST | `/api/books` | Create a book (JSON body: `title`, `author`, `categoryId`, `price`, `pages`, `year`, optional `rating`, `stock`, `featured`, `description`) |
| PUT | `/api/books/:id` | Update a book (partial updates allowed) |
| DELETE | `/api/books/:id` | Delete a book |

Example:

```bash
curl "http://localhost:3000/api/books?category=sff&sort=rating"
curl -X POST http://localhost:3000/api/books \
  -H "Content-Type: application/json" \
  -d '{"title":"New Title","author":"A. Writer","categoryId":"fiction","price":15.99,"pages":250,"year":2026}'
```

Validation errors return `400` with an `error` message; missing resources
return `404`.

## Frontend notes

- **The shelf** at the top is the signature piece: every book is drawn as a
  spine whose width scales with its page count and whose color matches its
  category — a real shelf you can browse, not a stock hero banner. Click any
  spine to open its details.
- **The catalog grid** below is what search, category chips, and sorting act
  on — it's the scannable list view for when you know roughly what you want.
- The "save to reading list" toggle in the detail panel is stored in the
  browser's `localStorage` — there's no account system, so it's local to
  that browser.
- No build step: it's plain HTML/CSS/JS, so you can open `public/` files
  directly in an editor and see changes on refresh (no bundler, no compile).

## Password protection

The whole site requires a username and password (a browser login popup will
appear). The defaults are:

- Username: `reader`
- Password: `changeme123`

**Change these before putting the site online.** Set them as environment
variables instead of editing the code:

```bash
# Windows (Command Prompt)
set SITE_USERNAME=yourname
set SITE_PASSWORD=yourpassword
node server.js

# Mac/Linux
SITE_USERNAME=yourname SITE_PASSWORD=yourpassword node server.js
```

When you deploy to a host like Render (below), you'll set these same two
values in that host's dashboard instead of typing them in a terminal.

## Putting it online (so others can visit it)

This is a two-part process: put the code on GitHub, then connect GitHub to a
hosting service (Render) that runs it continuously and gives you a public
web address.

**1. Create a free GitHub account** at [github.com](https://github.com).

**2. Create a new repository** (top-right `+` → New repository). Give it a
name like `marginalia-bookshop`, keep it Public or Private (either works),
don't add a README (you already have one), then click Create.

**3. Upload your project.** On the new repository's page, click
**"uploading an existing file"**, then drag in everything from inside your
`bookcatalog` folder (all the files and the `data`/`public` folders), and
commit.

**4. Create a free Render account** at [render.com](https://render.com),
signing in with your GitHub account.

**5. Create a new Web Service.** From the Render dashboard: New → Web
Service → connect the `marginalia-bookshop` repository you just created.

**6. Fill in the settings Render asks for:**
- Runtime: `Node`
- Build Command: leave blank (there's nothing to build)
- Start Command: `node server.js`

**7. Add your password as environment variables.** In the same setup screen,
find "Environment Variables" and add:
- `SITE_USERNAME` = your chosen username
- `SITE_PASSWORD` = your chosen password

**8. Click Deploy.** After a minute or two, Render gives you a public URL
like `https://marginalia-bookshop.onrender.com`. Visiting it will prompt for
the username/password you set in step 7.

Note: Render's free tier "sleeps" a site after periods of no visits, so the
first visit after a quiet spell can take ~30 seconds to wake up — that's
normal, not a bug.

**To update the live site later:** edit `books.json` locally, then on your
repository's GitHub page use "Add file → Upload files" again to replace it —
Render will automatically redeploy.

## Extending it

- Add real cover images: swap the CSS gradient `.card-cover`/`.panel-cover`
  blocks for an `<img>` and add an `imageUrl` field to each book in
  `data/books.json`.
- Add an admin view: the API already has full create/update/delete — you'd
  just need a form in the frontend that calls `POST`/`PUT`/`DELETE`.
- Swap the datastore: replace the two functions `loadData()` and
  `saveData()` in `server.js` with calls to whatever database you prefer.
