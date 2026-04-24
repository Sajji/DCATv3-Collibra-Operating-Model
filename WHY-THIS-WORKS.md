# Why This Solution Implements DCAT-US 3.0 in Collibra

This document explains what DCAT-US 3.0 is, how it models metadata, how Collibra models metadata, and why the mapping this tool creates is a faithful implementation of the standard. It is aimed at someone who knows Collibra reasonably well but has not looked at DCAT before.

---

## 1. What DCAT-US 3.0 is, in plain terms

**DCAT** ("Data Catalog Vocabulary") is a W3C standard for describing datasets on the web. It is a vocabulary — a fixed set of *things* (classes) and *attributes* (properties) that every tool can agree on so that catalogs from different organizations can be exchanged and compared.

**DCAT-US 3.0** is the U.S. government's "application profile" of DCAT — that is, it takes the generic W3C DCAT 3 vocabulary and tailors it to U.S. federal requirements. It is the successor to the Project Open Data (POD) 1.1 standard that Data.gov has used for the last decade. The full specification lives at https://doi-do.github.io/dcat-us/.

DCAT-US 3.0 adds three things on top of plain DCAT 3:

1. **U.S.-specific concepts.** Things the base W3C standard doesn't cover — Controlled Unclassified Information (CUI) markings required by NARA, liability statements, federally-specific access restrictions, a geographic bounding box class for geospatial data, and a reusable Identifier class.
2. **Mandated controlled vocabularies.** For certain properties (themes, file formats, agency names, access rights), you *must* pick values from the named controlled vocabulary. You cannot invent your own.
3. **SHACL shapes.** A formal, machine-checkable set of validation rules that say, for each class, which properties are mandatory, which are recommended, which are optional, and how many values each can have.

The goal is **FAIR** — Findable, Accessible, Interoperable, Reusable. When every federal agency describes its datasets with the same vocabulary and the same rules, Data.gov and cross-agency programs can aggregate, search, and cross-reference metadata without each agency having to do a custom integration.

### How DCAT-US 3.0 structures metadata

DCAT-US is built from three ingredients:

**Classes** are "things." A `dcat:Dataset` is a thing. A `dcat:Distribution` (a specific file or download of that dataset) is a thing. A `foaf:Agent` (a person or organization that publishes data) is a thing. Class names start with a capital letter. DCAT-US 3.0 defines six **core classes** — `Catalog`, `Catalog Record`, `Dataset`, `Distribution`, `Data Service`, `Dataset Series` — and roughly two dozen **supporting classes** (Agent, Contact, Location, Checksum, License Document, etc.).

**Properties** are attributes of things. They come in two flavors:

- *Literal properties* — a value that is just text, a number, or a date. `dcterms:title` holds a string. `dcterms:modified` holds a date. Property names start with a lowercase letter.
- *Object properties* — a value that is *another thing*. `dcterms:publisher` on a Dataset points at a `foaf:Agent`. `dcat:distribution` on a Dataset points at a `dcat:Distribution`. These are what make DCAT a graph rather than a flat record.

A third, special flavor — *reified relationships* — is a relationship that itself has attributes. `prov:Attribution` doesn't just say "Dataset X is related to Agent Y"; it says "Dataset X is related to Agent Y *with role 'steward'*." The relationship carries its own data. DCAT-US 3.0 has two of these: `dcat:Relationship` and `prov:Attribution`.

**SHACL shapes** are the rulebook. For each class, SHACL specifies which properties are:

- **Mandatory (M)** — the class is not valid without at least one value (min cardinality ≥ 1).
- **Recommended (R)** — should be provided if known, but the class is still valid without it (min cardinality 0).
- **Optional (O)** — may be provided (min cardinality 0).

And the max cardinality: most properties allow many values (0..n or 1..n), a few allow only one (0..1 or 1..1).

---

## 2. How Collibra models metadata

Collibra's operating model uses a different set of primitives, but they line up with DCAT-US cleanly once you see them side-by-side.

