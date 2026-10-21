# D2 Syntax Reference

Distilled from https://d2lang.com/tour (v0.9.x). Everything here is valid D2.

## 1. Shapes

```d2
imAShape            # label defaults to key
im_a_shape
i'm a shape         # unquoted strings allow most punctuation
a-shape
SQLite; Cassandra   # semicolons separate statements on one line

pg: PostgreSQL      # key: Label
cloud: my cloud
cloud.shape: cloud  # shape type via reserved field

# or inline map:
db: PostgreSQL {
  shape: cylinder
}
```

- Keys are **case-insensitive** and must be unique per scope.
- Default shape type: `rectangle`.

### Shape catalog

`rectangle` `square` `page` `parallelogram` `document` `cylinder` `queue` `package`
`step` `callout` `stored_data` `person` `diamond` `oval` `circle` `hexagon` `cloud`
`c4-person`

Special shapes (see `special-shapes.md`): `class`, `sql_table`, `sequence_diagram`,
`code`, `text`, `image`.

`circle` and `square` keep a 1:1 aspect ratio (the larger of width/height wins).

## 2. Connections

```d2
a -> b                    # directed
b <- a                    # same, reversed
a -- b                    # undirected
a <-> b                   # bidirectional
a -> b: HTTPS             # label
a -> b -> c               # chaining
a -> b: {class: critical} # inline attributes
```

- Referencing an undeclared shape in a connection creates it.
- **Connect keys, not labels.** `Backend -> Frontend` after `be: Backend` creates
  NEW shapes named "Backend"/"Frontend".
- Repeated connections add parallel edges; they do not merge. Reference an existing
  one by index: `(a -> b)[0].style.stroke: red`.
- Cycles are fine.

### Arrowheads

```d2
a -> b: {
  source-arrowhead: 1
  target-arrowhead: {
    shape: diamond
    style.filled: true
    label: many
  }
}
```

Options: `triangle` (default), `arrow`, `diamond`, `circle`, `box`, `cross`,
`cf-one`, `cf-one-required`, `cf-many`, `cf-many-required` (crow's foot).
`triangle` supports `style.filled: false`; `diamond`/`circle`/`box` support
`style.filled: true`. Keep arrowhead labels short — they don't auto-layout.

## 3. Containers (nesting)

```d2
server: {
  api
  worker
}
server.process  # dotted access

clouds: {
  aws: AWS {
    lb -> api
    api -> db
  }
  gcloud: Google Cloud {
    auth -> db
  }
  aws -> gcloud: deploys
}

# container labels: shorthand or reserved keyword
gcloud: Google Cloud { ... }
gcloud: {
  label: Google Cloud
}

# inside a container, _ is the parent scope:
christmas: {
  presents
}
birthdays: {
  presents -> _.christmas.presents: regift
}
```

## 4. Strings & text

- Quotes usually unnecessary; use single or double quotes for reserved characters.
  Use double quotes + `\` escapes when text contains both quote types.
- `#` starts a line comment — quote URLs containing `#`.
- Block comments: `""" ... """`.
- Block strings for long text:
  ```d2
  description: |md
    # Markdown **here**
  |
  code: |go
    package main
  |
  weird: |||ts
    const x = (a > 1) || (b < 2)
  |||
  ```
  Fence chars: `|`, `||`, `|||`, or any non-alphanumeric symbol, e.g. `` |` ... `| ``.
- Language aliases: `md`→markdown, `tex`→latex, `js`/`ts`/`go`/`py`/`rb`→the language.
  Unknown languages render as plain text.

## 5. Labels, tooltips, links, icons

```d2
x: {
  label: Display name          # or shorthand: x: Display name
  tooltip: on-hover text       # plain text only (HTML title); add near: to pin it
  link: https://example.com    # click target (quote URLs with #)
  icon: https://icons.terrastruct.com/aws/_Group%20Icons/Virtual-private-cloud-VPC_light-bg.svg
}
title: My Diagram {near: top-center}   # classic title placement
```

Local icons work on the CLI: `icon: ./img/db.png`. Hosted catalog:
https://icons.d2lang.com. `shape: image` makes a standalone image object.

## 6. Variables & config

```d2
vars: {
  service-name: payments
  d2-config: {          # bake render config into the file
    layout-engine: tala # dagre | elk | tala
    theme-id: 105
    dark-theme-id: 200
    pad: 40
    sketch: true
    center: true
    # theme-overrides: { B1: "#2E7D32" ... }
  }
}

api: ${service-name} API   # substitution
'api: ${service-name}'     # single quotes bypass substitution
```

- Variables are lexically scoped; closer scope wins.
- Spread maps/arrays: `...${x}`.
- Precedence: CLI flags > env vars > `d2-config`.

## 7. Imports

```d2
models: @models            # whole file as a map (extension omitted)
svc: @lib/service.partial  # partial import of one object
container: {
  ...@shared               # spread import (inside maps only)
}
x: @"schema-v0.1.2"        # quote names containing .
```

- Paths are relative to the importing FILE, not the CWD. Absolute paths allowed
  (quote Windows paths: `@"C:\abs\path"`).
- Only `.d2` files are importable.
- Model-view pattern: define all objects once in `models.d2`, then multiple view
  files import them and define only the connections each view needs.

## 8. Overrides, null, globs

- Redeclaring merges. Latest explicit `label` wins.
- `x: null` deletes a shape (and its connections/descendants);
  `(a -> b)[0]: null` deletes a connection; `x.style.fill: null` deletes an attribute.

Globs — batch styling/connecting:

```d2
*.style.fill: yellow                 # all shapes in this scope
**.shape: circle                     # recursive (leaf shapes only for connections)
***.style.font-size: 18              # global: crosses layers & imports
* -> *                               # fully connect, self-connections omitted
(* -> *)[*].style.stroke-dash: 3     # style all connections
*: &connected: false                 # filter by reserved keyword/property
  style.opacity: 0.5
```

Filters: `&key: value`, `!&key: value` (inverse), AND across lines, endpoint filters
`&src: a` / `&dst: b` (absolute IDs). Property filters: `connected: true|false`,
`leaf: true|false`. `*` as a filter value means "attribute is set".

Change theme defaults globally:

```d2
*.style.border-radius: 8
(* -> *)[*].style.stroke-width: 2
```

### suspend / unsuspend — model-view cuts

Globs can also toggle *visibility*, which is the basis of the model-view pattern
(see `reference/models-views.md`):

```d2
**: suspend                  # hide every shape
(** -> **)[*]: suspend       # hide every connection

*: unsuspend                # reveal all (a full view)
(* -> *)[*]: unsuspend {    # or a filtered view: edges labeled 'charge'
  &label: charge
}
(** -> **)[*]: unsuspend {  # or: everything touching payments
  &dst: payments
}
```

Suspended shapes stay in the model (extractors still see them); they just don't
render — perfect for keeping one source of truth and cutting focused views.

## 9. Reserved keywords (don't use bare as keys)

`label` `shape` `icon` `tooltip` `link` `near` `width` `height` `top` `left`
`direction` `style` `class` `classes` `vars` `layers` `scenarios` `steps`
`grid-rows` `grid-columns` `grid-gap` `vertical-gap` `horizontal-gap`
`source-arrowhead` `target-arrowhead` `constraint` (in sql_table) `null`

Quote them when you must: `"label": string`.
