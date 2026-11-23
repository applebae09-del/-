# VocaFlow AI

PDF/image/text vocabulary quiz builder with synonym and antonym practice.

## Deploy
The Vercel project serves `index.html` as a static site. PDF text extraction, URL payload import, browser OCR fallback, sample data, and quiz flows run in the browser.

## Optional Gemini backend
`gas/Code.gs` is the original Google Apps Script backend. The current frontend detects `google.script.run`, so the Gemini-powered text/image extraction and server-side URL fetching require deploying this file as a Google Apps Script web app and serving the HTML from that GAS app. A plain Vercel static deployment does not provide `google.script.run`; it uses the browser-side fallback parser/OCR instead.

Set the Script Property `GEMINI_API_KEY` in Apps Script before deploying that optional backend. Never commit API keys to this repository.
