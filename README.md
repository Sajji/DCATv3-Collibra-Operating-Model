# DCAT3-Collibra-Import

Programmatic import of the **DCAT-US 3.0** profile into Collibra DGC via the Core REST 2.0 API.

This tool runs the import in five idempotent phases that match the design plan: skeleton → attribute types → relation types → statuses → assignments. Each phase verifies its work and persists every Collibra UUID it creates to a local `state/state.json` file, so re-runs never duplicate and later phases can reference earlier IDs.

## Requirements

- Node.js **18 or newer** (uses native `fetch`)
- A Collibra user account with permission to manage the operating model (Sysadmin or equivalent role with `createCommunity`, `createDomain`, `createAssetType`, `createAttributeType`, `createRelationType`, `createComplexRelationType`, `createStatus`, `createAssignment`)
- Network access from your machine to the Collibra DGC URL

## Quickstart

```bash
git clone <this-repo> dcat3-collibra-import
cd dcat3-collibra-import
npm install

cp .env.example .env
# edit .env and fill in COLLIBRA_BASE_URL, COLLIBRA_USERNAME, COLLIBRA_PASSWORD

# Always do a dry run first against a non-prod tenant
DRY_RUN=true npm run all

# When happy, run for real
npm run all
```

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Hits `/auth/sessions/current`, prints state summary, verifies every phase. Exit code 2 if anything is missing. |
| `npm run status` | Prints what's in `state/state.json` without calling the API. |
| `npm run phase1` | Phase 1 — community, domains, asset types. |
| `npm run phase2` | Phase 2 — attribute types. |
| `npm run phase3` | Phase 3 — relation types and complex relation types. |
| `npm run phase4` | Phase 4 — statuses. |
| `npm run phase5` | Phase 5 — assignments wiring everything together. |
| `npm run all` | Runs phases 1 → 5 in order, with verification after each. |
| `npm run rollback` | Best-effort teardown of every DCAT3 object this tool created. Requires `-- --confirm`. |

The CLI is also directly invokable: `node bin/dcat3-import.js <command>`.

## What gets created

All objects are prefixed `DCAT3 ` to avoid collision with OOTB Collibra and your existing model.

**Phase 1** — `DCAT3 - DCAT-US 3.0 Profile` community, 5 domains (Catalog, Reference Data, Stakeholder, Governance, Spatial/Temporal), and ~32 asset types under a `DCAT3 Resource` root. New DCAT-US 3.0 classes (CUI Restriction, Access Restriction, Use Restriction, Liability Statement, Geographic Bounding Box, Identifier) are created as net-new types under appropriate OOTB parents.

**Phase 2** — ~35 attribute types covering literal-valued DCAT-US properties (titles, descriptions, dates, URLs, identifiers, vCard fields, geographic bounds, CUI markings, etc.).

**Phase 3** — ~45 relation types between the new asset types (e.g. `DCAT3 Catalog --contains dataset--> DCAT3 Dataset`), plus 2 complex relation types (`DCAT3 Resource Relationship` for `dcat:Relationship`, `DCAT3 Qualified Attribution` for `prov:Attribution`).

**Phase 4** — 5 statuses for the Catalog Record editorial flow: Draft, Under Review, Published, Deprecated, Withdrawn.

**Phase 5** — Assignments that wire status sets + attribute cardinalities + relation cardinalities onto each asset type. This is where the Mandatory/Recommended/Optional + min/max cardinality rules from the DCAT-US 3.0 SHACL shapes get enforced.

## How idempotency works

Every "ensure" function does a name-based search before creating:

- **Communities, domains, asset types, complex relation types**: `GET .../?name=<X>&nameMatchMode=EXACT`
- **Attribute types, statuses**: `GET /attributeTypes/name/{name}` and `GET /statuses/name/{name}` (single-result endpoints, return 404 if absent)
- **Relation types**: `GET /relationTypes?sourceTypeId=...&targetTypeId=...&role=...&coRole=...` and exact-match filter

If the object exists, its ID is recorded into `state/state.json` and creation is skipped. Re-running any phase is safe.

## State file

`state/state.json` is the source of truth for what this tool has created. Schema:

```jsonc
{
  "version": 1,
  "createdAt": "2026-04-23T...",
  "lastUpdated": "2026-04-23T...",
  "phasesCompleted": [1, 2, 3, 4, 5],
  "community": { "id": "<uuid>", "name": "DCAT3 - DCAT-US 3.0 Profile" },
  "domains":     { "catalog": { "id": "<uuid>", "name": "DCAT3 Catalog Domain" }, ... },
  "assetTypes":  { "dataset": { "id": "<uuid>", "name": "DCAT3 Dataset", "parentId": "<uuid>" }, ... },
  "attributeTypes":  { "title": { ... }, ... },
  "relationTypes":   { "datasetHasDistribution": { ... }, ... },
  "complexRelationTypes": { "resourceRelationship": { ... }, ... },
  "statuses":    { "draft": { ... }, ... },
  "assignments": { "dataset": { "id": "<uuid>", "assetTypeId": "<uuid>" }, ... }
}
```

**Don't commit it** — it's in `.gitignore` because it contains tenant-specific UUIDs. If you blow it away, the next run will rediscover everything by name.

