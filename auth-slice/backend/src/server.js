import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 4000);
const secureCookies = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

const app = createApp(openDb(), { secureCookies });
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
