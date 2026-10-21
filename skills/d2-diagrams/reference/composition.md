# Composition: Layers, Scenarios, Steps & Multi-file Diagrams

## 1. Boards

Everything so far is the **root board**. Three keywords declare additional boards:

| Keyword | Inheritance | Use for |
|---|---|---|
| `layers` | none — blank board | levels of abstraction (C4 context → container → component) |
| `scenarios` | inherits base layer | alternate views of the same diagram (normal vs. incident) |
| `steps` | inherits previous step | sequences of states (deployment rollout, request flow) |

```d2
# root board
internet -> lb -> app -> db

layers: {
  detail: {                 # fresh board
    app: {svc1; svc2}
  }
}

scenarios: {
  incident: {               # inherits everything from root
    db.style.opacity: 0.3
    lb -> backup: failover
  }
}

steps: {
  deploy-1: {app.version: v1}   # inherits root
  deploy-2: {app.version: v2}   # inherits deploy-1
}
```

Boards can nest (`layers` inside `scenarios` …). Reference inherited objects and
override or `null` them per board.

## 2. Exporting compositions

```sh
d2 in.d2 out.pdf                                   # one page per board, clickable nav
d2 in.d2 out.pptx                                  # one slide per board
d2 --animate-interval=1500 in.d2 out.svg           # animated SVG cycling boards
d2 --animate-interval=1000 in.d2 out.gif           # looping GIF
d2 --target='scenarios.incident' in.d2 out.svg     # render a single board
d2 --target='layers.detail.*' in.d2 out.svg        # board + all its children
```

## 3. Linking between boards (interactive navigation)

```d2
app.link: layers.detail          # click app -> jumps to detail board
layers: {
  detail: {
    back.link: _                 # _ in link values = parent BOARD
  }
}
# board names containing dots need quotes: link: layers."2012.06"
```

PDF/SVG exports include a clickable breadcrumb bar.

## 4. Multi-file organization (model-view)

`models.d2` — every object defined once:

```d2
web: Web App
api: API {shape: hexagon}
db: PostgreSQL {shape: cylinder}
```

`access-view.d2` — only the connections this view shows:

```d2
...@models
user -> web -> api: HTTPS
api -> db: SQL
```

`ssh-view.d2`:

```d2
...@models
admin -> api: SSH
api -> db
```

- Regular import `x: @models` puts the file under key `x`; spread `...@models`
  merges it into the current map (spread works only inside maps).
- Globs in imported files do NOT carry over — except triple globs (`***`), which are
  global.
- Imports are relative to the importing file.

## 5. Practical patterns

- **C4 drill-down**: root = system context, `layers.containers`, deeper
  `layers.components`, connected with `link`s.
- **Incident review**: root = steady state, `scenarios.failure` dims healthy parts
  (`style.opacity: 0.2`) and highlights the failure path.
- **Rollout plan**: `steps.canary` → `steps.25-percent` → `steps.full`; export GIF.
- **Animate grids**: `--animate-interval` works on grid diagrams too.
