# Workspace color treatment

Mode: Operate. Extend the existing Luminous system and the demo's blue expert header across auditor and administrator routes.

- Customer/public routes retain mint and teal.
- Auditor routes (`/audit` and descendants) use cool blue actions, sky selection surfaces, a blue header, and lightly blue workspace atmosphere.
- Administrator routes (`/admin` and descendants) use warm amber actions, amber selection surfaces, a bronze header, and lightly warm workspace atmosphere.
- Dark variants use tinted dark paper and headers with bright action colors and explicit contrasting foregrounds.
- Reading surfaces stay opaque. Semantic success, information, warning, danger, and explicitly named card/chart tones stay independent of role. Labels and selection attributes continue to convey meaning without color.

`ApplicationThemeProvider` derives the presentation role from the pathname and puts `data-workspace` on the document root. This covers normal, prototype, and demo routes as well as body portals, mobile navigation, focus and text selection. It is unrelated to authorization. Returning to public/customer routes resets the palette; switching roles preserves the light/dark choice during client navigation.

`luminous.css` owns role overrides and `--ds-accent-soft`, `--ds-workspace-glow`, and header aliases. Role-dependent surfaces use these aliases, while explicit `mint`, `sky`, `amber` data/card tones retain their meaning. The standalone design-system specimen keeps its independent local defaults. Shared workspace chrome consumes the system; the demo no longer owns its expert palette.

Scope: presentation only. Backend, service contracts, persistence, agent behavior, and live feature gates remain unchanged.
