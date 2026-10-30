# Spend Guard showcase

This is the self-contained Sites Worker checkout for the public Spend Guard showcase. All page assets, the policy engine, and the release download are embedded in worker/index.js. Pilot enquiries are stored in a private D1 binding named DB; no public endpoint lists them.

From the parent Spend Guard workspace, edit site-content/index.html and site-content/assets, then run npm run verify and npm run site:prepare. These regenerate the embedded worker from the exact release archive. Run npm run site:preview for a local preview with a separate local SQLite database.

From a restored standalone Sites checkout, edit worker/index.js directly. npm run build copies it and the manifest to dist/ without dependencies. npm run validate checks the Worker export. node --test test/api.test.mjs tests consent, private storage, deletion tokens, rate limits, and failure handling.

Publish using the Sites source helper with Node build commands. Windows installations with WSL but no distribution must put Git Bash before WSL Bash on PATH for the packaging helper. The Site identity in .openai/hosting.json must be retained.

D1 schema migrations are in drizzle/. Pilot signup is an enquiry, not payment collection. Review enquiries with the Sites database tools; they are not emailed automatically. Save visitors' deletion requests and do not expose the table publicly.
