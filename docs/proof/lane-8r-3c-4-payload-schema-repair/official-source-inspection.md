# Official Onchain OS 4.4.0 identity-source inspection

**Repository:** `okx/onchainos-skills`
**Tag:** `v4.4.0`
**Commit:** `782b5a05d9b0af797383009b0e5f0d4022b010e5`
**Inspected:** 2026-07-26

The tag and commit were resolved from the official GitHub repository. Source
files were fetched read-only from that exact tag and inspected without patching
or rebuilding the CLI.

| File | Git blob | Bytes | SHA-256 |
|---|---|---:|---|
| `cli/src/commands/agent_commerce/identity/models.rs` | `15a4cfb551b96658e813ecb1fbd0b2dfb22a65f8` | 5088 | `6fe2848c689e0498b6fab71522c731c5256b2449112951a291aae38c282bfe05` |
| `cli/src/commands/agent_commerce/identity/args.rs` | `20d3512069c582cf4048dd4088d639ff9aedf07a` | 19477 | `9712835dbec17e70b7af843d51910e31a28eab0843e851317799f974b61fe82f` |
| `cli/src/commands/agent_commerce/identity/validate.rs` | `15c4beca4b56cc7c1652007a0c0bb37cd9362c40` | 41370 | `3876b6dfdf97540101dd964f50eb0e3968a7f69af726828ddb497cabed3db37a` |
| `cli/src/commands/agent_commerce/identity/utils.rs` | `f3b91822746e3052cd5b747f5418d4a8a09dbad9` | 68210 | `2d913742f7db6665d60e67188ebc2ed6bf23df860bf9020e43cc670586668011` |

## `models.rs`

- `AgentService.id` is declared as `Option<String>`.
- `serviceName`, `serviceDescription`, and `serviceType` use the exact
  camel-case JSON keys.
- `operation` is an optional `ServiceOperation`; serde uses lowercase
  `create`, `update`, and `delete`.
- `fee` is a string and A2MCP `endpoint` is optional at model level but
  required by normalization/validation.

This directly explains why the Lane 8R.3C.0 numeric service ids failed model
deserialization before field-level validation.

## `args.rs`

- `UpdateArgs.service` is an incremental JSON array of create/update/delete
  service deltas.
- An update entry carries the existing service id.
- The service description is newline-separated:
  line 1 capability, line 2 user input, and line 3+ delivery.
- Each part is limited to 400 display-width units and the whole description to
  1200; URLs, 0x addresses, test markers, and guaranteed-profit language are
  prohibited.
- `ValidateListingArgs.service` documents the same element shape as
  create/update.

## `validate.rs`

- `validate-listing` is pure local and does not make HTTP/network calls.
- `parse_services_lenient` deserializes the provided JSON directly into
  `Vec<AgentService>`, the same model used by create/update.
- Any serde/model-deserialization error is collapsed into the blocking
  `service/PARSE` finding. Consequently, `service/PARSE` does not establish
  Windows argv corruption.
- A service description needs at least two non-empty lines. A third delivery
  line is recommended and was included in both Nobu entries.
- The validator checks service name, type, fee, endpoint, description
  structure, URLs, test markers, addresses, and guarantee language.

## `utils.rs`

- `parse_services` also deserializes to `Vec<AgentService>`.
- `normalize_service` trims and normalizes fields, requires A2MCP fee and
  endpoint, and validates numeric fee syntax.
- Operation/id consistency is explicit:
  `create` must not carry an id; `update` and `delete` require an id.
- Display-width counting matches the documented backend convention.

## Conclusion

The Node `spawnSync`, `shell:false`, explicit argument-array method remained
the correct transport candidate. The old payload failed because numeric ids
could not deserialize into `Option<String>`; both one-paragraph descriptions
would then have failed the separate multiline description rule. The corrected
candidate addresses those schema defects without changing its intended service
identity, pricing, endpoints, or capabilities.