| Collibra primitive | What it is |
|---|---|
| **Community** | A top-level organizational container. Everything else lives inside a community. |
| **Domain** | A typed container inside a community. Each domain has a *domain type* (Asset Domain, Code List, Governance Asset Domain, etc.) that dictates what kinds of things can live in it. |
| **Asset Type** | The "class" — the definition of a kind of thing you can create instances of. Asset types form a hierarchy (parent/child). Every Collibra tenant has OOTB asset types like `BusinessAsset`, `GovernanceAsset`, `TechnicalAsset`, `CodeValue`, `CodeList`. |
| **Attribute Type** | A literal property definition — typed as STRING, NUMERIC, DATE, BOOLEAN, etc. A global definition, reused across asset types. |
| **Relation Type** | A binary link definition between two asset types, with a named *role* on the source side and a named *coRole* on the target side. |
| **Complex Relation Type** | A reified relationship. Unlike a normal relation, it has its own "legs" (each pointing at an asset type) and its own attributes. This is exactly what you need to represent things like `prov:Attribution`. |
| **Status** | A named lifecycle state (Draft, Published, etc.). Statuses are global. |
| **Assignment** | The thing that ties everything together for a given asset type. An assignment says, for asset type *T*: "these are the attribute types you're allowed to set, these are the relation types you're allowed to use, these are the statuses you can be in — and here are the min/max cardinalities for each." This is where SHACL-equivalent rules get enforced. |

The key insight is that **Collibra Assignments play the same role as SHACL shapes in DCAT-US**. Both say "for this class, here are the allowed properties and their cardinalities." Same rulebook, different syntax.

---

## 3. The mapping

This is the core of why the solution works. Every DCAT-US 3.0 modelling primitive maps to exactly one Collibra primitive:

| DCAT-US 3.0 concept | Collibra equivalent | How the tool creates it |
|---|---|---|
| Class (e.g. `dcat:Dataset`) | Asset Type | Phase 1, `data/asset-types.json` |
| Literal property (e.g. `dcterms:title`) | Attribute Type | Phase 2, `data/attribute-types.json` |
| Object property (e.g. `dcat:distribution`) | Relation Type | Phase 3, `data/relation-types.json` |
| Reified relationship (`dcat:Relationship`, `prov:Attribution`) | Complex Relation Type | Phase 3, `data/complex-relation-types.json` |
| `adms:status` / Catalog Record editorial flow | Status | Phase 4, `data/statuses.json` |
| SHACL shape (mandatory / recommended / optional + min/max cardinality) | Assignment on an Asset Type, with characteristic cardinalities | Phase 5, `assignments` block in `data/statuses.json` |
| `skos:ConceptScheme` (controlled vocabulary) | Code List domain, with Code Values | Reference Data Domain is created in Phase 1; actual vocabulary *content* is left for a later reference-data load (see "Out of scope" below) |
| Class hierarchy (e.g. `dcat:Catalog rdfs:subClassOf dcat:Dataset`) | Asset Type parent/child | The `parentKey` / `parentPublicId` fields in `data/asset-types.json` |
| Organizational grouping by topic area | Domain | Five domains in `data/community.json`: Catalog, Reference Data, Stakeholder, Governance, Spatial/Temporal |

Every single DCAT-US 3.0 construct has a direct Collibra home. There is nothing in the standard that required invention or a workaround.

---

## 4. Why each phase exists

The five-phase structure follows a strict dependency order. Each phase creates objects that later phases *reference*, and none of it can be reordered without breaking.

### Phase 1 — Skeleton (community, domains, asset types)

Creates the container (one `DCAT3 - DCAT-US 3.0 Profile` community), five domains sorted by topic (Catalog, Reference Data, Stakeholder, Governance, Spatial/Temporal), and ~32 asset types that directly mirror DCAT-US classes.

The asset type hierarchy respects DCAT's own class hierarchy. The standard says `dcat:Catalog rdfs:subClassOf dcat:Dataset rdfs:subClassOf dcat:Resource`, so the tool creates `DCAT3 Resource` first, then `DCAT3 Dataset` as its child, then `DCAT3 Catalog` as a child of Dataset. Properties defined on `dcat:Resource` (title, description, publisher, theme, access rights) naturally flow down to every subclass.

The six **brand-new DCAT-US 3.0 classes** (CUI Restriction, Access Restriction, Use Restriction, Liability Statement, Geographic Bounding Box, Identifier) are created as net-new asset types placed under the most appropriate OOTB Collibra parent — Governance assets for the restriction classes, Technical assets for Identifier and Checksum. This matters because those classes have no DCAT 1 or DCAT 2 equivalent, so they needed somewhere sensible to live in Collibra's asset hierarchy.

### Phase 2 — Attribute types

