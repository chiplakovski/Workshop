# Varmak Workshop

Internal workshop system for Varmak AB (Marieholm). Front-end module by module.

## Screens (current)
- `login.html` — Google sign-in landing page
- `hours-desktop.html` / `hours-mobile.html` — Hours module (worker: log time, equipment, notes)
- `hub-desktop.html` / `hub-mobile.html` — Admin hub (choose a module)
- `projects-desktop.html` — Projects module (customers, items → estimation / jobcard / hours, print offer)

## Access model
- Worker logs in → Hours module only
- Admin logs in → Hub → any module

## Shared design
Navy theme (#013179), sharp edges, engineering-grid + spark animation,
compact SV / EN / MK language switcher, 3K/4K scaling on desktop screens.

## Run locally
Open any `.html` in a browser, or use the VS Code **Live Server** extension
(right-click a file → "Open with Live Server"). Keep online — fonts load from Google.

## Status
Front-end previews. Next: shared assets refactor, then backend + real Google auth.