## Customising

The shape of what gets created is driven entirely by the JSON files under `data/`:

- `data/community.json` — community + domain layout
- `data/asset-types.json` — asset type hierarchy
- `data/attribute-types.json` — literal-valued properties
- `data/relation-types.json` — class-valued properties
- `data/complex-relation-types.json` — reified relationships
- `data/statuses.json` — statuses + assignment cardinalities

To add or rename an object, edit the relevant JSON file and re-run the corresponding phase. The `key` field on each item is the local stable identifier used by other JSON files — don't change `key` values once you've run a phase, or the idempotency check will see the renamed object as new.

## Dry-run mode

Set `DRY_RUN=true` in `.env` (or inline: `DRY_RUN=true npm run all`). All `GET` calls still execute (so idempotency checks still work), but every `POST`/`PATCH`/`DELETE` is logged and skipped. This lets you preview exactly what will hit the API before committing. Note that the state file is not updated in dry-run, so a real run still has full work to do afterwards.

## Rollback

```bash
node bin/dcat3-import.js rollback --confirm
```

Tears everything down in reverse dependency order: complex relations → relations → attributes → asset types (children first) → statuses → community (which cascades remaining domains).

This is best-effort — if you've manually attached additional things in Collibra (real assets, additional assignments, custom workflows) deletion may fail with a dependency error. Those failures are logged but not fatal.

## Phase ordering — why it matters

| Phase | Depends on |
|---|---|
| 1 | (nothing) |
| 2 | (nothing — attribute types are global) |
| 3 | Phase 1 (relation types reference asset type IDs) |
| 4 | (nothing — statuses are global) |
| 5 | Phases 1, 2, 3, 4 (assignments tie asset types to statuses + attribute types + relation types) |

Phase 2 and Phase 4 can run in parallel with Phase 1 if you wanted to optimise. The sequential script doesn't, because the time saved isn't worth the extra failure-mode complexity.

## What this tool does NOT do

- **Reference data load.** The plan's Phase 4 (controlled vocabularies — themes, formats, CUI categories, etc.) is not yet implemented; it should use the Reference Data Import API and is best driven by the upstream SKOS files. Add it as `data/reference-data.json` + a new phase script when you're ready.
- **Validation rules / DGC data quality rules.** The cardinalities in `data/statuses.json` cover assignment-level enforcement, but DCAT-US 3.0's full SHACL shapes are richer. Author those as DGC validation rules in a separate workflow.
- **Workflows.** No Catalog Record approval workflow is created; statuses are in place but the BPMN workflow that drives them between states is left to your governance team.
- **Actual catalog content.** This tool builds the *operating model*. Loading actual `DCAT3 Catalog` / `DCAT3 Dataset` instances is a separate ingestion task (Excel template, Import API, or Edge).

## Troubleshooting

**`401 Unauthorized`** — Check `COLLIBRA_USERNAME` / `COLLIBRA_PASSWORD`. Some tenants disable basic auth in favour of SSO; in that case provision a service account with basic-auth enabled.

**`self signed certificate` / `unable to verify the first certificate`** — Set `ALLOW_SELF_SIGNED_CERT=true` in `.env` for on-prem or lab environments using self-signed TLS certificates. This disables TLS certificate verification for outbound HTTPS calls from this tool, so use it only in trusted environments.

**`403 Forbidden` on POST** — The user lacks the relevant `create*` global permission. Add the user to a global role like *Sysadmin* or *Catalog Author* with operating-model create privileges.

**`409 Conflict` on a create** — Something with the same name already exists outside the path our search checked (e.g. an asset type was created under a different parent). Use Collibra's UI to find the duplicate and delete it, or rename it so the import can proceed.

**Could not resolve OOTB parent asset type "BusinessAsset"** — Your Collibra tenant uses a different `publicId` for the OOTB type. List the available types via `GET /assetTypes?limit=200` and adjust `parentPublicId` values in `data/asset-types.json`.

**Asset type create succeeds but parent comes back null** — The parent asset type was found by name but the relation didn't stick. Check that the parent asset type is in a community that the API user can read. Re-run phase 1; the existence check will see the now-orphan asset type and the assignment phase will still wire it correctly.

## File layout

```
.
├── bin/
│   └── dcat3-import.js       # CLI entry
├── data/                     # Declarative model definition (edit these)
│   ├── community.json
│   ├── asset-types.json
│   ├── attribute-types.json
│   ├── relation-types.json
│   ├── complex-relation-types.json
│   └── statuses.json
├── src/
│   ├── client.js             # CollibraClient — basic auth, idempotent helpers
│   ├── config.js             # Env loading + validation
│   ├── logger.js             # Leveled logger
│   ├── state.js              # state/state.json read/write
│   ├── verify.js             # verifyAuth + state assertions
│   ├── rollback.js           # Reverse-order teardown
│   └── phases/
│       ├── index.js          # Orchestrator
│       ├── phase1-skeleton.js
│       ├── phase2-attributes.js
│       ├── phase3-relations.js
│       ├── phase4-statuses.js
│       └── phase5-assignments.js
├── state/
│   └── state.json            # Created at runtime; gitignored
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## License

MIT.