Creates ~35 attribute types for every DCAT-US property whose range is a literal (string, number, date). This includes the common Dublin Core ones (`dcterms:title`, `dcterms:description`, `dcterms:issued`, `dcterms:modified`, `dcterms:identifier`), vCard fields for contacts (`vcard:fn`, `vcard:hasEmail`, `vcard:tel`, etc.), the geographic bounding box coordinates as four numeric attributes, the two mandatory CUI attributes (`dcat-us:cuiBannerMarking`, `dcat-us:designationIndicator`), and the checksum value.

Attribute types in Collibra are *global* — a single `DCAT3 Title` attribute type is defined once and reused wherever the spec uses `dcterms:title`. That matches DCAT's own semantics: `dcterms:title` is one property, used by Catalog, Dataset, Distribution, Data Service, Concept Scheme, and Catalog Record.

### Phase 3 — Relation types and complex relation types

Creates ~45 binary relation types (`DCAT3 Catalog —contains dataset→ DCAT3 Dataset`, `DCAT3 Dataset —has distribution→ DCAT3 Distribution`, etc.) covering every DCAT-US object property. This is where the graph structure of the standard is encoded.

The role/coRole naming directly mirrors the DCAT property name and its inverse sense. `dcat:distribution` becomes role "has distribution" with coRole "is distribution of." This keeps the Collibra model human-readable and preserves the spec's directionality.

Two **complex relation types** are created for the two reified relationships in the standard:

- **DCAT3 Resource Relationship** implements `dcat:Relationship` — a relationship between two Resources that also carries a Role. Three legs (source resource, target resource, role) plus description and modification date.
- **DCAT3 Qualified Attribution** implements `prov:Attribution` — the link from a Resource to an Agent that also carries a Role (e.g., "Agent X is the steward of Dataset Y"). Three legs (resource, agent, role).

Without complex relations, you can't cleanly represent `prov:Attribution` in Collibra — a normal binary relation can't carry a Role of its own. This is the part of the mapping that most often gets skipped in naïve implementations, and its absence breaks the standard because `qualifiedAttribution` is a property every class in DCAT-US can use.

### Phase 4 — Statuses

Creates the five statuses (`Draft`, `Under Review`, `Published`, `Deprecated`, `Withdrawn`) that map to `adms:status` — specifically, the editorial flow that Catalog Records use to track "what state is this registration in." DCAT-US 3.0 defines `adms:status` as a recommended property on Catalog Record with range `skos:Concept`, and the five values above are the canonical editorial lifecycle per the spec.

Statuses are global in Collibra, so one definition serves every asset type that opts in via its assignment.

### Phase 5 — Assignments (the SHACL equivalent)

This is the phase that makes the whole thing *conformant* rather than just *structurally present*. An assignment on an asset type declares:

1. **Which statuses** it can hold (the subset of the global set).
2. **Which attribute types** it can have, with `min` and `max` — directly encoding DCAT-US's Mandatory / Recommended / Optional levels and cardinality.
3. **Which relation types** it participates in, and in which direction.

For example, the assignment on `DCAT3 Dataset` says `title` has min=1 (because DCAT-US 3.0 lists `dcterms:title` as **Mandatory 1..n** for Dataset) and max=9999, `keyword` has min=0/max=9999 (Optional 0..n), `version` has min=0/max=1 (Optional 0..1), and the relation `datasetHasDistribution` is wired in. The min=1 on title is what prevents a user from saving a Dataset without one — which is exactly what the DCAT-US SHACL shape requires.

The assignment for `DCAT3 CUI Restriction` encodes both of its mandatory attributes (`cuiBannerMarking` min=1 max=1, `designationIndicator` min=1 max=1) plus the optional `requiredIndicatorPerAuthority` (min=0 max=n). That's a direct translation of the `dcat-us:CuiRestriction` SHACL shape.

Phase 5 is where the model goes from "the right shapes exist" to "the right shapes are *enforced*."

---

## 5. Coverage against DCAT-US 3.0 conformance requirements

The spec's "Data Provider requirements" section lists what a conformant implementation must support. Here's how the tool addresses each:

