const PAGES = {
  404: {
    title: 'Link not found',
    message: 'This short link does not exist. Check the address and try again.',
  },
  410: {
    title: 'Link no longer available',
    message: 'This short link has expired or was removed by its owner.',
  },
};

/** Minimal standalone page for people who open a dead short link in a browser. Static text only. */
export function renderErrorPage(status) {
  const { title, message } = PAGES[status];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f6f7f9; color: #1c2430; }
    main { max-width: 26rem; padding: 2rem; text-align: center; }
    h1 { margin: 0 0 .5rem; font-size: 1.5rem; }
    p { margin: 0 0 1.5rem; color: #5a6675; line-height: 1.5; }
    a { color: #2456d6; font-weight: 600; }
    @media (prefers-color-scheme: dark) { body { background: #12161c; color: #e6e9ee; } p { color: #9aa5b4; } a { color: #7da2ff; } }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Create your own short link</a>
  </main>
</body>
</html>`;
}
