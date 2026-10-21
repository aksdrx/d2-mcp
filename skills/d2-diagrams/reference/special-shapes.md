# Special Shapes: sql_table, class, sequence_diagram, text/code/LaTeX

## 1. sql_table (ER diagrams)

```d2
users: {
  shape: sql_table
  id: int {constraint: primary_key}        # rendered as PK
  org_id: int {constraint: foreign_key}    # FK
  email: varchar {constraint: [unique]}    # UNQ; array for multiple constraints
  "label": varchar                         # quote reserved words
  created_at: timestamp
}

orders: {
  shape: sql_table
  id: int {constraint: primary_key}
  user_id: int {constraint: foreign_key}
  total: numeric
}

orders.user_id -> users.id   # row-to-row edge (exact-row routing on ELK & TALA)
```

Recognized constraint shorthands: `primary_key`→PK, `foreign_key`→FK,
`unique`→UNQ. Anything else renders as-is.
Style hooks: `style.fill` = header color, `style.stroke` = body color.

## 2. class (UML class diagrams)

```d2
Animal: {
  shape: class
  +name: string        # + public, - private, # protected, none = public
  #age: int
  +speak(): string     # any key with ( is a method; value = return type
  -die()               # no value => void
}

Dog: {
  shape: class
  +breed: string
}

Animal <- Dog: inherits {
  target-arrowhead.shape: triangle   # UML generalization
}
```

- Escape reserved keys with quotes: `"label": string`.
- `style.fill` = header, `style.stroke` = body.

## 3. sequence_diagram

Set `shape: sequence_diagram` on a container; children become actors:

```d2
checkout: {
  shape: sequence_diagram
  user; web; api; db        # declaration order = left→right actor order

  user -> web: submit order
  web -> api: POST /orders

  auth: {                   # group (fragment/frame): unconnected container
    api -> db: verify token
    db -> api: ok
  }

  api -> db: insert order: {
    style.stroke-dash: 4    # style messages like any connection
  }

  api.note: retries 3x      # note: nested object, no connections
  api.t1 -> db: tx begin    # spans: connect nested objects on an actor
  db -> api.t1: committed   #   (t1 = activation bar / lifespan)
  web -> web: validate cart # self-message
}
```

Rules that differ from the rest of D2:
- **Order matters** — messages appear top→bottom in declaration order.
- **Flat scope** — all actors share one scope; `alice` in two groups is one actor.
- Inside a group, connected actors must exist at the top level (declare them first).

Extras:
- Lifelines inherit the actor's `style.stroke` / `stroke-dash`.
- Sequence diagrams are normal objects: contain them, connect to them, restyle them,
  even nest them inside grid cells.

## 4. Text, Markdown, code, LaTeX objects

```d2
# standalone text objects ARE markdown
spec: |md
  ## SLA
  - p99 < **250ms**
  - uptime 99.95%
|

# markdown label on a shape requires explicit declaration
box: {
  label: |md **bold** label |
}

snippet: |go
  func main() { fmt.Println("hi") }
|                         # syntax highlighting via Chroma; aliases md/tex/js/ts/go/py/rb

formula: |latex
  \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
|                         # MathJax — no linebreaks; use \displaylines

plain: {
  shape: text             # opt OUT of markdown rendering
  label: "literal **stars**"
}
```

LaTeX blocks ignore `font-size`; use `\tiny \small \normal \large \huge` inside.