| DCAT-US requirement | Addressed by |
|---|---|
| Describe Catalog with its mandatory properties | Phase 1 creates `DCAT3 Catalog` asset type; Phase 5 assignment enforces min=1 for title, description, publisher (via relation). |
| Describe Catalog Records (optional), with mandatory properties if used | Phase 1 creates `DCAT3 Catalog Record`; Phase 5 assignment enforces min=1 for `modificationDate` and the `catalogRecordPrimaryTopic` relation. |
| Describe Datasets with mandatory properties | Phase 1 creates `DCAT3 Dataset`; Phase 5 assignment enforces title, description minimums. |
| Describe Distributions with mandatory properties | Phase 1 creates `DCAT3 Distribution`; Phase 5 assignment wires relations to media type, checksum, license. |
| Describe Data Services with mandatory properties | Phase 1 creates `DCAT3 Data Service`; Phase 5 enforces min=1 for `title` and `endpointURL`. |
| Describe all Agents involved | Phase 1 creates `DCAT3 Agent`, `DCAT3 Organization`, `DCAT3 Person`. Relations `resourcePublishedBy` and `resourceCreatedBy` link Resources to Agents. |
| Support `prov:qualifiedAttribution` with Role | `DCAT3 Qualified Attribution` complex relation in Phase 3. |
| Handle new DCAT-US 3.0 classes (CUI, Access, Use, Liability, GeographicBoundingBox, Identifier) | All six created in Phase 1; relations in Phase 3; mandatory attribute cardinalities in Phase 5. |
| Support controlled vocabularies as `skos:ConceptScheme` | Phase 1 creates the `DCAT3 Reference Data Domain` and asset types `DCAT3 Concept Scheme` + `DCAT3 Concept` under OOTB `CodeList` / `CodeValue`. *Loading vocabulary content* (themes, formats, CUI categories) is deferred — see below. |
| Enforce cardinality / requirement level (M/R/O) | Phase 5 assignments. Min=1 → Mandatory. Min=0/max>1 → Recommended or Optional (distinguished by what the data sender *should* do, which is a convention layered on top and not a hard rule in Collibra). |
| Editorial flow (`adms:status`) for Catalog Records | Phase 4 statuses; Phase 5 assignment binds all five to Catalog Record (and to Catalog/Dataset/Distribution/DataService too). |

---

## 6. What the tool deliberately does not do

A faithful implementation of the standard is not the same as a *complete* data governance deployment. Three things are explicitly out of scope and left to follow-on work:

1. **Loading the content of controlled vocabularies.** The DCAT-US 3.0 spec mandates specific SKOS vocabularies for themes, file formats, access rights codes, CUI categories, NARA restriction codes, spatial areas, etc. The tool creates the *container* (`DCAT3 Reference Data Domain`, `DCAT3 Concept Scheme` asset type, `DCAT3 Concept` asset type) but does not ingest the vocabulary members. That is a separate SKOS → Reference Data Import job, best driven from the upstream SKOS files published alongside the spec.

2. **Full SHACL validation rules.** Collibra assignments enforce cardinality, but DCAT-US's SHACL shapes include richer constraints — regex on CUI banner markings, latitude range checks on bounding-box coordinates, value-in-vocabulary checks. Those should be authored as DGC data quality rules in a separate workflow.

3. **Catalog Record approval workflow (BPMN).** The five statuses exist and are wired to the right asset types, but no BPMN workflow is deployed to drive transitions between them (Draft → Under Review → Published, etc.). That's an artifact of the customer's governance process and is deliberately left to the governance team.

These gaps do not affect conformance of the *operating model*. A dataset modeled in this Collibra tenant will have all the right attributes, the right relations, the right mandatory-ness, and the right lifecycle hooks to exchange cleanly with any other DCAT-US 3.0 compliant system. Filling in the content of the vocabularies, the SHACL-style validation rules, and the approval workflow makes the deployment *operational*, not more *standards-compliant*.

---

## 7. Summary

DCAT-US 3.0 is, at its core, (a) a list of classes, (b) a list of properties attached to those classes, (c) cardinality and requirement-level rules for each property, and (d) mandated controlled vocabularies for certain fields. Collibra's operating model has a direct counterpart for each of those four things: asset types, attribute types + relation types, assignments with min/max, and code-list domains. The mapping is one-to-one with no semantic loss.

The five-phase import reflects that mapping directly: skeleton first (classes), then attributes (literal properties), then relations (object properties), then statuses (lifecycle), then assignments (the rulebook that binds everything together and enforces cardinality). Each phase is idempotent and verified, so the tool can be re-run safely and state is preserved across runs.

The result is a Collibra operating model that any DCAT-US 3.0 aware tool — including Data.gov ingestion pipelines — can interoperate with, while giving internal Collibra users a native, properly-typed, properly-constrained model to catalog their federal datasets against.
